import type { CancellationTokenSource } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import {
	getBranchId,
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import { supportedOrderedCloudIssuesIntegrationIds } from '@gitlens/integrations/constants.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { areEqual } from '@gitlens/utils/object.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getAssociatedIssuesForBranch } from '../../../git/utils/-webview/branch.issue.utils.js';
import {
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
	getBranchRemote,
} from '../../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { getRemoteProviderUrl } from '../../../git/utils/-webview/remote.utils.js';
import { getWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { toAbortSignal } from '../../../system/-webview/cancellation.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getContext } from '../../../system/-webview/context.js';
import { serializeWebviewItemContext } from '../../../system/webview.js';
import type { IpcParams } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type { GraphSyncPublisher } from './graphSyncPublisher.js';
import {
	isRepoHostingIntegrationConnected,
	stripRefsMetadataTypes,
	toGraphHostingServiceType,
	toGraphIssueTrackerType,
} from './graphWebview.utils.js';
import type {
	BranchState,
	GetMissingRefsMetadataCommand,
	GraphItemContext,
	GraphMissingRefsMetadata,
	GraphMissingRefsMetadataType,
	GraphRefMetadata,
	GraphRefMetadataType,
	GraphRefsMetadata,
} from './protocol.js';
import { DidChangeBranchStateNotification, supportedRefMetadataTypes } from './protocol.js';

/** Collaborators the producers cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphProducersContext()`. `getRepository`/`getSession`/`getSync` read
 *  live provider state; `updateState` forwards to the data controller's coalescer; the cancellation
 *  and pending-notification callbacks route through the provider's shared `_cancellations` map and
 *  `_ipcNotificationMap`, which stay there. */
export type GraphProducersServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getSync: () => GraphSyncPublisher;
	updateState: (immediate?: boolean) => void;
	createBranchStateOnlyCancellation: () => CancellationTokenSource;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Host-side producers cluster for the graph, split out of `GraphWebviewProvider` (R3). Owns the
 *  refsMetadata enrichment pipeline (fetch/dedup-buffer/invalidations/integration-flip strips + the
 *  debounced publisher mark) and the branchState channel (full + fast-path pushes with the last-sent
 *  dedup gate). The provider keeps the IPC forwarder and subscription wiring and injects the
 *  collaborators via {@link GraphProducersServiceContext}. */
export class GraphProducersService {
	constructor(private readonly context: GraphProducersServiceContext) {}

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
	private get _graphSync(): GraphSyncPublisher {
		return this.context.getSync();
	}

	private _issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked' = 'not-checked';
	// Last observed membership of THIS repo in `gitlens:repos:withHostingIntegrationsConnected` — the
	// hosting-connected context handler only resets refsMetadata when this flips, so a no-op re-publish
	// (a fresh-but-identical array; see `isRepoHostingIntegrationConnected`) can't blank the pills.
	private _lastHostingIntegrationConnected: boolean | undefined;
	private _refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	/** Most recent branchState we sent to the webview, so async PR resolution can merge into the freshest values. */
	private _lastSentBranchState: BranchState | undefined;
	// Metadata requests that arrived while the graph session isn't loaded (mid-rebuild) — onGetMissingRefMetadata can't
	// fetch yet, so buffer them and replay on the next `setGraph(data)`. RepoPath-tagged so a request captured
	// for the prior repo can never drain onto a freshly-swapped graph. Without this, a request lost in the
	// rebuild window left its id stuck in the webview's per-id dedup → the pill's counts never returned.
	private _pendingRefMetadataRequests: GraphMissingRefsMetadata | undefined;
	private _pendingRefMetadataRepoPath: string | undefined;
	private _notifyDidChangeRefsMetadataDebounced:
		| Deferrable<GraphProducersService['notifyDidChangeRefsMetadata']>
		| undefined = undefined;

	dispose(): void {
		this._notifyDidChangeRefsMetadataDebounced?.cancel();
	}

	/** Read-only view for the publisher's data source and the provider's config-change gate. */
	get refsMetadata(): Map<string, GraphRefMetadata | null> | null | undefined {
		return this._refsMetadata;
	}

	get lastSentBranchState(): BranchState | undefined {
		return this._lastSentBranchState;
	}

	/** Sets the branchState dedup gate directly — used by bootstrap capture, the state coalescer's
	 *  post-send commit, and `resetRepositoryState` (undefined). */
	setLastSentBranchState(branchState: BranchState | undefined): void {
		this._lastSentBranchState = branchState;
	}

	async onGetMissingRefMetadata(params: IpcParams<typeof GetMissingRefsMetadataCommand>): Promise<void> {
		// Feature off → nothing to fetch; ignore permanently (the webview won't request when null anyway).
		if (this._refsMetadata === null) return;
		// Mid-rebuild (graph not yet populated) → can't fetch now, but DON'T silently drop the request: that
		// left the requested id stuck in the webview's per-id dedup, so the pill's counts never came back.
		// Buffer it (repoPath-tagged) and replay on the next setGraph(data) once the graph exists.
		if (this._graphSession == null) {
			const repoPath = this.repository?.path;
			if (repoPath == null) return;

			if (this._pendingRefMetadataRepoPath !== repoPath) {
				this._pendingRefMetadataRequests = undefined;
				this._pendingRefMetadataRepoPath = repoPath;
			}
			const pending = (this._pendingRefMetadataRequests ??= {});
			for (const [id, types] of Object.entries(params.metadata)) {
				pending[id] = pending[id] != null ? [...new Set([...pending[id], ...types])] : types;
			}
			return;
		}

		// PR/issue enrichment needs a connected integration; upstream (ahead/behind) is local-git data and
		// doesn't. Resolve integration availability up front so we can still satisfy upstream requests when
		// nothing is connected (the per-type loop nulls PR/issue in that case) instead of bailing entirely.
		const hasHostingIntegration =
			getContext('gitlens:repos:withHostingIntegrationsConnected')?.includes(this._graphSession.repoPath) ??
			false;
		const hasIntegration =
			hasHostingIntegration ||
			(this._issueIntegrationConnectionState !== 'not-checked'
				? this._issueIntegrationConnectionState === 'connected'
				: await this.checkIssueIntegrations());

		const repoPath = this._graphSession.repoPath;

		async function getRefMetadata(
			this: GraphProducersService,
			id: string,
			missingTypes: GraphMissingRefsMetadataType[],
		) {
			this._refsMetadata ??= new Map();

			const branch = (
				await this.container.git
					.getRepositoryService(repoPath)
					.branches.getBranches({ filter: b => b.id === id })
			)?.values?.[0];
			const metadata = { ...this._refsMetadata.get(id) };

			if (branch == null) {
				for (const type of missingTypes) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);
				}

				return;
			}

			// `pullRequest` and `issue` each need their own network round-trip and don't depend on one
			// another (or on `upstream`, which is local-git data) — resolve them concurrently below
			// instead of blocking one on the other in a sequential loop.
			const resolvePullRequest = async (): Promise<void> => {
				const pr = branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;

				if (pr == null) {
					if (metadata.pullRequest === undefined || metadata.pullRequest?.length === 0) {
						metadata.pullRequest = null;
					}

					this._refsMetadata!.set(id, metadata);
					return;
				}

				const hostingService = toGraphHostingServiceType(pr.provider.id);
				if (hostingService == null) {
					debugger;
					return;
				}

				const prMetadata: NonNullable<NonNullable<GraphRefMetadata>['pullRequest']>[number] = {
					hostingServiceType: hostingService,
					id: Number.parseInt(pr.id) || 0,
					title: pr.title,
					author: pr.author.name,
					date: (pr.mergedDate ?? pr.closedDate ?? pr.updatedDate)?.getTime(),
					state: pr.state,
					url: pr.url,
					context: serializeWebviewItemContext<GraphItemContext>({
						webviewItem: `gitlens:pullrequest${pr.refs ? '+refs' : ''}`,
						webviewItemValue: {
							type: 'pullrequest',
							id: pr.id,
							url: pr.url,
							repoPath: repoPath,
							refs: pr.refs,
							provider: {
								id: pr.provider.id,
								name: pr.provider.name,
								domain: pr.provider.domain,
								icon: pr.provider.icon,
							},
						},
					}),
				};

				metadata.pullRequest = [prMetadata];

				this._refsMetadata!.set(id, metadata);
				if (branch?.upstream?.missing) {
					this._refsMetadata!.set(getBranchId(repoPath, true, branch.upstream.name), metadata);
				}
			};

			// TODO: Issue metadata needs to update for a branch whenever we add an associated issue for it, so that we don't
			// have to completely refresh the component to see the new issue
			const resolveIssue = async (): Promise<void> => {
				let issues: IssueShape[] | undefined = await getAssociatedIssuesForBranch(this.container, branch).then(
					issues => issues.value,
				);
				if (!issues?.length) {
					issues = await getBranchEnrichedAutolinks(this.container, branch).then(async enrichedAutolinks => {
						if (enrichedAutolinks == null) return undefined;

						return (
							await Promise.all(
								Array.from(
									enrichedAutolinks.values(),
									async ([issueOrPullRequestPromise]) => issueOrPullRequestPromise ?? undefined,
								),
							)
						).filter<IssueShape>(
							(a?: unknown): a is IssueShape =>
								a != null && a instanceof Object && 'type' in a && a.type === 'issue',
						);
					});

					if (!issues?.length) {
						metadata.issue = null;
						this._refsMetadata!.set(id, metadata);
						return;
					}
				}

				const issuesMetadata: NonNullable<NonNullable<GraphRefMetadata>['issue']>[number][] = [];
				for (const issue of issues) {
					const issueTracker = toGraphIssueTrackerType(issue.provider.id);
					if (issueTracker == null) {
						debugger;
						continue;
					}

					issuesMetadata.push({
						issueTrackerType: issueTracker,
						displayId: issue.id,
						id: issue.nodeId ?? issue.id,
						// TODO: This is a hack/workaround because the graph component doesn't support this in the tooltip.
						// Update this once that is fixed.
						title: `${issue.title}\nDouble-click to open issue on ${issue.provider.name}`,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:issue',
							webviewItemValue: {
								type: 'issue',
								id: issue.id,
								url: issue.url,
								provider: {
									id: issue.provider.id,
									name: issue.provider.name,
									domain: issue.provider.domain,
									icon: issue.provider.icon,
								},
							},
						}),
					});
				}

				metadata.issue = issuesMetadata;
				this._refsMetadata!.set(id, metadata);
			};

			const asyncResolvers: Promise<void>[] = [];

			for (const type of missingTypes) {
				if (!supportedRefMetadataTypes.includes(type)) {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);

					continue;
				}

				// PR/issue enrichment requires a connected integration; without one, resolve them as
				// "none" so the webview stops re-requesting them, while still resolving upstream below.
				if (!hasIntegration && type !== 'upstream') {
					metadata[type] = null;
					this._refsMetadata.set(id, metadata);

					continue;
				}

				if (type === 'pullRequest') {
					asyncResolvers.push(resolvePullRequest());
					continue;
				}

				if (type === 'upstream') {
					const upstream = branch?.upstream;

					if (upstream == null || upstream.missing) {
						metadata.upstream = null;
						this._refsMetadata.set(id, metadata);
						continue;
					}

					const upstreamMetadata: NonNullable<GraphRefMetadata>['upstream'] = {
						name: getBranchNameWithoutRemote(upstream.name),
						owner: getRemoteNameFromBranchName(upstream.name),
						ahead: branch.upstream?.state.ahead ?? 0,
						behind: branch.upstream?.state.behind ?? 0,
						context: serializeWebviewItemContext<GraphItemContext>({
							webviewItem: 'gitlens:upstreamStatus',
							webviewItemValue: {
								type: 'upstreamStatus',
								ref: getReferenceFromBranch(branch),
								ahead: branch.upstream?.state.ahead ?? 0,
								behind: branch.upstream?.state.behind ?? 0,
							},
						}),
					};

					metadata.upstream = upstreamMetadata;

					this._refsMetadata.set(id, metadata);
					continue;
				}

				if (type === 'issue') {
					asyncResolvers.push(resolveIssue());
				}
			}

			if (asyncResolvers.length) {
				await Promise.allSettled(asyncResolvers);
			}
		}

		const promises: Promise<void>[] = [];

		for (const id of Object.keys(params.metadata)) {
			promises.push(getRefMetadata.call(this, id, params.metadata[id]));
		}

		if (promises.length) {
			await Promise.allSettled(promises);
		}
		this.updateRefsMetadata();
	}

	// Re-fetch ahead/behind for already-tracked branches after their tips/upstreams move (commit → `heads`,
	// fetch → `remotes`); the cached counts are now stale. Rather than wiping the map (which would blank every
	// pill until re-fetched), re-request ONLY entries that already carry upstream metadata — onGetMissingRefMetadata
	// overwrites their value references (copy-on-write) and the delta channel ships just those, so the pills
	// update in place, the per-id dedup is untouched (no re-request storm for no-upstream branches), and
	// unrelated state pushes do zero ref-metadata git work — the perf win over the old reset-on-every-push.
	invalidateUpstreamRefsMetadata(): void {
		if (this._refsMetadata == null) return;

		const metadata: GraphMissingRefsMetadata = {};
		for (const [id, value] of this._refsMetadata) {
			if (value?.upstream != null) {
				metadata[id] = ['upstream'];
			}
		}
		if (Object.keys(metadata).length === 0) return;

		void this.onGetMissingRefMetadata({ metadata: metadata });
	}

	/** Clear cached issue metadata so the next render re-fetches. Returns true when there was
	 *  metadata to clear (caller can use this to decide whether to fire a partial IPC refresh). */
	clearRefsMetadataIssues(): boolean {
		if (this._refsMetadata == null) return false;

		for (const [id, value] of this._refsMetadata) {
			// Skip entries with nothing cached to clear (already pending re-fetch) — avoids allocating and
			// needlessly bumping their reference into the next delta.
			if (value?.issue === undefined) continue;

			// Replace the value reference (copy-on-write) rather than mutating in place: the publisher's
			// refsMetadata delta detects changes by value-reference identity, so an in-place
			// `value.issue = undefined` would be invisible to the delta and the stale issue would never ship.
			this._refsMetadata.set(id, { ...value, issue: undefined });
		}
		return true;
	}

	// Whether refsMetadata is populatable at all. Upstream (ahead/behind) is local-git data needing no
	// integration, so it stays on whenever upstream status is enabled — even with nothing connected; only
	// fully OFF when upstream status is disabled AND no integration is connected. Derived from config/context
	// (NOT from `_refsMetadata`'s value) so feature-off is detectable BEFORE the map is ever initialized — a
	// `serializeRefsMetadata()` on the first/bootstrap push must ship `null` for off, not a spurious empty map.
	get isRefsMetadataEnabled(): boolean {
		// Membership-scoped to THIS repo — the context is repo-agnostic (any connected repo would
		// otherwise wrongly enable metadata here).
		const repoPath = this._graphSession?.repoPath ?? this.repository?.path;
		return (
			configuration.get('graph.showUpstreamStatus') ||
			isRepoHostingIntegrationConnected(getContext('gitlens:repos:withHostingIntegrationsConnected'), repoPath) ||
			this._issueIntegrationConnectionState !== 'not-connected'
		);
	}

	resetRefsMetadata(): null | undefined {
		// `null` marks the whole refsMetadata feature off (the webview won't request metadata). The
		// publisher's refsMetadata cursor self-corrects: `onGetMissingRefMetadata` re-fetches with fresh
		// value references (copy-on-write), so the next delta ships every re-fetched entry regardless of
		// the stale cursor, and the accompanying `updateState(true)` REPLACES the webview's map.
		this._refsMetadata = this.isRefsMetadataEnabled ? undefined : null;
		return this._refsMetadata;
	}

	/**
	 * Publish a hosting/issue integration connect/disconnect WITHOUT blanking upstream stats. A wholesale
	 * `resetRefsMetadata()` wipe shipped an authoritative empty REPLACE that blanked every pill's ahead/behind
	 * (local-git data the integration flip never touches) until it re-fetched. Instead STRIP only the
	 * integration-owned `drop` types (copy-on-write, preserving `upstream`) and REPLACE the webview's map over
	 * the sequenced channel with `refsMetadataReset` — pills keep their counts, and the reset re-arms the
	 * webview's per-id request dedup so it re-requests just the dropped types for visible rows. Falls back to
	 * the full `resetRefsMetadata()` wipe only when the flip leaves the feature genuinely off, or when there's
	 * nothing populated to preserve.
	 */
	private updateRefsMetadataForIntegrationChange(drop: readonly GraphRefMetadataType[]): void {
		// The legacy <gl-graph> has no reset-token plumbing — only a wholesale wipe makes GKC re-request the
		// stripped types. Preserve the upstream-keeping strip ONLY for the new engine, which honors the token.
		const useNewEngine = configuration.get('graph.experimental.useNewEngine') === true;
		if (useNewEngine && this.isRefsMetadataEnabled && this._refsMetadata != null) {
			this._refsMetadata = stripRefsMetadataTypes(this._refsMetadata, drop);
		} else {
			// Legacy engine, or the feature is off (→ `null`) / on-but-unpopulated (→ `undefined`): full wipe.
			this.resetRefsMetadata();
		}

		// REPLACE the webview's refsMetadata map (the reset-anchor) over the sequenced channel — same authoritative
		// path the old wipe used, but with an upstream-preserving payload the reducer REPLACEs (counts intact).
		// The reset flag also bumps the webview's request-dedup token so the dropped types re-request.
		this._graphSync.markRefsMetadataReset();
		void this._graphSync.flush();
		this.context.updateState(true);
	}

	// Read-only FULL snapshot of refsMetadata for the full-state push. That push is a reset-anchor (prior
	// dedicated deltas are pruned on replay), so it must carry the COMPLETE map, never a delta. Returns `null`
	// when the feature is off, else a concrete Record (`{}` when empty — NEVER `undefined`) so the webview's
	// full-state REPLACE is unambiguous: `{}` after a reset clears the map (e.g. repo swap), a populated map
	// re-syncs wholesale, and there's no "absent field" that would silently preserve stale entries. Pure: it
	// does NOT mutate `_refsMetadata` or the delta watermark (decoupling production from the push lifecycle —
	// the root-cause fix; getState() used to reset on every push, blanking the webview's accumulated counts).
	serializeRefsMetadata(): GraphRefsMetadata | null {
		if (!this.isRefsMetadataEnabled) return null;
		return this._refsMetadata == null ? {} : Object.fromEntries(this._refsMetadata);
	}

	/** Replay ref-metadata requests buffered during a rebuild window, fired by the controller's `setGraph`
	 *  once a graph lands. The graph exists now, so `onGetMissingRefMetadata` can fetch. RepoPath-gated so a
	 *  buffer captured for the prior repo can't satisfy against this graph. */
	replayPendingRefMetadataForGraph(graph: GitGraph): void {
		if (this._pendingRefMetadataRequests != null && this._pendingRefMetadataRepoPath === graph.repoPath) {
			const pending = this._pendingRefMetadataRequests;
			this._pendingRefMetadataRequests = undefined;
			this._pendingRefMetadataRepoPath = undefined;
			void this.onGetMissingRefMetadata({ metadata: pending });
		}
	}

	@trace()
	private updateRefsMetadata(immediate: boolean = false) {
		if (immediate) {
			this.notifyDidChangeRefsMetadata();
			return;
		}

		this._notifyDidChangeRefsMetadataDebounced ??= debounce(this.notifyDidChangeRefsMetadata.bind(this), 100);
		this._notifyDidChangeRefsMetadataDebounced();
	}

	@trace()
	private notifyDidChangeRefsMetadata() {
		// Incremental enrichment path: the publisher ships the value-reference delta of changed entries
		// (copy-on-write in `onGetMissingRefMetadata` makes the compare exact), and `null` (feature off)
		// as an authoritative reset the webview replaces on. The feature-toggle/integration RESET flows
		// (enable/wipe) route through `updateState(true)` instead — the full-state push REPLACES
		// refsMetadata, which the delta channel's spread-merge can't express for a same-enabled wipe.
		this._graphSync.mark('refsMetadata');
		void this._graphSync.flush();
	}

	getEnabledRefMetadataTypes(): GraphRefMetadataType[] {
		const types: GraphRefMetadataType[] = [];

		if (configuration.get('graph.issues.enabled')) {
			types.push('issue');
		}

		if (configuration.get('graph.pullRequests.enabled')) {
			types.push('pullRequest');
		}

		if (configuration.get('graph.showUpstreamStatus')) {
			types.push('upstream');
		}

		return types;
	}

	/** Seed the membership baseline (on repo-subscription wiring) so the first genuine flip
	 *  (connect/disconnect) is detected, and a no-op re-publish of the context is a no-op here. */
	seedHostingIntegrationConnected(repoPath: string): void {
		this._lastHostingIntegrationConnected = isRepoHostingIntegrationConnected(
			getContext('gitlens:repos:withHostingIntegrationsConnected'),
			repoPath,
		);
	}

	/** Handler body for the `gitlens:repos:withHostingIntegrationsConnected` context change (the
	 *  provider's repo-subscription wiring dispatches here). */
	onHostingIntegrationsConnectedContextChanged(repoPath: string): void {
		// The context is re-published with a freshly-allocated array on every `updateContext()`
		// (repo add/remove/open/close, integration connection changes), and `setContext` dedupes by
		// reference identity — so this fires even when the connected-repo set is UNCHANGED. Only react
		// to a real flip of THIS repo's membership; otherwise a no-op re-publish would wipe refsMetadata
		// and blank every ref pill's (integration-independent) ahead/behind until it re-fetches — the
		// "upstream stats flicker in and out" bug. PR/issue enrichment only needs to re-resolve when
		// this repo's hosting-integration connection actually changed, which is exactly this flip.
		const connected = isRepoHostingIntegrationConnected(
			getContext('gitlens:repos:withHostingIntegrationsConnected'),
			repoPath,
		);
		if (connected === this._lastHostingIntegrationConnected) return;

		this._lastHostingIntegrationConnected = connected;

		// A hosting-integration flip owns BOTH PR enrichment and hosting-derived issue autolinks — strip
		// both, preserving `upstream` (local-git ahead/behind) so the pills' counts never blank.
		this.updateRefsMetadataForIntegrationChange(['pullRequest', 'issue']);
	}

	async onIssueIntegrationConnectionChanged(connected: boolean): Promise<void> {
		if (connected) {
			this._issueIntegrationConnectionState = 'connected';
		} else {
			// Recheck since another issue integration might still be connected
			await this.checkIssueIntegrations();
		}

		// An issue-integration flip owns only issue enrichment — strip just `issue` (PRs + upstream survive).
		this.updateRefsMetadataForIntegrationChange(['issue']);
	}

	private async checkIssueIntegrations(): Promise<boolean> {
		const results = await Promise.allSettled(
			supportedOrderedCloudIssuesIntegrationIds.map(async id => {
				const integration = await this.container.integrations.get(id);
				return integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
			}),
		);
		const connected = results.map(r => (r.status === 'fulfilled' ? r.value : false));
		this._issueIntegrationConnectionState = connected.some(Boolean) ? 'connected' : 'not-connected';
		return this._issueIntegrationConnectionState === 'connected';
	}

	@trace()
	async notifyDidChangeBranchState(branchState: BranchState): Promise<boolean> {
		// Skip the notify when nothing actually changed — the fast-path (notifyDidChangeBranchStateOnly)
		// can fire on every tracking-affecting repo event, and a watcher burst will often produce identical
		// payloads after coalescing.
		if (this._lastSentBranchState != null && areEqual(branchState, this._lastSentBranchState)) {
			return false;
		}

		this._lastSentBranchState = branchState;
		return this.host.notify(DidChangeBranchStateNotification, {
			branchState: branchState,
		});
	}

	/**
	 * Fast-path refresh of just the header's branchState (ahead/behind/upstream/provider/worktree).
	 * Runs in parallel with the heavier full-state pipeline so push/pull/fetch land in the header
	 * immediately on `head`/`heads`/`remotes` events instead of waiting on the full graph rebuild.
	 *
	 * Uses its own `branchStateOnly` cancellation key — sharing `branchState` with the full-state
	 * pipeline would let `getState`'s start-of-call `cancelOperation('branchState')` abort our
	 * getBranch mid-flight, which silently falls through to the `getCurrentBranch` fallback path
	 * (hardcoded ahead/behind = 0) and poisons the cache with stale zeros.
	 *
	 * Preserves the last-known PR so the PR pill doesn't flicker; the full-state pass refreshes PR data.
	 */
	@trace()
	async notifyDidChangeBranchStateOnly(): Promise<void> {
		if (this.repository == null) return;
		if (!this.host.ready || !this.host.visible) {
			// Queue so the header refreshes immediately on panel reveal, instead of silently
			// dropping the notify (current behavior) and waiting for the full graph rebuild.
			// `_lastSentBranchState` dedupe inside `notifyDidChangeBranchState` correctly skips
			// no-change replays.
			this.context.addPendingNotification(DidChangeBranchStateNotification);
			return;
		}

		const cancellation = this.context.createBranchStateOnlyCancellation();
		const signal = toAbortSignal(cancellation.token);

		// getBranch + getWorktreesByBranch are independent — allSettled so a non-critical worktree failure
		// doesn't drop the branch state; branch.id is only read after both resolve.
		const [branchResult, worktreesByBranchResult] = await Promise.allSettled([
			this.repository.git.branches.getBranch(undefined, signal),
			getWorktreesByBranch(this.repository, undefined, signal),
		]);
		const branch: GitBranch | undefined = getSettledValue(branchResult);
		if (cancellation.token.isCancellationRequested || branch == null) return;

		const branchState: BranchState = { ...(branch.upstream?.state ?? { ahead: 0, behind: 0 }) };
		branchState.worktree = getSettledValue(worktreesByBranchResult)?.has(branch.id) ?? false;

		if (branch.upstream != null) {
			branchState.upstream = branch.upstream.name;
			try {
				const remote = await getBranchRemote(this.container, branch);
				if (remote?.provider != null) {
					branchState.provider = {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: await getRemoteProviderUrl(remote.provider, { type: RemoteResourceType.Repo }),
					};
				}
			} catch {
				/* swallow — provider info is non-critical */
			}

			// Preserve previously-resolved PR so the pill doesn't flicker between full-state passes.
			const existingPr = this._lastSentBranchState?.pr;
			if (existingPr != null) {
				branchState.pr = existingPr;
			}
		}

		if (cancellation.token.isCancellationRequested) return;

		void this.notifyDidChangeBranchState(branchState);
	}
}
