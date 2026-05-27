import type {
	ExcludeByType,
	ExcludeRefsById,
	GraphColumnSetting,
	GraphContexts,
	GraphRef,
	GraphRefOptData,
	GraphRefType,
	GraphRow,
	GraphZoneType,
	Head,
	HostingServiceType,
	IncludeOnlyRefsById,
	IssueTrackerType,
	PullRequestMetadata,
	RefMetadata,
	RefMetadataItem,
	RefMetadataType,
	Remote,
	RowStats,
	GraphItemContext as SerializedGraphItemContext,
	Tag,
	UpstreamMetadata,
	WorkDirStats,
} from '@gitkraken/gitkraken-components';
import type { GitTrackingState } from '@gitlens/git/models/branch.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { GitGraphRowType } from '@gitlens/git/models/graph.js';
import type { GitGraphSearchResultData } from '@gitlens/git/models/graphSearch.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PullRequestRefs, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '@gitlens/git/models/reference.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { SearchQuery } from '@gitlens/git/models/search.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import type { DateTimeFormat } from '@gitlens/utils/date.js';
import type { AgentSessionState } from '../../../agents/models/agentSessionState.js';
import type { Config, DateStyle, GraphBranchesVisibility, GraphMultiSelectionMode } from '../../../config.js';
import type { StoredGraphWipDraft } from '../../../constants.storage.js';
import type { FeaturePreview } from '../../../features.js';
import type { RepositoryShape } from '../../../git/models/repositoryShape.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import type { ReferencesQuickPickOptions2 } from '../../../quickpicks/referencePicker.js';
import type { WebviewItemContext, WebviewItemGroupContext } from '../../../system/webview.js';
import type { IpcScope } from '../../ipc/models/ipc.js';
import { IpcCommand, IpcNotification, IpcRequest } from '../../ipc/models/ipc.js';
import type { WebviewState } from '../../protocol.js';
import type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranch,
	OverviewRecentThreshold,
} from '../../shared/overviewBranches.js';
import type { TimelinePeriod, TimelineSliceBy } from '../timeline/protocol.js';
import type { TreemapMode } from '../treemap/protocol.js';
import type { Wip } from './detailsProtocol.js';

export type { Wip };

/** Prefix for synthetic row ids + shas that represent a secondary-worktree WIP row. */
const secondaryWipShaPrefix = 'worktree-wip::';

export function createSecondaryWipSha(path: string): string {
	return `${secondaryWipShaPrefix}${path}`;
}

export function createWipSha(path: string, selectedRepoPath: string | undefined): string {
	return path === selectedRepoPath ? uncommitted : createSecondaryWipSha(path);
}

export function getSecondaryWipPath(sha: string): string {
	return sha.slice(secondaryWipShaPrefix.length);
}

export function isSecondaryWipSha(sha: string | undefined): boolean {
	return sha?.startsWith(secondaryWipShaPrefix) ?? false;
}

export function isWipSha(sha: string | undefined): boolean {
	return sha === uncommitted || isSecondaryWipSha(sha);
}

export type { GraphRefType } from '@gitkraken/gitkraken-components';
export type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranch,
	OverviewBranchContributor,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchLaunchpadItem,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
	OverviewBranchRemote,
	OverviewBranchWip,
	OverviewRecentThreshold,
} from '../../shared/overviewBranches.js';

export const scope: IpcScope = 'graph';

export type GraphColumnsSettings = Record<GraphColumnName, GraphColumnSetting>;
export type GraphSelectedRows = Record</*id*/ string, true>;
export type GraphAvatars = Record</*email*/ string, /*url*/ string>;
export type GraphDownstreams = Record</*upstreamName*/ string, /*downstreamNames*/ string[]>;

export type GraphRefMetadata = RefMetadata | null;
export type GraphUpstreamMetadata = UpstreamMetadata | null;
export type GraphRefsMetadata = Record</* id */ string, GraphRefMetadata>;
export type GraphHostingServiceType = HostingServiceType;
export type GraphRefMetadataItem = RefMetadataItem;
export type GraphRefMetadataType = RefMetadataType;
export type GraphMissingRefsMetadataType = RefMetadataType;
export type GraphMissingRefsMetadata = Record</*id*/ string, /*missingType*/ GraphMissingRefsMetadataType[]>;
export type GraphPullRequestMetadata = PullRequestMetadata;

export type GraphRefMetadataTypes = 'upstream' | 'pullRequest' | 'issue';
export type GraphSearchMode = 'normal' | 'filter';

export interface GraphSelection {
	id: string;
	type: GitGraphRowType;
	active: boolean;
	hidden: boolean;
	repoPath?: string;
}

export type GraphScrollMarkerTypes =
	| 'selection'
	| 'head'
	| 'highlights'
	| 'localBranches'
	| 'pullRequests'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'upstream'
	| 'wip';

export type GraphMinimapMarkerTypes =
	| 'selection'
	| 'head'
	| 'highlights'
	| 'localBranches'
	| 'pullRequests'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'upstream'
	| 'worktree';

export const supportedRefMetadataTypes: GraphRefMetadataType[] = ['upstream', 'pullRequest', 'issue'];

export type GraphSidebarPanel = 'agents' | 'branches' | 'overview' | 'remotes' | 'stashes' | 'tags' | 'worktrees';

/** Top-level rendering mode for the Graph webview. New modes (e.g. kanban) plug in here. */
export type GraphDisplayMode = 'graph' | 'visualizations' | 'kanban';

export type GraphShowAction = 'show-wip' | 'enter-review' | 'enter-compose' | 'open-compare' | 'scope-to-branch';

/** Optional target row for a `GraphShowAction`. When provided, the webview routes the action
 *  to this specific row (used by context-menu invocations on secondary WIP rows where the
 *  action targets a worktree other than the primary). When absent, the webview falls back to
 *  its primary repo + `uncommitted`.
 *
 *  `worktreePath` is the row's own worktree path — for the primary WIP this equals the repo
 *  path; for secondary WIP rows it's the named worktree's path. It is also the key the
 *  graph webview uses to look up persisted WIP drafts, so callers must populate it from the
 *  row's worktree (typically `ref.repoPath` since `GitGraphRowRef.repoPath` is set to the
 *  worktree path for secondary rows), not the parent repository's path. */
export interface GraphActionTarget {
	sha: string;
	worktreePath: string;
}
/** Sub-visualization shown when `displayMode === 'visualizations'`.
 *  Adding a new visualization is a 4-step extension: extend this union, render its component in
 *  `gl-graph-visualizations`, persist any per-visualization config in `graph-app.persistStateNow`,
 *  and add the host-side data service to `GraphServices`. */
export type VisualizationMode = 'timeline' | 'treemap';

/** Aliased from the canonical treemap protocol so both the storage type and the graph state refer
 *  to the same union — adding a fourth mode in `treemap/protocol.ts` flows here automatically. */
export type GraphTreemapMode = TreemapMode;

export interface GraphOverviewData {
	active: OverviewBranch[];
	recent: OverviewBranch[];
	/** Set when the host couldn't compute the overview. `active`/`recent` are still
	 *  structurally-valid (empty arrays) so existing consumers don't crash on `.length`. */
	error?: string;
}

export interface GraphScope {
	branchName: string;
	/** Full ref id of the specific branch to scope to (e.g. 'refs/heads/feature/x'). NOT necessarily HEAD. */
	branchRef: string;
	/** Full ref id of the branch's upstream (e.g. 'refs/remotes/origin/feature/x'). */
	upstreamRef?: string;
	/** SHA of the focal branch's tip commit. Backfilled by the scope-anchor resolver so callers
	 *  (e.g. the popover's fallback path) can select the focal tip even when the branch isn't in
	 *  the loaded graph rows page. */
	focalBranchTipSha?: string;
	/** SHA of the merge-target tip commit. Its ancestors are NOT walked — the tip is kept as a marker. */
	mergeTargetTipSha?: string;
	mergeBase?: { sha: string; date: number };
	/**
	 * Additional ref ids to include in the scope. Each tip becomes an anchor (same treatment as
	 * branchRef — shows all refs, acts as visibility floor) and its ancestors contribute to
	 * visibleShas subject to the mergeTarget exclusion.
	 *
	 * Primary use case: branches stacked on top of the focal branch (e.g. F2, F3 stacked on F1).
	 * The helper makes no stackedness check — any refs are valid (siblings, comparisons, etc.).
	 */
	additionalBranchRefs?: string[];
}

export interface State extends WebviewState<'gitlens.graph' | 'gitlens.views.graph'> {
	windowFocused?: boolean;
	webroot?: string;
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	branchesVisibility?: GraphBranchesVisibility;
	branch?: GitBranchReference;
	branchState?: BranchState;
	lastFetched?: Date;
	selectedRows?: GraphSelectedRows;
	subscription?: Subscription;
	allowed: boolean;
	avatars?: GraphAvatars;
	loading?: boolean;
	refsMetadata?: GraphRefsMetadata | null;
	rows?: GraphRow[];
	rowsStats?: Record<string, GraphRowStats>;
	rowsStatsLoading?: boolean;
	/** Mirrors the host's `_graph.includes.stats` — true when the current graph build requested stats.
	 *  Used by the webview to decide whether entering Timeline mode needs to eagerly show its loading
	 *  overlay (stale `rowsStats` from a prior stats-bearing build can otherwise mask a missing refetch). */
	rowsStatsIncluded?: boolean;
	downstreams?: GraphDownstreams;
	paging?: GraphPaging;
	columns?: GraphColumnsSettings;
	config?: GraphComponentConfig;
	context?: GraphContexts & { settings?: SerializedGraphItemContext };
	nonce?: string;
	workingTreeStats?: GraphWorkingTreeStats;
	wipMetadataBySha?: GraphWipMetadataBySha;
	/**
	 * Most-recently pushed primary-repo WIP. Set on every `DidChangeWorkingTreeNotification` so
	 * the details panel can apply changes without an extra `getWip` round-trip. Initial state
	 * leaves this undefined — first selection of a WIP row triggers the panel's resource fetch
	 * for the cold-load path; subsequent working-tree ticks flow through this push channel.
	 */
	wip?: Wip;
	searchMode?: GraphSearchMode;
	/** Search query to be executed once */
	searchRequest?: SearchQuery;
	searchResults?: DidSearchParams['results'];
	useNaturalLanguageSearch?: boolean;
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
	pinnedRef?: GraphPinnedRef;
	featurePreview?: FeaturePreview;
	orgSettings?: { ai: boolean; drafts: boolean };
	overview?: GraphOverviewData;
	mcpBannerCollapsed?: boolean;
	hooksBannerCollapsed?: boolean;
	canInstallClaudeHook?: boolean;
	graphWalkthroughBannerCollapsed?: boolean;
	graphWalkthroughComplete?: boolean;
	graphWalkthroughStarted?: boolean;
	visualizationsButtonCalloutDismissed?: boolean;

	// Persisted UI state (from `graph:state` workspace memento)
	displayMode?: GraphDisplayMode;
	details?: {
		visible?: boolean;
		position?: number;
		bottomPosition?: number;
		showSearchBox?: boolean;
		/** `true` = filter (hide non-matches), `false` = highlight (dim non-matches). */
		searchBoxFilter?: boolean;
	};
	sidebar?: {
		visible?: boolean;
		position?: number;
		activePanel?: GraphSidebarPanel;
		/** `true` = filter (hide non-matches), `false` = highlight (dim non-matches). */
		searchBoxFilter?: boolean;
	};
	minimap?: {
		visible?: boolean;
		position?: number;
	};
	pendingAction?: { action: GraphShowAction; target?: GraphActionTarget; commitMessage?: string };
	/** Per-worktree commit drafts for this repo's WIP rows, keyed by worktree fsPath (== `repoPath`
	 *  for the primary WIP, == the secondary worktree's fsPath for each secondary WIP row).
	 *  Restored on WIP row selection; mutated via {@link UpdateWipDraftCommand}. */
	wipDrafts?: Record<string, StoredGraphWipDraft>;
	// Persisted Visualizations-mode chart options (when `displayMode === 'visualizations'`).
	// Field name stays `timeline` since it persists the embedded Timeline component's settings;
	// only the display-mode value changed to align with the user-facing "Show Visualizations" label.
	timeline?: {
		period?: TimelinePeriod;
		sliceBy?: TimelineSliceBy;
		showAllBranches?: boolean;
	};
	// Persisted timeframe for the Overview panel's "Recent" section. Kept flat (not under `overview`)
	// because `overview` is already used for `GraphOverviewData` (active/recent branches).
	overviewRecentThreshold?: OverviewRecentThreshold;

	// Props below are computed in the webview (not passed)
	activeDay?: number;
	activeRow?: string;
	visibleDays?: {
		top: number;
		bottom: number;
	};

	// Persisted Visualizations-mode state (when `displayMode === 'visualizations'`).
	visualizationMode?: VisualizationMode;
	treemapMode?: GraphTreemapMode;
}

export interface BranchState extends GitTrackingState {
	upstream?: string;
	provider?: {
		name: string;
		icon?: string;
		url?: string;
	};
	pr?: PullRequestShape;
	worktree?: boolean;
}

export type GraphWorkingTreeStats = WorkDirStats & {
	hasConflicts?: boolean;
	conflictsCount?: number;
	pausedOpStatus?: GitPausedOperationStatus;
};

export interface GraphWipNodeMetadata {
	/** Omit to have the GK component request it via `onWipShasMissingStats`. */
	workDirStats?: WorkDirStats;
	/** Keep the current stats visible while asking for fresh ones (stale-while-revalidate). */
	workDirStatsStale?: boolean;
	/** Host-only: used by the webview to construct the synthetic row and by details panel routing. Not consumed by the GK component. */
	repoPath: string;
	/** Host-only: the worktree HEAD sha this WIP row should be anchored at (used as `parents`). */
	parentSha: string;
	/** Host-only: user-visible suffix for the row message (e.g. worktree name). */
	label: string;
	/**
	 * Host-only: the worktree branch in scope ref-id format (`{repoPath}|heads/{name}`), or undefined
	 * for detached worktrees. Used by the webview's scope filter to drop secondary WIPs whose branch
	 * isn't part of the active scope — independent of SHA collisions with scope anchors.
	 */
	branchRef?: string;
	/**
	 * Host-only: paused operation (rebase/merge/cherry-pick) running in this worktree, when any.
	 * Mirrors the primary's `workingTreeStats.pausedOpStatus` so the secondary WIP row can render
	 * the same indicator the action bar does. Not consumed by the GK component.
	 */
	pausedOpStatus?: GitPausedOperationStatus;
	/** Host-built serialized `GraphItemContext` for the row's `contexts.row` slot (right-click menu). */
	context?: string;
}

export type GraphWipMetadataBySha = Record<string, GraphWipNodeMetadata>;

export interface GraphPaging {
	startingCursor?: string;
	hasMore: boolean;
}

export type GraphRepository = RepositoryShape;

export interface GraphCommitIdentity {
	name: string;
	email: string | undefined;
	date: number;
}
export interface GraphCommit {
	sha: string;
	author: GraphCommitIdentity;
	message: string;
	parents: string[];
	committer: GraphCommitIdentity;
	type: GitGraphRowType;

	avatarUrl: string | undefined;
}
export type GraphRemote = Remote;
export type GraphTag = Tag;
export type GraphBranch = Head;

export type GraphAutoFetchMode = 'off' | 'vscode' | 'gitlens';

export interface GraphComponentConfig {
	aiEnabled?: boolean;
	autoFetchEnabled?: boolean;
	autoFetchIntervalSeconds?: number;
	autoFetchMode?: GraphAutoFetchMode;
	avatars?: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	detailsLocation?: 'right' | 'bottom';
	dimMergeCommits?: boolean;
	enabledRefMetadataTypes?: GraphRefMetadataType[];
	experimentalKanbanEnabled?: boolean;
	experimentalVisualizationsEnabled?: boolean;
	highlightRowsOnRefHover?: boolean;
	idLength?: number;
	minimap?: boolean;
	minimapDataType?: Config['graph']['minimap']['dataType'];
	minimapMarkerTypes?: GraphMinimapMarkerTypes[];
	minimapReversed?: boolean;
	multiSelectionMode?: GraphMultiSelectionMode;
	onlyFollowFirstParent?: boolean;
	scrollMarkerTypes?: GraphScrollMarkerTypes[];
	scrollRowPadding?: number;
	showGhostRefsOnRowHover?: boolean;
	showRemoteNamesOnRefs?: boolean;
	showWorktreeWipStats?: boolean;
	sidebar: boolean;
	sidebarPinned?: boolean;
	stickyTimeline?: boolean;
}

export interface GraphColumnConfig {
	isHidden?: boolean;
	mode?: string;
	width?: number;
	order?: number;
}

export type GraphColumnsConfig = Record<string, GraphColumnConfig>;

export type GraphExcludeRefs = ExcludeRefsById;
export type GraphExcludedRef = GraphRefOptData;
export type GraphExcludeTypes = ExcludeByType;
export type GraphIncludeOnlyRefs = IncludeOnlyRefsById;
export type GraphIncludeOnlyRef = GraphRefOptData;
export type GraphPinnedRef = GraphRefOptData & { sha?: string };

export type GraphColumnName = GraphZoneType;
export type GraphRowStats = RowStats;

export type InternalNotificationType = 'didChangeTheme';

export type UpdateStateCallback = (state: State, type?: IpcNotification<any> | InternalNotificationType) => void;

// COMMANDS

export const ChooseRepositoryCommand = new IpcCommand(scope, 'chooseRepository');

export type DoubleClickedParams =
	| { type: 'ref'; ref: GraphRef; metadata?: GraphRefMetadataItem }
	| { type: 'row'; row: { id: string; type: GitGraphRowType }; preserveFocus?: boolean };
export const DoubleClickedCommand = new IpcCommand<DoubleClickedParams>(scope, 'dblclick');

export interface GetMissingAvatarsParams {
	emails: GraphAvatars;
}
export const GetMissingAvatarsCommand = new IpcCommand<GetMissingAvatarsParams>(scope, 'avatars/get');

export interface GetMissingRefsMetadataParams {
	metadata: GraphMissingRefsMetadata;
}
export const GetMissingRefsMetadataCommand = new IpcCommand<GetMissingRefsMetadataParams>(scope, 'refs/metadata/get');

export interface GetMoreRowsParams {
	id?: string;
	/** Override the host's configured page size (`gitlens.graph.pageItemLimit`) for this single
	 *  request. Used by the embedded Visual History when the user picks `All time` so we burn
	 *  through the repo's history in fewer, larger chunks instead of paying per-RPC overhead
	 *  on the default 200-row page size. Falls back to the host's configured limit when
	 *  unspecified. */
	limit?: number;
}
export const GetMoreRowsCommand = new IpcCommand<GetMoreRowsParams>(scope, 'rows/get');

export interface OpenPullRequestDetailsParams {
	id?: string;
	/** Provider id (e.g. 'github') — when supplied with `id`, the host resolves the PR via the
	 *  matching integration instead of falling back to the current-branch lookup. */
	providerId?: string;
}
export const OpenPullRequestDetailsCommand = new IpcCommand<OpenPullRequestDetailsParams>(
	scope,
	'pullRequest/openDetails',
);

export type RowAction =
	| 'open-changes'
	| 'open-changes-with-working'
	| 'stash-apply'
	| 'stash-drop'
	| 'stash-pop'
	| 'stash-save';

export interface RowActionParams {
	action: RowAction;
	row: { id: string; type: GitGraphRowType };
}
export const RowActionCommand = new IpcCommand<RowActionParams>(scope, 'row/action');

export interface TreemapFileActionParams {
	action: 'open' | 'history';
	/** Repo this click belongs to — the host rehydrates the file URI via
	 *  `Uri.joinPath(repository.uri, path)` so the original scheme (file://, vscode-vfs://, etc.)
	 *  is preserved for virtual workspaces. */
	repoPath: string;
	/** Forward-slash, repo-relative path of the clicked treemap leaf. Relative (not absolute) so
	 *  the host can scheme-preserve the rehydration; `vscode.Uri` instances can't cross IPC. */
	path: string;
}
export const TreemapFileActionCommand = new IpcCommand<TreemapFileActionParams>(scope, 'treemap/file/action');

export interface SearchOpenInViewParams {
	search: SearchQuery;
}
export const SearchOpenInViewCommand = new IpcCommand<SearchOpenInViewParams>(scope, 'search/openInView');

export interface SearchCancelParams {
	preserveResults: boolean;
}
export const SearchCancelCommand = new IpcCommand<SearchCancelParams>(scope, 'search/cancel');

export interface UpdateColumnsParams {
	config: GraphColumnsConfig;
}
export const UpdateColumnsCommand = new IpcCommand<UpdateColumnsParams>(scope, 'columns/update');

export interface UpdateRefsVisibilityParams {
	refs: GraphExcludedRef[];
	visible: boolean;
}
export const UpdateRefsVisibilityCommand = new IpcCommand<UpdateRefsVisibilityParams>(scope, 'refs/update/visibility');

export interface UpdatePinnedRefParams {
	ref: GraphPinnedRef | null;
}
export const UpdatePinnedRefCommand = new IpcCommand<UpdatePinnedRefParams>(scope, 'refs/update/pinned');

export interface UpdateExcludeTypesParams {
	key: keyof GraphExcludeTypes;
	value: boolean;
}
export const UpdateExcludeTypesCommand = new IpcCommand<UpdateExcludeTypesParams>(scope, 'filters/update/excludeTypes');

export interface UpdateGraphConfigurationParams {
	changes: { [key in keyof GraphComponentConfig]?: GraphComponentConfig[key] };
}
export const UpdateGraphConfigurationCommand = new IpcCommand<UpdateGraphConfigurationParams>(
	scope,
	'configuration/update',
);

export interface UpdateGraphDisplayModeParams {
	mode: GraphDisplayMode;
}
export const UpdateGraphDisplayModeCommand = new IpcCommand<UpdateGraphDisplayModeParams>(scope, 'displayMode/update');

export interface UpdateGraphSearchModeParams {
	searchMode: GraphSearchMode;
	useNaturalLanguage: boolean;
}
export const UpdateGraphSearchModeCommand = new IpcCommand<UpdateGraphSearchModeParams>(scope, 'search/update/mode');

export interface UpdateIncludedRefsParams {
	branchesVisibility?: GraphBranchesVisibility;
	refs?: GraphIncludeOnlyRef[];
}
export const UpdateIncludedRefsCommand = new IpcCommand<UpdateIncludedRefsParams>(scope, 'filters/update/includedRefs');

export const ResetGraphFiltersCommand = new IpcCommand(scope, 'filters/reset');

export interface UpdateSelectionParams {
	selection: GraphSelection[];
}
export const UpdateSelectionCommand = new IpcCommand<UpdateSelectionParams>(scope, 'selection/update');

export interface UpdateWipDraftParams {
	/** Worktree fsPath this draft belongs to — the storage key. Equals the main repo path for
	 *  the primary worktree; the worktree's own fsPath for secondary worktrees. */
	worktreePath: string;
	/** `null` ⇒ delete the entry. */
	draft: StoredGraphWipDraft | null;
}
export const UpdateWipDraftCommand = new IpcCommand<UpdateWipDraftParams>(scope, 'wipDraft/update');

// REQUESTS

export type DidChooseRefParams =
	| { id?: string; name: string; sha: string; refType: GitReference['refType']; graphRefType?: GraphRefType }
	| undefined;

export const JumpToHeadRequest = new IpcRequest<undefined, DidChooseRefParams>(scope, 'jumpToHead');

export interface ChooseRefParams {
	title: string;
	placeholder: string;
	allowedAdditionalInput?: ReferencesQuickPickOptions2['allowedAdditionalInput'];
	include?: ReferencesQuickPickOptions2['include'];
	picked?: string;
}
export const ChooseRefRequest = new IpcRequest<ChooseRefParams, DidChooseRefParams>(scope, 'chooseRef');

export interface ChooseComparisonParams {
	title: string;
	placeholder: string;
}
export interface DidChooseComparisonParams {
	range: string | undefined;
}
export const ChooseComparisonRequest = new IpcRequest<ChooseComparisonParams, DidChooseComparisonParams>(
	scope,
	'chooseComparison',
);

export interface ChooseAuthorParams {
	title: string;
	placeholder: string;
	picked?: string[];
}
export interface DidChooseAuthorParams {
	authors: string[] | undefined;
}
export const ChooseAuthorRequest = new IpcRequest<ChooseAuthorParams, DidChooseAuthorParams>(scope, 'chooseAuthor');

export interface ChooseFileParams {
	title: string;
	type: 'file' | 'folder';
	openLabel?: string;
	picked?: string[];
}
export interface DidChooseFileParams {
	files: string[] | undefined;
}
export const ChooseFileRequest = new IpcRequest<ChooseFileParams, DidChooseFileParams>(scope, 'chooseFile');

export interface ResolvedGraphScope extends GraphScope {
	mergeBase?: { sha: string; date: number };
	/**
	 * Resolved merge-target tip SHA. Carried alongside `mergeBase` so the lightweight scope-anchor
	 * path can backfill the scope without forcing a parallel `getOverviewEnrichment` IPC for branches
	 * that aren't already in active/recent.
	 */
	resolvedMergeTargetTipSha?: string;
	/** Resolved focal-branch tip SHA, looked up by the scope-anchor resolver. Mirrors the
	 *  `resolvedMergeTargetTipSha` shape — distinct response field so the patcher can tell
	 *  "resolver had no answer" (`undefined`) from "value already on the scope". */
	resolvedFocalBranchTipSha?: string;
}
export interface ResolveGraphScopeParams {
	repoPath: string;
	scope: GraphScope;
}
export interface DidResolveGraphScopeParams {
	scope: ResolvedGraphScope;
	/** Set when the scope-anchor resolver threw. `scope` is the unresolved caller-supplied scope
	 *  as a fallback so consumers reading `scope.mergeBase` etc. don't crash. */
	error?: string;
}
export const ResolveGraphScopeRequest = new IpcRequest<ResolveGraphScopeParams, DidResolveGraphScopeParams>(
	scope,
	'scope/resolve',
);

export interface EnsureRowParams {
	id: string;
	select?: boolean;
}
export interface DidEnsureRowParams {
	id?: string; // `undefined` if the row was not found
	/** Set when the host couldn't load the row. `id` is undefined alongside. */
	error?: string;
}
export const EnsureRowRequest = new IpcRequest<EnsureRowParams, DidEnsureRowParams>(scope, 'rows/ensure');

export interface SearchHistoryGetParams {
	repoPath: string | undefined;
}
export interface DidSearchHistoryGetParams {
	history: SearchQuery[];
	/** Set when the store/delete operation failed. `history` reflects the last-known state from
	 *  storage so the UI can still render something coherent. */
	error?: string;
}
export const SearchHistoryGetRequest = new IpcRequest<SearchHistoryGetParams, DidSearchHistoryGetParams>(
	scope,
	'search/history/get',
);

export interface SearchHistoryStoreParams {
	repoPath: string | undefined;
	search: SearchQuery;
}
export const SearchHistoryStoreRequest = new IpcRequest<SearchHistoryStoreParams, DidSearchHistoryGetParams>(
	scope,
	'search/history/store',
);

export interface SearchHistoryDeleteParams {
	repoPath: string | undefined;
	query: string;
}
export const SearchHistoryDeleteRequest = new IpcRequest<SearchHistoryDeleteParams, DidSearchHistoryGetParams>(
	scope,
	'search/history/delete',
);

export type DidGetCountParams =
	| {
			branches: number;
			remotes: number;
			stashes?: number;
			tags: number;
			worktrees?: number;
	  }
	| undefined;
export const GetCountsRequest = new IpcRequest<void, DidGetCountParams>(scope, 'counts');

export interface GetOverviewParams {
	/** When set, updates the host's stored "Recent" timeframe before computing the overview. */
	recentThreshold?: OverviewRecentThreshold;
}
export const GetOverviewRequest = new IpcRequest<GetOverviewParams, GraphOverviewData>(scope, 'overview/get');

export interface GetOverviewWipParams {
	branchIds: string[];
	/**
	 * When true, the host probes `status.hasWorkingChanges()` (cheap `git diff --quiet` + untracked
	 * probe) instead of running a full `git status` per branch. Result entries carry `hasChanges`
	 * only — `workingTreeState`, conflicts, and pausedOp are filled in on hover via
	 * {@link GetOverviewWipDetailedRequest}.
	 */
	cheap?: boolean;
}
export const GetOverviewWipRequest = new IpcRequest<GetOverviewWipParams, GetOverviewWipResponse>(
	scope,
	'overview/wip/get',
);

export interface GetOverviewWipDetailedParams {
	branchIds: string[];
}
/**
 * On-demand fetch of the full wip breakdown (add/changed/deleted) for the given branches. Driven
 * by the rich hover so the eager overview load can stay on the cheap clean/dirty path
 * ({@link GetOverviewWipRequest}).
 */
export const GetOverviewWipDetailedRequest = new IpcRequest<GetOverviewWipDetailedParams, GetOverviewWipResponse>(
	scope,
	'overview/wip/detailed/get',
);

export interface GetOverviewEnrichmentParams {
	branchIds: string[];
}
export const GetOverviewEnrichmentRequest = new IpcRequest<GetOverviewEnrichmentParams, GetOverviewEnrichmentResponse>(
	scope,
	'overview/enrichment/get',
);

export const GetAgentSessionsRequest = new IpcRequest<void, AgentSessionState[]>(scope, 'agentSessions/get');

export interface GetWipStatsParams {
	shas: string[];
	/**
	 * When true, bypass the `graph.showWorktreeWipStats` gate and always compute stats for the
	 * requested shas. Used by the selection-driven fetch path so clicking a worktree WIP row still
	 * populates its stats when the setting is disabled.
	 */
	force?: boolean;
}
/** Per-row WIP stats. Carries `workDirStats` (consumed by the GK component) plus host-only
 *  fields like `pausedOpStatus` so the secondary WIP row can surface a paused-op indicator. */
export interface WipRowStats {
	workDirStats: WorkDirStats;
	pausedOpStatus?: GitPausedOperationStatus;
}
export type GetWipStatsResponse = Record<string, WipRowStats | undefined>;
export const GetWipStatsRequest = new IpcRequest<GetWipStatsParams, GetWipStatsResponse>(scope, 'wip/stats/get');

export interface SyncWipWatchesParams {
	/** Full set of currently-visible secondary WIP shas. Host diffs against its subscription set. */
	shas: string[];
}
export const SyncWipWatchesCommand = new IpcCommand<SyncWipWatchesParams>(scope, 'wip/watches/sync');

export interface DidRequestWipRefetchParams {
	/** Repo path of the WIP that should be re-fetched. */
	repoPath: string;
	/** Pre-fetched WIP payload — same shape as `DidChangeWorkingTreeNotification`'s `wip`. The
	 *  panel applies this directly so the round-trip `getWip` RPC is avoided. */
	wip?: Wip;
	/** Pre-computed working-tree stats for this repo. Carried alongside `wip` so the webview
	 *  doesn't have to re-derive them — the host already paid for the `git status` that produced
	 *  the WIP payload. Used by the webview to refresh `workingTreeStats` (when this repo is the
	 *  selected one) and the secondary row's `workDirStats`. */
	stats?: GraphWorkingTreeStats;
}
/** Host → panel: push fresh WIP after host-side mutating actions whose effects don't reach the
 *  panel via the active-repo working-tree watcher (e.g. context-menu conflict-resolution
 *  commands on a non-active worktree's WIP row). */
export const DidRequestWipRefetchNotification = new IpcNotification<DidRequestWipRefetchParams>(
	scope,
	'wip/refetch/request',
);

export interface GraphSidebarBranch {
	name: string;
	sha?: string;
	current: boolean;
	remote: boolean;
	status?: string;
	upstream?: { name: string; missing: boolean };
	tracking?: { ahead: number; behind: number };
	worktree?: boolean;
	worktreeOpened?: boolean;
	checkedOut?: boolean;
	disposition?: string;
	date?: number;
	providerName?: string;
	starred?: boolean;
	context?: GraphItemRefContext<GraphBranchContextValue>;
}

export interface GraphSidebarRemoteBranch {
	name: string;
	sha?: string;
	context?: GraphItemRefContext<GraphBranchContextValue>;
}

export interface GraphSidebarRemote {
	name: string;
	url?: string;
	isDefault: boolean;
	providerIcon?: string;
	providerName?: string;
	/** Whether the remote's integration is connected (`true`), disconnected (`false`), or not applicable (`undefined`). */
	connected?: boolean;
	branches: GraphSidebarRemoteBranch[];
	context?: GraphItemTypedContext<GraphRemoteContextValue>;
}

export interface GraphSidebarStash {
	name: string;
	sha: string;
	message: string;
	date?: number;
	stashNumber: string;
	stashOnRef?: string;
	context?: GraphItemRefContext<GraphStashContextValue>;
}

export interface GraphSidebarTag {
	name: string;
	sha?: string;
	message?: string;
	annotated: boolean;
	date?: number;
	context?: GraphItemRefContext<GraphTagContextValue>;
}

/**
 * Per-worktree change entry carried by `sidebarWorktreeState` push events. Both fields come from
 * the same `getStatus()` in `doComputeWorktreeChanges`, so the worktrees-panel row's clean/dirty
 * pill and its breakdown tooltip stay in sync without a second fetch. `workingTreeState` is
 * optional so bare worktrees / fetch failures still produce a structurally-valid entry.
 */
export interface SidebarWorktreeChange {
	hasChanges: boolean;
	workingTreeState?: GitDiffFileStats;
}

export interface GraphSidebarWorktree {
	name: string;
	uri: string;
	branch?: string;
	sha?: string;
	isDefault: boolean;
	locked: boolean;
	opened: boolean;
	/** The graph row id this worktree's WIP anchors to: `uncommitted` for the graph's primary
	 *  worktree, a secondary-wip sha for others, or undefined when the worktree has no WIP row. */
	wipSha?: string;
	hasChanges?: boolean;
	/**
	 * Full add/changed/deleted breakdown for the worktree's working tree. Populated alongside
	 * `hasChanges` by `doComputeWorktreeChanges()` from the same `git status` fetch — no extra
	 * git work. Drives the panel row's clean/dirty pill tooltip.
	 */
	workingTreeState?: GitDiffFileStats;
	status?: string;
	upstream?: string;
	tracking?: { ahead: number; behind: number };
	providerName?: string;
	context?: GraphItemRefContext<GraphBranchContextValue> | GraphItemRefContext<GraphCommitContextValue>;
}

export type GetSidebarDataParams = { panel: GraphSidebarPanel };
export type DidGetSidebarDataParams = { layout?: 'list' | 'tree'; compact?: boolean } & (
	| { panel: 'branches'; items: GraphSidebarBranch[] }
	| { panel: 'remotes'; items: GraphSidebarRemote[] }
	| { panel: 'stashes'; items: GraphSidebarStash[] }
	| { panel: 'tags'; items: GraphSidebarTag[] }
	| { panel: 'worktrees'; items: GraphSidebarWorktree[] }
	| { panel: 'overview'; items: never[] }
	| { panel: 'agents'; items: AgentSessionState[] }
);
export type GetRowHoverParams = {
	type: GitGraphRowType;
	id: string;
};

export interface DidGetRowHoverParams {
	id: string;
	markdown: PromiseSettledResult<string>;
	/** Set when the host couldn't even start building the hover (e.g. repo lookup threw).
	 *  `markdown` is still present as a structurally-valid rejected `PromiseSettledResult`. */
	error?: string;
}

export const GetRowHoverRequest = new IpcRequest<GetRowHoverParams, DidGetRowHoverParams>(scope, 'row/hover/get');

export interface SearchParams {
	search: SearchQuery;
	limit?: number;
	more?: boolean;
}
export interface GraphSearchResults {
	ids?: Record<string, GitGraphSearchResultData>;
	count: number;
	hasMore: boolean;
	/** Whether the commits for these search results are loaded in the graph */
	commitsLoaded: { count: number };
}
export interface GraphSearchResultsError {
	error: string;
}
export interface DidSearchParams {
	search: SearchQuery | undefined;
	results: GraphSearchResults | GraphSearchResultsError | undefined;
	selectedRows?: GraphSelectedRows;
	/** Indicates this is a partial result (more results coming) */
	partial?: boolean;
	/** Search ID to track which search these results belong to */
	searchId: number;
}
export const SearchRequest = new IpcRequest<SearchParams, DidSearchParams>(scope, 'search');

// NOTIFICATIONS

export interface DidChangeOverviewParams {
	overview: GraphOverviewData;
}
export const DidChangeOverviewNotification = new IpcNotification<DidChangeOverviewParams>(scope, 'overview/didChange');

export interface DidChangeAgentSessionsParams {
	sessions: AgentSessionState[];
}
export const DidChangeAgentSessionsNotification = new IpcNotification<DidChangeAgentSessionsParams>(
	scope,
	'agentSessions/didChange',
);

export interface DidChangeRepoConnectionParams {
	repositories?: GraphRepository[];
}
export const DidChangeRepoConnectionNotification = new IpcNotification<DidChangeRepoConnectionParams>(
	scope,
	'repositories/integration/didChange',
);

export interface DidChangeWipDraftsParams {
	wipDrafts: Record<string, StoredGraphWipDraft> | undefined;
}
/** Fired when `graph:wipDrafts` changes in workspace storage. Lets a concurrent webview
 *  instance (e.g. sidebar + editor view open simultaneously, or two editor instances) refresh
 *  its in-memory `wipDrafts` from storage without waiting for a full state push. */
export const DidChangeWipDraftsNotification = new IpcNotification<DidChangeWipDraftsParams>(
	scope,
	'wipDrafts/didChange',
);

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);

export interface DidChangeGraphConfigurationParams {
	config: GraphComponentConfig;
}
export const DidChangeGraphConfigurationNotification = new IpcNotification<DidChangeGraphConfigurationParams>(
	scope,
	'configuration/didChange',
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	allowed: boolean;
}
export const DidChangeSubscriptionNotification = new IpcNotification<DidChangeSubscriptionParams>(
	scope,
	'subscription/didChange',
);

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettings = new IpcNotification<DidChangeOrgSettingsParams>(scope, 'org/settings/didChange');

export interface DidChangeAvatarsParams {
	avatars: GraphAvatars;
}
export const DidChangeAvatarsNotification = new IpcNotification<DidChangeAvatarsParams>(scope, 'avatars/didChange');

export const DidChangeMcpBanner = new IpcNotification<boolean>(scope, 'mcp/didChange');

export const DidChangeHooksBanner = new IpcNotification<boolean>(scope, 'hooks/didChange');

export const DidChangeCanInstallClaudeHook = new IpcNotification<boolean>(
	scope,
	'agents/canInstallClaudeHook/didChange',
);

export interface CloseGraphWalkthroughBannerParams {
	openWelcome?: boolean;
}

export const CloseGraphWalkthroughBannerCommand = new IpcCommand<CloseGraphWalkthroughBannerParams>(
	scope,
	'graphWalkthrough/banner/close',
);

export interface GraphWalkthroughBannerState {
	dismissed: boolean;
}

export const DidChangeGraphWalkthroughBanner = new IpcNotification<GraphWalkthroughBannerState>(
	scope,
	'graphWalkthrough/banner/didChange',
);

export const DidChangeGraphWalkthroughComplete = new IpcNotification<boolean>(
	scope,
	'graphWalkthrough/complete/didChange',
);

export const DidChangeGraphWalkthroughStarted = new IpcNotification<boolean>(
	scope,
	'graphWalkthrough/started/didChange',
);

export const DidChangeVisualizationsButtonCallout = new IpcNotification<boolean>(
	scope,
	'visualizationsButtonCallout/didChange',
);

export const DismissVisualizationsButtonCalloutCommand = new IpcCommand(scope, 'visualizationsButtonCallout/dismiss');

export interface DidRequestActiveSidebarPanelParams {
	panel: GraphSidebarPanel;
}
export const DidRequestActiveSidebarPanelNotification = new IpcNotification<DidRequestActiveSidebarPanelParams>(
	scope,
	'sidebar/activePanel/didRequest',
);

export interface DidRequestGraphActionParams {
	action: GraphShowAction;
	target?: GraphActionTarget;
	/** Optional seed value for the WIP details panel's commit message input. Currently used after
	 *  Undo Commit to restore the undone commit's message into the box where the user will redo it. */
	commitMessage?: string;
}
export const DidRequestGraphActionNotification = new IpcNotification<DidRequestGraphActionParams>(
	scope,
	'action/didRequest',
);

export const TrackGraphOverviewShownCommand = new IpcCommand(scope, 'track/overview/shown');
export const TrackGraphScopeChangedCommand = new IpcCommand(scope, 'track/scope/changed');
export const TrackGraphDetailsReviewModeCommand = new IpcCommand(scope, 'track/details/reviewMode');
export const TrackGraphDetailsComposeModeCommand = new IpcCommand(scope, 'track/details/composeMode');
export const TrackGraphDetailsCompareModeCommand = new IpcCommand(scope, 'track/details/compareMode');
export const TrackGraphDetailsWipShownCommand = new IpcCommand(scope, 'track/details/wipShown');

export interface DidChangeBranchStateParams {
	branchState: BranchState;
}
export const DidChangeBranchStateNotification = new IpcNotification<DidChangeBranchStateParams>(
	scope,
	'branchState/didChange',
);

export interface DidChangeRefsMetadataParams {
	metadata: GraphRefsMetadata | null | undefined;
}
export const DidChangeRefsMetadataNotification = new IpcNotification<DidChangeRefsMetadataParams>(
	scope,
	'refs/didChangeMetadata',
);

export interface DidChangeColumnsParams {
	columns: GraphColumnsSettings | undefined;
	context?: string;
	settingsContext?: string;
}
export const DidChangeColumnsNotification = new IpcNotification<DidChangeColumnsParams>(scope, 'columns/didChange');

export interface DidChangeScrollMarkersParams {
	context?: string;
}
export const DidChangeScrollMarkersNotification = new IpcNotification<DidChangeScrollMarkersParams>(
	scope,
	'scrollMarkers/didChange',
);

export interface DidChangeRefsVisibilityParams {
	branchesVisibility: GraphBranchesVisibility;
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
}
export const DidChangeRefsVisibilityNotification = new IpcNotification<DidChangeRefsVisibilityParams>(
	scope,
	'refs/didChangeVisibility',
);

export interface DidChangePinnedRefParams {
	pinnedRef?: GraphPinnedRef;
}
export const DidChangePinnedRefNotification = new IpcNotification<DidChangePinnedRefParams>(
	scope,
	'refs/didChangePinned',
);

export interface DidChangeRowsParams {
	rows: GraphRow[];
	/** Undefined when the backing `avatars` Map's size hasn't changed since the last notification —
	 *  the host skips the `Object.fromEntries` cost and the frontend reducer keeps its existing
	 *  state. Present (full Map) when new avatar entries were added. */
	avatars: Record<string, string> | undefined;
	/** Always present — the graph provider mutates downstream arrays in place
	 *  (`downstreams.push(tip)` for existing upstream keys), so size-based dedupe would miss
	 *  array-mutation cases. Frontend wholesale-replaces. */
	downstreams: Record<string, string[]>;
	paging?: GraphPaging;
	refsMetadata?: GraphRefsMetadata | null;
	/** Delta of `rowsStats` entries added since the last notification. The frontend reducer
	 *  spread-merges into its existing state, so shipping only new keys is sufficient and avoids
	 *  the N² IPC payload on pagination of big repos. Undefined when no new entries. */
	rowsStats?: Record<string, GraphRowStats>;
	rowsStatsLoading: boolean;
	rowsStatsIncluded?: boolean;
	search?: DidSearchParams;
	selectedRows?: GraphSelectedRows;
}
export const DidChangeRowsNotification = new IpcNotification<DidChangeRowsParams>(scope, 'rows/didChange');

export interface DidChangeRowsStatsParams {
	rowsStats: Record<string, GraphRowStats>;
	rowsStatsLoading: boolean;
}
export const DidChangeRowsStatsNotification = new IpcNotification<DidChangeRowsStatsParams>(
	scope,
	'rows/stats/didChange',
);

export interface DidChangeSelectionParams {
	selection: GraphSelectedRows;
}
export const DidChangeSelectionNotification = new IpcNotification<DidChangeSelectionParams>(
	scope,
	'selection/didChange',
);

export interface DidRequestOpenCompareModeParams {
	repoPath: string;
	leftRef: string;
	leftRefType?: 'branch' | 'tag' | 'commit';
	rightRef: string;
	rightRefType?: 'branch' | 'tag' | 'commit';
	includeWorkingTree?: boolean;
}
export const DidRequestOpenCompareModeNotification = new IpcNotification<DidRequestOpenCompareModeParams>(
	scope,
	'compareMode/didRequestOpen',
);

export interface DidRequestOpenTimelineScopeParams {
	type: 'file' | 'folder';
	relativePath: string;
	repoPath: string;
}
export const DidRequestOpenTimelineScopeNotification = new IpcNotification<DidRequestOpenTimelineScopeParams>(
	scope,
	'timeline/didRequestOpenScope',
);

export interface DidRequestSearchParams {
	search: SearchQuery;
	selectSha?: string;
}
export const DidRequestSearchNotification = new IpcNotification<DidRequestSearchParams>(scope, 'search/didRequest');

export interface DidChangeWorkingTreeParams {
	stats: WorkDirStats;
	wipMetadataBySha?: GraphWipMetadataBySha;
	/**
	 * Primary-repo WIP, captured from the same `git status` that produced `stats`. Lets the
	 * details panel render fresh file lists without an extra `getWip` RPC. Omitted only when
	 * the underlying status fetch fails — callers should fall back to their existing path
	 * (resource fetch on selection) in that case.
	 */
	wip?: Wip;
	/** Path of the repo whose working tree changed. Used by the webview's WIP cache to key the
	 *  freshest `wip` payload by repo. Always set by the host. */
	repoPath: string;
}
export const DidChangeWorkingTreeNotification = new IpcNotification<DidChangeWorkingTreeParams>(
	scope,
	'workingTree/didChange',
);

export const DidSearchNotification = new IpcNotification<DidSearchParams>(scope, 'didSearch');

export interface DidFetchParams {
	lastFetched: Date;
}
export const DidFetchNotification = new IpcNotification<DidFetchParams>(scope, 'didFetch');

export interface DidInvalidateScopeAnchorsParams {
	repoPath: string;
	/** When undefined, invalidate all scope anchors for the repo. */
	branchRefs?: string[];
}
export const DidInvalidateScopeAnchorsNotification = new IpcNotification<DidInvalidateScopeAnchorsParams>(
	scope,
	'scope/anchors/didInvalidate',
);

export interface DidInvalidateGraphTreemapParams {
	repoPath: string;
}
export const DidInvalidateGraphTreemapNotification = new IpcNotification<DidInvalidateGraphTreemapParams>(
	scope,
	'treemap/didInvalidate',
);

export interface DidStartFeaturePreviewParams {
	featurePreview: FeaturePreview;
	allowed: boolean;
}
export const DidStartFeaturePreviewNotification = new IpcNotification<DidStartFeaturePreviewParams>(
	scope,
	'featurePreview/didStart',
);

export type GraphItemContext = WebviewItemContext<GraphItemContextValue>;
export type GraphItemContextValue = GraphColumnsContextValue | GraphItemTypedContextValue | GraphItemRefContextValue;

export type GraphItemGroupContext = WebviewItemGroupContext<GraphItemGroupContextValue>;
export type GraphItemGroupContextValue = GraphItemRefGroupContextValue;

export type GraphItemRefContext<T = GraphItemRefContextValue> = WebviewItemContext<T>;
export type GraphItemRefContextValue =
	| GraphBranchContextValue
	| GraphCommitContextValue
	| GraphStashContextValue
	| GraphTagContextValue;

export type GraphItemRefGroupContext<T = GraphItemRefGroupContextValue> = WebviewItemGroupContext<T>;
export interface GraphItemRefGroupContextValue {
	type: 'refGroup';
	refs: (GitBranchReference | GitTagReference)[];
}

export type GraphItemTypedContext<T = GraphItemTypedContextValue> = WebviewItemContext<T>;
export type GraphItemTypedContextValue =
	| GraphContributorContextValue
	| GraphPullRequestContextValue
	| GraphRemoteContextValue
	| GraphUpstreamStatusContextValue
	| GraphIssueContextValue;

export type GraphColumnsContextValue = string;

export interface GraphContributorContextValue {
	type: 'contributor';
	repoPath: string;
	name: string;
	email: string | undefined;
	current?: boolean;
}

export interface GraphPullRequestContextValue {
	type: 'pullrequest';
	id: string;
	url: string;
	repoPath: string;
	refs?: PullRequestRefs;
	provider: ProviderReference;
}

export interface GraphIssueContextValue {
	type: 'issue';
	id: string;
	url: string;
	provider: ProviderReference;
}

export interface GraphRemoteContextValue {
	type: 'remote';
	name: string;
	repoPath: string;
}

export interface GraphBranchContextValue {
	type: 'branch';
	ref: GitBranchReference;
	/** Set when this context represents a worktree sidebar row — the worktree's filesystem path. */
	worktreePath?: string;
}

export interface GraphCommitContextValue {
	type: 'commit';
	ref: GitRevisionReference;
	/** Set when this context represents a worktree sidebar row — the worktree's filesystem path. */
	worktreePath?: string;
}

export interface GraphStashContextValue {
	type: 'stash';
	ref: GitStashReference;
}

export interface GraphTagContextValue {
	type: 'tag';
	ref: GitTagReference;
}

export interface GraphUpstreamStatusContextValue {
	type: 'upstreamStatus';
	ref: GitBranchReference;
	ahead: number;
	behind: number;
}

export type GraphIssueTrackerType = IssueTrackerType;
