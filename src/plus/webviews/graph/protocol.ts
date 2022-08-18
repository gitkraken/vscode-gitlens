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
	mixedColumnColors?: { [variable: string]: string };
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
	columns?: {
		[key: string]: GraphColumnConfig;
	};
}

export interface CommitListCallback {
	(state: State): void;
}

// Commands
export interface ColumnChangeParams {
	name: string;
	config: GraphColumnConfig;
}
export const ColumnChangeCommandType = new IpcCommandType<ColumnChangeParams>('graph/column');

export interface MoreCommitsParams {
	limit?: number;
}
export const MoreCommitsCommandType = new IpcCommandType<MoreCommitsParams>('graph/moreCommits');

export interface SelectRepositoryParams {
	path: string;
}
export const SelectRepositoryCommandType = new IpcCommandType<SelectRepositoryParams>('graph/selectRepository');

export const DismissPreviewCommandType = new IpcCommandType<undefined>('graph/dismissPreview');

export interface UpdateSelectionParams {
	selection: GraphCommit[];
}
export const UpdateSelectionCommandType = new IpcCommandType<UpdateSelectionParams>('graph/update/selection');

// Notifications
export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('graph/didChange');

export interface DidChangeConfigParams {
	config: GraphCompositeConfig;
}
export const DidChangeConfigNotificationType = new IpcNotificationType<DidChangeConfigParams>('graph/didChangeConfig');

export interface DidChangeCommitsParams {
	commits: GraphCommit[];
	log?: GraphLog;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/didChangeCommits',
);
