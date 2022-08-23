import type { CommitType, GraphRow, Remote } from '@gitkraken/gitkraken-components';
import type { GraphColumnConfig, GraphConfig } from '../../../config';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	repositories?: GraphRepository[];
	selectedRepository?: string;
	rows?: GraphRow[];
	config?: GraphCompositeConfig;
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
	type: CommitType;

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
	'graph/update/repositorySelection',
);

export interface UpdateSelectionParams {
	selection: string[];
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
	rows: GraphRow[];
	previousCursor?: string;
	log?: GraphLog;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/commits/didChange',
);
