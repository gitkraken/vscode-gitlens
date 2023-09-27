import type {
	CssVariables,
	ExcludeByType,
	ExcludeRefsById,
	GraphColumnSetting,
	GraphContexts,
	GraphRef,
	GraphRefOptData,
	GraphRow,
	GraphZoneType,
	Head,
	HostingServiceType,
	IncludeOnlyRefsById,
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
import type { Config, DateStyle } from '../../../config';
import type { WebviewIds, WebviewViewIds } from '../../../constants';
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitTrackingState } from '../../../git/models/branch';
import type { GitGraphRowType } from '../../../git/models/graph';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference';
import type { GitSearchResultData, SearchQuery } from '../../../git/search';
import type { Subscription } from '../../../subscription';
import type { DateTimeFormat } from '../../../system/date';
import type { WebviewItemContext, WebviewItemGroupContext } from '../../../system/webview';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export type { GraphRefType } from '@gitkraken/gitkraken-components';

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

export type GraphScrollMarkerTypes =
	| 'selection'
	| 'head'
	| 'highlights'
	| 'localBranches'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'upstream';

export type GraphMinimapMarkerTypes =
	| 'selection'
	| 'head'
	| 'highlights'
	| 'localBranches'
	| 'remoteBranches'
	| 'stashes'
	| 'tags'
	| 'upstream';

export const supportedRefMetadataTypes: GraphRefMetadataType[] = ['upstream', 'pullRequest', 'issue'];

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;

	windowFocused?: boolean;
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	branchName?: string;
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
	downstreams?: GraphDownstreams;
	paging?: GraphPaging;
	columns?: GraphColumnsSettings;
	config?: GraphComponentConfig;
	context?: GraphContexts & { settings?: SerializedGraphItemContext };
	nonce?: string;
	workingTreeStats?: GraphWorkingTreeStats;
	searchResults?: DidSearchParams['results'];
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;

	// Props below are computed in the webview (not passed)
	activeDay?: number;
	activeRow?: string;
	visibleDays?: {
		top: number;
		bottom: number;
	};
	theming?: { cssVariables: CssVariables; themeOpacityFactor: number };
}

export interface BranchState extends GitTrackingState {
	upstream?: string;
	provider?: {
		name: string;
		icon?: string;
		url?: string;
	};
}

export type GraphWorkingTreeStats = WorkDirStats;

export interface GraphPaging {
	startingCursor?: string;
	hasMore: boolean;
}

export interface GraphRepository {
	formattedName: string;
	id: string;
	name: string;
	path: string;
	isVirtual: boolean;
}

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

export interface GraphComponentConfig {
	avatars?: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	dimMergeCommits?: boolean;
	enabledRefMetadataTypes?: GraphRefMetadataType[];
	enableMultiSelection?: boolean;
	highlightRowsOnRefHover?: boolean;
	minimap?: boolean;
	minimapDataType?: Config['graph']['minimap']['dataType'];
	minimapMarkerTypes?: GraphMinimapMarkerTypes[];
	scrollMarkerTypes?: GraphScrollMarkerTypes[];
	scrollRowPadding?: number;
	showGhostRefsOnRowHover?: boolean;
	showRemoteNamesOnRefs?: boolean;
	idLength?: number;
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

export type GraphColumnName = GraphZoneType;
export type GraphRowStats = RowStats;

export type InternalNotificationType = 'didChangeTheme';

export type UpdateStateCallback = (
	state: State,
	type?: IpcNotificationType<any> | InternalNotificationType,
	themingChanged?: boolean,
) => void;

// Commands

export const ChooseRepositoryCommandType = new IpcCommandType<undefined>('graph/chooseRepository');

export interface DimMergeCommitsParams {
	dim: boolean;
}
export const DimMergeCommitsCommandType = new IpcCommandType<DimMergeCommitsParams>('graph/dimMergeCommits');

export type DoubleClickedParams =
	| {
			type: 'ref';
			ref: GraphRef;
			metadata?: GraphRefMetadataItem;
	  }
	| {
			type: 'row';
			row: { id: string; type: GitGraphRowType };
			preserveFocus?: boolean;
	  };
export const DoubleClickedCommandType = new IpcCommandType<DoubleClickedParams>('graph/dblclick');

export interface EnsureRowParams {
	id: string;
	select?: boolean;
}
export const EnsureRowCommandType = new IpcCommandType<EnsureRowParams>('graph/rows/ensure');

export interface GetMissingAvatarsParams {
	emails: GraphAvatars;
}
export const GetMissingAvatarsCommandType = new IpcCommandType<GetMissingAvatarsParams>('graph/avatars/get');

export interface GetMissingRefsMetadataParams {
	metadata: GraphMissingRefsMetadata;
}
export const GetMissingRefsMetadataCommandType = new IpcCommandType<GetMissingRefsMetadataParams>(
	'graph/refs/metadata/get',
);

export interface GetMoreRowsParams {
	id?: string;
}
export const GetMoreRowsCommandType = new IpcCommandType<GetMoreRowsParams>('graph/rows/get');

export interface SearchParams {
	search?: SearchQuery;
	limit?: number;
	more?: boolean;
}
export const SearchCommandType = new IpcCommandType<SearchParams>('graph/search');

export interface SearchOpenInViewParams {
	search: SearchQuery;
}
export const SearchOpenInViewCommandType = new IpcCommandType<SearchOpenInViewParams>('graph/search/openInView');

export interface UpdateColumnsParams {
	config: GraphColumnsConfig;
}
export const UpdateColumnsCommandType = new IpcCommandType<UpdateColumnsParams>('graph/columns/update');

export interface UpdateRefsVisibilityParams {
	refs: GraphExcludedRef[];
	visible: boolean;
}
export const UpdateRefsVisibilityCommandType = new IpcCommandType<UpdateRefsVisibilityParams>(
	'graph/refs/update/visibility',
);

export interface UpdateExcludeTypeParams {
	key: keyof GraphExcludeTypes;
	value: boolean;
}
export const UpdateExcludeTypeCommandType = new IpcCommandType<UpdateExcludeTypeParams>(
	'graph/fitlers/update/excludeType',
);

export interface UpdateGraphConfigurationParams {
	changes: { [key in keyof GraphComponentConfig]?: GraphComponentConfig[key] };
}
export const UpdateGraphConfigurationCommandType = new IpcCommandType<UpdateGraphConfigurationParams>(
	'graph/configuration/update',
);

export interface UpdateIncludeOnlyRefsParams {
	refs?: GraphIncludeOnlyRef[];
}
export const UpdateIncludeOnlyRefsCommandType = new IpcCommandType<UpdateIncludeOnlyRefsParams>(
	'graph/fitlers/update/includeOnlyRefs',
);

export interface UpdateSelectionParams {
	selection: { id: string; type: GitGraphRowType }[];
}
export const UpdateSelectionCommandType = new IpcCommandType<UpdateSelectionParams>('graph/selection/update');

// Notifications

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('graph/didChange', true);

export interface DidChangeGraphConfigurationParams {
	config: GraphComponentConfig;
}
export const DidChangeGraphConfigurationNotificationType = new IpcNotificationType<DidChangeGraphConfigurationParams>(
	'graph/configuration/didChange',
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	allowed: boolean;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'graph/subscription/didChange',
);

export interface DidChangeAvatarsParams {
	avatars: GraphAvatars;
}
export const DidChangeAvatarsNotificationType = new IpcNotificationType<DidChangeAvatarsParams>(
	'graph/avatars/didChange',
);

export interface DidChangeRefsMetadataParams {
	metadata: GraphRefsMetadata | null | undefined;
}
export const DidChangeRefsMetadataNotificationType = new IpcNotificationType<DidChangeRefsMetadataParams>(
	'graph/refs/didChangeMetadata',
);

export interface DidChangeColumnsParams {
	columns: GraphColumnsSettings | undefined;
	context?: string;
	settingsContext?: string;
}
export const DidChangeColumnsNotificationType = new IpcNotificationType<DidChangeColumnsParams>(
	'graph/columns/didChange',
);

export interface DidChangeScrollMarkersParams {
	context?: string;
}
export const DidChangeScrollMarkersNotificationType = new IpcNotificationType<DidChangeScrollMarkersParams>(
	'graph/scrollMarkers/didChange',
);

export interface DidChangeFocusParams {
	focused: boolean;
}
export const DidChangeFocusNotificationType = new IpcNotificationType<DidChangeFocusParams>('graph/focus/didChange');

export interface DidChangeWindowFocusParams {
	focused: boolean;
}
export const DidChangeWindowFocusNotificationType = new IpcNotificationType<DidChangeWindowFocusParams>(
	'graph/window/focus/didChange',
);

export interface DidChangeRefsVisibilityParams {
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
}
export const DidChangeRefsVisibilityNotificationType = new IpcNotificationType<DidChangeRefsVisibilityParams>(
	'graph/refs/didChangeVisibility',
);

export interface DidChangeRowsParams {
	rows: GraphRow[];
	avatars: Record<string, string>;
	downstreams: Record<string, string[]>;
	paging?: GraphPaging;
	refsMetadata?: GraphRefsMetadata | null;
	rowsStats?: Record<string, GraphRowStats>;
	rowsStatsLoading: boolean;
	selectedRows?: GraphSelectedRows;
}
export const DidChangeRowsNotificationType = new IpcNotificationType<DidChangeRowsParams>('graph/rows/didChange');

export interface DidChangeRowsStatsParams {
	rowsStats: Record<string, GraphRowStats>;
	rowsStatsLoading: boolean;
}
export const DidChangeRowsStatsNotificationType = new IpcNotificationType<DidChangeRowsStatsParams>(
	'graph/rows/stats/didChange',
);

export interface DidChangeSelectionParams {
	selection: GraphSelectedRows;
}
export const DidChangeSelectionNotificationType = new IpcNotificationType<DidChangeSelectionParams>(
	'graph/selection/didChange',
);

export interface DidChangeWorkingTreeParams {
	stats: WorkDirStats;
}
export const DidChangeWorkingTreeNotificationType = new IpcNotificationType<DidChangeWorkingTreeParams>(
	'graph/workingTree/didChange',
);

export interface DidEnsureRowParams {
	id?: string; // `undefined` if the row was not found
	remapped?: string;
}
export const DidEnsureRowNotificationType = new IpcNotificationType<DidEnsureRowParams>('graph/rows/didEnsure');

export interface GraphSearchResults {
	ids?: Record<string, GitSearchResultData>;
	count: number;
	paging?: { hasMore: boolean };
}

export interface GraphSearchResultsError {
	error: string;
}

export interface DidSearchParams {
	results: GraphSearchResults | GraphSearchResultsError | undefined;
	selectedRows?: GraphSelectedRows;
}
export const DidSearchNotificationType = new IpcNotificationType<DidSearchParams>('graph/didSearch');

export interface DidFetchParams {
	lastFetched: Date;
}
export const DidFetchNotificationType = new IpcNotificationType<DidFetchParams>('graph/didFetch');

export interface ShowInCommitGraphCommandArgs {
	ref: GitReference;
	preserveFocus?: boolean;
}
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
	| GraphUpstreamStatusContextValue;

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
}

export interface GraphBranchContextValue {
	type: 'branch';
	ref: GitBranchReference;
}

export interface GraphCommitContextValue {
	type: 'commit';
	ref: GitRevisionReference;
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
