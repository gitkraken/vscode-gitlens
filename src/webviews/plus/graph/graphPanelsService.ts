import { Uri } from 'vscode';
import type { Account } from '@gitlens/git/models/author.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraph } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { PullRequest, PullRequestStackInfo } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProvider } from '@gitlens/git/models/remoteProvider.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '@gitlens/git/utils/branch.utils.js';
import { getPullRequestNumberFromUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { getDefaultRemoteOrOrigin } from '@gitlens/git/utils/remote.utils.js';
import { sortBranches, sortRemotes, sortTags, sortWorktrees } from '@gitlens/git/utils/sorting.js';
import type { IntegrationIds, SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '@gitlens/integrations/constants.js';
import type { GitHostIntegration } from '@gitlens/integrations/models/gitHostIntegration.js';
import { fromProviderPullRequest, toProviderPullRequestWithUniqueId } from '@gitlens/integrations/providers/models.js';
import { getIntegrationIdForRemote } from '@gitlens/integrations/utils/integration.utils.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { areEqual } from '@gitlens/utils/object.js';
import { pauseOnCancelOrTimeout } from '@gitlens/utils/promise.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { StoredGraphExcludedRef } from '../../../constants.storage.js';
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
import {
	canonicalizeViewerIdentity,
	categorizePullRequests,
	isSupportedLaunchpadIntegrationId,
} from '../../../plus/launchpad/launchpadProvider.js';
import type { LaunchpadActionCategory } from '../../../plus/launchpad/models/launchpad.js';
import {
	launchpadCategoryToGroupMap,
	launchpadPriorityGroups,
	sharedCategoryToLaunchpadActionCategoryMap,
} from '../../../plus/launchpad/models/launchpad.js';
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
	GraphSidebarPullRequestsEmptyState,
	GraphSidebarWorktree,
	GraphStashContextValue,
	GraphTagContextValue,
} from './protocol.js';
import { createWipRowId, DidChangeOverviewNotification, sidebarItemOrigin } from './protocol.js';

/** Collaborators the panels cluster reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphPanelsContext()`. `getRepository`/`getSession`/`getLoading` read
 *  live provider state; `getPinnedRefId`/`getExcludedRefsByRepo`/`fetchWipStatus`/`computeWorktreeChanges`
 *  forward into provider-owned filter storage and the WIP service's caches (kept there); `fireSidebarInvalidated`
 *  fires the provider's `sidebarInvalidated` RPC event (that transport stays wired in `getRpcServices`); the
 *  pending-notification callback routes through the provider's shared `_ipcNotificationMap`, which stays there. */
export type GraphPanelsServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	getRepository: () => GlRepository | undefined;
	getSession: () => GitGraphSession | undefined;
	getLoading: () => Promise<GitGraph> | undefined;
	getPinnedRefId: (repoPath: string | undefined) => string | undefined;
	getExcludedRefsByRepo: (repoPath: string | undefined) => Record<string, StoredGraphExcludedRef> | undefined;
	fetchWipStatus: (path: string, signal?: AbortSignal) => Promise<GitStatus | undefined>;
	computeWorktreeChanges: (worktrees: GitWorktree[]) => void;
	fireSidebarInvalidated: () => void;
	addPendingNotification: (notification: IpcNotification<any>) => void;
};

/** Open-PR list TTL. Matches Launchpad's list-level cache, which fronts the same kind of query. */
const pullRequestsCacheExpiration = 30 * 60 * 1000;
/** TTL for an *empty* list, which is the one answer that can be wrong without ever reporting a failure —
 *  GitLab's search converts an API failure into `[]`, indistinguishable from a repo with no open pull
 *  requests. Hold it only long enough to keep a burst of panel opens to a single request. */
const pullRequestsEmptyCacheExpiration = 60 * 1000;
/** Page size for the open-PR walk. Paging is sequential, so a big page is the difference between one
 *  round trip and many — this is a browse list, not an export. */
const pullRequestsPageSize = 100;
/** Upper bound on the page walk, so a repo with a huge backlog can't stall the panel. With the page
 *  size above this is 300 pull requests, well past what anyone browses in a side bar. */
const pullRequestsMaxPages = 3;
/** Bound on resolving the panel's viewer, which is a network call with no timeout of its own and which the
 *  rows wait on. Long enough for a cold account lookup over a slow connection, short enough that a hung one
 *  can't hold the list back; past it the rows categorize viewer-less. */
const viewerAccountTimeout = 3000;

/** The pull-requests panel's cached fetch: the open-PR list plus its Launchpad categorization (keyed by the
 *  pull request itself). Both come from one shared promise, so a row never waits on a categorization the
 *  cache has already paid for. An `undefined` list means nothing answered — a failed lookup or a host
 *  that can't be asked — and never that the repo has no open pull requests. */
type SidebarPullRequests = {
	prs: PullRequest[] | undefined;
	launchpadByPr: Map<PullRequest, NonNullable<GraphSidebarPullRequest['launchpad']>> | undefined;
};

/** Hosts with no repo-scoped pull request query GitLens can issue *by either path*, so that nothing a
 *  refresh does changes the answer and the panel says so rather than offering a retry.
 *
 *  Azure only: `getMyPullRequestsForRepos` rejects it outright (its `repoDesc` carries no `project`, which
 *  that call requires — `gitHostIntegration.ts`), and it doesn't implement the provider-native repo-scoped
 *  search either. Failing only the *native* half isn't enough to belong here: Bitbucket Server stubs that
 *  half exactly as Bitbucket Cloud does, but both are wired for `getPullRequestsForRepos` and both inherit
 *  an `{ owner, name }` `repoDesc`, so they list through the providers-api path. Listing one and not the
 *  other here is what wrongly told Bitbucket Server users the host couldn't be asked. */
const pullRequestsUnsupportedIntegrationIds: ReadonlySet<IntegrationIds> = new Set([
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
]);

/** The checked-out branch's name, for deciding whether a pull request's head is already here. Matched by
 *  short name because that's how the deep link the row's actions run decides to skip the switch — a name
 *  match there means the action becomes a no-op, so the row must not offer it. */
function getCurrentBranchName(graph: GitGraph): string | undefined {
	for (const b of graph.branches.values()) {
		if (b.current) return b.name;
	}
	return undefined;
}

/** Reverse tracking map (upstream name → local branch), the same pass the remotes panel makes. Lets a
 *  pull request whose head is checked out focus the local branch, not a `remotes/*` ref, and name that
 *  branch's worktree — both without another walk of `graph.branches`. */
function buildLocalBranchesByUpstream(graph: GitGraph): {
	localByUpstream: Map<string, GitBranch>;
	/** Remote branch names present in this repository. Focus needs it: a pull request's head is named
	 *  `<remote>/<branch>` whether or not it was ever fetched, and scoping to a ref that isn't here
	 *  leaves the graph focused on nothing. Collected by name (not by the map's key) so it doesn't
	 *  depend on how branch ids happen to be built. */
	remoteNames: Set<string>;
} {
	const localByUpstream = new Map<string, GitBranch>();
	const remoteNames = new Set<string>();
	for (const b of graph.branches.values()) {
		if (b.remote) {
			remoteNames.add(b.name);
		} else if (b.upstream != null && !b.upstream.missing) {
			localByUpstream.set(b.upstream.name, b);
		}
	}
	return { localByUpstream: localByUpstream, remoteNames: remoteNames };
}

/** Whether a category paints a row indicator, which is what makes it worth preserving over an overlay.
 *  Resolved through the same maps the webview's `getLaunchpadItemGroup`/`getLaunchpadItemGrouping` pair
 *  uses, and carrying that pair's draft carve-out, so the host can't come to a different answer than the
 *  surface it's deciding for. */
function rendersIndicator(category: LaunchpadActionCategory, isDraft: boolean | undefined): boolean {
	// A draft nobody has been asked to review yet is a draft, not a blocked pull request, and the webview
	// renders nothing for it. Reading it as indicator-bearing here would skip the blocker overlay for a row
	// that then shows nothing at all — a conflicted draft with no indicator anywhere.
	if (isDraft && category === 'unassigned-reviewers') return false;

	const group = launchpadCategoryToGroupMap.get(category);
	return group != null && launchpadPriorityGroups.includes(group);
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
	// Open PRs (and their categorization) for the pull-requests panel, keyed by repo + integration +
	// remote. Holds the promise (not the value) so concurrent opens share one request; dropped on
	// rejection so a failure doesn't stick for the full TTL.
	private _pullRequestsCache: { key: string; expiresAt: number; promise: Promise<SidebarPullRequests> } | undefined;

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

	/** The stored `excludeRefs` filter, split into a per-id set (individually hidden branches/tags) and a
	 *  per-remote-name map (remotes hidden wholesale via the `name: '*'` wildcard entry, to the ids
	 *  exempted from that hide — the wildcard's `except`, empty when none). Sidebar rows bake these into
	 *  their `webviewItem` token as `+hidden`/`+hiddenbyremote` — see `getSidebarBranches`,
	 *  `getSidebarRemotes`, `getSidebarTags`. `+hiddenbyremote` is baked in ONLY for a branch that isn't
	 *  exempted; the remote header row itself keeps `+hidden` regardless of exceptions. */
	private getHiddenRefState(repoPath: string): { hiddenIds: Set<string>; hiddenRemotes: Map<string, Set<string>> } {
		const storedExcludeRefs = this.context.getExcludedRefsByRepo(repoPath);
		const hiddenIds = new Set<string>();
		const hiddenRemotes = new Map<string, Set<string>>();
		if (storedExcludeRefs != null) {
			for (const id in storedExcludeRefs) {
				const stored = storedExcludeRefs[id];
				if (stored.type === 'remote' && stored.name === '*') {
					if (stored.owner) {
						hiddenRemotes.set(stored.owner, new Set(stored.except));
					}
				} else {
					hiddenIds.add(stored.id);
				}
			}
		}
		return { hiddenIds: hiddenIds, hiddenRemotes: hiddenRemotes };
	}

	private getProviderByRemote(graph: GitGraph): Map<string, { name: string; icon: string }> {
		const providerByRemote = new Map<string, { name: string; icon: string }>();
		for (const r of graph.remotes.values()) {
			if (r.provider?.name) {
				providerByRemote.set(r.name, { name: r.provider.name, icon: r.provider.icon });
			}
		}
		return providerByRemote;
	}

	private getSidebarBranches(graph: GitGraph) {
		const providerByRemote = this.getProviderByRemote(graph);
		const pinnedRefId = this.context.getPinnedRefId(graph.repoPath);
		const { hiddenIds, hiddenRemotes } = this.getHiddenRefState(graph.repoPath);

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
			// A remote branch names its own remote; a local one only reaches a provider through its upstream
			const remoteName = b.remote
				? b.remoteName
				: b.upstream
					? getRemoteNameFromBranchName(b.upstream.name)
					: undefined;
			const provider = remoteName ? providerByRemote.get(remoteName) : undefined;
			// The remote's exception set, when the whole remote is wildcard-hidden. Excepted from it:
			// still `b.remote`, but not `+hiddenbyremote`.
			const remoteExcept = remoteName != null ? hiddenRemotes.get(remoteName) : undefined;
			const hiddenByRemote = b.remote && remoteExcept != null && !remoteExcept.has(b.id);
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
				providerName: provider?.name,
				providerIcon: provider?.icon,
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
					}${!b.current && hiddenIds.has(b.id) ? '+hidden' : ''}${hiddenByRemote ? '+hiddenbyremote' : ''}`,
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
		const { hiddenIds, hiddenRemotes } = this.getHiddenRefState(graph.repoPath);
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
				// The remote's exception set, when the whole remote is wildcard-hidden.
				const remoteExcept = hiddenRemotes.get(r.name);
				const branches = rBranches.map(b => ({
					name: getBranchNameWithoutRemote(b.name),
					sha: b.sha,
					localBranch: localByUpstream.get(b.name),
					pinned: (pinnedRefId != null && b.id === pinnedRefId) || undefined,
					context: {
						webview: this.host.id,
						webviewItemOrigin: sidebarItemOrigin,
						webviewItem: `gitlens:branch+remote${pinnedRefId != null && b.id === pinnedRefId ? '+pinned' : ''}${
							hiddenIds.has(b.id) ? '+hidden' : ''
						}${remoteExcept != null && !remoteExcept.has(b.id) ? '+hiddenbyremote' : ''}`,
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
				if (hiddenRemotes.has(r.name)) {
					webviewItem += '+hidden';
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

		// Gates on a connected integration, so a disconnected repo yields an empty panel rather than an
		// error — but "nothing to connect to" and "nothing connected yet" read identically as a bare empty
		// list, so the latter carries an empty state the panel can turn into a connect pitch.
		const remote = await getBestRemoteWithIntegration(graph.repoPath, undefined, signal);
		const integration = remote != null ? await getRemoteIntegration(remote) : undefined;
		if (remote == null || integration == null) {
			signal?.throwIfAborted();
			return { ...empty, emptyState: await this.getPullRequestsEmptyState(graph) };
		}

		signal?.throwIfAborted();

		// Asked before fetching, not after: these hosts have no repo-scoped query at all, so the list request
		// and the viewer lookup behind it are spent to learn what the integration's id already says — and
		// since a null list evicts the cache, they'd be spent again on every invalidation.
		if (pullRequestsUnsupportedIntegrationIds.has(integration.id)) {
			return { ...empty, emptyState: { reason: 'unsupported' as const, providerName: remote.provider.name } };
		}

		// Started alongside the list fetch, not after it: the two are independent requests, and serializing
		// them put a whole extra round trip in front of every panel build. Cancellation is the only error it
		// can raise (everything else is logged and folded to `undefined`), and the `throwIfAborted` below
		// re-raises that — so the swallow here only keeps an early return from leaving it unhandled.
		const stacks = this.getStacksByPullRequestNumber(remote, integration, signal).catch(() => undefined);

		const result = await this.fetchPullRequests(graph.repoPath, integration, remote);
		signal?.throwIfAborted();
		// No list at all means nothing answered — a failed lookup (which resolves rather than throwing), an
		// unresolvable session, or a host with no query to ask. None of those is an empty repository, so
		// none may render a bare empty list: that would claim there are no open pull requests.
		if (result.prs == null) {
			return { ...empty, emptyState: { reason: 'unavailable' as const } };
		}
		if (!result.prs.length) return empty;

		const { localByUpstream, remoteNames } = buildLocalBranchesByUpstream(graph);
		const currentBranchName = getCurrentBranchName(graph);
		// These pull requests come from the shared providers API, whose type carries no stack membership,
		// so it's joined in separately — one request for the whole repository rather than per pull request.
		const stacksByNumber = await stacks;
		signal?.throwIfAborted();

		const items = result.prs.map(pr =>
			this.toSidebarPullRequest(
				pr,
				graph.repoPath,
				remote.name,
				localByUpstream,
				remoteNames,
				result.launchpadByPr?.get(pr),
				currentBranchName,
				stacksByNumber,
			),
		);

		return { panel: 'pullRequests' as const, items: items };
	}

	/**
	 * Why the panel has nothing to list when no integration answered. Reads the graph's own remotes — the
	 * same set the remotes panel renders — so this costs no extra git work, and pitches the default (or
	 * origin) remote's provider, the one the repo actually publishes to.
	 */
	private async getPullRequestsEmptyState(graph: GitGraph): Promise<GraphSidebarPullRequestsEmptyState> {
		// Distinct from an unrecognized host only in what the panel says — a missing remote is the real
		// blocker there — and in telemetry; both render the generic connect pitch.
		if (graph.remotes.size === 0) return { reason: 'no-remotes' };

		const supported = [...graph.remotes.values()].filter(remoteSupportsIntegration);
		if (!supported.length) return { reason: 'no-supported-remote' };

		const remote = getDefaultRemoteOrOrigin(supported) ?? supported[0];
		// Always set: `supported` was filtered by `remoteSupportsIntegration`, which resolves this same id.
		const integrationId = getIntegrationIdForRemote(remote.provider)!;

		// `getBestRemoteWithIntegration` skips a remote whose connected state it can't settle cheaply — it
		// only resolves `isConnected()` for the default or the only remote, so any repo with two remotes and
		// no default lands here on a cold session — meaning a connected integration can still reach this. It
		// gets neither a Connect pitch (it's already connected) nor a bare empty list (we never got to ask,
		// which is not the same as there being none). It settles on the next invalidation.
		const integration = await getRemoteIntegration(remote);
		if (integration?.maybeConnected ?? (await integration?.isConnected())) return { reason: 'unavailable' };

		return {
			reason: 'integration-disconnected',
			providerName: remote.provider.name,
			integrationId: integrationId,
		};
	}

	/**
	 * Resolves the viewer for the connection the pull requests came from. Started alongside the list rather
	 * than after it, so the bound below overlaps the fetch instead of being added to it — the panel used to
	 * cost list latency plus this.
	 *
	 * Off the integration instance rather than looked up by id: a self-managed host can have several
	 * connections, and resolving by id would categorize these rows against whichever one is primary. Bounded
	 * because the rows wait on it and the lookup carries no timeout of its own; past the bound they
	 * categorize viewer-less, and the caller shortens the list's cache so that verdict isn't held for the
	 * full TTL.
	 */
	private async resolveViewerAccount(
		integration: GitHostIntegration,
	): Promise<{ account: Account | undefined; timedOut: boolean; pending?: Promise<Account | undefined> }> {
		if (!isSupportedLaunchpadIntegrationId(integration.id)) return { account: undefined, timedOut: false };

		try {
			// Held rather than inlined so the caller can still act on it: past the bound the request keeps
			// running, and the rows are left on a viewer-less categorization a refetch would now get right.
			// Handed back rather than acted on here — recovering means evicting a specific cache entry and
			// re-fetching, and only the caller knows which entry this categorization ended up in.
			const accountPromise = integration.getCurrentAccount();
			const result = await pauseOnCancelOrTimeout(accountPromise, undefined, viewerAccountTimeout);
			if (result.paused) return { account: undefined, timedOut: true, pending: accountPromise };

			return { account: result.value, timedOut: false };
		} catch (ex) {
			Logger.warn(`Unable to resolve the current account: ${ex}`, 'getSidebarPullRequests');
			return { account: undefined, timedOut: false };
		}
	}

	/**
	 * Launchpad categorization for the panel's rows, keyed by the pull request itself — the grouping
	 * indicator and the hover's signals line. Best-effort: any failure yields `undefined` so the rows still
	 * render, just un-enriched. Deliberately skips enriched items (pin/snooze), which the panel doesn't
	 * surface and which would couple it to a GitKraken account.
	 *
	 * The rule is: match Launchpad exactly wherever the viewer is involved, and show a best-effort
	 * objective signal for everyone else's pull requests. Categorizing against the real account is what
	 * buys the first half — a pull request you authored, are assigned to, or have been asked to review
	 * reads here exactly as it reads in Launchpad and in the branch hover, same category, same colour,
	 * same words, with no second vocabulary to keep in sync. The shared cascade gates every other category
	 * on the viewer, so anyone else's pull request comes back uncategorized, and those get one overlay and
	 * only one: conflicts or failing checks paint red "Blocked", because surfacing exactly that is why a
	 * repo-wide list of pull requests earns its space. With a viewer resolved the overlay never displaces a
	 * category the cascade already gave an indicator to, and it never invents a green one — `readyToMerge`
	 * is gated on the viewer being author or assignee, so "Ready to Merge" stays confined to your own work.
	 *
	 * With no account at all — the integration isn't connected, the lookup returns nothing, or it doesn't
	 * answer inside {@link viewerAccountTimeout} — it categorizes viewer-less, and that mode needs demotions
	 * of its own, because with no viewer every author-side rule fires for every row. `readyToMerge` is one:
	 * its only surviving gate is `canMerge`, which the shared cascade defaults to `true` for a pull request
	 * carrying no permissions — and the list's providers-api path never reports a negative one — so a
	 * stranger's approved pull request would come back green. `unassignedReviewers` is another: it's the
	 * cascade's last writer and is true of any pull request nobody has been asked to review yet, so left
	 * alone it paints every brand-new pull request red "Blocked". And last-writer-wins would let a
	 * changes-requested review outrank real conflicts. So that mode alone drops both `mergeable` and
	 * `unassigned-reviewers`, and lets conflicts and failing checks outrank whatever the cascade picked —
	 * leaving it to what's objectively true of a pull request, claiming nothing about what you may do with
	 * someone else's.
	 */
	private async categorizeSidebarPullRequests(
		prs: PullRequest[],
		integration: GitHostIntegration,
		viewer: Promise<{ account: Account | undefined; timedOut: boolean }>,
	): Promise<SidebarPullRequests['launchpadByPr']> {
		try {
			const integrationId = integration.id;
			if (!isSupportedLaunchpadIntegrationId(integrationId)) return undefined;

			const { account } = await viewer;

			const prsByUuid = new Map<string, PullRequest>();
			// A single malformed pull request shouldn't cost the whole panel its enrichment, so a failed
			// conversion drops just that one.
			const inputs = prs.flatMap(pr => {
				try {
					const providerPr = toProviderPullRequestWithUniqueId(pr);
					prsByUuid.set(providerPr.uuid, pr);
					// The shared pull request model carries no provider reference, and the per-integration
					// split keys on it.
					return [
						{
							...(account != null ? canonicalizeViewerIdentity(providerPr, pr, account) : providerPr),
							provider: pr.provider,
						},
					];
				} catch (ex) {
					Logger.warn(`Unable to convert pull request '${pr.url}': ${ex}`, 'getSidebarPullRequests');
					return [];
				}
			});

			// Bitbucket's API reports no mergeable state, checks, or draft flag, so the shared categorizer
			// sees a hardcoded "mergeable" and calls almost every pull request ready to merge. Demote that
			// one verdict to `other` — the category `getLaunchpadItemGroup` renders no indicator for —
			// rather than paint a green one nothing verified. Only the verdict goes: the review counts and
			// the review-driven categories still come from real data.
			const mergeableUnverifiable =
				integrationId === GitCloudHostIntegrationId.Bitbucket ||
				integrationId === GitSelfManagedHostIntegrationId.BitbucketServer;

			// Keyed by `pr.provider.id`, which is this integration's id — every pull request here came from it.
			const currentUsers = account != null ? new Map([[integrationId, account]]) : undefined;

			// Keyed by the pull request itself, not by a field of it — these are the very objects the rows are
			// built from, so object identity is exact and can't be wrong about which row a verdict belongs to.
			const launchpadByPr = new Map<PullRequest, NonNullable<GraphSidebarPullRequest['launchpad']>>();
			for (const item of categorizePullRequests(
				inputs,
				currentUsers,
				account != null ? undefined : { viewer: 'none' },
			)) {
				const pr = prsByUuid.get(item.uuid);
				let category = sharedCategoryToLaunchpadActionCategoryMap.get(item.suggestedActionCategory);
				if (pr == null || category == null) continue;

				if (mergeableUnverifiable && category === 'mergeable') {
					category = 'other';
				}

				if (account == null) {
					// Viewer-less only — see above for why these demotions exist and why they don't apply
					// once a real viewer resolves.
					if (category === 'mergeable' || category === 'unassigned-reviewers') {
						category = 'other';
					}
					if (item.hasConflicts) {
						category = 'conflicts';
					} else if (item.failingCI) {
						category = 'failed-checks';
					}
				} else if (!rendersIndicator(category, pr.isDraft)) {
					// Rows that would otherwise show nothing — everyone else's pull requests, which the
					// cascade leaves blank, and your own drafts. Objective blockers only.
					if (item.hasConflicts) {
						category = 'conflicts';
					} else if (item.failingCI) {
						category = 'failed-checks';
					}
				}

				launchpadByPr.set(pr, {
					category: category,
					failingCI: item.failingCI,
					hasConflicts: item.hasConflicts,
					reviewCounts: {
						approval: item.approvalReviewCount,
						changeRequest: item.changeRequestReviewCount,
						comment: item.commentReviewCount,
					},
				});
			}
			return launchpadByPr;
		} catch (ex) {
			Logger.warn(`Unable to categorize pull requests: ${ex}`, 'getSidebarPullRequests');
			return undefined;
		}
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

		const { localByUpstream, remoteNames } = buildLocalBranchesByUpstream(graph);
		return this.toSidebarPullRequest(
			pr,
			graph.repoPath,
			remote.name,
			localByUpstream,
			remoteNames,
			undefined,
			getCurrentBranchName(graph),
		);
	}

	/**
	 * Resolves a pull request and its integration for the merge action — same resolution as
	 * {@link onFindPullRequest}, but returns the raw model (with `refs`/`stack`) instead of the
	 * sidebar-mapped shape, since the merge confirmation and the mutation itself need those fields.
	 */
	async resolvePullRequestForMerge(
		number: string,
	): Promise<{ integration: GitHostIntegration; pr: PullRequest } | undefined> {
		const graph = this._graphSession?.current ?? (await this.context.getLoading()?.catch(() => undefined));
		if (graph == null) return undefined;

		const remote = await getBestRemoteWithIntegration(graph.repoPath);
		if (remote == null) return undefined;

		const integration = await getRemoteIntegration(remote);
		if (integration == null) return undefined;

		// Bypass the cache — a merge decision must act on the pull request's current mergeability, not a
		// stale snapshot from an earlier read.
		const pr = await integration.getPullRequest(remote.provider.repoDesc, number, { expiryOverride: true });
		if (pr == null) return undefined;

		return { integration: integration, pr: pr };
	}

	/** Evicts the pull-requests panel cache (list + stack membership) so a subsequent load doesn't
	 *  re-serve stale state. Shared by the sidebar refresh action, an integration connection change,
	 *  and a successful pull request merge. */
	resetPullRequests(): void {
		this._pullRequestsCache = undefined;
		this._stacksCache.clear();
	}

	/**
	 * Stack membership for the repository's stacked pull requests, keyed by number — GitHub-only, since no
	 * other host has stacks. Best-effort: a repository not enrolled in the preview, or any failure, yields
	 * `undefined` and the rows simply render unstacked.
	 */
	private async getStacksByPullRequestNumber(
		remote: GitRemote<RemoteProvider>,
		integration: GitHostIntegration,
		signal?: AbortSignal,
	): Promise<Map<number, PullRequestStackInfo> | undefined> {
		// Only github.com has stacks. Without this every GitHub Enterprise Server panel build would spend a
		// round-trip on a request that can only 404 — the same reasoning as the GraphQL selections' gate.
		if (integration.id !== GitCloudHostIntegrationId.GitHub) return undefined;

		const owner = remote.provider.owner;
		const repo = remote.provider.repoName;
		if (owner == null || repo == null) return undefined;

		const cached = this._stacksCache.get(`${owner}/${repo}`);
		if (cached != null && Date.now() - cached.timestamp < pullRequestsCacheExpiration) return cached.stacks;

		try {
			const stacks = await integration.getStacksByPullRequestNumber?.(owner, repo, signal);

			// Only a real answer is cached — caching `undefined` would pin a transient failure for the
			// cache's whole lifetime, and the rows silently de-group when membership goes missing.
			if (stacks != null) {
				this._stacksCache.set(`${owner}/${repo}`, { stacks: stacks, timestamp: Date.now() });
			}
			return stacks ?? cached?.stacks;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			// The doc above promises best-effort: a malformed preview payload must degrade to rows without
			// badges, not take the whole panel down.
			Logger.warn(`Unable to resolve stacks for ${owner}/${repo}: ${ex}`, 'getSidebarPullRequests');
			return cached?.stacks;
		}
	}

	/** Stacks live outside `_pullRequestsCache` (a different request), so they get the same expiry here. */
	private readonly _stacksCache = new Map<string, { stacks: Map<number, PullRequestStackInfo>; timestamp: number }>();

	private toSidebarPullRequest(
		pr: PullRequest,
		repoPath: string,
		remoteName: string,
		localByUpstream: Map<string, GitBranch>,
		remoteNames: Set<string>,
		launchpad?: GraphSidebarPullRequest['launchpad'],
		currentBranchName?: string,
		stacksByNumber?: Map<number, PullRequestStackInfo>,
	): GraphSidebarPullRequest {
		// Truthiness, not a null check: `fromProviderPullRequest` always builds `refs` and fills a gone head
		// repo (merged-and-deleted, deleted fork) with `''` — the same test the command handlers make before
		// acting on a head. The GitHub-native builder leaves them `undefined` instead, so both spellings of
		// "no head" have to fall out here.
		const headBranch = pr.refs?.head?.branch || undefined;
		const headUrl = pr.refs?.head?.url || undefined;
		// Only a same-repo head can be named against this repo's remote; a fork's head lives under a
		// remote that may not exist locally, so leave `focus` unset rather than invent a ref.
		const upstreamName =
			headBranch != null && pr.refs?.isCrossRepository !== true ? `${remoteName}/${headBranch}` : undefined;
		const localBranch = upstreamName != null ? localByUpstream.get(upstreamName) : undefined;
		// Checked out anywhere, default worktree included — `isCurrent` below is what separates "here" from
		// "somewhere else", so excluding the default one here would call a branch checked out in the primary
		// worktree switchable while the graph is scoped to a secondary one, and git refuses that. The
		// branches panel draws the same two lines (`isCheckedOut` vs `hasWorktree`); only its *icon* cares
		// about the worktree being non-default, and a pull request row has no such icon.
		const branchWorktree = localBranch?.worktree;
		const isCheckedOut = branchWorktree != null && branchWorktree !== false;
		// By short name, and independent of `localBranch` — a fork head resolves no local branch, but its
		// name can still be what's checked out, which is all the deep link compares before skipping.
		const isCurrent =
			localBranch?.current === true || (headBranch != null && currentBranchName === headBranch) || undefined;

		// Set only when the ref is already here, which lets the row scope instantly instead of round-tripping
		// to the host. Absent is no longer "no Focus" — the row falls back to the host command, which offers
		// to fetch the ref (adding a fork's remote) and then scopes. So this is a fast path, not a gate.
		const focus =
			localBranch != null
				? { branchName: localBranch.name, upstreamName: upstreamName }
				: upstreamName != null && remoteNames.has(upstreamName)
					? { branchName: upstreamName, remote: true }
					: undefined;

		// `PullRequest.id` is the number only on the provider-native path; the providers-api path
		// puts the provider's internal id there. The URL carries the real number on both.
		const number = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
		// Prefer what the model already carries (the native reads select it) and fall back to the
		// per-repository join, which is the only source on the providers-api path this panel uses.
		const stack = pr.stack ?? stacksByNumber?.get(Number(number));

		return {
			number: number,
			id: pr.id,
			title: pr.title,
			state: pr.state,
			url: pr.url,
			isDraft: pr.isDraft,
			authorName: pr.author.name,
			authorAvatarUrl: pr.author.avatarUrl,
			// The date the byline's verb names: a merged pull request says "merged <when>", and a comment
			// landing after the merge bumps `updatedDate` — which would date the merge to that comment.
			// Same precedence `PullRequest.formatDateFromNow` uses; identical to `updatedDate` while open.
			date: (pr.mergedDate ?? pr.closedDate ?? pr.updatedDate).getTime(),
			headBranch: headBranch,
			headUrl: headUrl,
			headSha: upstreamName != null ? pr.refs?.head?.sha || undefined : undefined,
			baseBranch: pr.refs?.base?.branch,
			commitCount: pr.commitCount,
			headOwner: pr.refs?.isCrossRepository === true ? pr.refs.head?.owner || undefined : undefined,
			focus: focus,
			// Checked out, but not where the graph is looking — the chip opens that worktree instead of
			// offering a switch git would refuse.
			worktree: (isCheckedOut && !isCurrent) || undefined,
			current: isCurrent,
			additions: pr.additions,
			deletions: pr.deletions,
			filesChanged: pr.filesChanged,
			body: pr.body,
			commentsCount: pr.commentsCount,
			statusCheckRollup: pr.statusCheckRollupState,
			mergeableState: pr.mergeableState,
			reviewDecision: pr.reviewDecision,
			launchpad: launchpad,
			stack:
				stack != null
					? {
							number: stack.number,
							position: stack.position,
							size: stack.size,
							baseRef: stack.baseRef,
						}
					: undefined,
			context: {
				webview: this.host.id,
				webviewItemOrigin: sidebarItemOrigin,
				// Every suffix names a precondition some handler actually checks, because a suffix that
				// merely says "a refs object exists" gates nothing: the providers-api path always builds
				// `refs`, filling a gone head with empty strings. So — `+head` for an actionable head
				// (branch and url both non-empty, what switch/worktree need), `+shas` for a diffable pair
				// (changes/comparison), `+focus` for a scope target that's really in this repo. `+head`
				// isn't fork-gated: those commands work for a fork off its own url, since the deep link
				// adds the remote. Kept in sync with the graph row's producer (`GraphProducersService`).
				webviewItem: `gitlens:pullrequest${
					headBranch != null && headUrl != null ? '+head' : ''
				}${pr.refs?.base?.sha && pr.refs.head?.sha ? '+shas' : ''}${
					pr.state !== 'opened' ? '+closed' : ''
				}${pr.refs?.isCrossRepository === true ? '+fork' : ''}${isCurrent ? '+current' : ''}`,
				webviewItemValue: {
					type: 'pullrequest',
					id: pr.id,
					title: pr.title,
					url: pr.url,
					repoPath: repoPath,
					refs: pr.refs,
					// Identifiers only, for commands invoked against this row. No command reads them today —
					// `focusPullRequest` deliberately scopes to the one layer, and whole-stack focus is driven
					// from the stack row's own webview-side action.
					stack:
						stack != null
							? { number: stack.number, position: stack.position, size: stack.size }
							: undefined,
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
	 * Fetches the repo's open PRs and their Launchpad categorization, deduping concurrent callers and
	 * caching the result — neither `getMyPullRequestsForRepos` nor `searchMyPullRequests` is `@gate()`d,
	 * so without this every panel open and every sidebar invalidation would issue its own request.
	 */
	private async fetchPullRequests(
		repoPath: string,
		integration: GitHostIntegration,
		remote: GitRemote<RemoteProvider>,
	): Promise<SidebarPullRequests> {
		const key = `${repoPath}|${integration.id}|${remote.provider.repoDesc.key ?? remote.name}`;
		const cached = this._pullRequestsCache;
		if (cached?.key === key && cached.expiresAt > Date.now()) return cached.promise;

		// Started before the list so the viewer's bounded lookup overlaps the fetch rather than following it.
		const viewer = this.resolveViewerAccount(integration);

		// Deliberately not given the caller's AbortSignal. This promise is shared, so cancelling it on
		// behalf of one caller — a panel switch, say — would fail every other caller waiting on it, and
		// leave the cancelled result cached. Callers check their own signal after awaiting instead.
		let promise: Promise<SidebarPullRequests>;
		const evict = () => {
			if (this._pullRequestsCache?.promise === promise) {
				this._pullRequestsCache = undefined;
			}
		};
		promise = this.fetchPullRequestsCore(integration, remote).then(
			async prs => {
				// Only a real list is worth keeping. No list means the lookup failed or the provider can't
				// answer it, and caching either would hold that for the full TTL with refresh unable to
				// shift it.
				if (prs == null) {
					evict();
					return { prs: undefined, launchpadByPr: undefined };
				}

				// Sorted here rather than at either producer: the providers-api walk and the provider-native
				// fallback each return their own order, so without this the same repository lists differently
				// depending on which path answered. Most-recently-updated first, matching the row's own byline
				// and every other panel's explicit sort. `updatedDate` specifically — the row's `date` prefers
				// a merge/close date, which only the search fallback's rows ever carry.
				prs.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());

				// An empty list can be a swallowed failure rather than an empty repository, so it gets a
				// short window instead of the full one — long enough to dedupe a burst of panel opens,
				// short enough that a transient outage can't serve "No items" for half an hour.
				if (!prs.length && this._pullRequestsCache?.promise === promise) {
					this._pullRequestsCache.expiresAt = Math.min(
						this._pullRequestsCache.expiresAt,
						Date.now() + pullRequestsEmptyCacheExpiration,
					);
				}

				// Categorize within the shared promise so the rows wait on it exactly once, no matter how
				// many panel opens land on this fetch. It neither throws nor waits unbounded, so it can cost
				// the enrichment but never the list.
				const launchpadByPr = await this.categorizeSidebarPullRequests(prs, integration, viewer);

				// A viewer that timed out categorized every row viewer-less. That's a worse answer than the one
				// a second attempt would give — the account request it gave up on has very likely landed in
				// its own cache by now — so don't hold it for the full window, and re-fetch once it lands.
				const { timedOut, pending } = await viewer;
				if (timedOut && this._pullRequestsCache?.promise === promise) {
					this._pullRequestsCache.expiresAt = Math.min(
						this._pullRequestsCache.expiresAt,
						Date.now() + pullRequestsEmptyCacheExpiration,
					);

					// Wired here, not where the account is resolved, and only now that the list is in hand: an
					// account landing mid-fetch would otherwise evict an entry still being filled and have the
					// invalidation start a second identical request. Identity-checked because there's one cache
					// field for the whole service — by the time this runs it may belong to another repository,
					// and evicting that one recovers nothing while costing it its list.
					void pending?.then(
						account => {
							if (account == null || this._pullRequestsCache?.promise !== promise) return;

							// Evict, then invalidate. Invalidating alone re-enters `fetchPullRequests`, which
							// finds this entry still inside its (shortened) window and hands back the very
							// viewer-less result being replaced.
							this._pullRequestsCache = undefined;
							this.context.fireSidebarInvalidated();
						},
						() => {},
					);
				}

				return { prs: prs, launchpadByPr: launchpadByPr };
			},
			(ex: unknown) => {
				evict();
				throw ex;
			},
		);
		this._pullRequestsCache = { key: key, expiresAt: Date.now() + pullRequestsCacheExpiration, promise: promise };
		return promise;
	}

	/** The repo's open pull requests, or `undefined` when nothing answered — a failure, an unresolvable
	 *  session, or a host with no repo-scoped query. Never an empty list for any of those. */
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

		// Fallback: provider-native, and only the current user's PRs. Every integration exposes it, but not
		// every one answers a repo-scoped query — Azure DevOps (both editions) and Bitbucket Server stub
		// that out. Bitbucket Cloud only stubs this path; it lists via the providers-api path above.
		const result = await integration.searchMyPullRequests(
			remote.provider.repoDesc,
			undefined,
			true,
			undefined,
			'open',
		);
		// It reports failure by resolving with `error` rather than throwing, and resolves a bare `undefined`
		// when the session can't be resolved at all (expired token, revoked connection) — so an unchecked
		// `value` turns either into an empty list, which the caller would then cache as the truth. Both are
		// `undefined` here, and the caller names them apart by integration.
		if (result == null || 'error' in result) return undefined;
		return result.value;
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
		const { hiddenIds } = this.getHiddenRefState(graph.repoPath);
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
				webviewItem: `gitlens:tag${hiddenIds.has(t.id) ? '+hidden' : ''}`,
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
				providerName: remoteName ? providerByRemote.get(remoteName)?.name : undefined,
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
			this.resetPullRequests();
		}

		// The agents panel renders from pushed session state, not the sidebar resource loop — reach
		// past it: reconcile providers with their durable stores and force a snapshot re-publish.
		if (params.panel === 'agents') {
			void this.container.agentStatus?.refresh();
		}

		this.notifySidebarInvalidated();
	}

	onSidebarAction(params: { command: GlCommands; context?: string; args?: unknown[] }): void {
		// The pull-requests panel's connect empty state passes the integration to connect, not the
		// command's own args shape, and the connect flow needs no repo context — so it's handled ahead of
		// both the typed-args dispatch and the repoPath gate below.
		if (params.command === 'gitlens.plus.cloudIntegrations.connect') {
			const [arg] = params.args ?? [];
			const integrationId = (arg as { integrationId?: SupportedCloudIntegrationIds } | undefined)?.integrationId;

			// No specific integration (an unrecognized host): the generic manage flow, where connecting a
			// self-managed integration with its domain is what makes the host recognized.
			if (integrationId == null) {
				void this.container.integrations.manageCloudIntegrations({
					source: 'graph-sidebar',
					detail: 'pullRequests',
				});
				return;
			}

			// Never skip an already-connected provider: the empty state is only offered when nothing is
			// connected, so a "connected" read here is stale and skipping would leave the panel empty.
			void this.container.integrations.connectCloudIntegrations(
				{ integrationIds: [integrationId], skipIfConnected: false },
				{ source: 'graph-sidebar', detail: 'pullRequests' },
			);
			return;
		}

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

	/** A git host integration connected or disconnected — the pull-requests panel's list (and its connect
	 *  empty state) is entirely a function of that, so drop the cached list and re-fetch. */
	onIntegrationConnectionChanged(): void {
		this.resetPullRequests();
		this.notifySidebarInvalidated();
	}

	@trace()
	notifySidebarInvalidated(): void {
		this.context.fireSidebarInvalidated();
	}
}
