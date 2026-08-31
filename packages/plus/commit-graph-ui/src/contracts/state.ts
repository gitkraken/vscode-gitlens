import type { ChangesColumnMode } from '@gitkraken/commit-graph/stats.js';
import type { ColumnId, ColumnMode, GraphColumnMode, GraphStyle } from '@gitkraken/commit-graph/view.js';
import type { CommitGraphHostingServiceType, CommitGraphRowStats } from './rows.js';

export type GraphColumnName = ColumnId;
export type GraphAvatars = Record<string, string>;
export type GraphSelectedRows = Record<string, true>;
export type GraphDownstreams = Record<string, string[]>;
export type GraphSearchMode = 'normal' | 'filter';
export type GraphRevealMode = 'always' | 'if-changed';
export type GraphRowStats = CommitGraphRowStats;

export type GraphScrollMarkerTypes =
	| 'selection'
	| 'head'
	| 'highlights'
	| 'localBranches'
	| 'mergeTarget'
	| 'pinned'
	| 'pullRequests'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'upstream'
	| 'wip';

export interface GraphColumnSetting<TMode extends ColumnMode = ColumnMode> {
	width: number;
	isFilterable?: boolean;
	isHidden: boolean;
	mode?: TMode;
	order?: number;
	grouped?: boolean | string;
}

export type GraphColumnsSettings = {
	ref: GraphColumnSetting<never>;
	graph: GraphColumnSetting<GraphColumnMode>;
	message: GraphColumnSetting<never>;
	author: GraphColumnSetting<never>;
	changes: GraphColumnSetting<ChangesColumnMode>;
	datetime: GraphColumnSetting<never>;
	sha: GraphColumnSetting<never>;
};

export interface GraphColumnConfig {
	isHidden?: boolean;
	mode?: ColumnMode;
	width?: number;
	order?: number;
	grouped?: boolean | string;
}

export type GraphColumnsConfig = Record<string, GraphColumnConfig>;

export interface GraphComponentConfig {
	avatars?: boolean;
	dateFormat: string;
	dateStyle: 'absolute' | 'relative';
	dimMergeCommits?: boolean;
	idLength?: number;
	lanesFoldingEnabled?: boolean;
	lanesFoldingDefault?: 'none' | 'all' | 'auto';
	lanesDensity?: 'expanded' | 'compact';
	lanesGroupedMin?: number;
	lanesGroupedMax?: number;
	maxInlineRefs?: number | 'auto';
	maxStackedRefs?: number | 'auto';
	multiSelectionMode?: boolean | 'topological';
	refsLayout?: 'inline' | 'stacked';
	scrollMarkerTypes?: GraphScrollMarkerTypes[];
	scrollRowPadding?: number;
	showGhostRefsOnRowHover?: boolean;
	showRemoteNamesOnRefs?: boolean;
	stickyTimeline?: boolean;
	style?: GraphStyle;
	timelineSeparators?: boolean;
}

export type GraphRefType = 'head' | 'remote' | 'tag' | 'worktree';

export interface GraphRefOptData {
	id: string;
	name: string;
	type: GraphRefType;
	owner?: string;
	providerIcon?: string;
	except?: string[];
}

export interface GraphExcludeTypes {
	heads?: boolean;
	remotes?: boolean;
	stashes?: boolean;
	tags?: boolean;
}

export type GraphExcludeRefs = Record<string, GraphRefOptData>;
export type GraphIncludeOnlyRefs = Record<string, GraphRefOptData>;
export type GraphPinnedRef = GraphRefOptData & { sha?: string };

/** Opaque product/provider identifier; the renderer only uses it to select known optional glyphs. */
export type GraphIssueTrackerType = string;

export interface PullRequestMetadata {
	context?: string | object;
	hostingServiceType: CommitGraphHostingServiceType;
	id: number;
	title: string;
	author?: string;
	date?: number;
	state?: string;
	isDraft?: boolean;
	url?: string;
	stack?: { number: number; position: number; size: number };
}

export interface UpstreamMetadata {
	context?: string | object;
	name: string;
	owner: string;
	ahead: number;
	behind: number;
	sha?: string;
	missing?: boolean;
}

export interface IssueMetadata {
	context?: string | object;
	displayId: string;
	id: string;
	issueTrackerType: GraphIssueTrackerType;
	title: string;
}

export interface GraphRefMetadata {
	pullRequest?: PullRequestMetadata[] | null;
	upstream?: UpstreamMetadata | null;
	issue?: IssueMetadata[] | null;
}

export type GraphRefMetadataType = keyof GraphRefMetadata;
export type GraphRefsMetadata = Record<string, GraphRefMetadata | null>;
export type GraphRefMetadataItem =
	| { refId: string; type: 'pullRequest'; data: PullRequestMetadata }
	| { refId: string; type: 'upstream'; data: UpstreamMetadata }
	| { refId: string; type: 'issue'; data: IssueMetadata };
export type GraphMissingRefsMetadata = Record<string, GraphRefMetadataType[]>;

export interface GraphSearchResultData {
	readonly date: number;
	readonly i: number;
	readonly files?: ReadonlyArray<Readonly<{ readonly path: string }>>;
}

export interface GraphSearchResults {
	ids?: Record<string, GraphSearchResultData>;
	count: number;
	hasMore: boolean;
}

export interface GraphSearchResultsError {
	error: string;
	reason?: 'invalidPattern' | 'invalidRef' | 'aiUnavailable';
	detail?: string;
}

export interface GraphScope {
	branchName: string;
	branchRef: string;
	origin?: { kind: 'pullRequest'; number: string } | { kind: 'stack'; number: number; size: number };
	upstreamRef?: string;
	focalBranchTipSha?: string;
	mergeTargetTipSha?: string;
	mergeBase?: { sha: string; date: number };
	additionalBranchRefs?: string[];
}

export interface CommitGraphPausedOperationStatus {
	type: 'cherry-pick' | 'merge' | 'rebase' | 'revert';
	steps?: { current: { number: number; commit?: unknown }; total: number };
	isPaused?: boolean;
	isInteractive?: boolean;
}

export interface WorkDirStats {
	added: number;
	deleted: number;
	modified: number;
	renamed?: number;
}

export interface GraphWipState {
	workDirStats?: WorkDirStats;
	workDirStatsStale?: boolean;
	hasChanges?: boolean;
	ahead?: number;
	hasUnpushed?: boolean;
	hasConflicts?: boolean;
	conflictsCount?: number;
	pausedOpStatus?: CommitGraphPausedOperationStatus;
}

export type GraphWipStateById = Record<string, GraphWipState>;
