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
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitTrackingState } from '../../../git/models/branch';
import type { GitGraphRowType } from '../../../git/models/graph';
import type { PullRequestRefs } from '../../../git/models/pullRequest';
import type {
	GitBranchReference,
	GitReference,
	GitRevisionReference,
	GitStashReference,
	GitTagReference,
} from '../../../git/models/reference';
import type { ProviderReference } from '../../../git/models/remoteProvider';
import type { GitSearchResultData, SearchQuery } from '../../../git/search';
import type { DateTimeFormat } from '../../../system/date';
import type { WebviewItemContext, WebviewItemGroupContext } from '../../../system/webview';
import type { IpcScope, WebviewState } from '../../../webviews/protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../../../webviews/protocol';
import type { Subscription } from '../../gk/account/subscription';

export type { GraphRefType } from '@gitkraken/gitkraken-components';

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

export interface State extends WebviewState {
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
	type?: IpcNotification<any> | InternalNotificationType,
	themingChanged?: boolean,
) => void;

// COMMANDS

export const ChooseRepositoryCommand = new IpcCommand(scope, 'chooseRepository');

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
export const DoubleClickedCommandType = new IpcCommand<DoubleClickedParams>(scope, 'dblclick');

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
}
export const GetMoreRowsCommand = new IpcCommand<GetMoreRowsParams>(scope, 'rows/get');

export interface SearchOpenInViewParams {
	search: SearchQuery;
}
export const SearchOpenInViewCommand = new IpcCommand<SearchOpenInViewParams>(scope, 'search/openInView');

export interface UpdateColumnsParams {
	config: GraphColumnsConfig;
}
export const UpdateColumnsCommand = new IpcCommand<UpdateColumnsParams>(scope, 'columns/update');

export interface UpdateDimMergeCommitsParams {
	dim: boolean;
}
export const UpdateDimMergeCommitsCommand = new IpcCommand<UpdateDimMergeCommitsParams>(scope, 'dimMergeCommits');

export interface UpdateRefsVisibilityParams {
	refs: GraphExcludedRef[];
	visible: boolean;
}
export const UpdateRefsVisibilityCommand = new IpcCommand<UpdateRefsVisibilityParams>(scope, 'refs/update/visibility');

export interface UpdateExcludeTypeParams {
	key: keyof GraphExcludeTypes;
	value: boolean;
}
export const UpdateExcludeTypeCommand = new IpcCommand<UpdateExcludeTypeParams>(scope, 'fitlers/update/excludeType');

export interface UpdateGraphConfigurationParams {
	changes: { [key in keyof GraphComponentConfig]?: GraphComponentConfig[key] };
}
export const UpdateGraphConfigurationCommand = new IpcCommand<UpdateGraphConfigurationParams>(
	scope,
	'configuration/update',
);

export interface UpdateIncludeOnlyRefsParams {
	refs?: GraphIncludeOnlyRef[];
}
export const UpdateIncludeOnlyRefsCommand = new IpcCommand<UpdateIncludeOnlyRefsParams>(
	scope,
	'fitlers/update/includeOnlyRefs',
);

export interface UpdateSelectionParams {
	selection: { id: string; type: GitGraphRowType }[];
}
export const UpdateSelectionCommand = new IpcCommand<UpdateSelectionParams>(scope, 'selection/update');

// REQUESTS

export interface EnsureRowParams {
	id: string;
	select?: boolean;
}
export interface DidEnsureRowParams {
	id?: string; // `undefined` if the row was not found
	remapped?: string;
}
export const EnsureRowRequest = new IpcRequest<EnsureRowParams, DidEnsureRowParams>(scope, 'rows/ensure');

export interface SearchParams {
	search?: SearchQuery;
	limit?: number;
	more?: boolean;
}
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
export const SearchRequest = new IpcRequest<SearchParams, DidSearchParams>(scope, 'search');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true, true);

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

export interface DidChangeAvatarsParams {
	avatars: GraphAvatars;
}
export const DidChangeAvatarsNotification = new IpcNotification<DidChangeAvatarsParams>(scope, 'avatars/didChange');

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
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
}
export const DidChangeRefsVisibilityNotification = new IpcNotification<DidChangeRefsVisibilityParams>(
	scope,
	'refs/didChangeVisibility',
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
export const DidChangeRowsNotification = new IpcNotification<DidChangeRowsParams>(
	scope,
	'rows/didChange',
	undefined,
	true,
);

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

export interface DidChangeWorkingTreeParams {
	stats: WorkDirStats;
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
	repoPath: string;
	refs?: PullRequestRefs;
	provider: ProviderReference;
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
