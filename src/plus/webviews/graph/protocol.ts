import type {
	CssVariables,
	GraphColumnSetting,
	GraphContexts,
	GraphRow,
	GraphZoneType,
	RefMetadata,
	Remote,
	WorkDirStats,
} from '@gitkraken/gitkraken-components';
import type { DateStyle } from '../../../config';
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitGraphRowType } from '../../../git/models/graph';
import type { GitSearchResultData, SearchQuery } from '../../../git/search';
import type { Subscription } from '../../../subscription';
import type { DateTimeFormat } from '../../../system/date';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export type GraphColumnsSettings = Record<GraphColumnName, GraphColumnSetting>;
export type GraphSelectedRows = Record</*id*/ string, true>;
export type GraphAvatars = Record</*email*/ string, /*url*/ string>;
export type GraphRefMetadata = Record</* id */ string, RefMetadata>;
export type GraphMissingRefMetadata = Record</*id*/ string, /*missingType*/ string[]>;

export interface State {
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	selectedRows?: GraphSelectedRows;
	subscription?: Subscription;
	allowed: boolean;
	avatars?: GraphAvatars;
	loading?: boolean;
	refMetadata?: GraphRefMetadata;
	rows?: GraphRow[];
	paging?: GraphPaging;
	columns?: GraphColumnsSettings;
	config?: GraphComponentConfig;
	context?: GraphContexts;
	nonce?: string;
	previewBanner?: boolean;
	trialBanner?: boolean;
	workingTreeStats?: GraphWorkingTreeStats;
	searchResults?: DidSearchParams['results'];

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
export type GraphTag = Record<string, any>;
export type GraphBranch = Record<string, any>;

export interface GraphComponentConfig {
	avatars?: boolean;
	dateFormat: DateTimeFormat | string;
	dateStyle: DateStyle;
	enableMultiSelection?: boolean;
	highlightRowsOnRefHover?: boolean;
	showGhostRefsOnRowHover?: boolean;
	idLength?: number;
}

export interface GraphColumnConfig {
	isHidden?: boolean;
	width?: number;
}

export type GraphColumnName = GraphZoneType;

export type InternalNotificationType = 'didChangeTheme';

export interface UpdateStateCallback {
	(state: State, type?: IpcNotificationType<any> | InternalNotificationType, themingChanged?: boolean): void;
}

// Commands
export interface DismissBannerParams {
	key: 'preview' | 'trial';
}
export const DismissBannerCommandType = new IpcCommandType<DismissBannerParams>('graph/dismissBanner');

export interface EnsureRowParams {
	id: string;
	select?: boolean;
}
export const EnsureRowCommandType = new IpcCommandType<EnsureRowParams>('graph/rows/ensure');

export interface GetMissingAvatarsParams {
	emails: GraphAvatars;
}
export const GetMissingAvatarsCommandType = new IpcCommandType<GetMissingAvatarsParams>('graph/avatars/get');

export interface GetMissingRefMetadataParams {
	missing: GraphMissingRefMetadata;
}
export const GetMissingRefMetadataCommandType = new IpcCommandType<GetMissingRefMetadataParams>('graph/refMetadata/get');

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

export interface UpdateColumnParams {
	name: GraphColumnName;
	config: GraphColumnConfig;
}
export const UpdateColumnCommandType = new IpcCommandType<UpdateColumnParams>('graph/column/update');

export interface UpdateSelectedRepositoryParams {
	path: string;
}
export const UpdateSelectedRepositoryCommandType = new IpcCommandType<UpdateSelectedRepositoryParams>(
	'graph/selectedRepository/update',
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
	avatars: { [email: string]: string };
}
export const DidChangeAvatarsNotificationType = new IpcNotificationType<DidChangeAvatarsParams>(
	'graph/avatars/didChange',
);

export interface DidChangeRefMetadataParams {
	refMetadata: GraphRefMetadata | undefined;
}
export const DidChangeRefMetadataNotificationType = new IpcNotificationType<DidChangeRefMetadataParams>(
	'graph/refMetadata/didChange',
);

export interface DidChangeColumnsParams {
	columns: GraphColumnsSettings | undefined;
	context?: string;
}
export const DidChangeColumnsNotificationType = new IpcNotificationType<DidChangeColumnsParams>(
	'graph/columns/didChange',
	true,
);

export interface DidChangeRowsParams {
	rows: GraphRow[];
	avatars: { [email: string]: string };
	paging?: GraphPaging;
	refMetadata: GraphRefMetadata | undefined;
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
