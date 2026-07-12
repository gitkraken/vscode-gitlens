import type { CancellationToken } from 'vscode';
import { CancellationTokenSource, Disposable, Uri } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitGraphRowType } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitRevisionReference, GitStashReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchId } from '@gitlens/git/utils/branch.utils.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { CoalescedRun } from '@gitlens/utils/coalescedRun.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual, updateRecordValue } from '@gitlens/utils/object.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import type { StoredGraphWipDraft } from '../../../constants.storage.js';
import type { Container } from '../../../container.js';
import { CommitFormatter } from '../../../git/formatters/commitFormatter.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getBranchRemote } from '../../../git/utils/-webview/branch.utils.js';
import { formatCommitStats } from '../../../git/utils/-webview/commit.utils.js';
import { countConflictMarkers } from '../../../git/utils/-webview/mergeConflicts.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import {
	getWorktreeHasUnpublishedCommits,
	getWorktreeHasWorkingChanges,
} from '../../../git/utils/-webview/worktree.utils.js';
import { toAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import type { IpcParams } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { GitBranchShape, Wip, WipStats } from './detailsProtocol.js';
import type {
	DidChangeWorkingTreeParams,
	GraphItemContext,
	GraphWipMetadataBySha,
	GraphWorkingTreeStats,
	SidebarWorktreeChange,
	SyncWipWatchesCommand,
} from './protocol.js';
import {
	createSecondaryWipSha,
	DidChangeWipDraftsNotification,
	DidChangeWorkingTreeNotification,
	DidRequestWipRefetchNotification,
	getSecondaryWipPath,
	isSecondaryWipSha,
} from './protocol.js';

/**
 * Grace period before a secondary-WIP filesystem watcher is disposed after its row leaves the
 * viewport. Lets scroll-past-then-back reuse the live watcher instead of thrashing.
 */
const wipWatchGracePeriodMs = 30_000;

// Minimal template used for the first line of the WIP row hover (avatar + author). The rest of the WIP
// tooltip is built directly in `getWipTooltip` to accommodate the optional worktree path and the
// "No working changes" fallback, neither of which is representable via formatter tokens.
const wipAuthorTemplate =
	// oxlint-disable-next-line no-template-curly-in-string
	'${avatar} &nbsp;__${author}__';

/** Collaborators the WIP/working-tree cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphWipContext()`. `getRepository`/`getSession` read live provider
 *  state; the rest forward to provider methods/state that stay there — revision refs, pinned-ref
 *  lookup, the sidebar-worktree RPC event, and the pending-notification queue. */
export type GraphWipServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getRevisionReference: (
		repoPath: string | undefined,
		id: string | undefined,
		type: GitGraphRowType | undefined,
	) => GitStashReference | GitRevisionReference | undefined;
	getPinnedRefId: (repoPath: string | undefined) => string | undefined;
	fireSidebarWorktreeChanges: (changes: Record<string, SidebarWorktreeChange | undefined>) => void;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Host-side WIP/working-tree cluster for the graph, split out of `GraphWebviewProvider` (R3). Owns
 *  the secondary-worktree watchers, the working-tree change/badge push pipeline, the shared status
 *  cache, and the WIP draft storage. The provider owns state/IPC and injects the collaborators via
 *  {@link GraphWipServiceContext}. */
export class GraphWipService {
	constructor(private readonly context: GraphWipServiceContext) {}

	private get container(): Container {
		return this.context.container;
	}
	private get host(): WebviewHost<'gitlens.views.graph' | 'gitlens.graph'> {
		return this.context.host;
	}
	private get repository(): GlRepository | undefined {
		return this.context.getRepository();
	}
	private get _graphSession(): GitGraphSession | undefined {
		return this.context.getSession();
	}

	private _disposed = false;

	private _computeWorktreeChangesPromise?: Promise<void>;
	private _pendingWorktreeChanges?: Parameters<typeof getWorktreeHasWorkingChanges>[1][];

	/** Per-secondary-WIP filesystem watchers, keyed by synthetic `worktree-wip::<path>` sha. */
	private readonly _wipWatches = new Map<string, Disposable>();

	/** Pending watcher-disposal timers; entries here mean "watcher is lingering past viewport exit". */
	private readonly _wipWatchRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	/** Per-secondary-WIP refetch coordination (timer + in-flight Promise), keyed by secondary WIP sha. */
	private readonly _wipRefetches = new Map<
		string,
		{
			timer?: ReturnType<typeof setTimeout>;
			repo: GlRepository;
			inFlight?: Promise<void>;
			dirty: boolean;
			/**
			 * A watcher tick fired while the graph was hidden, so its refetch was held back rather than
			 * run (a hidden graph shouldn't run `git status`). Flushed by `recoverDeferredSecondaryWip`
			 * on the next visibility/focus regain — mirrors the primary's pending-notification replay so
			 * secondary worktrees don't go stale across a hidden→shown transition.
			 */
			deferred?: boolean;
		}
	>();

	/**
	 * Per-secondary-worktree cache of `getStatus()` results, keyed by worktree path. Consulted on
	 * cold load (`GetWipStatsRequest`) for newly-visible rows that don't yet have stats; the FS
	 * watcher invalidates entries on real changes. The live-update path pushes WIP+stats directly
	 * via `DidRequestWipRefetchNotification` and bypasses this cache entirely.
	 */
	private readonly _wipStatusCache = new PromiseCache<string, GitStatus | undefined>({
		createTTL: 1000 * 10, // 10 seconds
	});

	private _wipProbeGeneration = 0;
	private _wipProbeCancellation: CancellationTokenSource | undefined;

	/**
	 * Coalesces concurrent `notifyDidChangeWorkingTree` triggers into a single in-flight call, with a
	 * trailing-edge re-fire when more triggers arrive while one is running. Crucially does NOT cancel
	 * the in-flight call — cancelling a `git status` mid-flight would return undefined and we'd skip
	 * the notification, leaving the webview's WIP view one tick behind reality. The previous
	 * `createCancellation('workingTree')` pattern was the source of that storm.
	 */
	private readonly _wipNotify = new CoalescedRun<boolean>(
		() => this.runNotifyDidChangeWorkingTree(),
		() => void this.notifyDidChangeWorkingTree(),
	);
	/** Last-sent payload — used to skip identical pushes. Working-tree watchers fire on any FS
	 *  event in the repo (file saves, branch metadata writes, lock-file twiddles), so most ticks
	 *  produce an unchanged status. Without this gate the webview re-renders the WIP details
	 *  panel on every tick even though nothing visible changed. Same intent as `_lastSentBranchState`
	 *  / `_lastSentWipDrafts`, but stamped AFTER notify resolves (with a repo-identity re-check)
	 *  to avoid poisoning the cache on transport failure or repo swap mid-await. Reset alongside
	 *  `_lastSentWipDrafts` in `setGraph(undefined)`. */
	private _lastSentWipNotificationParams: DidChangeWorkingTreeParams | undefined;

	/** Last working-tree count pushed to the view badge — skips redundant `host.badge` writes.
	 *  Reset to -1 (force re-set) on repo swap (`setGraph(undefined)`) and on setting toggle. */
	private _lastBadgeCount = -1;

	private _lastSentWipDrafts: Record<string, StoredGraphWipDraft> | undefined;
	private _lastSentWipDraftsInitialized = false;

	async syncWipWatches(params: IpcParams<typeof SyncWipWatchesCommand>): Promise<void> {
		const wanted = new Set(params.shas);

		// Schedule lazy disposal for watchers whose row left the viewport, or cancel a pending
		// disposal if the row is back in view. Rapid scroll-past-then-back reuses the same watcher.
		for (const sha of this._wipWatches.keys()) {
			if (wanted.has(sha)) {
				const pending = this._wipWatchRemoveTimers.get(sha);
				if (pending != null) {
					clearTimeout(pending);
					this._wipWatchRemoveTimers.delete(sha);
				}
				continue;
			}

			if (this._wipWatchRemoveTimers.has(sha)) continue;

			const timer = setTimeout(() => {
				this._wipWatchRemoveTimers.delete(sha);
				const d = this._wipWatches.get(sha);
				if (d == null) return;

				this._wipWatches.delete(sha);
				d.dispose();

				// Drop any pending debounced refetch for this sha. In-flight fetches are not
				// cancelled (matches the `_wipNotify` coalescer precedent) — the late notification
				// is a no-op because the state-provider gates writes on `prevSecondary != null`.
				const refetch = this._wipRefetches.get(sha);
				if (refetch != null) {
					if (refetch.timer != null) {
						clearTimeout(refetch.timer);
					}
					if (refetch.inFlight == null) {
						this._wipRefetches.delete(sha);
					}
				}
			}, wipWatchGracePeriodMs);
			this._wipWatchRemoveTimers.set(sha, timer);
		}

		// Open watchers for newly visible shas.
		for (const sha of wanted) {
			// Bail out entirely if the provider has been disposed mid-loop — `_wipWatches` was
			// cleared in `dispose()`, so subsequent `.set` calls below would leak watchers that
			// nothing ever tears down.
			if (this._disposed) break;
			if (this._wipWatches.has(sha)) continue;
			if (!isSecondaryWipSha(sha)) continue;

			const path = getSecondaryWipPath(sha);
			const repo = await this.container.git.getOrAddRepository(Uri.file(path), {
				opened: false,
				detectNested: true,
			});
			if (this._disposed) break;
			if (repo == null) continue;
			// Double-check: another concurrent call may have claimed this sha while we awaited.
			if (this._wipWatches.has(sha) || !wanted.has(sha)) continue;

			// Use the service-level watch facility so events fire regardless of whether the
			// `GlRepository` is open or closed — secondary worktrees are typically added with
			// `opened: false` (hidden), which leaves `repo.onDidChange` dead (a not-open repo holds
			// no repo-change watch lease). Going through `repo.git.watch()` routes around that gating
			// without flipping the repo to "open" (which would inflate `openRepositoryCount` and
			// surface the worktree in multi-repo UI).
			const watcher = await repo.git.watch({ workingTreeDelayMs: 500 });
			if (watcher == null) continue;
			// Re-check after the await — provider may have been disposed, or another sync may have
			// claimed this sha.
			if (this._disposed || this._wipWatches.has(sha) || !wanted.has(sha)) {
				watcher.dispose();
				if (this._disposed) break;
				continue;
			}

			this._wipWatches.set(
				sha,
				Disposable.from(
					watcher.onDidChangeWorkingTree(() => {
						this._wipStatusCache.invalidate(path);
						this.queueWipRefetch(sha, repo);
					}),
					// `onDidChangeWorkingTree` covers FS edits to tracked/untracked files. Index,
					// `.gitignore` edits, paused-op, and branch-tracking changes (staging from the
					// CLI, ignoring/un-ignoring files, rebase progress, fetch/publish) only surface
					// via the structural `onDidChange` event — mirror the WIP triggers the primary
					// fires from `onRepositoryChanged` (see `index`/`ignores` and
					// `head`/`heads`/`remotes`) so the secondary panel stays reactive to those same
					// changes.
					watcher.onDidChange(e => {
						if (!e.changed('index', 'ignores', 'pausedOp', 'head', 'heads', 'remotes', 'config')) return;

						this._wipStatusCache.invalidate(path);
						this.queueWipRefetch(sha, repo);
					}),
					watcher,
				),
			);
		}
	}

	private queueWipRefetch(sha: string, repo: GlRepository) {
		let entry = this._wipRefetches.get(sha);
		if (entry == null) {
			entry = { repo: repo, dirty: false };
			this._wipRefetches.set(sha, entry);
		} else {
			entry.repo = repo;
		}

		// Concurrent fetch will absorb this change via the `dirty` flag and re-fire on
		// completion — don't run a second `git status` for the same worktree in parallel.
		if (entry.inFlight != null) {
			entry.dirty = true;
			return;
		}

		if (entry.timer != null) {
			clearTimeout(entry.timer);
		}
		entry.timer = setTimeout(() => {
			entry.timer = undefined;
			void this.runWipRefetch(sha);
		}, 250);
	}

	private async runWipRefetch(sha: string): Promise<void> {
		const entry = this._wipRefetches.get(sha);
		if (entry == null) return;
		// Watcher disposed during debounce, or webview gone — drop without a fetch.
		if (!this._wipWatches.has(sha) || !this.host.ready) {
			this._wipRefetches.delete(sha);
			return;
		}
		// Graph hidden — defer rather than drop. Running `git status` for an unseen panel is wasted
		// work, but silently discarding the tick would leave the secondary's WIP/paused-op stale with
		// no recovery (unlike the primary, which queues a pending notification and replays on show).
		// Keep the entry and mark it deferred; `recoverDeferredSecondaryWip` flushes it on the next
		// visibility/focus regain.
		if (!this.host.visible) {
			entry.deferred = true;
			return;
		}

		entry.deferred = false;

		const promise = (async () => {
			try {
				const result = await this.getWipForRepoAndStats(entry.repo);
				if (result == null) return;
				// Only bail if the whole provider is gone. Deliberately DON'T gate on
				// `!this._wipWatches.has(sha)`: the grace-period timer can dispose this row's watcher
				// while this fetch is in flight, but the worktree is still tracked in
				// `wipMetadataBySha`, so delivering the fresh stats keeps the row correct when it
				// scrolls back into view (otherwise the update is silently dropped and the row stays
				// stale). The stateProvider ignores notifications for rows it no longer tracks (its
				// `prevSecondary != null` gate). Don't gate on `host.ready` either — `host.notify`
				// queues when not ready and replays on reconnect.
				if (this._disposed) return;

				void this.host.notify(DidRequestWipRefetchNotification, {
					repoPath: entry.repo.path,
					wip: result.wip,
				});
			} finally {
				entry.inFlight = undefined;
				if (entry.dirty) {
					entry.dirty = false;
					// Re-arm immediately — the in-flight already absorbed the debounce window.
					void this.runWipRefetch(sha);
				} else {
					// `entry.timer` is always null here: queueWipRefetch short-circuits while
					// `inFlight` is set, so no new timer can have been armed during the fetch.
					this._wipRefetches.delete(sha);
				}
			}
		})();
		entry.inFlight = promise;
		await promise;
	}

	/**
	 * Flush secondary-WIP refetches that a watcher tick deferred while the graph was hidden (see
	 * `runWipRefetch`). Re-queues only entries flagged `deferred`, so a normal hide→show with no
	 * pending change does zero git work; the `queueWipRefetch`/`runWipRefetch` in-flight+dirty dedup
	 * collapses any overlap (visibility + focus both firing, or a flush racing a fresh tick) into a
	 * single status read. Restores the `getWipState().isLive` invariant — the cache becomes current
	 * again, so the in-graph paused-op badge updates and the details panel's select-time
	 * revalidation can keep trusting `isLive`.
	 */
	recoverDeferredSecondaryWip(): void {
		if (this._disposed || !this.host.ready || !this.host.visible) return;

		for (const [sha, entry] of this._wipRefetches) {
			if (!entry.deferred) continue;

			entry.deferred = false;
			this.queueWipRefetch(sha, entry.repo);
		}
	}

	/** Lazy escalation for the rare case where both the initial-state stats fetch AND the
	 *  500ms one-shot retry returned undefined (git busy / locked / antivirus during ready-up).
	 *  `_lastSentWipNotificationParams == null` means no authoritative working-tree push has ever
	 *  landed for this graph — so the header/row badges are rendering nothing. Recover on the
	 *  next visibility/focus transition: cheap (a single `git status` only when actually needed)
	 *  and aligned with when the user is actually looking. No-op once any push has succeeded. */
	recoverWorkingTreeStatsIfStuck(): void {
		if (this._disposed || this.repository == null) return;
		if (this._lastSentWipNotificationParams != null) return;

		void this.notifyDidChangeWorkingTree();
	}

	computeWorktreeChanges(worktrees: Parameters<typeof getWorktreeHasWorkingChanges>[1][]): void {
		if (this._computeWorktreeChangesPromise != null) {
			this._pendingWorktreeChanges = worktrees;
			return;
		}

		this._computeWorktreeChangesPromise = this.doComputeWorktreeChanges(worktrees).finally(() => {
			this._computeWorktreeChangesPromise = undefined;
			const pending = this._pendingWorktreeChanges;
			this._pendingWorktreeChanges = undefined;
			if (pending != null) {
				this.computeWorktreeChanges(pending);
			}
		});
	}

	private async doComputeWorktreeChanges(worktrees: Parameters<typeof getWorktreeHasWorkingChanges>[1][]) {
		try {
			const results = await Promise.allSettled(
				worktrees.map(async w => {
					if (w.type === 'bare') return [w.uri.fsPath, undefined] as const;

					// Route through `_wipStatusCache` so the worktrees panel shares status data
					// with the WIP/overview paths — when the per-event push has just populated the
					// cache for this worktree, the panel fetch is free.
					const path = w.uri.fsPath;
					const svc = this.container.git.getRepositoryService(path);
					const status = await this._wipStatusCache.getOrCreate(path, (_cacheable, factorySignal) =>
						svc.status.getStatus(undefined, factorySignal),
					);
					const entry: SidebarWorktreeChange | undefined =
						status != null
							? { hasChanges: status.files.length > 0, workingTreeState: status.diffStatus }
							: undefined;
					return [path, entry] as const;
				}),
			);

			const changes: Record<string, SidebarWorktreeChange | undefined> = {};
			for (const result of results) {
				if (result.status === 'fulfilled') {
					changes[result.value[0]] = result.value[1];
				}
			}

			this.context.fireSidebarWorktreeChanges(changes);
		} catch {
			// Ignore — non-critical async enhancement
		}
	}

	/** Mirrors the SCM view's change-count badge onto the Graph's panel-tab view. Only the panel
	 *  WebviewView can carry a badge (`host.is('view')`); the editor-tab variant no-ops. */
	updateWorkingTreeBadge(stats: { added: number; deleted: number; modified: number } | undefined): void {
		if (!this.host.is('view') || !configuration.get('graph.showWorkingTreeBadge')) return;

		const count = stats != null ? stats.added + stats.deleted + stats.modified : 0;
		if (count === this._lastBadgeCount) return;

		this._lastBadgeCount = count;
		// Panel-container views ignore `badge = undefined`, so a zeroed value renders as no badge.
		this.host.badge =
			count > 0
				? { value: count, tooltip: `${count} working tree change${count === 1 ? '' : 's'}` }
				: { value: 0, tooltip: '' };
	}

	notifyDidChangeWorkingTree(): Promise<boolean> {
		return this._wipNotify.run();
	}

	/** Recovery for transient initial-state cancellations. Fires once shortly after a `getState`
	 *  whose `getWorkingTreeStatsAndPausedOperations` returned undefined — without it, the
	 *  webview would sit on `workingTreeStats: undefined` (and the header/row badges would render
	 *  nothing) until an unrelated FS event happened to trigger the watcher.
	 *
	 *  Resets the dedup cache before re-notifying so a prior stale-but-non-null
	 *  `_lastSentWipNotificationParams` (e.g. a partial push during ready-up) can't dedup-equal
	 *  the corrective payload and suppress it — the whole point of the retry is to force a
	 *  fresh push through. The repo-identity guard inside `runNotifyDidChangeWorkingTree` still
	 *  protects against pushing for a stale repo if the user swapped during the 500ms window. */
	scheduleInitialWorkingTreeStatsRetry(): void {
		setTimeout(() => {
			if (this._disposed || this.repository == null) return;

			this._lastSentWipNotificationParams = undefined;
			void this.notifyDidChangeWorkingTree();
		}, 500);
	}

	@trace()
	private async runNotifyDidChangeWorkingTree(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.context.addPendingNotification(DidChangeWorkingTreeNotification);

			// The webview can't update while hidden, but the panel-tab badge should stay live (matches
			// SCM). Recompute the count off a lightweight status — only when a badge actually exists
			// (panel view + setting enabled), so the editor variant and disabled case stay zero-cost.
			// Fire-and-forget to keep the early return fast; guard the repo identity in the callback,
			// and skip undefined (cancelled/failed) so we never fabricate a zero and clear the badge.
			if (this.host.is('view') && configuration.get('graph.showWorkingTreeBadge') && this.repository != null) {
				const repo = this.repository;
				void this.getWorkingTreeStatsAndPausedOperations().then(stats => {
					if (stats != null && this.repository === repo) {
						this.updateWorkingTreeBadge(stats);
					}
				});
			}
			return false;
		}

		const repo = this.repository;
		if (repo == null || !this.container.git.repositoryCount) return false;

		// Working-tree event means this repo's status has changed; drop any cached `_wipStatusCache`
		// entry so the fetch below sees fresh data. Mirrors the secondary worktree watcher's
		// invalidate-then-refetch pattern (see `_wipWatches` setup) — without this, rapid-succession
		// primary edits within the 10s TTL would serve stale data through the per-event push.
		this._wipStatusCache.invalidate(repo.path);

		// Single `git status` per working-tree tick. The details panel previously did a second
		// `getWip` RPC after the host sent stats — both runs returned the same status data, just
		// derived differently. Pushing the full WIP here eliminates the round-trip AND removes
		// the dedup gymnastics that used to mis-skip mixed↔fully-staged transitions: the panel
		// just applies whatever the host last sent.
		// Guarded: callers `void` this per-FS-event path, so a throw (e.g. `getWipMetadataBySha`'s
		// worktree feature-support check on an old git) would surface as an unhandled rejection.
		// Skipping the push matches the failed-status handling below; the next tick re-tries (the
		// coalescer's trailing refire still runs — it refires on settle, resolve or reject alike).
		let wipAndStatsResult;
		let wipMetadataBySha;
		try {
			[wipAndStatsResult, wipMetadataBySha] = await Promise.all([
				this.getWipForRepoAndStats(repo),
				this.getWipMetadataBySha(),
			]);
		} catch (ex) {
			Logger.debug(`GraphWipService: working-tree push failed; skipping; ${String(ex)}`);
			return false;
		}

		// Failed status fetch (cancelled / hard error) — skip the notification rather than pushing
		// a fabricated zero state. The next tick re-tries.
		if (wipAndStatsResult === undefined) return false;

		// Drop the push if the active repo changed during the await — pushing RepoA's WIP after
		// the user switched to RepoB would corrupt the webview's view of "what repo's WIP this is"
		// and pin the wrong payload in `_lastSentWipNotificationParams`, blocking the legitimate
		// next push for the new repo. The new repo's own watcher tick will produce a fresh push.
		if (this.repository !== repo) return false;

		// Update the panel-tab badge from the same status we just fetched — no extra git cost.
		this.updateWorkingTreeBadge(wipAndStatsResult.wip.stats);

		// Overview entries for this repo's branch are updated inline by the webview's notification
		// handler from the same `wip` payload above (`mergeOverviewWipForRepo`). The previous bulk
		// fanout that re-probed every visible branch on every primary FS event is gone — non-live
		// entries (opened worktrees whose graph WIP row is off-screen) refresh lazily when the
		// overview panel becomes visible, served from `_wipStatusCache` when warm.
		const params: DidChangeWorkingTreeParams = {
			wipMetadataBySha: wipMetadataBySha,
			wip: wipAndStatsResult.wip,
			repoPath: repo.path,
		};
		// Skip identical pushes. Working-tree events fire on any FS write in the repo (file saves,
		// `.git/index.lock` twiddles, branch-metadata writes), so most ticks reproduce the prior
		// status verbatim. Comparing the whole params object is safe: `wipMetadataBySha` and `wip`
		// (with stats embedded as `wip.stats`) all derive from the same `git status` — when `wip`
		// is unchanged the others are too. Same dedup pattern as `_lastSentBranchState`.
		if (this._lastSentWipNotificationParams != null && areEqual(this._lastSentWipNotificationParams, params)) {
			return false;
		}

		// Stamp the cache only AFTER the notify resolves successfully (avoids cache poisoning on
		// transport failure — a stamped-then-failed pattern would skip the corrective next-tick
		// push when params haven't changed). Also re-check `this.repository === repo` inside the
		// `.then`: between the await starting and resolving, the user may have switched repos and
		// `setGraph(undefined)` may have cleared the cache. Without the re-check, the resolved-
		// successfully notify (for the OLD repo's payload) would re-pin stale params into the
		// just-cleared cache, blocking the NEW repo's first push.
		return this.host.notify(DidChangeWorkingTreeNotification, params).then(success => {
			if (success && this.repository === repo) {
				this._lastSentWipNotificationParams = params;
			}
			return success;
		});
	}

	@trace()
	async notifyDidChangeWipDrafts(): Promise<boolean> {
		if (this.repository == null) return false;
		if (!this.host.ready || !this.host.visible) {
			this.context.addPendingNotification(DidChangeWipDraftsNotification);
			return false;
		}

		// Slice the storage record to entries this panel's repo can display so an unrelated
		// repo's keystroke doesn't fan a full cross-repo map to every open graph instance.
		// Self-echo from this panel's own write short-circuits via the `areEqual` check below.
		// Use a separate `_initialized` flag rather than a `!== undefined` sentinel so the
		// short-circuit also covers the "storage is empty, slice is undefined" case after the
		// first send — otherwise every storage event would re-send `{ wipDrafts: undefined }`.
		const slice = this.sliceWipDraftsForPanel();
		if (this._lastSentWipDraftsInitialized && areEqual(this._lastSentWipDrafts, slice)) {
			return false;
		}

		this._lastSentWipDrafts = slice;
		this._lastSentWipDraftsInitialized = true;
		return this.host.notify(DidChangeWipDraftsNotification, { wipDrafts: slice });
	}

	sliceWipDraftsForPanel(): Record<string, StoredGraphWipDraft> | undefined {
		const all = this.container.storage.getWorkspace('graph:wipDrafts');
		if (all == null) return undefined;

		const repoPath = this.repository?.path;
		const worktrees = this._graphSession?.current.worktrees;
		// Pre-graph load — fall back to the full map so initial state isn't blanked.
		if (repoPath == null || worktrees == null) return all;

		const paths = new Set<string>([repoPath]);
		for (const wt of worktrees) {
			paths.add(wt.path);
		}
		const slice: Record<string, StoredGraphWipDraft> = {};
		for (const path of paths) {
			const draft = all[path];
			if (draft != null) {
				slice[path] = draft;
			}
		}
		return slice;
	}

	async getWipTooltip(commit: GitCommit, cancellation: CancellationToken, worktree?: GitWorktree): Promise<string> {
		const [authorLine] = await Promise.all([
			CommitFormatter.fromTemplateAsync(
				wipAuthorTemplate,
				commit,
				{ source: 'graph' },
				{ outputFormat: 'markdown' },
			),
			GitCommit.ensureFullDetails(commit, { include: { stats: true } }),
		]);

		if (cancellation.isCancellationRequested) throw new CancellationError();

		const workingTreeLine =
			worktree != null ? `\`Working Tree\` &nbsp;$(folder) \`${worktree.uri.fsPath}\`` : '`Working Tree`';

		const statsShort = formatCommitStats(commit.stats, 'stats', { color: true });
		const statsExpanded = formatCommitStats(commit.stats, 'expanded', {
			addParenthesesToFileStats: true,
			color: true,
			separator: ', ',
		});
		const statsLine = statsShort
			? statsExpanded
				? `${statsShort} ${statsExpanded}`
				: statsShort
			: 'No working changes';

		return `${authorLine}\\\n${workingTreeLine}\\\n${statsLine}`;
	}

	/** Runs the worktree clean/dirty probe OFF the load path and pushes the enriched metadata
	 *  through the guarded working-tree channel (the webview's `mergeWipMetadata` folds the probe
	 *  fields into whatever anchors it already has). */
	probeSecondaryWipInBackground(): void {
		const generation = ++this._wipProbeGeneration;
		// Cancel the superseded generation's fan-out: its results would be discarded by the generation
		// guard below anyway, so letting up to 4 git probes per stale generation run to completion only
		// stacks processes (rapid reloads / repo swaps) with no cross-generation bound.
		this._wipProbeCancellation?.cancel();
		this._wipProbeCancellation?.dispose();
		const cancellable = new CancellationTokenSource();
		this._wipProbeCancellation = cancellable;

		const repo = this.repository;
		void (async () => {
			try {
				const metadata = await this.getWipMetadataBySha(cancellable.token, { probeChanges: true });
				if (this._disposed || generation !== this._wipProbeGeneration || this.repository !== repo) return;
				if (repo == null || Object.keys(metadata).length === 0) return;

				await this.host.notify(DidChangeWorkingTreeNotification, {
					repoPath: repo.path,
					wipMetadataBySha: metadata,
				});
			} catch {
			} finally {
				if (this._wipProbeCancellation === cancellable) {
					this._wipProbeCancellation = undefined;
				}
				cancellable.dispose();
			}
		})();
	}

	@trace({ exit: r => `secondaryWorktrees=${Object.keys(r).length}` })
	async getWipMetadataBySha(
		cancellation?: CancellationToken,
		options?: { probeChanges?: boolean },
	): Promise<GraphWipMetadataBySha> {
		const result: GraphWipMetadataBySha = {};
		// Capture the active repo at entry so the post-await reads below see a stable target. If
		// the user switches repos while `getWorktrees` is in flight, `this.repository` may have
		// moved to a different repo by the time we filter and assemble — the captured `repo` keeps
		// the function's output internally consistent (matches the worktrees it just fetched).
		const repo = this.repository;
		if (repo == null) return result;

		const worktrees = await repo.git.worktrees?.getWorktrees(toAbortSignal(cancellation));
		if (!worktrees?.length) return result;

		// Cheap clean/dirty probe per secondary worktree — ONLY when `probeChanges` is set (the
		// graph-load build), never on the per-working-tree-tick push, so we don't re-stat every
		// worktree on each FS event (the bulk fanout the per-tick path deliberately dropped).
		// `getWorktreeHasWorkingChanges` (`git diff --quiet` + untracked probe) short-circuits and
		// is far cheaper than the full stats the WIP bar fetches lazily on hover. Lets the bar
		// surface a worktree that has changes before its `workDirStats` are ever requested; visible
		// rows derive clean/dirty from their fetched `workDirStats` instead and ignore this.
		let hasChangesByPath: Map<string, boolean | undefined> | undefined;
		// Per local-only secondary worktree (branch without an upstream): cheap `rev-list --not --remotes`
		// presence probe so the WIP bar can flag unpushed commits. Tracked branches get their ahead count
		// for free from `branch.upstream.state` (computed in the loop below), so they're NOT probed here.
		// Gated on `probeChanges` like the dirty probe, and skipped entirely when the repo has no remotes
		// (with none, every local branch would falsely read as unpushed). Preserved client-side by
		// `mergeWipMetadata` between graph loads.
		let hasUnpushedByPath: Map<string, boolean | undefined> | undefined;
		if (options?.probeChanges) {
			const changesMap = new Map<string, boolean | undefined>();
			const unpushedMap = new Map<string, boolean | undefined>();
			const hasRemotes = (await repo.git.remotes.getRemotes(undefined, toAbortSignal(cancellation))).length > 0;
			// Bounded concurrency ON PURPOSE: an all-at-once fan-out across many worktrees spawns a
			// git-process storm (`diff --quiet` + `ls-files` each) that starves whatever else is
			// touching the repo — most visibly the graph's own rows walk during a load.
			const targets = worktrees.filter(wt => wt.type !== 'bare' && wt.path !== repo.path);
			const probeConcurrency = 4;
			let nextTarget = 0;
			await Promise.allSettled(
				Array.from({ length: Math.min(probeConcurrency, targets.length) }, async () => {
					while (nextTarget < targets.length) {
						if (cancellation?.isCancellationRequested) return;

						const wt = targets[nextTarget++];
						changesMap.set(wt.path, await getWorktreeHasWorkingChanges(this.container, wt));
						if (hasRemotes && wt.branch != null && wt.branch.upstream == null) {
							unpushedMap.set(wt.path, await getWorktreeHasUnpublishedCommits(this.container, wt));
						}
					}
				}),
			);
			hasChangesByPath = changesMap;
			hasUnpushedByPath = unpushedMap;
		}

		// All known worktrees other than the primary (which is already covered by workingTreeStats).
		// Emit row-anchor metadata only; workDirStats are fetched on-demand via GetWipStatsRequest
		// when the GK component fires onWipShasMissingStats for visible rows.
		// Always return an object (empty when no secondaries) — undefined would be dropped by
		// JSON.stringify, and the webview's `DidChangeNotification` handler only refreshes
		// `wipMetadataBySha` when the field is present, so removing the last secondary worktree
		// would leave a phantom anchor in the webview state until another full push arrived.
		for (const wt of worktrees) {
			if (wt.type === 'bare' || wt.sha == null) continue;
			if (wt.path === repo.path) continue;

			// Use the MAIN repo's path for branchRef so it matches the format scope uses (see
			// `setScope` in graph-app.ts) — `GitWorktree.repoPath` is the main repo's path anyway.
			// Detached worktrees have no `wt.branch`; leaving `branchRef` undefined defers them
			// to the graph component's SHA filter.
			const branchName = wt.branch?.name;
			// Unpushed state. Tracked branches: `ahead` (free, every build) drives both the hover count
			// and the `↑` (`ahead > 0`). Local-only branches (no upstream): no count — the `↑` comes from
			// the probe above (probe build only; preserved between loads by `mergeWipMetadata`).
			const ahead = wt.branch?.upstream?.state.ahead;
			let hasUnpushed: boolean | undefined;
			if (wt.branch?.upstream != null) {
				hasUnpushed = (ahead ?? 0) > 0;
			} else if (hasUnpushedByPath != null) {
				hasUnpushed = hasUnpushedByPath.get(wt.path);
			}
			result[createSecondaryWipSha(wt.path)] = {
				repoPath: wt.path,
				parentSha: wt.sha,
				// HEAD commit date (epoch ms) — `GitWorktree.date` is `branch.date`, no extra git
				// work. Sent on every build so the WIP bar's recency ordering stays current.
				parentDate: wt.date?.getTime(),
				// Only attach when probed; omitted on per-tick pushes and preserved client-side by
				// `mergeWipMetadata` so the bar doesn't lose a worktree's dirty bit between loads.
				...(hasChangesByPath?.has(wt.path) ? { hasChanges: hasChangesByPath.get(wt.path) } : {}),
				// Free, every build — attached even at 0 so a push (ahead → 0) clears the stale count.
				...(ahead != null ? { ahead: ahead } : {}),
				// Tracked: definite every build. Local-only: probe build only; omitted on per-tick and
				// preserved client-side by `mergeWipMetadata`.
				...(hasUnpushed != null ? { hasUnpushed: hasUnpushed } : {}),
				label: wt.name,
				branchRef: branchName != null ? getBranchId(repo.path, false, branchName) : undefined,
			};
		}

		return result;
	}

	/**
	 * Builds the full WIP payload and derived stats from a single `git status` call. Used by
	 * both `runNotifyDidChangeWorkingTree` (pushed to the webview every working-tree tick) and
	 * the inspect `getWip` (cold-load path on first WIP selection). Consolidating into one
	 * helper avoids a second `git status` per event — the panel used to fetch `getWip` after
	 * receiving the stats notification, running the same query twice.
	 */
	async getWipForRepoAndStats(
		repo: GlRepository,
		signal?: AbortSignal,
		options?: { bypassCache?: boolean },
	): Promise<{ wip: Wip } | undefined> {
		signal?.throwIfAborted();

		const svc = this.container.git.getRepositoryService(repo.path);
		// Route `getStatus` through `_wipStatusCache` so every WIP/overview/worktrees code path
		// shares the same status data within the cache's TTL — FS-watcher invalidations keep it
		// honest, and the lazy overview-panel-visibility refresh + worktrees-panel fetch get
		// served from cache when warm (often right after we just populated it here).
		//
		// `bypassCache` (user-initiated refresh) runs a separate `git status` OUTSIDE the cache.
		// We don't invalidate or write back — invalidate would fire the shared `AbortAggregate`
		// and could cancel a concurrent watcher fetch; a write-back is unsafe because the prior
		// in-flight entry's settle handler can delete our freshly-set value. Other consumers
		// self-correct within the cache TTL via the next FS-watcher tick.
		const statusFetch = options?.bypassCache
			? svc.status.getStatus(undefined, signal)
			: this._wipStatusCache.getOrCreate(
					repo.path,
					(_cacheable, factorySignal) => svc.status.getStatus(undefined, factorySignal),
					{ cancellation: signal },
				);
		const [statusResult, pausedOpStatusResult, signingConfigResult] = await Promise.allSettled([
			statusFetch,
			// `force` so a missed `'pausedOp'` FS-watcher tick (common on secondary worktrees
			// whose `GlRepository` is closed) can't leave the WIP row stuck on a stale indicator.
			svc.pausedOps?.getPausedOperationStatus?.({ force: true }, signal),
			// Cached config read — drives the "will be signed" indicator in the commit box.
			svc.config.getSigningConfig?.(),
		]);
		const status = getSettledValue(statusResult);
		if (status == null) return undefined;

		signal?.throwIfAborted();

		const pausedOpStatus = getSettledValue(pausedOpStatusResult);
		const signingConfig = getSettledValue(signingConfigResult);

		const conflictMarkerCounts = new Map<string, number>();
		if (status.hasConflicts) {
			const conflictedPaths = status.files.filter(f => isConflictStatus(f.status)).map(f => f.path);
			if (conflictedPaths.length > 0) {
				const counts = await Promise.allSettled(
					conflictedPaths.map(p => countConflictMarkers(Uri.joinPath(repo.uri, p))),
				);
				conflictedPaths.forEach((p, i) => {
					const c = getSettledValue(counts[i]);
					if (c != null) {
						conflictMarkerCounts.set(p, c);
					}
				});
			}
		}
		signal?.throwIfAborted();

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const conflictMarkers = conflictMarkerCounts.get(file.path);
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
				conflictMarkers: conflictMarkers,
			};
			files.push(change);
			if (file.staged && file.wip) {
				// Mixed file: the unstaged twin must carry the WORKING-tree status, not the index
				// status `file.status` resolves to. Otherwise, after committing only the staged side,
				// the optimistic clear keeps this twin still showing the staged letter (e.g. `A`) until
				// the host's status push corrects it to the real working letter (e.g. `M`) — a visible
				// flicker. `file.wip` guarantees `workingTreeStatus` is set here.
				files.push({ ...change, staged: false, status: file.workingTreeStatus ?? file.status });
			}
		}

		// Callers on the fire-and-forget path (e.g. `runWipRefetch`) don't pass a signal and never
		// await rejections, so a worktree-removed/ref-read failure here would become an unhandled
		// rejection — degrade to `undefined` instead of throwing.
		let branch: GitBranch | undefined;
		try {
			branch = await repo.git.branches.getBranch(status.branch, signal);
		} catch (ex) {
			signal?.throwIfAborted();
			Logger.error(ex, 'graph: failed to get branch for WIP');
		}
		signal?.throwIfAborted();

		let branchShape: GitBranchShape | undefined;
		if (branch != null) {
			branchShape = {
				name: branch.name,
				repoPath: branch.repoPath,
				upstream: branch.upstream,
				tracking: {
					ahead: branch.upstream?.state.ahead ?? 0,
					behind: branch.upstream?.state.behind ?? 0,
				},
				reference: getReferenceFromBranch(branch),
			};
		}

		let branchRemote: GitRemote | undefined;
		if (branch != null) {
			try {
				branchRemote = await getBranchRemote(this.container, branch);
			} catch (ex) {
				signal?.throwIfAborted();
				Logger.error(ex, 'graph: failed to get branch remote for WIP');
			}
		}
		signal?.throwIfAborted();

		const diff = status.diffStatus;

		// Flag secondary worktrees so the details-header kebab (which renders from `wip.stats.context`)
		// surfaces the worktree-management actions (Open/Delete/Reveal Worktree) gated on
		// `gitlens:wip+worktree`. Mirrors `buildWipContext(path, secondary)` for graph rows and the
		// header's own `isSecondaryWorktree` check (`wip.repo.path !== currentRepoPath`).
		const isSecondaryWorktree = this.repository != null && repo.path !== this.repository.path;

		// Serialize the current branch's context so the WIP header's left kebab opens the same branch
		// actions menu as a graph branch row. Undefined on detached HEAD (no branch) so the header hides
		// that kebab. Mirrors the `webviewItem` suffix logic in `getSidebarBranches`.
		const pinnedRefId = this.context.getPinnedRefId(repo.path);
		const branchContext =
			branch != null
				? serializeWebviewItemContext<GraphItemContext>({
						webviewItem: `gitlens:branch${branch.current ? '+current' : ''}${
							branch.upstream != null && !branch.upstream.missing ? '+tracking' : ''
						}${isSecondaryWorktree ? '+worktree' : ''}${branch.current || isSecondaryWorktree ? '+checkedout' : ''}${
							branch.upstream?.state.ahead ? '+ahead' : ''
						}${branch.upstream?.state.behind ? '+behind' : ''}${
							pinnedRefId != null && branch.id === pinnedRefId ? '+pinned' : ''
						}`,
						webviewItemValue: {
							type: 'branch',
							ref: createReference(branch.name, repo.path, {
								id: branch.id,
								refType: 'branch',
								name: branch.name,
								remote: false,
								upstream: branch.upstream,
							}),
						},
					})
				: undefined;

		// Build the stats once and embed it as `wip.stats`. The webview derives `workingTreeStats`
		// from `wip.stats`, so the file list and its counts can never drift — they're one object.
		const stats: WipStats = {
			added: diff.added,
			deleted: diff.deleted,
			modified: diff.changed,
			hasConflicts: status.hasConflicts,
			conflictsCount: status.hasConflicts ? status.conflicts.length : undefined,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: `gitlens:wip${isSecondaryWorktree ? '+worktree' : ''}${status.hasConflicts ? '+hasConflicts' : ''}`,
				webviewItemValue: {
					type: 'commit',
					ref: this.context.getRevisionReference(repo.path, uncommitted, 'work-dir-changes')!,
					worktreePath: repo.path,
				},
			}),
			branchContext: branchContext,
		};

		return {
			wip: {
				changes: {
					repository: { name: repo.name, path: repo.path, uri: repo.uri.toString() },
					branchName: status.branch,
					files: files,
					hasConflicts: status.hasConflicts,
					pausedOpStatus: pausedOpStatus,
				},
				repositoryCount: this.container.git.openRepositoryCount,
				branch: branchShape,
				repo: {
					uri: repo.uri.toString(),
					name: repo.name,
					path: repo.path,
					isWorktree: repo.isWorktree,
					provider:
						branchRemote?.provider != null
							? {
									supportedFeatures: {
										createPullRequestWithDetails:
											branchRemote.provider.supportedFeatures?.createPullRequestWithDetails,
									},
								}
							: undefined,
				},
				stats: stats,
				signing:
					signingConfig != null
						? { enabled: signingConfig.enabled, format: signingConfig.format }
						: undefined,
			},
		};
	}

	async getWorkingTreeStatsAndPausedOperations(
		hasWorkingChanges?: boolean,
		cancellation?: CancellationToken,
	): Promise<GraphWorkingTreeStats | undefined> {
		if (this.repository == null || !this.container.git.repositoryCount) return undefined;

		const svc = this.container.git.getRepositoryService(this.repository.path);

		try {
			hasWorkingChanges ??= await svc.status.hasWorkingChanges(
				{ staged: true, unstaged: true, untracked: true },
				toAbortSignal(cancellation),
			);
		} catch {
			// Cancellation or hard failure — surface as undefined so callers don't poison their
			// dedup cache with all-zero fallback values, which would silently swallow future updates.
			return undefined;
		}

		if (cancellation?.isCancellationRequested) return undefined;

		const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
			hasWorkingChanges ? svc.status.getStatus(undefined, toAbortSignal(cancellation)) : undefined,
			// `force` so a missed `'pausedOp'` FS-watcher tick can't leave the primary's working-tree
			// badges stuck on a stale in-progress indicator after a CLI-driven completion.
			svc.pausedOps?.getPausedOperationStatus?.({ force: true }, toAbortSignal(cancellation)),
		]);

		if (cancellation?.isCancellationRequested) return undefined;

		// If we expected status data (working changes detected) but the fetch failed/was cancelled,
		// return undefined for the same dedup-poisoning reason. Resolved "no working changes"
		// still produces a real zero-stats payload — that case is correct.
		if (hasWorkingChanges && statusResult.status === 'rejected') return undefined;

		const status = getSettledValue(statusResult);
		const workingTreeStatus = status?.diffStatus;
		const pausedOpStatus = getSettledValue(pausedOpStatusResult);

		return {
			added: workingTreeStatus?.added ?? 0,
			deleted: workingTreeStatus?.deleted ?? 0,
			modified: workingTreeStatus?.changed ?? 0,
			hasConflicts: status?.hasConflicts,
			conflictsCount: status?.hasConflicts ? status.conflicts.length : undefined,
			pausedOpStatus: pausedOpStatus,
			context: serializeWebviewItemContext<GraphItemContext>({
				webviewItem: `gitlens:wip${status?.hasConflicts ? '+hasConflicts' : ''}`,
				webviewItemValue: {
					type: 'commit',
					ref: this.context.getRevisionReference(this.repository.path, uncommitted, 'work-dir-changes')!,
					worktreePath: this.repository.path,
				},
			}),
		};
	}

	/** Read-merge-write of `graph:wipDrafts` for one worktree's slot. Pass `draft: null` to
	 *  delete the slot. Used by the webview's `UpdateWipDraftCommand` handler AND by
	 *  host-initiated writes (Undo Commit) that need to persist a draft without waiting for the
	 *  webview to round-trip a flush. Key is the worktree's own fsPath — invariant across
	 *  whether the user opens the main repo or the worktree directly. */
	writeWipDraftToStorage(worktreePath: string, draft: StoredGraphWipDraft | null): void {
		const current = this.container.storage.getWorkspace('graph:wipDrafts');
		const next = updateRecordValue(current, worktreePath, draft ?? undefined);
		void this.container.storage
			.storeWorkspace('graph:wipDrafts', next)
			.catch((ex: unknown) => Logger.error(ex, 'graph: failed to persist WIP draft'));
	}

	pruneWipDraftsForRemovedRepos(removedPaths: string[]): void {
		const current = this.container.storage.getWorkspace('graph:wipDrafts');
		if (current == null) return;

		let next = current;
		let changed = false;
		for (const path of removedPaths) {
			if (next[path] == null) continue;

			next = updateRecordValue(next, path, undefined);
			changed = true;
		}
		if (!changed) return;

		void this.container.storage
			.storeWorkspace('graph:wipDrafts', next)
			.catch((ex: unknown) => Logger.error(ex, 'graph: failed to prune WIP drafts'));
	}

	/** Cache-backed `git status` read shared by the overview-WIP + wip-stats handlers that stay on
	 *  the provider — keeps `_wipStatusCache` private to the service while those handlers read it. */
	getStatusFromCache(path: string, signal?: AbortSignal): Promise<GitStatus | undefined> {
		return this._wipStatusCache.getOrCreate(
			path,
			(_cacheable, factorySignal) =>
				this.container.git.getRepositoryService(path).status.getStatus(undefined, factorySignal),
			{ cancellation: signal },
		);
	}

	/** Hard-evict the whole status cache (git:cache:reset with no repoPath, repo swap/clear). */
	clearStatusCache(): void {
		this._wipStatusCache.clear();
	}

	/** Hard-evict one repo's cached status (git:cache:reset for a specific repoPath). */
	deleteStatusCache(repoPath: string): void {
		this._wipStatusCache.delete(repoPath);
	}

	/** Reset the working-tree/draft send-dedup state on graph identity change (`setGraph(undefined)`). */
	resetSendState(): void {
		this._lastSentWipDrafts = undefined;
		this._lastSentWipDraftsInitialized = false;
		this._lastSentWipNotificationParams = undefined;
		// Force the badge to re-evaluate on the next push so a repo swap to one with the same
		// change count as the prior repo still re-stamps (and the tooltip stays correct).
		this._lastBadgeCount = -1;
	}

	/** Force the panel-tab badge to re-evaluate on the next push (setting toggle). */
	resetBadgeCount(): void {
		this._lastBadgeCount = -1;
	}

	/** Clear the panel-tab badge (setting toggled off). Panel-container views ignore `badge = undefined`. */
	clearWorkingTreeBadge(): void {
		if (!this.host.is('view')) return;

		this._lastBadgeCount = 0;
		this.host.badge = { value: 0, tooltip: '' };
	}

	dispose(): void {
		this._disposed = true;
		this._wipProbeCancellation?.cancel();
		this._wipProbeCancellation?.dispose();
		this._wipProbeCancellation = undefined;
		for (const t of this._wipWatchRemoveTimers.values()) {
			clearTimeout(t);
		}
		this._wipWatchRemoveTimers.clear();
		for (const d of this._wipWatches.values()) {
			d.dispose();
		}
		this._wipWatches.clear();
		for (const entry of this._wipRefetches.values()) {
			if (entry.timer != null) {
				clearTimeout(entry.timer);
			}
		}
		this._wipRefetches.clear();
		this._wipStatusCache.clear();
	}
}
