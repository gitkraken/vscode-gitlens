import { Uri } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { getPullRequestIdentityFromMaybeUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { getDefaultRemoteOrOrigin } from '@gitlens/git/utils/remote.utils.js';
import { sortBranches, sortRemotes, sortTags, sortWorktrees } from '@gitlens/git/utils/sorting.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import { fromProviderPullRequest } from '@gitlens/integrations/providers/models.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual } from '@gitlens/utils/object.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { Container } from '../../../container.js';
import * as BranchActions from '../../../git/actions/branch.js';
import * as RemoteActions from '../../../git/actions/remote.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import * as TagActions from '../../../git/actions/tag.js';
import * as WorktreeActions from '../../../git/actions/worktree.js';
import type { GlRepository } from '../../../git/models/repository.js';
import {
	getBestRemoteWithIntegration,
	getRemoteIntegration,
	remoteSupportsIntegration,
} from '../../../git/utils/-webview/remote.utils.js';
import { getOpenedWorktreesByBranch } from '../../../git/utils/-webview/worktree.utils.js';
import { isSubscriptionTrialOrPaidFromState } from '../../../plus/gk/utils/subscription.utils.js';
import { executeCommand } from '../../../system/-webview/command.js';
import type { ConfigPath } from '../../../system/-webview/configuration.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { IpcParams } from '../../ipc/handlerRegistry.js';
import type { IpcNotification } from '../../ipc/models/ipc.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewRecentThreshold,
} from '../../shared/overviewBranches.js';
import { getBranchOverviewType, toOverviewBranch } from '../../shared/overviewBranches.js';
import { getOverviewEnrichment, getOverviewWip } from '../../shared/overviewEnrichment.utils.js';
import type { WebviewHost } from '../../webviewProvider.js';
import { markSidebarInlineInvocation } from './graphSidebarActionTelemetry.js';
import type {
	DidGetSidebarDataParams,
	GetOverviewEnrichmentRequest,
	GetOverviewRequest,
	GetOverviewWipDetailedRequest,
	GetOverviewWipRequest,
	GraphBranchContextValue,
	GraphItemRefContext,
	GraphItemTypedContext,
	GraphOverviewData,
	GraphPullRequestContextValue,
	GraphRemoteContextValue,
	GraphSidebarItemOrigin,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
	GraphSidebarWorktree,
	GraphStashContextValue,
	GraphTagContextValue,
} from './protocol.js';
import { createWipRowId, DidChangeOverviewNotification, sidebarItemOrigin } from './protocol.js';

/** Collaborators the panels cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphPanelsContext()`. `getRepository`/`getSession`/`getLoading` read
 *  live provider state; `getPinnedRefId`/`fetchWipStatus`/`computeWorktreeChanges` forward into the
 *  WIP service's caches (kept there); `fireSidebarInvalidated` fires the provider's `sidebarInvalidated`
 *  RPC event (that transport stays wired in `getRpcServices`); the pending-notification callback routes
 *  through the provider's shared `_ipcNotificationMap`, which stays there. */
export type GraphPanelsServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getLoading: () => Promise<GitGraph> | undefined;
	getPinnedRefId: (repoPath: string | undefined) => string | undefined;
	fetchWipStatus: (path: string, signal?: AbortSignal) => Promise<GitStatus | undefined>;
	computeWorktreeChanges: (worktrees: GitWorktree[]) => void;
	fireSidebarInvalidated: () => void;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Open-PR list TTL. Matches Launchpad's list-level cache, which fronts the same kind of query. */
const pullRequestsCacheExpiration = 30 * 60 * 1000;
/** Page size for the open-PR walk. Paging is sequential, so a big page is the difference between one
 *  round trip and many — this is a browse list, not an export. */
const pullRequestsPageSize = 100;
/** Upper bound on the page walk, so a repo with a huge backlog can't stall the panel. With the page
 *  size above this is 300 pull requests, well past what anyone browses in a side bar. */
const pullRequestsMaxPages = 3;

/** Reverse tracking map (upstream name → local branch name), the same pass the remotes panel makes.
 *  Lets a pull request whose head is checked out focus the local branch, not a `remotes/*` ref. */
function buildLocalBranchesByUpstream(graph: GitGraph): Map<string, string> {
	const localByUpstream = new Map<string, string>();
	for (const b of graph.branches.values()) {
		if (!b.remote && b.upstream != null && !b.upstream.missing) {
			localByUpstream.set(b.upstream.name, b.name);
		}
	}
	return localByUpstream;
}

/** Host-side panels cluster for the graph, split out of `GraphWebviewProvider` (R3). Owns the Overview
 *  panel (data production + the `_lastSentOverview` dedup gate + `_overviewRecentThreshold` timeframe +
 *  the WIP/enrichment fetch handlers) and the Sidebar panels (branches/pull-requests/remotes/stashes/tags/
 *  worktrees data production + toggle/refresh/action handlers). The provider keeps the IPC forwarders and
 *  the RPC wiring and injects the collaborators via {@link GraphPanelsServiceContext}. */
export class GraphPanelsService {
	constructor(private readonly context: GraphPanelsServiceContext) {}

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

	// Timeframe for the Overview panel's "Recent" section. Seeded from the `graph:state` memento
	// in `getState`, updated in-place by `onGetOverview` when the webview changes it.
	private _overviewRecentThreshold: OverviewRecentThreshold = 'OneWeek';
	// Last overview shipped to the webview. `setGraph` fires `notifyDidChangeOverview` on every graph
	// reload (repo/visibility/filter change, refresh); most reloads reproduce the prior overview, so
	// a deep-equal gate skips the redundant serialize + webview re-render. Cleared in `setGraph` on
	// graph identity change.
	private _lastSentOverview: GraphOverviewData | undefined;
	// Open-PR list for the pull-requests panel, keyed by repo + integration + remote. Holds the promise
	// (not the value) so concurrent opens share one request; dropped on rejection so a failure doesn't
	// stick for the full TTL.
	private _pullRequestsCache:
		| { key: string; expiresAt: number; promise: Promise<PullRequest[] | undefined> }
		| undefined;

	get overviewRecentThreshold(): OverviewRecentThreshold {
		return this._overviewRecentThreshold;
	}

	/** Seeds the Overview "Recent" timeframe from the persisted memento (`getState`), before the first
	 *  `getOverviewData()` runs. */
	setOverviewRecentThreshold(value: OverviewRecentThreshold): void {
		this._overviewRecentThreshold = value;
	}

	/** Clear the overview dedup gate — the data controller calls this on graph identity change so the
	 *  next `notifyDidChangeOverview` always ships. */
	clearLastSentOverview(): void {
		this._lastSentOverview = undefined;
	}

	onGetOverview(params: IpcParams<typeof GetOverviewRequest>): GraphOverviewData {
		if (params.recentThreshold != null) {
			this._overviewRecentThreshold = params.recentThreshold;
		}
		try {
			return this.getOverviewData();
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverview');
			// Ship a structurally-valid shape so the frontend's `.length`/`.map` reads don't crash.
			return { active: [], recent: [], error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	async onGetOverviewWip(params: IpcParams<typeof GetOverviewWipRequest>): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		// Visibility-refresh path: webview asks for current overview WIP on panel mount / focus.
		// Default mode routes through the shared `_wipStatusCache`, so when the per-event push has
		// just populated entries (within 10s TTL) this is essentially free — no extra `git status`.
		// Cold entries (off-screen worktree without active watcher) miss → fetched once →
		// populated for any subsequent reader (rich hover, worktrees panel, next event push).
		// `cheap` mode (Recent worktree-backed cards) probes `status.hasWorkingChanges()` per
		// worktree — `@gate`d at the sub-provider so concurrent identical calls dedup. It bypasses
		// the status cache entirely; the breakdown arrives later via the hover-triggered detailed
		// fetch which goes through the cache.
		try {
			return await this.computeOverviewWipFromCache(params.branchIds, params.cheap);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWip');
			// Record-shaped response — empty map is safe; frontend reads `response[sha]` and gets `undefined`.
			return {};
		}
	}

	async onGetOverviewWipDetailed(
		params: IpcParams<typeof GetOverviewWipDetailedRequest>,
	): Promise<GetOverviewWipResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		try {
			return await this.computeOverviewWipFromCache(params.branchIds);
		} catch (ex) {
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewWipDetailed');
			return {};
		}
	}

	private computeOverviewWipFromCache(branchIds: string[], cheap?: boolean): Promise<GetOverviewWipResponse> {
		const data = this._graphSession!.current;
		// Cheap mode probes `hasWorkingChanges()` directly (dirty bit only) and bypasses the
		// shared `_wipStatusCache`; the cheap probe's `@gate` dedups concurrent identical calls.
		// Full breakdown arrives on hover via the non-cheap path through the cache.
		const options = cheap
			? { cheap: true }
			: {
					fetchStatus: (path: string, signal?: AbortSignal) => this.context.fetchWipStatus(path, signal),
				};
		return getOverviewWip(
			this.container,
			data.branches.values(),
			data.worktreesByBranch ?? new Map(),
			branchIds,
			options,
		);
	}

	async onGetOverviewEnrichment(
		params: IpcParams<typeof GetOverviewEnrichmentRequest>,
	): Promise<GetOverviewEnrichmentResponse> {
		if (params.branchIds.length === 0 || this._graphSession == null || this.repository == null) return {};

		try {
			const subscription = await this.container.subscription.getSubscription();
			const isPro = isSubscriptionTrialOrPaidFromState(subscription.state);

			return await getOverviewEnrichment(
				this.container,
				this._graphSession.current.branches.values(),
				params.branchIds,
				{
					isPro: isPro,
					resolveLaunchpad: true,
					// Merge-target is fetched lazily by the overview card on hover (and by the click-to-scope
					// path in `graph-app`) via `BranchesService.getMergeTargetStatus`, so initial enrichment
					// doesn't block on ~4 git/integration ops per branch. The resolved value is then merged
					// back into shared `overviewEnrichment` state via `mergeMergeTargetIntoEnrichment` so the
					// scope-anchor's `reconcileScopeMergeTarget` hook still backfills the tip SHA.
					skipMergeTarget: true,
				},
			);
		} catch (ex) {
			// Rethrow rather than resolving `{}` — `publishOverviewEnrichment` treats an empty result as
			// authoritative and would drop every previously-published entry, blanking the overview cards
			Logger.error(ex, 'GraphWebviewProvider', 'onGetOverviewEnrichment');
			throw ex;
		}
	}

	onGetAgentSessions(): AgentSessionState[] {
		return this.container.agentStatus?.getSerializedSessions() ?? [];
	}

	getOverviewData(): GraphOverviewData {
		const active: GraphOverviewData['active'] = [];
		const recent: GraphOverviewData['recent'] = [];

		if (this._graphSession == null || this.repository == null) {
			return { active: active, recent: recent };
		}

		const data = this._graphSession.current;
		const worktreesByBranch = data.worktreesByBranch ?? new Map();

		for (const branch of data.branches.values()) {
			if (branch.remote) continue;

			const branchType = getBranchOverviewType(
				branch,
				worktreesByBranch,
				this._overviewRecentThreshold,
				'OneYear',
			);
			switch (branchType) {
				case 'active':
					active.push(toOverviewBranch(branch, worktreesByBranch, true));
					break;
				case 'recent':
					recent.push(toOverviewBranch(branch, worktreesByBranch, false));
					break;
			}
		}

		recent.sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1));

		return { active: active, recent: recent };
	}

	@trace()
	async notifyDidChangeOverview(): Promise<boolean> {
		if (!this.host.ready || !this.host.visible) {
			this.context.addPendingNotification(DidChangeOverviewNotification);
			return false;
		}

		// Skip identical pushes — most graph reloads reproduce the prior overview verbatim. Advance
		// the last-sent snapshot only on confirmed delivery: a failed `notify` is requeued by type
		// and REPLACED by a later one, so a speculative advance could let the gate suppress the
		// replacement and leave the webview never receiving the overview.
		const overview = this.getOverviewData();
		if (this._lastSentOverview != null && areEqual(overview, this._lastSentOverview)) {
			return false;
		}

		const success = await this.host.notify(DidChangeOverviewNotification, { overview: overview });
		if (success) {
			this._lastSentOverview = overview;
		}
		return success;
	}

	async onGetSidebarData(
		params: { panel: GraphSidebarPanel; displayed?: boolean },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams> {
		const graph = this._graphSession?.current ?? (await this.context.getLoading()?.catch(() => undefined));
		signal?.throwIfAborted();
		if (graph == null) return { panel: params.panel, items: [] };

		switch (params.panel) {
			case 'branches':
				return this.getSidebarBranches(graph);
			case 'pullRequests':
				return this.getSidebarPullRequests(graph, signal);
			case 'remotes':
				return this.getSidebarRemotes(graph);
			case 'stashes':
				return this.getSidebarStashes(graph);
			case 'tags':
				return this.getSidebarTags(graph);
			case 'worktrees':
				return this.getSidebarWorktrees(graph, params.displayed);
			default:
				return { panel: params.panel, items: [] };
		}
	}

	private getProviderByRemote(graph: GitGraph): Map<string, string> {
		const providerByRemote = new Map<string, string>();
		for (const r of graph.remotes.values()) {
			if (r.provider?.name) {
				providerByRemote.set(r.name, r.provider.name);
			}
		}
		return providerByRemote;
	}

	private getSidebarBranches(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);

		const branchCfg = configuration.get('views.branches.branches');
		// Shares the Branches view's setting, but not its dedupe — that view drops remote branches with a
		// local counterpart only because it strips the remote prefix; we keep it, so both can coexist.
		const showRemoteBranches = configuration.get('views.branches.showRemoteBranches');
		const defaultRemote = showRemoteBranches
			? getDefaultRemoteOrOrigin([...graph.remotes.values()])?.name
			: undefined;

		const sorted = sortBranches(
			[...graph.branches.values()].filter(
				b => !b.remote || (defaultRemote != null && b.remoteName === defaultRemote),
			),
			{
				current: true,
				orderBy: configuration.get('sortBranchesBy'),
				openedWorktreesByBranch: getOpenedWorktreesByBranch(graph.worktreesByBranch),
			},
		);

		const items = sorted.map(b => {
			// Exclude the default worktree from the worktree indicator (matches view behavior)
			const isCheckedOut = b.worktree != null && b.worktree !== false;
			const hasWorktree = isCheckedOut && !b.worktree.isDefault;
			const worktree = graph.worktreesByBranch?.get(b.id);
			const remoteName = b.upstream ? getRemoteNameFromBranchName(b.upstream.name) : undefined;
			return {
				name: b.name,
				sha: b.sha,
				current: b.current,
				remote: b.remote,
				status: b.status,
				upstream: b.upstream ? { name: b.upstream.name, missing: b.upstream.missing } : undefined,
				tracking: b.upstream?.state,
				worktree: hasWorktree,
				worktreeOpened: worktree?.opened || undefined,
				checkedOut: isCheckedOut || undefined,
				disposition: b.disposition || undefined,
				date: b.date?.getTime(),
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				starred: b.starred || undefined,
				pinned: (pinnedRefId != null && b.id === pinnedRefId) || undefined,
				context: {
					webview: this.host.id,
					webviewItemOrigin: sidebarItemOrigin,
					webviewItem: `gitlens:branch${b.remote ? '+remote' : ''}${b.current ? '+current' : ''}${
						b.upstream != null && !b.upstream.missing ? '+tracking' : ''
					}${hasWorktree ? '+worktree' : ''}${
						b.current || isCheckedOut ? '+checkedout' : ''
					}${b.upstream?.state.ahead ? '+ahead' : ''}${b.upstream?.state.behind ? '+behind' : ''}${
						pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''
					}`,
					webviewItemValue: {
						type: 'branch',
						ref: createReference(b.name, graph.repoPath, {
							id: b.id,
							refType: 'branch',
							name: b.name,
							remote: b.remote,
							upstream: b.upstream,
						}),
					},
				} satisfies GraphItemRefContext<GraphBranchContextValue> & GraphSidebarItemOrigin,
			};
		});
		return {
			panel: 'branches' as const,
			items: items,
			layout: branchCfg.layout,
			compact: branchCfg.compact,
			showRemoteBranches: showRemoteBranches,
		};
	}

	private async getSidebarRemotes(graph: GitGraph) {
		const sorted = sortRemotes([...graph.remotes.values()]);
		const branchOrderBy = configuration.get('sortBranchesBy');
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);
		const branchesByRemote = new Map<string, GitBranch[]>();
		// Reverse tracking map (upstream name → local branch name) so each remote branch can name the
		// local branch that tracks it. Same pass as the grouping — no extra git work.
		const localByUpstream = new Map<string, string>();
		for (const b of graph.branches.values()) {
			if (!b.remote) {
				if (b.upstream != null && !b.upstream.missing) {
					localByUpstream.set(b.upstream.name, b.name);
				}
				continue;
			}

			const remote = getRemoteNameFromBranchName(b.name);
			let arr = branchesByRemote.get(remote);
			if (arr == null) {
				arr = [];
				branchesByRemote.set(remote, arr);
			}
			arr.push(b);
		}
		const items = await Promise.all(
			sorted.map(async r => {
				const rBranches = sortBranches(branchesByRemote.get(r.name) ?? [], {
					current: false,
					orderBy: branchOrderBy,
				});
				const branches = rBranches.map(b => ({
					name: getBranchNameWithoutRemote(b.name),
					sha: b.sha,
					localBranch: localByUpstream.get(b.name),
					pinned: (pinnedRefId != null && b.id === pinnedRefId) || undefined,
					context: {
						webview: this.host.id,
						webviewItemOrigin: sidebarItemOrigin,
						webviewItem: `gitlens:branch+remote${pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''}`,
						webviewItemValue: {
							type: 'branch',
							ref: createReference(b.name, graph.repoPath, {
								id: b.id,
								refType: 'branch',
								name: b.name,
								remote: true,
							}),
						},
					} satisfies GraphItemRefContext<GraphBranchContextValue> & GraphSidebarItemOrigin,
				}));

				let connected: boolean | undefined;
				if (remoteSupportsIntegration(r)) {
					const integration = await getRemoteIntegration(r);
					connected = integration?.maybeConnected ?? (await integration?.isConnected()) ?? false;
				}

				let webviewItem = 'gitlens:remote';
				if (r.default) {
					webviewItem += '+default';
				}
				if (connected != null) {
					webviewItem += connected ? '+connected' : '+disconnected';
				}

				return {
					name: r.name,
					url: r.urls[0]?.url,
					isDefault: r.default,
					providerIcon: r.provider?.icon,
					providerName: r.provider?.name,
					connected: connected,
					branches: branches,
					context: {
						webview: this.host.id,
						webviewItemOrigin: sidebarItemOrigin,
						webviewItem: webviewItem,
						webviewItemValue: {
							type: 'remote',
							name: r.name,
							repoPath: graph.repoPath,
						},
					} satisfies GraphItemTypedContext<GraphRemoteContextValue> & GraphSidebarItemOrigin,
				};
			}),
		);
		const remoteCfg = configuration.get('views.remotes.branches');
		return { panel: 'remotes' as const, items: items, layout: remoteCfg.layout, compact: remoteCfg.compact };
	}

	/**
	 * Open pull requests for the graph's repo. Unlike every other panel this reads from an integration
	 * rather than the in-memory graph, so it carries its own cache (`src/cache.ts` keys PRs by
	 * branch/sha/id and has no list bucket) and resolves each PR's focus target here, where the local
	 * branch set is known.
	 */
	private async getSidebarPullRequests(graph: GitGraph, signal?: AbortSignal): Promise<DidGetSidebarDataParams> {
		const empty = { panel: 'pullRequests' as const, items: [] };

		// Already gates on a connected integration, so a disconnected repo yields an empty panel rather
		// than an error — the same degrade non-GitHub providers get below.
		const remote = await getBestRemoteWithIntegration(graph.repoPath, undefined, signal);
		if (remote == null) return empty;

		const integration = await getRemoteIntegration(remote);
		if (integration == null) return empty;

		signal?.throwIfAborted();

		const prs = await this.fetchPullRequests(graph.repoPath, integration, remote);
		signal?.throwIfAborted();
		if (!prs?.length) return empty;

		const localByUpstream = buildLocalBranchesByUpstream(graph);
		const items = prs.map(pr => this.toSidebarPullRequest(pr, graph.repoPath, remote.name, localByUpstream));

		return { panel: 'pullRequests' as const, items: items };
	}

	/**
	 * Looks up a single pull request by number, for the Focus pane's "search for this PR" fallback —
	 * the panel lists only open PRs, so a pasted URL for a merged or closed one finds nothing locally.
	 */
	async onFindPullRequest(params: { number: string }): Promise<GraphSidebarPullRequest | undefined> {
		const graph = this._graphSession?.current ?? (await this.context.getLoading()?.catch(() => undefined));
		if (graph == null) return undefined;

		const remote = await getBestRemoteWithIntegration(graph.repoPath);
		if (remote == null) return undefined;

		const integration = await getRemoteIntegration(remote);
		if (integration == null) return undefined;

		// Cached by id in `src/cache.ts`, so repeated lookups of the same PR don't re-hit the API.
		const pr = await integration.getPullRequest(remote.provider.repoDesc, params.number);
		if (pr == null) return undefined;

		return this.toSidebarPullRequest(pr, graph.repoPath, remote.name, buildLocalBranchesByUpstream(graph));
	}

	private toSidebarPullRequest(
		pr: PullRequest,
		repoPath: string,
		remoteName: string,
		localByUpstream: Map<string, string>,
	): GraphSidebarPullRequest {
		const headBranch = pr.refs?.head?.branch;
		// Only a same-repo head can be named against this repo's remote; a fork's head lives under a
		// remote that may not exist locally, so leave `focus` unset rather than invent a ref.
		const upstreamName =
			headBranch != null && pr.refs?.isCrossRepository !== true ? `${remoteName}/${headBranch}` : undefined;
		const localBranch = upstreamName != null ? localByUpstream.get(upstreamName) : undefined;

		return {
			// `PullRequest.id` is the number only on the provider-native path; the providers-api path
			// puts the provider's internal id there. The URL carries the real number on both.
			number: getPullRequestIdentityFromMaybeUrl(pr.url)?.prNumber ?? pr.id,
			id: pr.id,
			title: pr.title,
			state: pr.state,
			url: pr.url,
			isDraft: pr.isDraft,
			authorName: pr.author.name,
			authorAvatarUrl: pr.author.avatarUrl,
			date: pr.updatedDate.getTime(),
			headBranch: headBranch,
			headSha: upstreamName != null ? pr.refs?.head?.sha : undefined,
			baseBranch: pr.refs?.base?.branch,
			headRepo:
				pr.refs?.isCrossRepository === true && pr.refs.head?.owner != null
					? `${pr.refs.head.owner}/${pr.refs.head.repo}`
					: undefined,
			focus:
				localBranch != null
					? { branchName: localBranch, upstreamName: upstreamName }
					: upstreamName != null
						? { branchName: upstreamName, remote: true }
						: undefined,
			context: {
				webview: this.host.id,
				webviewItemOrigin: sidebarItemOrigin,
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
			} satisfies GraphItemTypedContext<GraphPullRequestContextValue> & GraphSidebarItemOrigin,
		};
	}

	/**
	 * Fetches the repo's open PRs, deduping concurrent callers and caching the result — neither
	 * `getMyPullRequestsForRepos` nor `searchMyPullRequests` is `@gate()`d, so without this every panel
	 * open and every sidebar invalidation would issue its own request.
	 */
	private async fetchPullRequests(
		repoPath: string,
		integration: GitHostIntegration,
		remote: GitRemote<RemoteProvider>,
	): Promise<PullRequest[] | undefined> {
		const key = `${repoPath}|${integration.id}|${remote.provider.repoDesc.key ?? remote.name}`;
		const cached = this._pullRequestsCache;
		if (cached?.key === key && cached.expiresAt > Date.now()) return cached.promise;

		// Deliberately not given the caller's AbortSignal. This promise is shared, so cancelling it on
		// behalf of one caller — a panel switch, say — would fail every other caller waiting on it, and
		// leave the cancelled result cached. Callers check their own signal after awaiting instead.
		let promise: Promise<PullRequest[] | undefined>;
		const evict = () => {
			if (this._pullRequestsCache?.promise === promise) {
				this._pullRequestsCache = undefined;
			}
		};
		promise = this.fetchPullRequestsCore(integration, remote).then(
			prs => {
				// Only a real list is worth keeping. `undefined` means the lookup failed, and caching
				// that would show "no pull requests" for the full TTL with refresh unable to shift it.
				if (prs == null) {
					evict();
				}
				return prs;
			},
			(ex: unknown) => {
				evict();
				throw ex;
			},
		);
		this._pullRequestsCache = { key: key, expiresAt: Date.now() + pullRequestsCacheExpiration, promise: promise };
		return promise;
	}

	private async fetchPullRequestsCore(
		integration: GitHostIntegration,
		remote: GitRemote<RemoteProvider>,
	): Promise<PullRequest[] | undefined> {
		const repoDesc = remote.provider.repoDesc as { key: string; owner?: string; name?: string };

		// Every open PR, not just the current user's — `getMyPullRequestsForRepos` is only user-scoped
		// when `filters` is passed, and omitting it returns the whole repo. It takes no AbortSignal, so
		// the caller discards a superseded result rather than cancelling the request.
		if (repoDesc.owner != null && repoDesc.name != null) {
			try {
				const repos = [{ namespace: repoDesc.owner, name: repoDesc.name }];
				const prs: PullRequest[] = [];
				let cursor: string | undefined;

				// Ask for a full page up front: the provider's default page size is small, and each round
				// trip is sequential (the cursor for page N+1 only arrives with page N), so a large page
				// is what keeps this to one request on almost every repo.
				for (let page = 0; page < pullRequestsMaxPages; page++) {
					const result = await integration.getMyPullRequestsForRepos(repos, {
						state: 'open',
						cursor: cursor,
						pageSize: pullRequestsPageSize,
					});
					if (result?.values == null) {
						// First page failed outright — fall through to the provider-native path.
						if (page === 0) break;
						return prs;
					}

					prs.push(...result.values.map(pr => fromProviderPullRequest(pr, integration)));

					if (!result.paging?.more || result.paging.cursor == null) return prs;

					cursor = result.paging.cursor;
				}

				if (prs.length) {
					Logger.warn(
						`Stopped paging pull requests at ${pullRequestsMaxPages} pages`,
						'getSidebarPullRequests',
					);
					return prs;
				}
			} catch (ex) {
				// Not fatal — fall through to the provider-native path below, which every provider implements.
				Logger.warn(`Unable to list pull requests via providers-api: ${ex}`, 'getSidebarPullRequests');
			}
		}

		// Fallback: provider-native, implemented by every integration, but only the current user's PRs.
		const result = await integration.searchMyPullRequests(
			remote.provider.repoDesc,
			undefined,
			true,
			undefined,
			'open',
		);
		// It reports failure by resolving with `error` rather than throwing, so an unchecked `value`
		// turns a failed lookup into an empty list — which the caller would then cache as the truth.
		return result != null && 'error' in result ? undefined : result?.value;
	}

	private getSidebarStashes(graph: GitGraph) {
		const items =
			graph.stashes != null
				? Array.from(graph.stashes.values(), s => ({
						name: s.stashName,
						sha: s.sha,
						message: s.message ?? '',
						date: s.author.date.getTime(),
						stashNumber: s.stashNumber ?? '',
						stashOnRef: s.stashOnRef,
						context: {
							webview: this.host.id,
							webviewItemOrigin: sidebarItemOrigin,
							webviewItem: 'gitlens:stash',
							webviewItemValue: {
								type: 'stash',
								ref: createReference(s.sha, graph.repoPath, {
									refType: 'stash',
									name: s.stashName,
									message: s.message,
									number: s.stashNumber,
								}),
							},
						} satisfies GraphItemRefContext<GraphStashContextValue> & GraphSidebarItemOrigin,
					}))
				: [];
		return { panel: 'stashes' as const, items: items };
	}

	private async getSidebarTags(graph: GitGraph) {
		const tagCfg = configuration.get('views.tags.branches');
		const result = await this.container.git.getRepositoryService(graph.repoPath).tags.getTags({ sort: true });
		const sorted = sortTags(result.values, { orderBy: configuration.get('sortTagsBy') });
		const items = sorted.map(t => ({
			name: t.name,
			sha: t.sha,
			message: t.message || undefined,
			annotated: t.annotated,
			date: t.date?.getTime(),
			context: {
				webview: this.host.id,
				webviewItemOrigin: sidebarItemOrigin,
				webviewItem: 'gitlens:tag',
				webviewItemValue: {
					type: 'tag',
					ref: createReference(t.name, graph.repoPath, {
						id: t.id,
						refType: 'tag',
						name: t.name,
					}),
				},
			} satisfies GraphItemRefContext<GraphTagContextValue> & GraphSidebarItemOrigin,
		}));
		return { panel: 'tags' as const, items: items, layout: tagCfg.layout, compact: tagCfg.compact };
	}

	private getSidebarWorktrees(graph: GitGraph, displayed?: boolean) {
		const providerByRemote = this.getProviderByRemote(graph);
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);

		const wtCfg = configuration.get('views.worktrees.branches');
		const worktrees =
			graph.worktrees != null
				? sortWorktrees([...graph.worktrees], { orderBy: configuration.get('sortWorktreesBy') })
				: [];

		const items = worktrees.map(w => {
			const upstreamName = w.branch?.upstream?.name;
			const remoteName = upstreamName ? getRemoteNameFromBranchName(upstreamName) : undefined;

			let webviewItem = `gitlens:worktree${w.isDefault ? '+default' : ''}${
				w.workspaceFolder != null ? '+active' : ''
			}${w.locked ? '+locked' : ''}`;
			if (w.branch != null) {
				webviewItem += '+branch';
				if (w.branch.starred) {
					webviewItem += '+starred';
				}
				if (w.branch.upstream != null && !w.branch.upstream.missing) {
					webviewItem += '+tracking';
				}
				switch (w.branch.status) {
					case 'ahead':
						webviewItem += '+ahead';
						break;
					case 'behind':
						webviewItem += '+behind';
						break;
					case 'diverged':
						webviewItem += '+ahead+behind';
						break;
				}
				if (w.branch.rebasing) {
					webviewItem += '+rebasing';
				}
				if (pinnedRefId != null && w.branch.id === pinnedRefId) {
					webviewItem += '+pinned';
				}
			} else if (w.type === 'detached') {
				webviewItem += '+detached';
			}

			// The graph row this worktree's WIP anchors to — one path-keyed id per worktree, mirroring
			// `getWipRows` (only when a row can exist at all, i.e. non-bare).
			const wipSha = w.type === 'bare' ? undefined : createWipRowId(w.path);

			// Base context — `+working` is appended in the webview when the async hasChanges resolves.
			const context: GraphSidebarWorktree['context'] =
				w.branch != null
					? {
							webview: this.host.id,
							webviewItemOrigin: sidebarItemOrigin,
							webviewItem: webviewItem,
							webviewItemValue: {
								type: 'branch',
								ref: createReference(w.branch.name, graph.repoPath, {
									id: w.branch.id,
									refType: 'branch',
									name: w.branch.name,
									remote: false,
									upstream: w.branch.upstream,
								}),
								worktreePath: w.uri.fsPath,
							},
						}
					: w.sha != null
						? {
								webview: this.host.id,
								webviewItemOrigin: sidebarItemOrigin,
								webviewItem: webviewItem,
								webviewItemValue: {
									type: 'commit',
									ref: createReference(w.sha, graph.repoPath, {
										refType: 'revision',
										name: w.sha,
										message: '',
									}),
									worktreePath: w.uri.fsPath,
								},
							}
						: undefined;

			return {
				name: w.name,
				uri: w.uri.fsPath,
				branch: w.branch?.name,
				sha: w.sha,
				isDefault: w.isDefault,
				locked: w.locked !== false,
				opened: w.workspaceFolder != null,
				wipSha: wipSha,
				status: w.branch?.status,
				upstream: w.branch?.upstream?.name,
				tracking: w.branch?.upstream?.state,
				providerName: remoteName ? providerByRemote.get(remoteName) : undefined,
				pinned: (pinnedRefId != null && w.branch?.id === pinnedRefId) || undefined,
				context: context,
			};
		});

		// Fire-and-forget: compute working changes per worktree and notify the webview. Gated on the panel
		// actually being on screen — this is the only call site, and it's the expensive half of this request
		// (a per-worktree git probe; the item list above is in-memory). The sidebar panel component is never
		// unmounted (it stays slotted with `inert` when collapsed), so without the flag this ran on every
		// repo event for a surface nobody could see. `undefined` computes, so any caller that doesn't pass
		// the flag keeps the old behavior; a wrong `false` costs only the dirty-pill enrichment, which the
		// working-tree push channel refreshes anyway — it can never blank or stale the panel's own data.
		if (worktrees.length > 0 && displayed !== false) {
			this.context.computeWorktreeChanges(worktrees);
		}

		return { panel: 'worktrees' as const, items: items, layout: wtCfg.layout, compact: wtCfg.compact };
	}

	onSidebarToggleLayout(params: { panel: GraphSidebarPanel }): void {
		const configKey = {
			branches: 'views.branches.branches.layout',
			remotes: 'views.remotes.branches.layout',
			tags: 'views.tags.branches.layout',
			worktrees: 'views.worktrees.branches.layout',
		} as const satisfies Partial<Record<GraphSidebarPanel, ConfigPath>>;

		const key = configKey[params.panel as keyof typeof configKey];
		if (key == null) return;

		const current = configuration.get(key);
		void configuration.updateEffective(key, current === 'tree' ? 'list' : 'tree');
	}

	onSidebarToggleShowRemoteBranches(): void {
		const current = configuration.get('views.branches.showRemoteBranches');
		void configuration.updateEffective('views.branches.showRemoteBranches', !current);
	}

	onSidebarRefresh(params: { panel: GraphSidebarPanel }): void {
		// Refresh has to reach past the list cache, or it just re-serves whatever is already held —
		// which is the one thing a user pressing Refresh is trying to get rid of.
		if (params.panel === 'pullRequests') {
			this._pullRequestsCache = undefined;
		}
		this.notifySidebarInvalidated();
	}

	onSidebarAction(params: { command: GlCommands; context?: string; args?: unknown[] }): void {
		const repoPath = this._graphSession?.repoPath;
		if (repoPath == null) return;

		// Typed-args path — used by panels (e.g. agents) where the action target is a structured
		// payload, not a serialized webview-item context. Args bypass the context+repoPath fallback
		// because the receiving command takes its own typed arguments.
		if (params.args != null) {
			void executeCommand(params.command, ...params.args);
			return;
		}

		if (params.context != null) {
			try {
				const ctx = JSON.parse(params.context);
				ctx.webview = this.host.id;
				ctx.webviewInstance = this.host.instanceId;
				// Mark this as an inline (hover-icon) invocation so the context-menu telemetry gate
				// skips it — the webview already emitted the action with `location: 'inline'`. Only
				// this host-side parsed copy is mutated; serialized sidebar contexts (and thus native
				// context-menu invocations) always carry 'sidebar'. INVARIANT: the no-double-count
				// guarantee depends on this executeCommand routing through the registered command
				// wrapper (registerCommands) with THIS marked ctx as args[0] — dispatching inline
				// commands any other way would reintroduce double-counting for dual-surface commands.
				markSidebarInlineInvocation(ctx);
				void executeCommand(params.command, ctx);
				return;
			} catch {}
		}

		// Header actions — dispatch directly to action functions with repoPath,
		// since view commands expect view node context, not Uri
		switch (params.command) {
			case 'gitlens.views.title.createWorktree':
				void WorktreeActions.create(repoPath);
				return;
			case 'gitlens.views.title.createBranch':
				void BranchActions.create(repoPath);
				return;
			case 'gitlens.views.title.createTag':
				void TagActions.create(repoPath);
				return;
			case 'gitlens.views.addRemote':
				void RemoteActions.add(repoPath);
				return;
			case 'gitlens.switchToAnotherBranch:views':
				void RepoActions.switchTo(repoPath);
				return;
			case 'gitlens.stashSave:views':
				void StashActions.push(repoPath);
				return;
			case 'gitlens.stashesApply:views':
				void StashActions.apply(repoPath);
				return;
			case 'gitlens.graph.pull':
				void RepoActions.pull(repoPath);
				return;
			case 'gitlens.graph.push':
				void RepoActions.push(repoPath);
				return;
			case 'gitlens.fetch:graph':
				void RepoActions.fetch(repoPath);
				return;
			default:
				void executeCommand(params.command, Uri.file(repoPath));
		}
	}

	@trace()
	notifySidebarInvalidated(): void {
		this.context.fireSidebarInvalidated();
	}
}
