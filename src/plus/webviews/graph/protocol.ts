import type { Remote } from '@gitkraken/gitkraken-components';
import type { GraphColumnConfig, GraphConfig } from '../../../config';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	repositories?: GraphRepository[];
	selectedRepository?: string;
	commits?: GraphCommit[];
	config?: GraphCompositeConfig;
	remotes?: GraphRemote[];
	tags?: GraphTag[];
	branches?: GraphBranch[];
	log?: GraphLog;
	nonce?: string;
	mixedColumnColors?: Record<string, string>;
	previewBanner?: boolean;
}

export interface GraphLog {
	count: number;
	limit?: number;
	hasMore: boolean;
	cursor?: string;
}

export type GraphRepository = Record<string, any>;
export type GraphCommit = Record<string, any>;
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
export const DismissPreviewCommandType = new IpcCommandType<undefined>('graph/dismissPreview');

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
	'graph/update/selectedRepository',
);

export interface UpdateSelectionParams {
	selection: GraphCommit[];
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

export interface DidChangeCommitsParams {
	commits: GraphCommit[];
	log?: GraphLog;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/commits/didChange',
);
