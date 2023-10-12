import type { TextDocumentShowOptions } from 'vscode';
import type { Config } from '../../../config';
import type { WebviewIds, WebviewViewIds } from '../../../constants';
import type { GitCommitStats } from '../../../git/models/commit';
import type { GitFileChangeShape } from '../../../git/models/file';
import type { DateTimeFormat } from '../../../system/date';
import type { Serialized } from '../../../system/serialize';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export const messageHeadlineSplitterToken = '\x00\n\x00';

export type FileShowOptions = TextDocumentShowOptions;

interface LocalDraftDetails {
	type: 'local';

	message?: string;
	files?: GitFileChangeShape[];
	stats?: GitCommitStats;

	author?: undefined;
	createdAt?: undefined;
	updatedAt?: undefined;
	repoPath?: string;
	repoName?: string;
	baseRef?: string;
}

interface CloudDraftDetails {
	type: 'cloud';

	message?: string;
	files?: GitFileChangeShape[];
	stats?: GitCommitStats;

	author: {
		avatar: string | undefined;
		name: string;
		email: string | undefined;
	};
	createdAt: number;
	updatedAt: number;
	repoPath: string;
	repoName?: string;
	baseRef?: string;
}

export type DraftDetails = LocalDraftDetails | CloudDraftDetails;

export interface RangeRef {
	baseSha: string;
	sha: string | undefined;
	branchName: string;
	// shortSha: string;
	// summary: string;
	// message: string;
	// author: GitCommitIdentityShape & { avatar: string | undefined };
	// committer: GitCommitIdentityShape & { avatar: string | undefined };
	// parents: string[];
	// repoPath: string;
	// stashNumber?: string;
}

export interface Preferences {
	avatars: boolean;
	dateFormat: DateTimeFormat | string;
	files: Config['views']['patchDetails']['files'];
	indentGuides: 'none' | 'onHover' | 'always';
}

export type UpdateablePreferences = Partial<Pick<Preferences, 'files'>>;

export type Mode = 'draft' | 'create';

export interface Change {
	type: 'commit' | 'wip';
	repository: { name: string; path: string; uri: string };

	range: RangeRef;
	files: GitFileChangeShape[];
}

export interface RepoCommitChangeSet {
	type: 'commit';

	repoName: string;
	repoUri: string;
	change: Change;

	checked: boolean;
	expanded: boolean;
}

export interface RepoWipChangeSet {
	type: 'wip';

	repoName: string;
	repoUri: string;
	change: Change | undefined;

	checked: boolean | 'staged';
	expanded: boolean;
}

export type RepoChangeSet = RepoCommitChangeSet | RepoWipChangeSet;

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;
	mode: Mode;

	preferences: Preferences;

	draft?: DraftDetails;
	create?: Record<string, RepoChangeSet>;
}

export type ShowCommitDetailsViewCommandArgs = string[];

// COMMANDS

export interface ApplyPatchParams {
	target?: 'head' | 'branch' | 'worktree';
}
export const ApplyPatchCommandType = new IpcCommandType<ApplyPatchParams>('patch/apply');

export interface CreatePatchParams {
	title: string;
	description?: string;
	changes: Change[];
}
export const CreatePatchCommandType = new IpcCommandType<CreatePatchParams>('patch/create');

export interface OpenInCommitGraphParams {
	repoPath: string;
	ref: string;
}
export const OpenInCommitGraphCommandType = new IpcCommandType<OpenInCommitGraphParams>('patch/openInGraph');

export interface SelectPatchRepoParams {
	repoPath: string;
}
export const SelectPatchRepoCommandType = new IpcCommandType<undefined>('patch/selectRepo');

export const SelectPatchBaseCommandType = new IpcCommandType<undefined>('patch/selectBase');

export interface FileActionParams {
	path: string;
	repoPath: string;

	showOptions?: TextDocumentShowOptions;
}
export const FileActionsCommandType = new IpcCommandType<FileActionParams>('patch/file/actions');
export const OpenFileCommandType = new IpcCommandType<FileActionParams>('patch/file/open');
export const OpenFileOnRemoteCommandType = new IpcCommandType<FileActionParams>('patch/file/openOnRemote');
export const OpenFileCompareWorkingCommandType = new IpcCommandType<FileActionParams>('patch/file/compareWorking');
export const OpenFileComparePreviousCommandType = new IpcCommandType<FileActionParams>('patch/file/comparePrevious');

export const ExplainCommandType = new IpcCommandType<undefined>('patch/explain');

export type UpdatePreferenceParams = UpdateablePreferences;
export const UpdatePreferencesCommandType = new IpcCommandType<UpdatePreferenceParams>('patch/preferences/update');

export interface SwitchModeParams {
	repoPath?: string;
	mode: Mode;
}
export const SwitchModeCommandType = new IpcCommandType<SwitchModeParams>('patch/switchMode');

export const CopyCloudLinkCommandType = new IpcCommandType<undefined>('patch/cloud/copyLink');

export const CreateFromLocalPatchCommandType = new IpcCommandType<undefined>('patch/local/createPatch');

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('patch/didChange', true);

export type DidExplainParams =
	| {
			summary: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const DidExplainCommandType = new IpcNotificationType<DidExplainParams>('patch/didExplain');

export type DidChangeCreateParams = Pick<Serialized<State>, 'create'>;
export const DidChangeCreateNotificationType = new IpcNotificationType<DidChangeCreateParams>('patch/create/didChange');
