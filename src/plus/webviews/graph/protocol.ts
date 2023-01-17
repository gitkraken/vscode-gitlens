import type {
	CommitDateTimeSource,
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
	RefMetadataType,
	Remote,
	Tag,
	UpstreamMetadata,
	WorkDirStats,
} from '@gitkraken/gitkraken-components';
import type { DateStyle } from '../../../config';
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitGraphRowType } from '../../../git/models/graph';
import type { GitSearchResultData, SearchQuery } from '../../../git/search';
import type { Subscription } from '../../../subscription';
import type { DateTimeFormat } from '../../../system/date';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export type { GraphRefType } from '@gitkraken/gitkraken-components';

export type GraphColumnsSettings = Record<GraphColumnName, GraphColumnSetting>;
export type GraphSelectedRows = Record</*id*/ string, true>;
export type GraphAvatars = Record</*email*/ string, /*url*/ string>;

export type GraphRefMetadata = RefMetadata | null;
export type GraphUpstreamMetadata = UpstreamMetadata | null;
export type GraphRefsMetadata = Record</* id */ string, GraphRefMetadata>;
export type GraphHostingServiceType = HostingServiceType;
export type GraphRefMetadataType = RefMetadataType;
export type GraphMissingRefsMetadataType = RefMetadataType;
export type GraphMissingRefsMetadata = Record</*id*/ string, /*missingType*/ GraphMissingRefsMetadataType[]>;
export type GraphPullRequestMetadata = PullRequestMetadata;

export enum GraphRefMetadataTypes {
	Upstream = 'upstream',
	PullRequest = 'pullRequests',
}

export const supportedRefMetadataTypes: GraphRefMetadataType[] = Object.values(GraphRefMetadataTypes);

export type GraphCommitDateTimeSource = CommitDateTimeSource;
export enum GraphCommitDateTimeSources {
	RowEntry = 'rowEntry',
	Tooltip = 'tooltip',
}

export interface State {
	windowFocused?: boolean;
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	branchName?: string;
	lastFetched?: Date;
	selectedRows?: GraphSelectedRows;
	subscription?: Subscription;
	allowed: boolean;
	avatars?: GraphAvatars;
	loading?: boolean;
	refsMetadata?: GraphRefsMetadata | null;
	rows?: GraphRow[];
	paging?: GraphPaging;
	columns?: GraphColumnsSettings;
	config?: GraphComponentConfig;
	context?: GraphContexts;
	nonce?: string;
	trialBanner?: boolean;
	workingTreeStats?: GraphWorkingTreeStats;
	searchResults?: DidSearchParams['results'];
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
	debugging: boolean;

	// Props below are computed in the webview (not passed)
	activeRow?: string;
	theming?: { cssVariables: CssVariables; themeOpacityFactor: number };
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
	activityMinibar?: boolean;
	avatars?: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	dimMergeCommits?: boolean;
	enabledRefMetadataTypes?: GraphRefMetadataType[];
	enableMultiSelection?: boolean;
	highlightRowsOnRefHover?: boolean;
	scrollRowPadding?: number;
	showGhostRefsOnRowHover?: boolean;
	showRemoteNamesOnRefs?: boolean;
	idLength?: number;
}

export interface GraphColumnConfig {
	isHidden?: boolean;
	width?: number;
	order?: number;
}

export type GraphColumnsConfig = { [name: string]: GraphColumnConfig };

export type GraphExcludeRefs = ExcludeRefsById;
export type GraphExcludedRef = GraphRefOptData;
export type GraphExcludeTypes = ExcludeByType;
export type GraphIncludeOnlyRefs = IncludeOnlyRefsById;
export type GraphIncludeOnlyRef = GraphRefOptData;

export type GraphColumnName = GraphZoneType;

export type InternalNotificationType = 'didChangeTheme';

export interface UpdateStateCallback {
	(state: State, type?: IpcNotificationType<any> | InternalNotificationType, themingChanged?: boolean): void;
}

// Commands

export const ChooseRepositoryCommandType = new IpcCommandType<undefined>('graph/chooseRepository');

export interface DimMergeCommitsParams {
	dim: boolean;
}
export const DimMergeCommitsCommandType = new IpcCommandType<DimMergeCommitsParams>('graph/dimMergeCommits');

export interface DismissBannerParams {
	key: 'preview' | 'trial';
}
export const DismissBannerCommandType = new IpcCommandType<DismissBannerParams>('graph/dismissBanner');

export type DoubleClickedParams =
	| {
			type: 'ref';
			ref: GraphRef;
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
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('graph/didChange');

export interface DidChangeGraphConfigurationParams {
	config: GraphComponentConfig;
}
export const DidChangeGraphConfigurationNotificationType = new IpcNotificationType<DidChangeGraphConfigurationParams>(
	'graph/configuration/didChange',
	true,
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	allowed: boolean;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'graph/subscription/didChange',
	true,
);

export interface DidChangeAvatarsParams {
	avatars: GraphAvatars;
}
export const DidChangeAvatarsNotificationType = new IpcNotificationType<DidChangeAvatarsParams>(
	'graph/avatars/didChange',
	true,
);

export interface DidChangeRefsMetadataParams {
	metadata: GraphRefsMetadata | null | undefined;
}
export const DidChangeRefsMetadataNotificationType = new IpcNotificationType<DidChangeRefsMetadataParams>(
	'graph/refs/didChangeMetadata',
	true,
);

export interface DidChangeColumnsParams {
	columns: GraphColumnsSettings | undefined;
	context?: string;
}
export const DidChangeColumnsNotificationType = new IpcNotificationType<DidChangeColumnsParams>(
	'graph/columns/didChange',
	true,
);

export interface DidChangeWindowFocusParams {
	focused: boolean;
}
export const DidChangeWindowFocusNotificationType = new IpcNotificationType<DidChangeWindowFocusParams>(
	'graph/window/focus/didChange',
	true,
);

export interface DidChangeRefsVisibilityParams {
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
}
export const DidChangeRefsVisibilityNotificationType = new IpcNotificationType<DidChangeRefsVisibilityParams>(
	'graph/refs/didChangeVisibility',
	true,
);

export interface DidChangeRowsParams {
	rows: GraphRow[];
	avatars: { [email: string]: string };
	paging?: GraphPaging;
	refsMetadata?: GraphRefsMetadata | null;
	selectedRows?: GraphSelectedRows;
}
export const DidChangeRowsNotificationType = new IpcNotificationType<DidChangeRowsParams>('graph/rows/didChange');

export interface DidChangeSelectionParams {
	selection: GraphSelectedRows;
}
export const DidChangeSelectionNotificationType = new IpcNotificationType<DidChangeSelectionParams>(
	'graph/selection/didChange',
	true,
);

export interface DidChangeWorkingTreeParams {
	stats: WorkDirStats;
}
export const DidChangeWorkingTreeNotificationType = new IpcNotificationType<DidChangeWorkingTreeParams>(
	'graph/workingTree/didChange',
	true,
);

export interface DidEnsureRowParams {
	id?: string; // `undefined` if the row was not found
}
export const DidEnsureRowNotificationType = new IpcNotificationType<DidEnsureRowParams>('graph/rows/didEnsure');

export interface GraphSearchResults {
	ids?: { [id: string]: GitSearchResultData };
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
export const DidSearchNotificationType = new IpcNotificationType<DidSearchParams>('graph/didSearch', true);

export interface DidFetchParams {
	lastFetched: Date;
}
export const DidFetchNotificationType = new IpcNotificationType<DidFetchParams>('graph/didFetch');
