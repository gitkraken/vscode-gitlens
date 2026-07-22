import type { GraphStyle } from '@gitkraken/commit-graph/view.js';
import type { GitTrackingState } from '@gitlens/git/models/branch.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type {
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowStats,
	GitGraphRowTag,
	GitGraphRowType,
	GraphReachabilityTable,
} from '@gitlens/git/models/graph.js';
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
import type {
	Config,
	DateStyle,
	GraphActivityDecay,
	GraphBranchesVisibility,
	GraphMultiSelectionMode,
} from '../../../config.js';
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

// Graph wire types — native replacements for the shapes formerly imported from
// `@gitkraken/gitkraken-components`. The host produces these and ships them over IPC; both the new
// (`@gitkraken/commit-graph`) and old engines consume structurally-compatible data.

/** A serialized `data-vscode-context` payload (JSON string) or its pre-serialization object form. */
export type SerializedGraphItemContext = string | object;

/** Ref kinds the graph recognizes (mirrors the old engine's `refTypes` values). */
export type GraphRefType = 'head' | 'remote' | 'tag' | 'worktree';

/** The old engine's column/zone identifiers (kept for event-payload compatibility). */
export type GraphZoneType = 'ref' | 'graph' | 'message' | 'author' | 'datetime' | 'sha' | 'changes';

/** Compact ref descriptor used by the include/exclude ref filters. */
export interface GraphRefOptData {
	id: string;
	name: string;
	type: GraphRefType;
	owner?: string;
	avatarUrl?: string;
}

export interface ExcludeByType {
	heads?: boolean;
	remotes?: boolean;
	stashes?: boolean;
	tags?: boolean;
}
export type ExcludeRefsById = Record<string, GraphRefOptData>;
export type IncludeOnlyRefsById = Record<string, GraphRefOptData>;

export interface GraphColumnSetting {
	width: number;
	isFilterable?: boolean;
	isFilterActive?: boolean;
	isHidden: boolean;
	mode?: string;
	order?: number;
	/** Column↔grouped placement. `graph`: `true` (legacy) or host zone id = grouped. `ref`: host zone id = grouped, `false` = column. */
	grouped?: boolean | string;
}

export interface GraphContexts {
	graph?: SerializedGraphItemContext;
	header?: SerializedGraphItemContext;
	settings?: SerializedGraphItemContext;
}

/** Working-tree change counts for the WIP row. */
export interface WorkDirStats {
	added: number;
	deleted: number;
	modified: number;
	renamed?: number;
	context?: SerializedGraphItemContext;
}

// Ref enrichment metadata (ahead/behind, PRs, issues) attached to refs.
export type GraphHostingServiceType =
	| 'github'
	| 'githubEnterprise'
	| 'gitlab'
	| 'gitlabSelfHosted'
	| 'azureDevops'
	| 'bitbucket'
	| 'bitbucketServer';
export type GraphIssueTrackerType = GraphHostingServiceType | 'jiraCloud' | 'jiraServer' | 'trello' | 'linear';

interface BaseRefMetadata {
	context?: SerializedGraphItemContext;
}
export interface PullRequestMetadata extends BaseRefMetadata {
	hostingServiceType: GraphHostingServiceType;
	id: number;
	title: string;
	author?: string;
	date?: number;
	state?: string;
	url?: string;
}
export interface UpstreamMetadata extends BaseRefMetadata {
	name: string;
	owner: string;
	ahead: number;
	behind: number;
	sha?: string;
}
export interface IssueMetadata extends BaseRefMetadata {
	displayId: string;
	id: string;
	issueTrackerType: GraphIssueTrackerType;
	title: string;
}
export interface RefMetadata {
	pullRequest?: PullRequestMetadata[] | null;
	upstream?: UpstreamMetadata | null;
	issue?: IssueMetadata[] | null;
}
export type RefMetadataType = keyof RefMetadata;
export type RefMetadataItem =
	| { refId: string; type: 'pullRequest'; data: PullRequestMetadata }
	| { refId: string; type: 'upstream'; data: UpstreamMetadata }
	| { refId: string; type: 'issue'; data: IssueMetadata };

/** A ref carried on a double-click payload — the union of head/remote/tag fields. */
export interface GraphRef {
	id?: string;
	name: string;
	refType: GraphRefType;
	context?: SerializedGraphItemContext;
	contextGroup?: SerializedGraphItemContext;
	fullName?: string;
	isCurrentHead?: boolean;
	upstream?: { name: string; id: string };
	worktreeId?: string;
	owner?: string;
	avatarUrl?: string;
	url?: string;
	current?: boolean;
	hostingServiceType?: GraphHostingServiceType;
	annotated?: boolean;
	message?: string;
}

/** Filter-state sentinel: `{ [emptySetMarker]: true }` means "filtering applied, zero matches". */
export const emptySetMarker = 'gk.empty-set-marker' as const;
export type EmptySetMarker = typeof emptySetMarker;

/** Options for the graph component's `selectCommits`. */
export interface SelectCommitsOptions {
	/** If true, toggle selection; if false, replace selection. */
	toggle?: boolean;
	/** If true, scroll to ensure the focused commit is visible. */
	ensureVisible?: boolean;
}

/** A read-only graph row as surfaced by the graph component's selection APIs. */
export interface ReadonlyGraphRow extends Readonly<GitGraphRow> {
	readonly rowIndex?: number;
	readonly hasRefs?: boolean;
	/** Old-engine output field (row filtered out); absent on the new engine. */
	readonly hidden?: boolean;
}

/** Map of commit sha → its column (lane) index. */
export type ColumnNumberBySha = Record<string, number>;

/** Map of CSS custom-property name → value, used to theme the graph component. */
export type CssVariables = Record<string, string>;

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

export type GraphShowAction =
	| 'show-wip'
	| 'enter-review'
	| 'enter-compose'
	| 'enter-resolve'
	| 'open-compare'
	| 'scope-to-branch';

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
	/** For `enter-resolve`: scopes the run to specific conflicted files (per-file or multi-select
	 *  entry points). Omitted means "resolve all conflicts". Ignored by other actions. */
	filePaths?: string[];
}

/** Resolved commit-range seed for `enter-compose`: recompose these existing commits instead of
 *  (or in addition to) working changes. `shas` are child-first (HEAD-first), a contiguous
 *  first-parent range ending at HEAD. Absent = plain working-changes compose. */
export interface GraphComposeScopeSeed {
	/** Covering commit range ending at HEAD, child-first (HEAD-first); the final element is the
	 *  range-base boundary commit (its first parent is the rewrite base). May include merge and
	 *  side-branch commits. */
	shas: string[];
	includeWip: boolean;
}

/** Target branch for a `scope-to-branch` action. When present, the webview focuses (scopes) the
 *  graph to this branch instead of the current branch — used by the Focus on Branch/Worktree
 *  context-menu commands. */
export interface GraphScopeBranch {
	branchName: string;
	upstreamName?: string;
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
	/** True when running in a web/virtual environment (e.g. vscode.dev), where the no-repo empty state
	 *  offers "Open Remote Repository" instead of clone/init. Sourced from `isWeb` (`@env/platform`). */
	isWeb?: boolean;
	repositories?: GraphRepository[];
	/** Absolute fsPaths of every worktree in the current repo's family (the main checkout plus
	 *  every secondary worktree), sourced from the loaded graph. A reusable registry for any
	 *  webview consumer that needs to map an absolute path to its worktree root — e.g. the Agent
	 *  Activity treemap resolves agent file activity to repo-relative keys against these. */
	worktreePaths?: string[];
	/** Names of the branches checked out in sibling worktrees (every worktree in this repo's family except
	 *  the one the graph is scoped to). Intersecting these with a row's reachability refs answers "is this
	 *  commit reachable from another worktree" with no git at all — see `DetailsActions.fetchDetails`. */
	worktreeBranches?: string[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	branchesVisibility?: GraphBranchesVisibility;
	branch?: GitBranchReference;
	branchState?: BranchState;
	lastFetched?: Date;
	selectedRows?: GraphSelectedRows;
	subscription?: Subscription;
	allowed: boolean;
	/** True when the workspace has both public and private repos, so a gated (private) repo can offer
	 *  switching to a public one. Independent of `allowed` — the gate only surfaces it when shown. */
	allowRepoSwitch?: boolean;
	avatars?: GraphAvatars;
	loading?: boolean;
	refsMetadata?: GraphRefsMetadata | null;
	rows?: GitGraphRow[];
	rowsStats?: Record<string, GraphRowStats>;
	rowsStatsLoading?: boolean;
	/** Mirrors the host's `_graph.includes.stats` — true when the current graph build requested stats.
	 *  Used by the webview to decide whether entering Timeline mode needs to eagerly show its loading
	 *  overlay (stale `rowsStats` from a prior stats-bearing build can otherwise mask a missing refetch). */
	rowsStatsIncluded?: boolean;
	/** Per-graph reachability encoding (shared ref dictionary + distinct membership bitmaps); rows
	 *  carry an index into `sets` via `contexts.reachabilityIndex`. Replaces the per-row `reachability`
	 *  object that dominated the graph payload. */
	reachabilityTable?: GraphReachabilityTable;
	downstreams?: GraphDownstreams;
	paging?: GraphPaging;
	/**
	 * Rows-plane sync baseline stamp from the publisher (R1). Carried on the bootstrap/full-state push
	 * so the webview can initialize its `{generation, seq}` baseline for subsequent
	 * {@link DidChangeRowsNotification} deltas. The rows themselves always travel via the publisher's
	 * channel, not this `State`. Consumed by R1c; ignored by the current reducer.
	 */
	sync?: GraphRowsSyncStamp;
	columns?: GraphColumnsSettings;
	/** See {@link DidChangeColumnsParams.columnsRevision} — bootstrap carries it too. */
	columnsRevision?: number;
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
	/** Show the one-time layout-choice prompt (view host only, until `graph:layoutPrompt` is dismissed) */
	layoutPromptNeeded?: boolean;

	// Persisted UI state (from `graph:state` workspace memento)
	displayMode?: GraphDisplayMode;
	details?: {
		visible?: boolean;
		position?: number;
		bottomPosition?: number;
		/** `true` = the (bottom-docked) details panel fills the graph area; restores to `bottomPosition`. */
		maximized?: boolean;
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
	pendingAction?: {
		action: GraphShowAction;
		target?: GraphActionTarget;
		commitMessage?: string;
		scopeBranch?: GraphScopeBranch;
		composeInstructions?: string;
		composeScope?: GraphComposeScopeSeed;
	};
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
	/** Host-only: the worktree HEAD commit date (epoch ms). Used by the WIP bar to order pills by
	 *  recency (descending). Derived from `GitWorktree.date` — no extra git work. */
	parentDate?: number;
	/**
	 * Host-only: cheap clean/dirty probe (`status.hasWorkingChanges()`) so the WIP bar can surface a
	 * dirty worktree before its `workDirStats` are fetched. Set ONLY on the graph-load build and
	 * preserved client-side via `mergeWipMetadata`; omitted on per-tick pushes to avoid re-statting
	 * every worktree on each FS event — so the dirty bit is only as fresh as the last graph load.
	 * Ignored once `workDirStats` is present (clean/dirty derives from it directly).
	 */
	hasChanges?: boolean;
	/**
	 * Host-only: count of commits ahead of the worktree branch's upstream (unpushed). Free — read from
	 * `branch.upstream.state.ahead` (the for-each-ref the worktree enumeration already runs), so it's
	 * sent on every build and not preserved by `mergeWipMetadata`. `undefined` for local-only branches
	 * (no upstream) — those use `hasUnpushed` instead. Consumed by the WIP bar for the hover count only.
	 */
	ahead?: number;
	/**
	 * Host-only: whether this worktree has unpushed commits — drives the WIP bar's `↑` indicator.
	 * For TRACKED branches it's `ahead > 0` (free, every build). For LOCAL-ONLY branches it's a cheap
	 * `rev-list --not --remotes` probe set ONLY on the graph-load build (and only when the repo has
	 * remotes) and preserved client-side via `mergeWipMetadata`, like `hasChanges`.
	 */
	hasUnpushed?: boolean;
	/** Host-only: user-visible suffix for the row message (e.g. worktree name). */
	label: string;
	/**
	 * Host-only: the worktree branch in scope ref-id format (`{repoPath}|heads/{name}`), or undefined
	 * for detached worktrees. Used by the webview's scope filter to drop secondary WIPs whose branch
	 * isn't part of the active scope — independent of SHA collisions with scope anchors.
	 */
	branchRef?: string;
	/**
	 * Host-only: the worktree's branch in overview form, keyed by `branchRef`. Pure sync projection of
	 * the `GitBranch` the worktree enumeration already loaded — no extra git work.
	 *
	 * Exists because a worktree branch only lands in `state.overview` when the worktree is `opened` or
	 * its last commit is recent (see `getBranchOverviewType`), so a dirty worktree on an older branch
	 * has no `OverviewBranch` to hover. The WIP bar passes this to `<gl-branch-hover>` as a fallback.
	 * Undefined for detached worktrees (no `wt.branch`) — those get a degraded hover.
	 */
	branch?: OverviewBranch;
	/**
	 * Host-only: paused operation (rebase/merge/cherry-pick) running in this worktree, when any.
	 * Mirrors the primary's `workingTreeStats.pausedOpStatus` so the secondary WIP row can render
	 * the same indicator the action bar does. Not consumed by the GK component.
	 */
	pausedOpStatus?: GitPausedOperationStatus;
	/**
	 * Host-only: whether this worktree's working tree has merge/rebase conflicts. Fetched lazily with
	 * the rest of the secondary's stats (on-demand, for visible rows) and preserved client-side, like
	 * `pausedOpStatus`. Drives the `+hasConflicts` segment of the WIP row's `gitlens:wip` context so the
	 * Resolve Conflicts menu item only appears when there's something to resolve.
	 */
	hasConflicts?: boolean;
}

export type GraphWipMetadataBySha = Record<string, GraphWipNodeMetadata>;

export interface GraphPaging {
	startingCursor?: string;
	hasMore: boolean;
}

/** Rows splice-delta for a rebuild push — see {@link DidChangeRowsParams.rowsSplice}. */
export interface GraphRowsSplice {
	/** Rows above the reused span (the changed region; may be empty). */
	head: GitGraphRow[];
	/** Index into the webview's CURRENT rows where the reused span starts. */
	reusedStart: number;
	reusedCount: number;
	/** Rows below the reused span (a grown bottom; usually absent). */
	tail?: GitGraphRow[];
	/**
	 * Per-row patch aligned with the reused span: new `contexts.flags` / `contexts.reachabilityIndex`
	 * values — `null` = unchanged, `-1` = now absent. Excluded from the reuse fingerprint because
	 * they flip graph-wide on branch create/delete/checkout; patching keeps those events on the
	 * splice path instead of re-shipping every row.
	 */
	patch?: { flags: (number | null)[]; reachability: (number | null)[] };
	/** Guards — the webview verifies all three before splicing. */
	expectedPriorRows: number;
	firstReusedSha: string;
	lastReusedSha: string;
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
export type GraphRemote = GitGraphRowRemoteHead;
export type GraphTag = GitGraphRowTag;
export type GraphBranch = GitGraphRowHead;

export type GraphAutoFetchMode = 'off' | 'vscode' | 'gitlens';

export interface GraphComponentConfig {
	aiEnabled?: boolean;
	autoFetchEnabled?: boolean;
	autoFetchIntervalSeconds?: number;
	autoFetchMode?: GraphAutoFetchMode;
	avatars?: boolean;
	changesColumnEnabled?: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	detailsLocation?: 'auto' | 'right' | 'bottom';
	detailsMaximizeOnMode?: boolean;
	dimMergeCommits?: boolean;
	enabledRefMetadataTypes?: GraphRefMetadataType[];
	experimentalHomeHeaderEnabled?: boolean;
	experimentalKanbanEnabled?: boolean;
	experimentalVisualizationsEnabled?: boolean;
	/** Raw setting value for the Activity-mode treemap decay window — drives the picker selection. */
	activityDecay?: GraphActivityDecay;
	/** Resolved decay window (ms) for the Activity-mode treemap heatmap. Drives how long a file's
	 *  read/edit heat fades after the last tool call. Resolved host-side from `activityDecay` so
	 *  the renderer doesn't need its own string→ms helper. */
	activityDecayMs?: number;
	/**
	 * When true, the graph webview renders using the experimental `@gitkraken/commit-graph`
	 * engine (vendored from commit-graph) instead of `@gitkraken/gitkraken-components`.
	 *
	 * Backed by the user setting `gitlens.graph.experimental.useNewEngine`.
	 */
	useNewEngine?: boolean;
	highlightRowsOnRefHover?: boolean;
	idLength?: number;
	/**
	 * Whether lane folding is available at all in the new (commit-graph) graph engine. When off there is
	 * no fold strip and no chevrons, every lane stays expanded, and both {@link lanesFoldingDefault} and
	 * manual folds are ignored.
	 *
	 * Backed by the user setting `gitlens.graph.lanes.folding.enabled`.
	 */
	lanesFoldingEnabled?: boolean;
	/**
	 * Which lanes are folded by default in the new (commit-graph) graph engine. `'none'` keeps every
	 * lane expanded on load; `'all'` folds every foldable lane segment into a chip; `'auto'` folds lanes
	 * whose tip is reachable from HEAD via first-parent only ("merged & done"). The segment containing
	 * HEAD is never auto-folded.
	 *
	 * Backed by the user setting `gitlens.graph.lanes.folding.default`. Manual folds during a session
	 * override this default per-segment until the webview is reloaded. Ignored when
	 * {@link lanesFoldingEnabled} is off.
	 */
	lanesFoldingDefault?: 'none' | 'all' | 'auto';
	/**
	 * Lane spacing density in the new (commit-graph) graph engine. `'expanded'` leaves a clear
	 * gap between lanes; `'compact'` packs them tightly together.
	 *
	 * Backed by the user setting `gitlens.graph.lanes.density`.
	 */
	lanesDensity?: 'expanded' | 'compact';
	/**
	 * Minimum number of lanes shown inline when the graph is grouped into another column (new engine) —
	 * always shown when the graph has that many, however narrow the view.
	 *
	 * Backed by the user setting `gitlens.graph.lanes.grouped.min`.
	 */
	lanesGroupedMin?: number;
	/**
	 * Maximum share of the row's width (percent) the inline lanes may take when the graph is grouped into
	 * another column (new engine) — wider views show more lanes automatically; a row that fans out past
	 * the resulting cap clips to it (extra lanes collapse to the edge). `lanesGroupedMin` wins when it
	 * needs more room than this allows.
	 *
	 * Backed by the user setting `gitlens.graph.lanes.grouped.max`.
	 */
	lanesGroupedMax?: number;
	minimap?: boolean;
	minimapDataType?: Config['graph']['minimap']['dataType'];
	minimapMarkerTypes?: GraphMinimapMarkerTypes[];
	minimapReversed?: boolean;
	multiSelectionMode?: GraphMultiSelectionMode;
	onlyFollowFirstParent?: boolean;
	scrollMarkerTypes?: GraphScrollMarkerTypes[];
	scrollRowPadding?: number;
	searchAutocompleteOnFocus?: boolean;
	showGhostRefsOnRowHover?: boolean;
	showRemoteNamesOnRefs?: boolean;
	showWorktreeWipStats?: boolean;
	sidebar: boolean;
	sidebarPinned?: boolean;
	stickyTimeline?: boolean;
	/**
	 * Graph style (row layout) in the new (commit-graph) graph engine. `'table'` uses the single-line
	 * column layout; `'list'` uses the stacked 2-line layout; `'auto'` (default) switches to `'list'`
	 * automatically when the panel is too narrow for the columns.
	 *
	 * Backed by the user setting `gitlens.graph.style`.
	 */
	style?: GraphStyle;
	timelineSeparators?: boolean;
}

export interface GraphColumnConfig {
	isHidden?: boolean;
	mode?: string;
	width?: number;
	order?: number;
	/** Column↔grouped placement. `graph`: `true` (legacy) or host zone id = grouped. `ref`: host zone id = grouped, `false` = column. */
	grouped?: boolean | string;
}

export type GraphColumnsConfig = Record<string, GraphColumnConfig>;

export type GraphExcludeRefs = ExcludeRefsById;
export type GraphExcludedRef = GraphRefOptData;
export type GraphExcludeTypes = ExcludeByType;
export type GraphIncludeOnlyRefs = IncludeOnlyRefsById;
export type GraphIncludeOnlyRef = GraphRefOptData;
export type GraphPinnedRef = GraphRefOptData & { sha?: string };

export type GraphColumnName = GraphZoneType;
export type GraphRowStats = GitGraphRowStats;

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

export interface ProxyAvatarsParams {
	avatars: Record</*email*/ string, /*url*/ string>;
}
export const ProxyAvatarsCommand = new IpcCommand<ProxyAvatarsParams>(scope, 'avatars/proxy');

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

export interface GraphSyncResyncParams {
	/** The generation the webview currently holds (for logging/diagnostics). */
	generation: number;
	/** The last seq the webview applied (for logging/diagnostics). */
	seq: number;
}
/** The rows-plane publisher's single recovery request (R1): on a seq gap, guard mismatch, dropped
 *  message, or reconnect (sync-hello), the webview reports its held baseline and the host answers with
 *  a fresh snapshot when the webview is behind (no-ops when already in sync). */
export const GraphSyncResyncCommand = new IpcCommand<GraphSyncResyncParams>(scope, 'sync/resync');

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

export type RowAction = RowActionParams['action'];

interface RowActionRowRef {
	id: string;
	type: GitGraphRowType;
}

/** Discriminated union — action-specific fields are only structurally present on their case so the
 *  compiler catches accidental cross-action leakage (e.g. shipping `worktreePath` on a stash action). */
export type RowActionParams =
	| { action: 'open-changes' | 'open-changes-with-working'; row: RowActionRowRef }
	| { action: 'push-to-commit'; row: RowActionRowRef }
	| { action: 'stash-apply' | 'stash-drop' | 'stash-pop' | 'stash-save'; row: RowActionRowRef }
	| {
			action: 'undo-commit';
			row: RowActionRowRef;
			/** Worktree path the action targets. Omit for the active worktree. */
			worktreePath?: string;
	  };
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
	/** Monotonic per-webview-session write counter; echoed back as `columnsRevision` so the webview can
	 * order pushes against its own writes (see `DidChangeColumnsParams.columnsRevision`). */
	revision?: number;
}
export const UpdateColumnsCommand = new IpcCommand<UpdateColumnsParams>(scope, 'columns/update');

export interface UpdateColumnModeParams {
	name: GraphColumnName;
	mode: string | undefined;
}
// Dedicated column-mode write: kept separate from `UpdateColumnsCommand` (which ignores echoed `mode` —
// it's host-authoritative) so the Changes mode picker's pick reaches the host's `setColumnMode` directly.
export const UpdateColumnModeCommand = new IpcCommand<UpdateColumnModeParams>(scope, 'columns/mode/update');

// One-time consent write for the Changes column's stats computation (`graph.changesColumn.enabled`).
export const EnableChangesColumnCommand = new IpcCommand(scope, 'columns/changes/enable');

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
	hasConflicts?: boolean;
}
export type GetWipStatsResponse = Record<string, WipRowStats | undefined>;
export const GetWipStatsRequest = new IpcRequest<GetWipStatsParams, GetWipStatsResponse>(scope, 'wip/stats/get');

export interface GetWipLineStatsParams {
	repoPath: string;
}
/** Per-file working-tree line stats keyed by repo-relative (normalized) path. Fetched lazily via a
 *  single `git diff HEAD --numstat` (incl. untracked) only while the WIP file list is shown — the
 *  every-tick `wip` push carries file status only, never line counts (`git status` can't emit them). */
export type GetWipLineStatsResponse = Record<string, { additions: number; deletions: number }>;
export const GetWipLineStatsRequest = new IpcRequest<GetWipLineStatsParams, GetWipLineStatsResponse | undefined>(
	scope,
	'wip/lineStats/get',
);

export interface SyncWipWatchesParams {
	/** Full set of currently-visible secondary WIP shas. Host diffs against its subscription set. */
	shas: string[];
}
export const SyncWipWatchesCommand = new IpcCommand<SyncWipWatchesParams>(scope, 'wip/watches/sync');

export interface DidRequestWipRefetchParams {
	/** Repo path of the WIP that should be re-fetched. */
	repoPath: string;
	/** Pre-fetched WIP payload — same shape as `DidChangeWorkingTreeNotification`'s `wip`. The
	 *  panel applies this directly so the round-trip `getWip` RPC is avoided. The working-tree
	 *  stats travel embedded as `wip.stats`, so no sibling `stats` field is needed. */
	wip?: Wip;
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
	context?: GraphItemRefContext<GraphBranchContextValue> & GraphSidebarItemOrigin;
}

export interface GraphSidebarRemoteBranch {
	name: string;
	sha?: string;
	context?: GraphItemRefContext<GraphBranchContextValue> & GraphSidebarItemOrigin;
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
	context?: GraphItemTypedContext<GraphRemoteContextValue> & GraphSidebarItemOrigin;
}

export interface GraphSidebarStash {
	name: string;
	sha: string;
	message: string;
	date?: number;
	stashNumber: string;
	stashOnRef?: string;
	context?: GraphItemRefContext<GraphStashContextValue> & GraphSidebarItemOrigin;
}

export interface GraphSidebarTag {
	name: string;
	sha?: string;
	message?: string;
	annotated: boolean;
	date?: number;
	context?: GraphItemRefContext<GraphTagContextValue> & GraphSidebarItemOrigin;
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
	context?:
		| (GraphItemRefContext<GraphBranchContextValue> & GraphSidebarItemOrigin)
		| (GraphItemRefContext<GraphCommitContextValue> & GraphSidebarItemOrigin);
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
	/** A results/coverage REFRESH riding a rows-plane emission — NOT search progress. The app must not
	 *  derive `searching` from it (an active progressive search's spinner would flicker off, and
	 *  jump-to-last could skip its wait-for-complete on a partial result set). */
	rider?: boolean;
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

/** The user's answer to the one-time layout prompt: move the Graph view to the side bar
 *  (vertical), keep/move it to the bottom panel (full width), or close without choosing. */
export interface ChooseGraphLayoutParams {
	choice: 'sidebar' | 'panel' | 'dismissed';
}
export const ChooseGraphLayoutCommand = new IpcCommand<ChooseGraphLayoutParams>(scope, 'layoutPrompt/choose');

/** Pushed when the `graph:layoutPrompt` onboarding state changes (e.g. dismissed in another window) */
export const DidChangeLayoutPromptNotification = new IpcNotification<boolean>(scope, 'layoutPrompt/didChange');

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
	/** For `scope-to-branch`: the branch to focus the graph on. Absent = focus the current branch. */
	scopeBranch?: GraphScopeBranch;
	/** For 'enter-compose': seeds the compose panel's AI-instructions input (parity with the standalone composer's autoComposeInstructions — seed only, no auto-run). */
	composeInstructions?: string;
	/** For 'enter-compose': resolved commit-range seed; absent = working-changes compose. */
	composeScope?: GraphComposeScopeSeed;
}
export const DidRequestGraphActionNotification = new IpcNotification<DidRequestGraphActionParams>(
	scope,
	'action/didRequest',
);

export const TrackGraphOverviewShownCommand = new IpcCommand(scope, 'track/overview/shown');
export const TrackGraphScopeChangedCommand = new IpcCommand(scope, 'track/scope/changed');
export const TrackGraphDetailsReviewModeCommand = new IpcCommand(scope, 'track/details/reviewMode');
export const TrackGraphDetailsComposeModeCommand = new IpcCommand(scope, 'track/details/composeMode');
export const TrackGraphDetailsResolveModeCommand = new IpcCommand(scope, 'track/details/resolveMode');
export const TrackGraphDetailsCompareModeCommand = new IpcCommand(scope, 'track/details/compareMode');
export const TrackGraphDetailsWipShownCommand = new IpcCommand(scope, 'track/details/wipShown');

export interface DidChangeBranchStateParams {
	branchState: BranchState;
}
export const DidChangeBranchStateNotification = new IpcNotification<DidChangeBranchStateParams>(
	scope,
	'branchState/didChange',
);

export interface DidChangeColumnsParams {
	columns: GraphColumnsSettings | undefined;
	/** The latest webview columns-write revision this push reflects (commands are processed serially).
	 * The webview drops pushes whose revision trails its own write counter — they were generated before
	 * an in-flight local change and would otherwise revert it (early-load grouping "reset/jump"). */
	columnsRevision?: number;
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
	rows: GitGraphRow[];
	/**
	 * Splice-delta alternative for a cursor-less (wholesale REPLACE) push. When present, `rows` is empty
	 * and the webview reconstructs from the rows it already holds (falling back to a
	 * {@link GraphSyncResyncCommand} on a guard mismatch). See {@link GraphRowsSplice}.
	 */
	rowsSplice?: GraphRowsSplice;
	/** Undefined when the backing `avatars` Map's size hasn't changed since the last notification —
	 *  the host skips the `Object.fromEntries` cost and the frontend reducer keeps its existing
	 *  state. Present (full Map) when new avatar entries were added. */
	avatars: Record<string, string> | undefined;
	/** Shipped on rows-bearing pushes (rebuild / page-append) and snapshots; ABSENT on enrichment-only
	 *  ticks (the provider mutates downstream arrays in place, so size-based dedupe would miss
	 *  array-mutation cases — re-shipping the full map every tick is pure waste). Absent = keep prior;
	 *  present = wholesale-replace. */
	downstreams?: Record<string, string[]>;
	paging?: GraphPaging;
	refsMetadata?: GraphRefsMetadata | null;
	/** When true, the payload's `refsMetadata` is an authoritative REPLACE (full map / `null` when off),
	 *  not a spread-merge delta — a repo-level enable/disable the delta channel can't express. Set by
	 *  {@link GraphSyncPublisher.markRefsMetadataReset}. */
	refsMetadataReset?: boolean;
	/** Delta of `rowsStats` entries added since the last notification. The frontend reducer
	 *  spread-merges into its existing state, so shipping only new keys is sufficient and avoids
	 *  the N² IPC payload on pagination of big repos. Undefined when no new entries. */
	rowsStats?: Record<string, GraphRowStats>;
	rowsStatsLoading: boolean;
	rowsStatsIncluded?: boolean;
	/** Per-graph reachability encoding for the rows in this payload (see {@link State.reachabilityTable}). */
	reachabilityTable?: GraphReachabilityTable;
	search?: DidSearchParams;
	selectedRows?: GraphSelectedRows;
	/**
	 * Sequencing stamp from the rows-plane publisher (R1). Present once the publisher owns this channel:
	 * the webview applies a delta iff `generation === current && seq === lastApplied + 1`, drops
	 * stale-generation messages, and rebases both on a `snapshot`. Optional during the migration.
	 */
	sync?: GraphRowsSyncStamp;
}
export interface GraphRowsSyncStamp {
	/** Bumps on graph identity change (repo swap / graph clear); stale-generation messages are dropped. */
	generation: number;
	/** Monotone per generation; a snapshot rebases the webview's baseline to this value. */
	seq: number;
	/** When true this payload is a full authoritative snapshot (rows-plane reset), not a delta. */
	snapshot?: boolean;
}
// `queueable: false` — the rows-plane publisher owns its own recovery (a failed send forces its next
// flush to a snapshot), so controller requeue would double-apply against that snapshot.
export const DidChangeRowsNotification = new IpcNotification<DidChangeRowsParams>(
	scope,
	'rows/didChange',
	false,
	false,
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
	wipMetadataBySha?: GraphWipMetadataBySha;
	/**
	 * Primary-repo WIP, captured from a single `git status`. Lets the details panel render fresh
	 * file lists without an extra `getWip` RPC. The working-tree stats travel embedded as
	 * `wip.stats`. Omitted only when the underlying status fetch fails — callers should fall back
	 * to their existing path (resource fetch on selection) in that case.
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
// `silent` — this only carries the last-fetched time; the user isn't waiting on it, so it should never
// spin the view's progress indicator.
export const DidFetchNotification = new IpcNotification<DidFetchParams>(scope, 'didFetch', undefined, undefined, true);

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

/** Origin stamp carried by every graph SIDEBAR item context. The host's sidebar-action telemetry
 *  gate keys on it — the same `webviewItem` types (and commands) are also produced by graph-canvas
 *  ref pills and the WIP header kebab, which must NOT count as sidebar actions. */
export const sidebarItemOrigin = 'sidebar';
/** Runtime rewrite applied by the host (`onSidebarAction`) to INLINE (hover-icon) invocations so
 *  the context-menu telemetry gate skips them (the webview already emitted `location: 'inline'`).
 *  Never present in serialized protocol data — sidebar contexts always serialize with
 *  {@link sidebarItemOrigin}; this value exists only on the host-side parsed copy. */
export const sidebarInlineItemOrigin = 'sidebar-inline';
/** Makes the origin stamp REQUIRED on sidebar item context types, so a new sidebar builder that
 *  forgets to stamp fails to compile instead of silently dropping out of sidebar telemetry. */
export type GraphSidebarItemOrigin = { webviewItemOrigin: typeof sidebarItemOrigin };

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
	/** The worktree's filesystem path. Set for a WIP row, and for a commit row that is the HEAD of a
	 *  non-active worktree (the `+worktreeHEAD` Undo-Commit routing target). `ref.repoPath` stays the
	 *  primary repo so other commands don't retarget; `_undoCommit` reads this to route to the worktree. */
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
