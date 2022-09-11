import type { GraphRow, Remote } from '@gitkraken/gitkraken-components';
import type { GraphColumnConfig, GraphConfig } from '../../../config';
import type { RepositoryVisibility } from '../../../git/gitProvider';
import type { GitGraphRowType } from '../../../git/models/graph';
import type { Subscription } from '../../../subscription';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	repositories?: GraphRepository[];
	selectedRepository?: string;
	selectedSha?: string;
	selectedVisibility?: RepositoryVisibility;
	subscription?: Subscription;
	allowed?: boolean;
	rows?: GraphRow[];
	paging?: GraphPaging;
	config?: GraphCompositeConfig;
	nonce?: string;
	previewBanner?: boolean;
	trialBanner?: boolean;

	// Props below are computed in the webview (not passed)
	mixedColumnColors?: Record<string, string>;
}

export interface GraphPaging {
	startingCursor?: string;
	more: boolean;
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

export interface GraphCompositeConfig extends GraphConfig {
	columns?: Record<string, GraphColumnConfig>;
}

export interface CommitListCallback {
	(state: State): void;
}

// Commands
export interface DismissBannerParams {
	key: 'preview' | 'trial';
}
export const DismissBannerCommandType = new IpcCommandType<DismissBannerParams>('graph/dismissBanner');

export interface GetMoreCommitsParams {
	limit?: number;
}
export const GetMoreCommitsCommandType = new IpcCommandType<GetMoreCommitsParams>('graph/getMoreCommits');

export interface UpdateColumnParams {
	name: string;
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
	config: GraphCompositeConfig;
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

export interface DidChangeCommitsParams {
	rows: GraphRow[];
	paging?: GraphPaging;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/commits/didChange',
);

export interface DidChangeSelectionParams {
	selection: string[];
}
export const DidChangeSelectionNotificationType = new IpcNotificationType<DidChangeSelectionParams>(
	'graph/selection/didChange',
);
