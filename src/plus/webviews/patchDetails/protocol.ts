import type { TextDocumentShowOptions } from 'vscode';
import type { Config } from '../../../config';
import type { WebviewIds, WebviewViewIds } from '../../../constants';
import type { GitFileChangeShape } from '../../../git/models/file';
import type { PatchRevisionRange } from '../../../git/models/patch';
import type { Repository } from '../../../git/models/repository';
import type { Draft, DraftPatch, DraftPatchFileChange, LocalDraft } from '../../../gk/models/drafts';
import type { GkRepositoryId } from '../../../gk/models/repositoryIdentities';
import type { DateTimeFormat } from '../../../system/date';
import type { Serialized } from '../../../system/serialize';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export const messageHeadlineSplitterToken = '\x00\n\x00';

export type FileShowOptions = TextDocumentShowOptions;

export type PatchDetails = Serialized<
	Omit<DraftPatch, 'commit' | 'contents' | 'repository'> & {
		repository: { id: GkRepositoryId; name: string; located: boolean };
	}
>;

interface CreateDraftFromChanges {
	title?: string;
	description?: string;
	changes: Change[];
	repositories?: never;
}

interface CreateDraftFromRepositories {
	title?: string;
	description?: string;
	changes?: never;
	repositories: Repository[] | undefined;
}

export type CreateDraft = CreateDraftFromChanges | CreateDraftFromRepositories;
export type ViewDraft = LocalDraft | Draft;

interface LocalDraftDetails {
	draftType: 'local';

	id?: never;
	author?: never;
	createdAt?: never;
	updatedAt?: never;

	title?: string;
	description?: string;

	patches?: PatchDetails[];

	// files?: GitFileChangeShape[];
	// stats?: GitCommitStats;

	// repoPath?: string;
	// repoName?: string;

	// baseRef?: string;
	// commit?: string;
}

interface CloudDraftDetails {
	draftType: 'cloud';

	id: string;
	createdAt: number;
	updatedAt: number;
	author: {
		id: string;
		name: string;
		email: string | undefined;
		avatar?: string;
	};

	title: string;
	description?: string;

	patches?: PatchDetails[];

	// commit?: string;

	// files?: GitFileChangeShape[];
	// stats?: GitCommitStats;

	// repoPath: string;
	// repoName?: string;
	// baseRef?: string;
}

export type DraftDetails = LocalDraftDetails | CloudDraftDetails;

// export interface RangeRef {
// 	baseSha: string;
// 	sha: string | undefined;
// 	branchName: string;
// 	// shortSha: string;
// 	// summary: string;
// 	// message: string;
// 	// author: GitCommitIdentityShape & { avatar: string | undefined };
// 	// committer: GitCommitIdentityShape & { avatar: string | undefined };
// 	// parents: string[];
// 	// repoPath: string;
// 	// stashNumber?: string;
// }

export interface Preferences {
	avatars: boolean;
	dateFormat: DateTimeFormat | string;
	files: Config['views']['patchDetails']['files'];
	indentGuides: 'none' | 'onHover' | 'always';
	indent: number | undefined;
}

export type UpdateablePreferences = Partial<Pick<Preferences, 'files'>>;

export type Mode = 'create' | 'view';
export type ChangeType = 'revision' | 'wip';

export interface WipChange {
	type: 'wip';
	repository: { name: string; path: string; uri: string };
	revision: PatchRevisionRange;
	files: GitFileChangeShape[] | undefined;

	checked?: boolean | 'staged';
	expanded?: boolean;
}

export interface RevisionChange {
	type: 'revision';
	repository: { name: string; path: string; uri: string };
	revision: PatchRevisionRange;
	files: GitFileChangeShape[];

	checked?: boolean | 'staged';
	expanded?: boolean;
}

export type Change = WipChange | RevisionChange;

// export interface RepoCommitChange {
// 	type: 'commit';

// 	repoName: string;
// 	repoUri: string;
// 	change: Change;

// 	checked: boolean;
// 	expanded: boolean;
// }

// export interface RepoWipChange {
// 	type: 'wip';

// 	repoName: string;
// 	repoUri: string;
// 	change: Change | undefined;

// 	checked: boolean | 'staged';
// 	expanded: boolean;
// }

// export type RepoChangeSet = RepoCommitChange | RepoWipChange;

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;
	mode: Mode;

	preferences: Preferences;

	draft?: DraftDetails;
	create?: {
		title?: string;
		description?: string;
		changes: Record<string, Change>;
		creationError?: string;
	};
}

export type ShowCommitDetailsViewCommandArgs = string[];

// COMMANDS

export interface ApplyPatchParams {
	details: DraftDetails;
	targetRef?: string; // a branch name. default to HEAD if not supplied
	target: 'current' | 'branch' | 'worktree';
	selected: PatchDetails['id'][];
}
export const ApplyPatchCommandType = new IpcCommandType<ApplyPatchParams>('patch/apply');

export interface CreatePatchParams {
	title: string;
	description?: string;
	changesets: Record<string, Change>;
}
export const CreatePatchCommandType = new IpcCommandType<CreatePatchParams>('patch/create');

export interface OpenInCommitGraphParams {
	repoPath: string;
	ref: string;
}
export const OpenInCommitGraphCommandType = new IpcCommandType<OpenInCommitGraphParams>('patch/openInGraph');

export interface DraftPatchCheckedParams {
	patch: PatchDetails;
	checked: boolean;
}
export const DraftPatchCheckedCommandType = new IpcCommandType<DraftPatchCheckedParams>('patch/checked');

export interface SelectPatchRepoParams {
	repoPath: string;
}
export const SelectPatchRepoCommandType = new IpcCommandType<undefined>('patch/selectRepo');

export const SelectPatchBaseCommandType = new IpcCommandType<undefined>('patch/selectBase');

export interface FileActionParams extends DraftPatchFileChange {
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

export interface UpdateCreatePatchRepositoryCheckedStateParams {
	repoUri: string;
	checked: boolean | 'staged';
}
export const UpdateCreatePatchRepositoryCheckedStateCommandType =
	new IpcCommandType<UpdateCreatePatchRepositoryCheckedStateParams>('patch/create/repository/check');

export interface UpdateCreatePatchMetadataParams {
	title: string;
	description: string | undefined;
}
export const UpdateCreatePatchMetadataCommandType = new IpcCommandType<UpdateCreatePatchMetadataParams>(
	'patch/update/create/metadata',
);

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('patch/didChange', true);

export type DidChangeCreateParams = Pick<Serialized<State>, 'create' | 'mode'>;
export const DidChangeCreateNotificationType = new IpcNotificationType<DidChangeCreateParams>('patch/create/didChange');

export type DidChangeDraftParams = Pick<Serialized<State>, 'draft' | 'mode'>;
export const DidChangeDraftNotificationType = new IpcNotificationType<DidChangeDraftParams>('patch/draft/didChange');

export type DidChangePreferencesParams = Pick<Serialized<State>, 'preferences'>;
export const DidChangePreferencesNotificationType = new IpcNotificationType<DidChangePreferencesParams>(
	'patch/preferences/didChange',
);

export type DidExplainParams =
	| {
			summary: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const DidExplainCommandType = new IpcNotificationType<DidExplainParams>('patch/didExplain');

export interface DidChangePatchRepositoryParams {
	patch: PatchDetails;
}
export const DidChangePatchRepositoryNotificationType = new IpcNotificationType<DidChangePatchRepositoryParams>(
	'patch/draft/didChangeRepository',
);
