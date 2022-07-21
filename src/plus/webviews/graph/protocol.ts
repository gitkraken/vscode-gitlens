import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	repositories?: Repository[];
	selectedRepository?: string;
	commits?: GitCommit[];
	config?: GraphConfig;
	remotes?: GitRemote[];
	tags?: GitTag[];
	branches?: GitBranch[];
	log?: GitLog;
	nonce?: string;
}

export interface GitLog {
	count: number;
	limit?: number;
	hasMore: boolean;
	cursor?: string;
}

export type Repository = Record<string, any>;
export type GitCommit = Record<string, any>;
export type GitRemote = Record<string, any>;
export type GitTag = Record<string, any>;
export type GitBranch = Record<string, any>;

export interface GraphColumnConfig {
	width: number;
}

export interface GraphColumnConfigDictionary {
	[key: string]: GraphColumnConfig;
}

export interface GraphConfig {
	defaultLimit: number;
	pageLimit: number;
	columns?: GraphColumnConfigDictionary;
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

// Notifications
export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('graph/didChange');

export interface DidChangeConfigParams {
	config: GraphConfig;
}
export const DidChangeConfigNotificationType = new IpcNotificationType<DidChangeConfigParams>('graph/didChangeConfig');

export interface DidChangeCommitsParams {
	commits: GitCommit[];
	log?: GitLog;
}
export const DidChangeCommitsNotificationType = new IpcNotificationType<DidChangeCommitsParams>(
	'graph/didChangeCommits',
);
