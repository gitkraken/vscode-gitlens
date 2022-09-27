import type {
	GraphColumnSetting,
	GraphContexts,
	GraphRow,
	GraphZoneType,
	Remote,
} from '@gitkraken/gitkraken-components';
import type { DateStyle } from '../../../config';
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitGraphRowType } from '../../../git/models/graph';
import type { SearchQuery } from '../../../git/search';
import type { Subscription } from '../../../subscription';
import type { DateTimeFormat } from '../../../system/date';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export type GraphColumnsSettings = Record<GraphColumnName, GraphColumnSetting>;

export interface State {
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedRepositoryVisibility?: RepositoryVisibility;
	selectedRows?: { [id: string]: true };
	subscription?: Subscription;
	allowed: boolean;
	avatars?: { [email: string]: string };
	loading?: boolean;
	rows?: GraphRow[];
	paging?: GraphPaging;
	columns?: Record<GraphColumnName, GraphColumnConfig>;
	config?: GraphComponentConfig;
	context?: GraphContexts;
	nonce?: string;
	previewBanner?: boolean;
	trialBanner?: boolean;

	// Props below are computed in the webview (not passed)
	mixedColumnColors?: Record<string, string>;
	searchResults?: DidSearchCommitsParams['results'];
}

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
	shaLength?: number;
}

export interface GraphColumnConfig {
	isHidden?: boolean;
	width?: number;
}

export type GraphColumnName = GraphZoneType;

export interface UpdateStateCallback {
	(state: State): void;
}

// Commands
export interface DismissBannerParams {
	key: 'preview' | 'trial';
}
export const DismissBannerCommandType = new IpcCommandType<DismissBannerParams>('graph/dismissBanner');

export interface EnsureCommitParams {
	id: string;
	select?: boolean;
}
export const EnsureCommitCommandType = new IpcCommandType<EnsureCommitParams>('graph/ensureCommit');

export interface GetMissingAvatarsParams {
	emails: { [email: string]: string };
}
export const GetMissingAvatarsCommandType = new IpcCommandType<GetMissingAvatarsParams>('graph/getMissingAvatars');

export interface GetMoreCommitsParams {
	sha?: string;
}
export const GetMoreCommitsCommandType = new IpcCommandType<GetMoreCommitsParams>('graph/getMoreCommits');

export interface SearchCommitsParams {
	search?: SearchQuery;
	limit?: number;
	more?: boolean;
}
export const SearchCommitsCommandType = new IpcCommandType<SearchCommitsParams>('graph/searchCommits');

export interface UpdateColumnParams {
	name: GraphColumnName;
	config: GraphColumnConfig;
}
export const UpdateColumnCommandType = new IpcCommandType<UpdateColumnParams>('graph/update/column');

export interface UpdateSelectedRepositoryParams {
	path: string;
}
export const UpdateSelectedRepositoryCommandType = new IpcCommandType<UpdateSelectedRepositoryParams>(
	'graph/update/repositorySelection',
);

export interface UpdateSelectionParams {
	selection: { id: string; type: GitGraphRowType }[];
}
export const UpdateSelectionCommandType = new IpcCommandType<UpdateSelectionParams>('graph/update/selection');

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
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	allowed: boolean;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'graph/subscription/didChange',
);

export interface DidChangeAvatarsParams {
	avatars: { [email: string]: string };
}
export const DidChangeAvatarsNotificationType = new IpcNotificationType<DidChangeAvatarsParams>(
	'graph/avatars/didChange',
);

export interface DidChangeColumnsParams {
	columns: Record<GraphColumnName, GraphColumnConfig> | undefined;
	context?: string;
}
export const DidChangeColumnsNotificationType = new IpcNotificationType<DidChangeColumnsParams>(
	'graph/columns/didChange',
);

export interface DidChangeCommitsParams {
	rows: GraphRow[];
	avatars: { [email: string]: string };
	selectedRows?: { [id: string]: true };
	paging?: GraphPaging;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/commits/didChange',
);

export interface DidChangeSelectionParams {
	selection: { [id: string]: true };
}
export const DidChangeSelectionNotificationType = new IpcNotificationType<DidChangeSelectionParams>(
	'graph/selection/didChange',
);

export interface DidEnsureCommitParams {
	id?: string;
	selected?: boolean;
}
export const DidEnsureCommitNotificationType = new IpcNotificationType<DidEnsureCommitParams>(
	'graph/commits/didEnsureCommit',
);

export interface DidSearchCommitsParams {
	results: { ids: { [sha: string]: number }; paging?: { hasMore: boolean } } | undefined;
	selectedRows?: { [id: string]: true };
}
export const DidSearchCommitsNotificationType = new IpcNotificationType<DidSearchCommitsParams>(
	'graph/commits/didSearch',
);
