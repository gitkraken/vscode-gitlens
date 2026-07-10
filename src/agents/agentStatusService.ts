import type { Disposable, QuickPickItem } from 'vscode';
import { commands, EventEmitter, Uri, window, workspace } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import { arePathsEqual } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../container.js';
import { createQuickPickSeparator } from '../quickpicks/items/common.js';
import { registerCommand } from '../system/-webview/command.js';
import type {
	AgentSessionState,
	AgentSessionWorktreeMetadata,
	PastAgentSessionsResult,
	PastAgentSessionState,
} from './models/agentSessionState.js';
import { getSessionDisplayName, serializeAgentSession, serializePastAgentSession } from './models/agentSessionState.js';
import type {
	AgentSession,
	AgentSessionProvider,
	PermissionDecision,
	PermissionSuggestion,
	ResumableSessionsResult,
} from './provider.js';
import { isClaudeExtensionAvailable, tryOpenClaudeSession } from './utils/-webview/claudeExtension.js';
import {
	canResumeSession,
	resumeClaudeSessionInTerminal,
	toResumableSessionRef,
} from './utils/-webview/claudeResume.js';

export class AgentStatusService implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidChangeHooksInstallState = new EventEmitter<void>();
	/**
	 * Fires after the user installs or uninstalls Claude Code hooks. Webviews subscribe so banners
	 * and integration chips reflect the new state without waiting for the 30s cache to expire.
	 */
	readonly onDidChangeHooksInstallState = this._onDidChangeHooksInstallState.event;

	private readonly _onDidChangeSessions = new EventEmitter<AgentSessionState[]>();
	/**
	 * Fires only when the session snapshot has actually changed (deep equality on the
	 * wire-shape). Lets multiple webviews subscribe without each re-implementing dedup against
	 * the noisier `onDidChange` event.
	 */
	readonly onDidChangeSessions = this._onDidChangeSessions.event;

	/**
	 * Per-session serialization memo, keyed by the session OBJECT. Providers replace a session
	 * immutably on every change (never mutate fields in place), so identity is a sound proxy for
	 * content: a cache hit means nothing about that session changed.
	 *
	 * This exists because the change-detect below runs on every `onDidChangeSessions` — which fires
	 * per hook event (each tool call) — while `_sessions` also holds every `completed` session in the
	 * CLI's 30-day window. Re-serializing and stringifying that whole set per event scales the live
	 * path by total history rather than by what's actually running. Terminal rows never change, so
	 * they land here once and cost a lookup thereafter.
	 *
	 * `generation` tracks {@link _worktreeMetadataGeneration}: the serialized shape also embeds
	 * host-resolved worktree metadata, which changes independently of the session (branch rename,
	 * checkout), so a bump invalidates every entry.
	 */
	private readonly _sessionStateCache = new WeakMap<
		AgentSession,
		{ state: AgentSessionState; key: string; generation: number }
	>();
	private _worktreeMetadataGeneration = 0;
	/** `sessionId -> change-detect key` from the last published snapshot. */
	private _lastSessionKeys = new Map<string, string>();

	/**
	 * Transient cache of `worktreePath -> live GitWorktree metadata`. Populated by
	 * `refreshWorktreeNameCache()` via `getWorktrees()` on the parent repo, which is cached by
	 * the git layer (keyed by `commonPath`, invalidated on `heads`/`remotes`/`worktrees`).
	 * Never persisted on `AgentSession` — every field is the worktree's *current* identity so
	 * `git checkout` / worktree renames / upstream changes flow to the UI without restarting.
	 */
	private readonly _worktreeNameByPath = new Map<string, AgentSessionWorktreeMetadata>();
	/** Worktree paths a refresh has already attempted, resolved or not. Gates the deferred-publish
	 *  branch in the `onDidChangeSessions` trigger: a path no open repo owns — a completed session
	 *  from a repo this window doesn't have open — never resolves, and without this every phase tick
	 *  would take the deferral and re-run the (ungated) refresh. Repos opening later still resolve
	 *  it: `onDidChangeRepositories` re-runs the refresh regardless of this set. */
	private readonly _attemptedWorktreePaths = new Set<string>();
	private _worktreeRefreshPromise: Promise<boolean> | undefined;
	/** Stable signature of the session worktree path set resolved by the last refresh. Lets the
	 *  noisy `onDidChangeSessions` trigger skip the refresh when only phase/activity changed. */
	private _resolvedWorktreePathsKey: string | undefined;

	private readonly _disposables: Disposable[] = [];
	private readonly _providers: AgentSessionProvider[];
	/** Timer for the deferred initial hooks-installed push; cleared on dispose if it hasn't fired. */
	private _initialHooksPushTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly container: Container,
		providers: AgentSessionProvider[],
		/** Commands are a process-wide singleton surface — VS Code throws on a duplicate id — so an
		 *  instance beyond the container's own (tests) must opt out of claiming them. Everything else
		 *  about the service is per-instance and safe to stand up more than once. */
		options?: { registerCommands?: boolean },
	) {
		this._providers = providers;

		for (const provider of this._providers) {
			this._disposables.push(
				provider.onDidChangeSessions(() => {
					// Always fire the cheap _onDidChange so non-name consumers (badge counts, agent
					// status row) stay snappy.
					this._onDidChange.fire();

					// If any session has a worktree path we haven't resolved yet, defer the rich
					// snapshot publish until the refresh completes so webviews don't paint with a
					// cold-fallback name (`On <path-basename>`) and then re-paint a moment later
					// with the proper branch name. The refresh publishes itself when metadata
					// changed; we only fire here when it didn't (couldn't resolve the path) or
					// failed, so the new session is never permanently swallowed.
					if (this.hasUnresolvedWorktreePaths()) {
						this.refreshWorktreeNameCache().then(
							changed => {
								if (!changed) {
									this.maybeFireSessionsChanged();
								}
							},
							() => this.maybeFireSessionsChanged(),
						);
					} else {
						this.maybeFireSessionsChanged();
						this.refreshWorktreeNameCacheIfSessionsChanged();
					}
				}),
			);
		}

		this._disposables.push(
			window.onDidChangeWindowState(e => {
				if (e.focused) {
					this.startProviders();
				} else {
					this.stopProviders();
				}
			}),
			workspace.onDidChangeWorkspaceFolders(() => this.onWorkspaceFoldersChanged()),
			this.container.git.onDidChangeRepository(e => {
				// Refresh when the worktree set or branch state of any repo we care about changes.
				// The underlying `getWorktrees()` cache already invalidates on these same signals.
				if (!e.changed('heads', 'remotes', 'worktrees')) return;

				void this.refreshWorktreeNameCache();
			}),
			this.container.git.onDidChangeRepositories(() => {
				// New repos may have just become resolvable for sessions that were previously
				// pending; existing repos may have been removed. Refresh either way.
				void this.refreshWorktreeNameCache();
			}),
			...((options?.registerCommands ?? true) ? this.registerCommands() : []),
		);

		this.startProviders();
		// Resolve the host's hooks-installed state once and push it to providers so they can gate
		// their reconciliation poll. Deferred out of the first-render window — like the CLI version
		// probe in GkCliService — so the `gk agents list` subprocess doesn't contend with Graph/Home
		// webview bootstrap on slower filesystems (e.g. WSL). Providers fail-open (keep polling) until
		// this lands, so the delay never suppresses session discovery.
		this._disposables.push(
			container.onReady(() => {
				this._initialHooksPushTimer = setTimeout(() => {
					this._initialHooksPushTimer = undefined;
					void this.pushHooksInstalledToProviders();
				}, 3000);
			}),
			{
				dispose: () => {
					if (this._initialHooksPushTimer != null) {
						clearTimeout(this._initialHooksPushTimer);
						this._initialHooksPushTimer = undefined;
					}
				},
			},
		);
	}

	dispose(): void {
		this.stopProviders();
		for (const provider of this._providers) {
			provider.dispose();
		}
		for (const d of this._disposables) {
			d.dispose();
		}
		this._onDidChange.dispose();
		this._onDidChangeHooksInstallState.dispose();
		this._onDidChangeSessions.dispose();
	}

	private async invalidateHooksState(): Promise<void> {
		// Drop the stale agent cache, re-read, and push the fresh state to providers (the re-read
		// also warms the cache so the next webview read returns the new state without a delay).
		await this.pushHooksInstalledToProviders({ invalidate: true });
		this._onDidChangeHooksInstallState.fire();
	}

	/** Resolves the host's Claude hooks-installed state and pushes it to all providers so they can
	 *  gate their reconciliation poll (the CLI `list-sessions` call). Resolves to `false` when the
	 *  agent can't be detected (e.g. the browser stub's `getClaude()` returns `undefined`); fails
	 *  *open* (`installed = true`) only if detection throws unexpectedly, so a transient failure
	 *  never wrongly suppresses polling. The browser has no providers to receive the push regardless.
	 *  Pass `invalidate` after an install/uninstall so the stale agent cache is dropped before re-reading.
	 *
	 *  Note: an external `gk ai hook install` (run outside GitLens) isn't observed here until
	 *  something else re-reads — acceptable per the staleness window documented in
	 *  `src/agents/agentService.ts`, and the poll gate opens anyway the moment any session
	 *  appears (a non-empty session list always polls). */
	private async pushHooksInstalledToProviders(options?: { invalidate?: boolean }): Promise<void> {
		let installed = true;
		try {
			if (options?.invalidate) {
				this.container.agents.invalidateCache();
			}
			const claude = await this.container.agents.getClaude();
			installed = claude?.hooksInstalled ?? false;
		} catch {
			// Unexpected detection failure — leave fail-open (assume installed) so a transient error
			// doesn't wrongly suppress polling. (The browser stub returns an empty list above, yielding
			// installed=false, and has no providers anyway.)
		}
		for (const provider of this._providers) {
			provider.setClaudeHooksInstalled?.(installed);
		}
	}

	get sessions(): readonly AgentSession[] {
		return this._providers.flatMap(p => p.sessions);
	}

	getSerializedSessions(): AgentSessionState[] {
		return this.sessions.map(s => this.getSessionStateEntry(s).state);
	}

	/** Memoized {@link serializeAgentSession} + its change-detect key — see {@link _sessionStateCache}. */
	private getSessionStateEntry(session: AgentSession): { state: AgentSessionState; key: string; generation: number } {
		const cached = this._sessionStateCache.get(session);
		if (cached != null && cached.generation === this._worktreeMetadataGeneration) return cached;

		const state = serializeAgentSession(session, this.getWorktreeMetadataForSession(session));
		const entry = {
			state: state,
			key: JSON.stringify(state, coarsenVolatileTimestamps),
			generation: this._worktreeMetadataGeneration,
		};
		this._sessionStateCache.set(session, entry);
		return entry;
	}

	private getWorktreeMetadataForSession(session: AgentSession): AgentSessionWorktreeMetadata | undefined {
		if (session.worktreePath == null) return undefined;
		return this._worktreeNameByPath.get(session.worktreePath);
	}

	/** Resolves a worktree's display name on demand — `_worktreeNameByPath` only tracks worktrees
	 *  with live sessions (and prunes them when the last one ends), so worktrees with only past
	 *  sessions need a direct lookup or they'd surface nameless (e.g. in the resume picker title). */
	private async getWorktreeName(worktreePath: string): Promise<string | undefined> {
		const cached = this._worktreeNameByPath.get(worktreePath)?.name;
		if (cached != null) return cached;

		try {
			const worktrees = await this.container.git.getRepositoryService(worktreePath).worktrees?.getWorktrees();
			return worktrees?.find(wt => arePathsEqual(wt.path, worktreePath))?.name;
		} catch {
			return undefined;
		}
	}

	/**
	 * Lists the past, resumable sessions for `worktreePath`, most-recently-active first.
	 *
	 * Excludes sessions that are still live (working/idle) — those already flow to consumers through
	 * {@link onDidChangeSessions} and are opened, not resumed. Terminal `completed` sessions are kept
	 * by default: they're themselves resumable-past sessions, so they fall through and pick up a
	 * proper `displayName` from the transcript store below. Archived sessions ARE excluded — the
	 * tracked row is gone, but the transcript on disk survives and would otherwise resurface. The
	 * exclude set is passed down via `excludeSessionIds` so a provider excludes it before its own
	 * `limit` applies, rather than this method dropping them from an already-limited slice.
	 *
	 * `excludeCompleted` is for callers that already render tracked completed sessions themselves
	 * (the webviews show them as cards). Without it those sessions occupy the `limit` slots here and
	 * are then deduped away at render, so a worktree whose newest transcripts are all tracked can
	 * show NO past rows — and no "N more" footer — while older ones exist. The resume picker leaves
	 * it off: it drops completed from its live group precisely so they surface here instead.
	 */
	async getPastSessions(
		worktreePath: string,
		options?: { limit?: number; excludeCompleted?: boolean },
	): Promise<PastAgentSessionsResult> {
		const excludeIds = new Set(
			this.sessions
				.filter(
					s =>
						s.status !== 'completed' ||
						// Scoped to the ones the caller actually renders a card for HERE. A completed
						// session whose worktree never resolved (an old CLI record with no worktree
						// data) matches no worktree, so it has no card — excluding it would make it
						// invisible rather than merely deduped, and this list is its only surface.
						(options?.excludeCompleted === true &&
							s.worktreePath != null &&
							arePathsEqual(s.worktreePath, worktreePath)),
				)
				.map(s => s.id),
		);

		// Archiving drops the tracked row, but the CLI's transcript survives on disk — without this,
		// an archived session would resurface here on every subsequent listing. Run alongside the
		// worktree-name lookup: the archived-id query spawns a CLI process, and serializing the two
		// would put that latency in front of every panel open.
		const [archivedSettled, worktreeNameResult] = await Promise.all([
			Promise.allSettled(
				this._providers.map(provider => provider.getArchivedSessionIds?.() ?? Promise.resolve([])),
			),
			this.getWorktreeName(worktreePath),
		]);
		for (const result of archivedSettled) {
			const ids = getSettledValue(result);
			if (ids == null) continue;

			for (const id of ids) {
				excludeIds.add(id);
			}
		}

		const worktreeName = worktreeNameResult;

		const sessions: PastAgentSessionState[] = [];
		let total = 0;

		// Providers with no durable per-directory store omit `listResumableSessions` entirely.
		const pending: Promise<ResumableSessionsResult>[] = [];
		for (const provider of this._providers) {
			const listing = provider.listResumableSessions?.(worktreePath, {
				limit: options?.limit,
				excludeSessionIds: excludeIds,
			});
			if (listing != null) {
				pending.push(listing);
			}
		}

		const settled = await Promise.allSettled(pending);
		for (const result of settled) {
			if (result.status !== 'fulfilled') continue;

			total += result.value.total;
			for (const session of result.value.sessions) {
				// Safety net: `listResumableSessions` is optional on the interface, and a future
				// provider may not honor `excludeSessionIds` — re-check here regardless.
				if (excludeIds.has(session.id)) continue;

				sessions.push(serializePastAgentSession(session, worktreePath, worktreeName));
			}
		}

		// Providers are ordered, so re-sort across them.
		sessions.sort((a, b) => b.lastActivity - a.lastActivity);
		// Re-apply the limit across the merged, sorted result — a no-op with a single provider, but
		// honors the contract once 2+ providers each return up to `limit`.
		const limited = options?.limit != null && options.limit > 0 ? sessions.slice(0, options.limit) : sessions;
		return { sessions: limited, total: total };
	}

	/** The worktree's sessions as the resume picker shows them: the live ones it can open, then the
	 *  past ones it can resume. `completed` sessions are excluded from `live` — they're resumable-past,
	 *  not open-able, so they're picked up by {@link getPastSessions} instead. */
	async getResumableSessions(
		worktreePath: string,
		options?: { limit?: number },
	): Promise<{ live: AgentSession[]; past: PastAgentSessionState[]; total: number }> {
		const live = this.sessions.filter(
			s => !s.isSubagent && s.status !== 'completed' && s.worktreePath === worktreePath,
		);
		const { sessions, total } = await this.getPastSessions(worktreePath, options);
		return { live: live, past: sessions, total: total };
	}

	/**
	 * Resumes a past session by starting a fresh process against its transcript.
	 *
	 * `'default'` uses the Claude Code extension only when `cwd` is itself one of this window's
	 * workspace folders, and otherwise falls back to a terminal. The extension's open command takes a
	 * session id and no cwd, so it resolves the session against the window's own folder — right only
	 * when that folder IS the session's directory. An ancestor folder won't do: the transcript is
	 * homed under the exact cwd, so the extension would look elsewhere and come up empty. A terminal
	 * is anchored at `cwd`, so it stays correct for any worktree.
	 */
	private async resumeSession(
		sessionId: string,
		cwd: string,
		target: 'default' | 'terminal',
		source: 'webview' | 'quickpick',
		name?: string,
	): Promise<void> {
		const useExtension =
			target === 'default' &&
			this.getWorkspacePaths().some(p => arePathsEqual(p, cwd)) &&
			(await isClaudeExtensionAvailable());
		const resumedInExtension = useExtension && (await tryOpenClaudeSession(sessionId));
		if (!resumedInExtension) {
			await resumeClaudeSessionInTerminal({ id: sessionId, cwd: cwd, name: name }, this.container);
		}

		this.container.telemetry.sendEvent('agents/sessionResumed', {
			'agent.provider': 'claudeCode',
			'agent.resume.source': source,
			'agent.resume.target': resumedInExtension ? 'extension' : 'terminal',
		});
	}

	private async showResumeSessionPicker(worktreePath: string): Promise<void> {
		const { showResumableSessionPicker } = await import(
			/* webpackChunkName: "agents" */ '../quickpicks/resumableSessionPicker.js'
		);

		const { live, past, total } = await this.getResumableSessions(worktreePath, { limit: 100 });
		const worktreeName = await this.getWorktreeName(worktreePath);
		const pick = await showResumableSessionPicker(live, past, total, worktreeName);
		if (pick == null) return;

		if (pick.live != null) {
			if (pick.target === 'resume-terminal') {
				await resumeClaudeSessionInTerminal(toResumableSessionRef(pick.live), this.container);
				return;
			}

			await this.dispatchSessionAction(pick.live);
			return;
		}

		if (pick.past == null) return;

		await this.resumeSession(
			pick.past.id,
			pick.past.cwd,
			pick.target === 'resume-terminal' ? 'terminal' : 'default',
			'quickpick',
			pick.past.displayName,
		);
	}

	private maybeFireSessionsChanged(): void {
		// Compared PER SESSION rather than as one stringified snapshot: the memo hands back the same
		// key instance for a session that didn't change, making the comparison a pointer check, so a
		// long tail of terminal rows costs a lookup each instead of being re-stringified on every
		// hook event. Only a session whose object identity changed pays a real `JSON.stringify`, and
		// only its own (~1KB) worth. Session ORDER is deliberately not part of the comparison —
		// consumers sort for themselves, so a reorder alone is not a change worth pushing.
		const states: AgentSessionState[] = [];
		const keys = new Map<string, string>();
		let changed = false;
		for (const session of this.sessions) {
			const entry = this.getSessionStateEntry(session);
			states.push(entry.state);
			keys.set(session.id, entry.key);
			if (!changed && this._lastSessionKeys.get(session.id) !== entry.key) {
				changed = true;
			}
		}
		// Catches removals (an addition already differs above, and a swap adds an unseen id).
		if (!changed && keys.size !== this._lastSessionKeys.size) {
			changed = true;
		}
		if (!changed) return;

		this._lastSessionKeys = keys;
		this._onDidChangeSessions.fire(states);
	}

	/** True iff at least one session has a `worktreePath` we haven't resolved metadata for yet.
	 *  Used to defer the snapshot publish for brand-new paths so the webview never paints the
	 *  cold-fallback name first; resolved paths skip the deferral and publish immediately. */
	private hasUnresolvedWorktreePaths(): boolean {
		for (const s of this.sessions) {
			// `_attemptedWorktreePaths` keeps a path that can't resolve from deferring every tick.
			if (
				s.worktreePath != null &&
				!this._worktreeNameByPath.has(s.worktreePath) &&
				!this._attemptedWorktreePaths.has(s.worktreePath)
			) {
				return true;
			}
		}
		return false;
	}

	/** Order-independent signature of the set of session worktree paths. The worktree-name cache
	 *  depends only on this set — not on session phase/activity — so it gates the noisy trigger. */
	private getSessionWorktreePathsKey(): string {
		const paths: string[] = [];
		for (const s of this.sessions) {
			if (s.worktreePath != null) {
				paths.push(s.worktreePath);
			}
		}
		return paths.sort().join('\0');
	}

	/**
	 * Gated entry point for the `onDidChangeSessions` trigger, which fires on every phase/activity
	 * tick. Skips the refresh entirely when the set of session worktree paths is unchanged —
	 * checkout-driven name changes still arrive via the `onDidChangeRepository` trigger, which
	 * calls `refreshWorktreeNameCache()` directly.
	 */
	private refreshWorktreeNameCacheIfSessionsChanged(): void {
		if (this.getSessionWorktreePathsKey() === this._resolvedWorktreePathsKey) return;

		void this.refreshWorktreeNameCache();
	}

	/**
	 * Resolves the live display name for each session's worktree by calling `getWorktrees()` once
	 * per parent repo (the underlying cache means repeated calls within a stable repo are free).
	 * Updates `_worktreeNameByPath` and fires `onDidChangeSerializedSessions` if anything changed.
	 * Concurrent calls dedupe to a single in-flight refresh.
	 *
	 * Resolves to `true` iff metadata changed and the snapshot was published — callers who need
	 * to publish unconditionally (e.g. the deferred-publish path) can skip a redundant fire when
	 * this returns true.
	 */
	private refreshWorktreeNameCache(): Promise<boolean> {
		if (this._worktreeRefreshPromise != null) return this._worktreeRefreshPromise;

		this._worktreeRefreshPromise = (async () => {
			let changed = false;
			try {
				// Capture the path set this run resolves so the noisy session trigger can skip
				// no-op refreshes; the `finally` re-checks it to catch paths that appeared while
				// this run was in-flight (it snapshots `this.sessions` synchronously below).
				this._resolvedWorktreePathsKey = this.getSessionWorktreePathsKey();

				// Query worktrees once per REPO IDENTITY: each session's `commonPath` (authoritative,
				// set together with `worktreePath` by `resolveGitInfo`) UNION the open repositories.
				// Deliberately NOT keyed by `workspacePath`: that's the matched workspace folder (or
				// undefined), not a repo identity.
				//
				// Keying by the session's `worktreePath` when `commonPath` is missing would be a real
				// fan-out: `getWorktrees()` dedupes by common path, and an UNREGISTERED worktree dir
				// resolves to itself — one `git worktree list` per path. Completed sessions read from
				// the CLI's durable store are exactly that case (they carry a `worktreePath` but never
				// a `commonPath`, since they're never git-probed) and can span a 30-day history.
				//
				// Folding in the open repos costs nothing — their worktree lists are already cached
				// and drive the graph itself — and it's what lets those probe-less sessions resolve
				// both their display name AND their repo identity. A session whose worktree belongs
				// to no open repo stays unresolved, which is correct: the surfaces that gate on repo
				// identity can only ever act on a repo the graph shows.
				//
				// An open repo contributes `commonPath ?? path` — the same formula the consumers'
				// family check uses — NOT `repo.path`. When the repo IS a linked worktree those
				// differ, and querying by `repo.path` would both miss the shared cache entry and come
				// back with every `GitWorktree.repoPath` rewritten to that worktree dir (the cache
				// maps `w.withRepoPath(callerPath)` whenever the caller path isn't the common path),
				// so the identity below would be a worktree dir that no family check can match.
				const repoPaths = new Set<string>();
				const referencedWorktreePaths = new Set<string>();
				for (const s of this.sessions) {
					if (s.worktreePath == null) continue;

					referencedWorktreePaths.add(s.worktreePath);
					if (s.commonPath != null) {
						repoPaths.add(s.commonPath);
					}
				}
				for (const repo of this.container.git.openRepositories) {
					repoPaths.add(repo.commonPath ?? repo.path);
				}

				// Prune entries for worktrees no session lives in anymore.
				for (const key of [...this._worktreeNameByPath.keys()]) {
					if (!referencedWorktreePaths.has(key)) {
						this._worktreeNameByPath.delete(key);
						changed = true;
					}
				}
				for (const key of this._attemptedWorktreePaths) {
					if (!referencedWorktreePaths.has(key)) {
						this._attemptedWorktreePaths.delete(key);
					}
				}

				const results = await Promise.allSettled(
					Array.from(repoPaths, async repoPath => {
						const worktrees = await this.container.git
							.getRepositoryService(repoPath)
							.worktrees?.getWorktrees();
						return { repoPath: repoPath, worktrees: worktrees ?? [] };
					}),
				);

				for (const r of results) {
					const value = getSettledValue(r);
					if (value == null) continue;

					for (const wt of value.worktrees) {
						if (!referencedWorktreePaths.has(wt.path)) continue;

						const next: AgentSessionWorktreeMetadata = {
							name: wt.name,
							type: wt.type,
							isDefault: wt.isDefault,
							// The owning repo — the identity a probe-less completed session lacks. Taken
							// from the path we QUERIED, not `wt.repoPath`: the cache rewrites that to the
							// caller's path whenever it differs from the common path, so it can't be
							// trusted as an identity.
							repoPath: value.repoPath,
							branch:
								wt.type === 'branch' && wt.branch != null
									? {
											name: wt.branch.name,
											// `upstream.name` is the raw `origin/foo` form; consumers reconstruct
											// the full upstreamRef via `getBranchId(workspacePath, true, name)`.
											upstreamName:
												wt.branch.upstream != null && !wt.branch.upstream.missing
													? wt.branch.upstream.name
													: undefined,
										}
									: undefined,
						};
						const existing = this._worktreeNameByPath.get(wt.path);
						if (!isSameWorktreeMetadata(existing, next)) {
							this._worktreeNameByPath.set(wt.path, next);
							changed = true;
						}
					}
				}

				// A path counts as attempted once it either resolved, or failed to resolve in a run where
				// every query SUCCEEDED (so its absence is real, not an artifact of a failed query).
				// Marking an unresolved path after a partial failure would permanently stop the deferred
				// publish from waiting on it — pinning the cold-fallback name — even though the repo that
				// owns it was never actually queried. Rejections come from the repo the path belongs to,
				// but the result carries no worktree list to attribute it, so any rejection holds back
				// every still-unresolved path; they retry on the next refresh.
				const allQueriesSucceeded = results.every(r => r.status === 'fulfilled');
				for (const path of referencedWorktreePaths) {
					if (allQueriesSucceeded || this._worktreeNameByPath.has(path)) {
						this._attemptedWorktreePaths.add(path);
					}
				}

				if (changed) {
					// Worktree metadata is embedded in every serialized session, so a change here has to
					// invalidate the per-session memo — otherwise a branch rename/checkout would never
					// reach consumers, since the session objects themselves are untouched.
					this._worktreeMetadataGeneration++;
					this.maybeFireSessionsChanged();
				}
			} finally {
				this._worktreeRefreshPromise = undefined;
				// A session worktree path may have appeared/changed while this run was in-flight
				// (it snapshotted `this.sessions` at the top, and `_worktreeRefreshPromise`
				// deduped any calls since). Re-run if the set no longer matches what we resolved.
				if (this.getSessionWorktreePathsKey() !== this._resolvedWorktreePathsKey) {
					void this.refreshWorktreeNameCache();
				}
			}
			return changed;
		})();

		return this._worktreeRefreshPromise;
	}

	resolvePermission(
		sessionId: string,
		decision: PermissionDecision,
		updatedPermissions?: PermissionSuggestion[],
	): void {
		for (const provider of this._providers) {
			const session = provider.sessions.find(s => s.id === sessionId);
			if (session == null) continue;

			// `false` means the session is peer-discovered (owned by another GitLens window);
			// our local provider has no `_pendingPermissions` entry to fulfil. Surface a hint so
			// the user knows where to act rather than seeing a silent no-op.
			const resolved = provider.resolvePermission?.(sessionId, decision, updatedPermissions) ?? false;
			if (!resolved) {
				const target = session.workspacePath
					? `the GitLens window for ${session.workspacePath}`
					: 'another GitLens window';
				void window.showInformationMessage(
					`This agent session is owned by ${target}. Resolve the request from there.`,
				);
			}
			return;
		}
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.agents.installClaudeHook', async () => {
				try {
					const { installClaudeHook } = await import(
						/* webpackChunkName: "agents" */ '@env/agents/installClaudeHook.js'
					);
					await installClaudeHook();
					await this.invalidateHooksState();
					this.container.telemetry.sendEvent('agents/hookInstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.installClaudeHook');
					void window.showErrorMessage(
						`Failed to install Claude Hooks: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.uninstallClaudeHook', async () => {
				try {
					const { uninstallClaudeHook } = await import(
						/* webpackChunkName: "agents" */ '@env/agents/uninstallClaudeHook.js'
					);
					await uninstallClaudeHook();
					await this.invalidateHooksState();
					this.container.telemetry.sendEvent('agents/hookUninstalled', { 'agent.provider': 'claudeCode' });
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.uninstallClaudeHook');
					void window.showErrorMessage(
						`Failed to uninstall Claude Hooks: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand('gitlens.agents.openSession', (sessionId?: string) => this.openSession(sessionId)),
			registerCommand('gitlens.agents.resumeSession', (args?: { sessionId: string; cwd: string }) => {
				if (args?.sessionId == null) return Promise.resolve();

				return this.resumeSession(args.sessionId, args.cwd, 'default', 'webview');
			}),
			registerCommand('gitlens.agents.showResumeSessionPicker', (args?: { worktreePath: string }) => {
				if (args?.worktreePath == null) return Promise.resolve();

				return this.showResumeSessionPicker(args.worktreePath);
			}),
			registerCommand('gitlens.agents.switchDefaultAgent', async () => {
				const { pickAndSetDefaultAgent } = await import(
					/* webpackChunkName: "agents" */ '../plus/agents/agentPicker.js'
				);
				await pickAndSetDefaultAgent(this.container);
			}),
			registerCommand('gitlens.agents.openPlanFile', async (planFilePath?: string) => {
				if (!planFilePath) return;

				try {
					await commands.executeCommand('vscode.open', Uri.file(planFilePath));
				} catch (ex) {
					Logger.error(ex, 'AgentStatusService.openPlanFile');
					void window.showErrorMessage(
						`Failed to open plan: ${ex instanceof Error ? ex.message : String(ex)}`,
					);
				}
			}),
			registerCommand(
				'gitlens.agents.resolvePermission',
				(args?: { sessionId: string; decision: PermissionDecision; alwaysAllow?: boolean }) => {
					if (args?.sessionId == null || args.decision == null) return;

					let updatedPermissions: PermissionSuggestion[] | undefined;
					if (args.alwaysAllow) {
						const session = this.sessions.find(s => s.id === args.sessionId);
						const suggestions = session?.pendingPermission?.suggestions;
						if (suggestions != null && suggestions.length > 0) {
							updatedPermissions = [...suggestions];
						}
					}

					this.resolvePermission(args.sessionId, args.decision, updatedPermissions);
				},
			),
			registerCommand('gitlens.agents.archiveSession', (sessionId?: string) => this.archiveSession(sessionId)),
		];
	}

	private async archiveSession(sessionId?: string): Promise<void> {
		if (!sessionId) return;

		for (const provider of this._providers) {
			if (provider.sessions.find(s => s.id === sessionId) == null) continue;

			try {
				// The CLI archive is keyed by session id and machine-global, so archiving succeeds
				// regardless of which window discovered the (completed) session. Only record the
				// telemetry when the provider actually archived — it returns `false` when it refused a
				// row that resumed out of `completed` since the click.
				const archived = await provider.archiveSession?.(sessionId);
				if (archived) {
					this.container.telemetry.sendEvent('agents/session/archived', { 'agent.provider': provider.id });
				}
			} catch (ex) {
				Logger.error(ex, 'AgentStatusService.archiveSession');
				void window.showErrorMessage(
					`Failed to archive session: ${ex instanceof Error ? ex.message : String(ex)}`,
				);
			}

			return;
		}
	}

	private async openSession(sessionId?: string): Promise<void> {
		const sessions = [...this.sessions];
		if (sessions.length === 0) return;

		let session: AgentSession | undefined;

		if (sessionId != null) {
			session = sessions.find(s => s.id === sessionId);
		} else if (sessions.length === 1) {
			session = sessions[0];
		} else {
			const workspaceSessions = sessions.filter(s => s.isInWorkspace);
			const externalSessions = sessions.filter(s => !s.isInWorkspace);

			interface SessionPickItem extends QuickPickItem {
				session: AgentSession;
			}

			const items: (SessionPickItem | QuickPickItem)[] = [];

			if (workspaceSessions.length > 0) {
				items.push(createQuickPickSeparator('This workspace'));
				for (const s of workspaceSessions) {
					const worktreeName = this.getWorktreeMetadataForSession(s)?.name;
					items.push({
						label: `$(robot) ${getSessionDisplayName(s, worktreeName)}`,
						description: s.status,
						detail: worktreeName ? `worktree: ${worktreeName}` : undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			if (externalSessions.length > 0) {
				items.push(createQuickPickSeparator('Other workspaces'));
				for (const s of externalSessions) {
					items.push({
						label: `$(robot) ${getSessionDisplayName(s, this.getWorktreeMetadataForSession(s)?.name)}`,
						description: s.status,
						detail: s.workspacePath ?? undefined,
						session: s,
					} satisfies SessionPickItem);
				}
			}

			const pick = await window.showQuickPick<SessionPickItem | QuickPickItem>(items, {
				placeHolder: 'Select an agent session',
			});
			if (pick == null || !('session' in pick)) return;

			session = pick.session;
		}

		if (session == null) return;

		await this.dispatchSessionAction(session);
	}

	/**
	 * Deterministically picks the right action for a resolved session — no quickpick:
	 *  - Extension-hosted, owned by another VS Code window → notify the owning peer (if it has
	 *    GitLens running with the workspace) to open the session in its Claude Code extension,
	 *    then `vscode.openFolder` (different workspace) or an info message (same/no workspace,
	 *    where OS-level cross-window focus is unreliable on multi-window VS Code instances).
	 *  - Extension-hosted, owned by this window → open in our Claude Code extension.
	 *  - CLI-hosted → focus the terminal via `pid`.
	 *  - Neither workspace nor pid → warn.
	 *
	 *  Host classification reads `~/.claude/sessions/<pid>.json` for the `entrypoint` field; the
	 *  ownership check walks up to two parent-pid levels — for extension sessions the Claude
	 *  binary's direct parent is the owning extension host process, so `parent === process.pid`
	 *  ⇔ ours, with one extra hop reserved as a safety margin for a hypothetical Claude shim
	 *  between the binary and the extension host.
	 */
	private async dispatchSessionAction(session: AgentSession): Promise<void> {
		// Match by id, not object identity — provider session arrays are rebuilt on every update
		// (immutable spread), so a `.includes(session)` check would miss if the provider rebuilt
		// its array between the user's pick and this dispatch.
		const provider = this._providers.find(p => p.sessions.some(s => s.id === session.id));

		// A completed session has no live process — its retained `pid` is a dead (and, across the
		// 30-day retention window, potentially reused) process id, so it must NOT reach the
		// classify/focus dispatch below. Trigger lazy title/prompt resolution (the poll skips it),
		// then route straight to resume: `canResumeSession` includes `completed`, so the user gets a
		// "Resume in Terminal" prompt instead of a focus attempt on an unrelated process.
		if (session.status === 'completed') {
			provider?.resolveCompletedSessionDetails?.(session.id);
			await this.offerResumeOrWarn(session, 'This agent session has ended.');
			return;
		}

		const { classifyClaudeSessionHost } = await import(
			/* webpackChunkName: "agents" */ '@env/agents/claudeSessionFile.js'
		);
		const host = session.pid != null ? await classifyClaudeSessionHost(session.pid) : undefined;

		// For extension-hosted sessions, determine whether this VS Code window owns the live
		// session (its Claude Code extension launched the Claude binary). The Claude binary's
		// direct parent IS the owning extension host process, so `parent === process.pid` ⇔ ours.
		// Authoritative even when the session arrived via `syncSessions` (which reads global
		// Claude session files without knowing which window owns each).
		const isExtensionLocal =
			host === 'extension' && session.pid != null
				? await this.isExtensionSessionLocallyHosted(session.pid)
				: true;

		// Peer-owned extension session, OR a peer-sync-discovered session. Either way the live
		// panel lives in another VS Code window; opening locally would just create an inert view.
		if ((host === 'extension' && !isExtensionLocal) || session.isPeerOwned) {
			await this.dispatchPeerOwnedSession(provider, session);
			return;
		}

		if (session.isInWorkspace) {
			// Always probe — when host is 'extension' we still need the real value to decide
			// between the actionable "Claude Code extension is not installed" warning below and
			// the generic "unable to open" fallback. Forcing `true` here would make the
			// extension-specific warning unreachable.
			const extensionAvailable = await isClaudeExtensionAvailable();
			const useExtension = host === 'extension' || (host == null && extensionAvailable);

			if (useExtension && (await tryOpenClaudeSession(session.id))) return;
			// Skip the terminal-focus fallback when we *know* the session is extension-hosted —
			// `pid` would be the extension host (VS Code itself), so focusing it is a no-op that
			// would falsely signal success and swallow the warning the user needs.
			if (host !== 'extension' && session.pid != null && (await this.tryFocusProcessWindow(session.pid))) {
				return;
			}

			Logger.warn(
				`AgentStatusService.dispatchSessionAction: in-workspace open failed for session ${session.id} (host=${host ?? 'unknown'}, pid=${session.pid ?? 'none'}, extensionAvailable=${extensionAvailable})`,
			);
			await this.offerResumeOrWarn(
				session,
				host === 'extension' && !extensionAvailable
					? 'The Claude Code extension is not installed or not available.'
					: 'Unable to open agent session.',
			);
			return;
		}

		// CLI-hosted out-of-workspace session — focus the terminal.
		if (session.pid != null && (await this.tryFocusProcessWindow(session.pid))) return;

		Logger.warn(
			`AgentStatusService.dispatchSessionAction: no actionable target for session ${session.id} (isInWorkspace=${session.isInWorkspace}, workspacePath=${session.workspacePath ?? 'none'}, pid=${session.pid ?? 'none'})`,
		);
		await this.offerResumeOrWarn(session, 'Unable to open agent session.');
	}

	/** Shared dead-end handler for every open path that can't reach the live session. When the
	 *  session is resumable (idle, or waiting on user input — see {@link canResumeSession}),
	 *  prompts the user to spawn a fresh terminal running `claude --resume <id>`; otherwise just
	 *  surfaces the original warning. Keeps the prompt single-action so a dismiss is the obvious
	 *  "no" — the warning text itself communicates the failure that triggered the fallback. */
	private async offerResumeOrWarn(session: AgentSession, warning: string): Promise<void> {
		if (!canResumeSession(session)) {
			void window.showWarningMessage(warning);
			return;
		}

		const action = 'Resume in Terminal';
		const choice = await window.showWarningMessage(`${warning} Resume it in a terminal?`, action);
		if (choice !== action) return;

		// Re-read after the prompt: it can sit unanswered indefinitely, and a resume reuses the SAME
		// session id, so acting on the captured snapshot could start a second `claude --resume` against
		// a transcript another window is already writing. A row that's gone (archived, or reconciled
		// away) is still safe to resume — its transcript is on disk and nothing is holding it.
		//
		// The test is that status AND pid are unchanged, not merely that it's still resumable. A
		// resume elsewhere revives a `completed` row to `idle`, which `canResumeSession` accepts, so
		// a resumability check alone would wave the second process straight through; and a reconnect
		// can swap the pid while HOLDING `idle`, which a status-only check would miss. Either move
		// means the situation the user agreed to no longer holds.
		const current = this.sessions.find(s => s.id === session.id);
		if (current != null && (current.status !== session.status || current.pid !== session.pid)) {
			void window.showInformationMessage('That agent session changed state, so it was not resumed.');
			return;
		}

		await resumeClaudeSessionInTerminal(toResumableSessionRef(current ?? session), this.container);
	}

	/** Routes a session that's owned by another VS Code window. Notifies the owning peer (if it
	 *  has GitLens running with the workspace) so its Claude Code extension surfaces the session,
	 *  then either `vscode.openFolder` (different workspace — focuses the peer window via the
	 *  folder-already-open path) or an info message (same workspace or unknown workspace, where
	 *  OS-level cross-window focus across a multi-window VS Code app is unreliable). */
	private async dispatchPeerOwnedSession(
		provider: AgentSessionProvider | undefined,
		session: AgentSession,
	): Promise<void> {
		// Target folder to focus. Each step picks a more general fallback so out-of-workspace
		// sessions (cwd doesn't match any of OUR workspace folders) still resolve to a path some
		// peer window likely has open as its workspace root:
		//  - workspacePath: our matched folder (only set when isInWorkspace=true; unused here)
		//  - worktreePath:  the session's worktree root — correct for named worktrees where the
		//                   peer has the worktree dir open, not the common repo dir
		//  - commonPath:    the parent repo's common dir — correct for default-worktree sessions
		//  - cwd:           last-resort raw cwd. May be a subdir of the peer's workspace, in which
		//                   case `vscode.openFolder` would open the subdir as its own workspace
		//                   instead of focusing the peer. In practice Claude sessions run at the
		//                   workspace root so cwd usually equals what the peer holds; the residual
		//                   risk is documented rather than fixed (full fix would have
		//                   `notifyPeerOpenSession` return the matched workspacePath so this
		//                   function could pass that exact path to `openFolder` instead).
		const targetPath = session.workspacePath ?? session.worktreePath ?? session.commonPath ?? session.cwd;

		if (provider?.notifyPeerOpenSession != null && targetPath != null) {
			// Cap the wait so an unhealthy peer can't stall the user click for the full per-fetch
			// timeout. The peer only needs to *start* opening the session before the focus switch
			// lands. `.catch` is on the notify promise itself (not the race) so a late rejection
			// after the timeout wins is still observed. We don't use the return value: VS Code's
			// `openFolder` finds and focuses the owning window whether or not it has GitLens, so
			// peer match status isn't the right signal for `forceNewWindow`.
			const notifyPromise = provider.notifyPeerOpenSession(targetPath, session.id).catch((ex: unknown) => {
				Logger.warn(
					`AgentStatusService.dispatchPeerOwnedSession: notifyPeerOpenSession failed: ${
						ex instanceof Error ? ex.message : String(ex)
					}`,
				);
				return false;
			});
			await Promise.race([notifyPromise, new Promise<void>(resolve => setTimeout(resolve, 500))]);
		}

		// Different workspace → `vscode.openFolder` with `forceNewWindow: false` asks VS Code to
		// focus the existing window holding `targetPath` (this works across windows even if the
		// peer doesn't have GitLens). Peer-owned implies *some* live window holds the folder (the
		// session is running there), so VS Code's window-folder matching reliably hits it instead
		// of replacing the current window.
		if (!session.isInWorkspace && targetPath != null) {
			void commands.executeCommand('vscode.openFolder', Uri.file(targetPath), {
				forceNewWindow: false,
			});
			return;
		}

		// Same workspace (already open here, can't disambiguate) or no target at all. Surface a
		// clear hint with the cwd so the user can switch manually.
		Logger.warn(
			`AgentStatusService.dispatchPeerOwnedSession: routed via info hint (pid=${session.pid ?? 'none'}, workspacePath=${session.workspacePath ?? 'none'}, cwd=${session.cwd ?? 'none'})`,
		);
		const cwdHint = session.cwd ? ` (${session.cwd})` : '';
		await this.offerResumeOrWarn(
			session,
			`This session is running in another VS Code window${cwdHint}. Switch to it to view.`,
		);
	}

	/** Returns `true` iff the given `pid` (a Claude binary process for an extension-hosted session)
	 *  is a descendant of this VS Code window's extension host. For peer-owned sessions the parent
	 *  is a *different* extension host (another window's), so this resolves to `false` — that's the
	 *  dispatcher's signal to route through the peer-notify path instead of opening locally. */
	private async isExtensionSessionLocallyHosted(pid: number): Promise<boolean> {
		const { isDescendantOfThisExtensionHost } = await import(
			/* webpackChunkName: "agents" */ '@env/focusWindow.js'
		);
		return isDescendantOfThisExtensionHost(pid);
	}

	private async tryFocusProcessWindow(pid: number): Promise<boolean> {
		const { focusProcessWindow } = await import(/* webpackChunkName: "agents" */ '@env/focusWindow.js');
		return focusProcessWindow(pid);
	}

	private getWorkspacePaths(): string[] {
		return workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
	}

	private startProviders(): void {
		const paths = this.getWorkspacePaths();
		if (paths.length === 0) return;

		for (const provider of this._providers) {
			provider.start(paths);
		}
	}

	private stopProviders(): void {
		for (const provider of this._providers) {
			provider.stop();
		}
	}

	private onWorkspaceFoldersChanged(): void {
		// Do NOT early-return on an empty list — providers need to reclassify
		// existing sessions' `isInWorkspace` when the last folder is removed.
		const paths = this.getWorkspacePaths();

		for (const provider of this._providers) {
			if (provider.updateWorkspacePaths != null) {
				provider.updateWorkspacePaths(paths);
			} else if (paths.length > 0) {
				provider.start(paths);
			}
		}
	}
}

/** Field-by-field equality for the worktree metadata cache. Keeps the refresh's `changed` flag
 *  precise (and `maybeFireSerializedChange`'s JSON-diff downstream rare) without paying for
 *  per-worktree `JSON.stringify` round-trips on the host hot path. */
/** `JSON.stringify` replacer for the change-detect key: coarsens the volatile timestamps to minute
 *  buckets. `lastActivity` moves on every provider tick, so comparing it raw defeats the gate and
 *  storms every webview with a full push every few seconds for as long as any session is live.
 *  Consumers render elapsed against local `now`, so minute-granularity refreshes are enough for
 *  drift; real changes (phase/status/membership/permission/worktree) still differ in the key and
 *  push immediately. The timestamps stay full-precision in the payload itself.
 *
 *  Dates reach this already converted by `toJSON`, hence the `string` check. */
function coarsenVolatileTimestamps(key: string, value: unknown): unknown {
	return (key === 'lastActivity' || key === 'phaseSince') && typeof value === 'string'
		? `${Math.floor(Date.parse(value) / 60000)}`
		: value;
}

function isSameWorktreeMetadata(a: AgentSessionWorktreeMetadata | undefined, b: AgentSessionWorktreeMetadata): boolean {
	if (a == null) return false;
	if (a.name !== b.name || a.type !== b.type || a.isDefault !== b.isDefault || a.repoPath !== b.repoPath) {
		return false;
	}
	if (a.branch == null) return b.branch == null;
	if (b.branch == null) return false;
	return a.branch.name === b.branch.name && a.branch.upstreamName === b.branch.upstreamName;
}
