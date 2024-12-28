import type { TextDocumentShowOptions } from 'vscode';
import type { Config } from '../../../config';
import type { GitFileChangeShape } from '../../../git/models/file';
import type { PatchRevisionRange } from '../../../git/models/patch';
import type { Repository } from '../../../git/models/repository';
import type {
	Draft,
	DraftArchiveReason,
	DraftPatch,
	DraftPatchFileChange,
	DraftPendingUser,
	DraftRole,
	DraftType,
	DraftUser,
	DraftVisibility,
	LocalDraft,
} from '../../../gk/models/drafts';
import type { GkRepositoryId } from '../../../gk/models/repositoryIdentities';
import type { OrganizationMember } from '../../../plus/gk/account/organization';
import type { DateTimeFormat } from '../../../system/date';
import type { Serialized } from '../../../system/vscode/serialize';
import type { IpcScope, WebviewState } from '../../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../../protocol';

export const scope: IpcScope = 'patchDetails';

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
}

export interface CloudDraftDetails {
	draftType: 'cloud';

	id: string;
	type: DraftType;
	createdAt: number;
	updatedAt: number;
	author: {
		id: string;
		name: string;
		email: string | undefined;
		avatar?: string;
	};

	role: DraftRole;
	visibility: DraftVisibility;

	title: string;
	description?: string;

	isArchived: boolean;
	archivedReason?: DraftArchiveReason;

	gkDevLink?: string;

	patches?: PatchDetails[];

	users?: DraftUser[];
	userSelections?: DraftUserSelection[];
}

export type DraftDetails = LocalDraftDetails | CloudDraftDetails;

export interface DraftUserSelection {
	change: 'add' | 'modify' | 'delete' | undefined;
	member: OrganizationMember;
	user: DraftUser | undefined;
	pendingRole: DraftPendingUser['role'] | undefined;
	avatarUrl?: string;
}

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

export interface CreatePatchState {
	title?: string;
	description?: string;
	changes: Record<string, Change>;
	creationError?: string;
	visibility: DraftVisibility;
	userSelections?: DraftUserSelection[];
}

export interface State extends WebviewState {
	mode: Mode;

	preferences: Preferences;
	orgSettings: {
		ai: boolean;
		byob: boolean;
	};

	draft?: DraftDetails;
	create?: CreatePatchState;
}

export type ShowCommitDetailsViewCommandArgs = string[];

// COMMANDS

export interface ApplyPatchParams {
	details: DraftDetails;
	targetRef?: string; // a branch name. default to HEAD if not supplied
	target: 'current' | 'branch' | 'worktree';
	selected: PatchDetails['id'][];
}
export const ApplyPatchCommand = new IpcCommand<ApplyPatchParams>(scope, 'apply');

export interface ArchiveDraftParams {
	reason?: Exclude<DraftArchiveReason, 'committed'>;
}
export const ArchiveDraftCommand = new IpcCommand<ArchiveDraftParams>(scope, 'archive');

export interface CreatePatchParams {
	title: string;
	description?: string;
	changesets: Record<string, Change>;
	visibility: DraftVisibility;
	userSelections?: DraftUserSelection[];
}
export const CreatePatchCommand = new IpcCommand<CreatePatchParams>(scope, 'create');

export interface OpenInCommitGraphParams {
	repoPath: string;
	ref: string;
}
export const OpenInCommitGraphCommand = new IpcCommand<OpenInCommitGraphParams>(scope, 'openInGraph');

export interface DraftPatchCheckedParams {
	patch: PatchDetails;
	checked: boolean;
}
export const DraftPatchCheckedCommand = new IpcCommand<DraftPatchCheckedParams>(scope, 'checked');

export interface SelectPatchRepoParams {
	repoPath: string;
}
export const SelectPatchRepoCommand = new IpcCommand(scope, 'selectRepo');

export const SelectPatchBaseCommand = new IpcCommand(scope, 'selectBase');

export interface ExecuteFileActionParams extends DraftPatchFileChange {
	showOptions?: TextDocumentShowOptions;
}
export const ExecuteFileActionCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/actions/execute');
export const OpenFileCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/open');
export const OpenFileOnRemoteCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/openOnRemote');
export const OpenFileCompareWorkingCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/compareWorking');
export const OpenFileComparePreviousCommand = new IpcCommand<ExecuteFileActionParams>(scope, 'file/comparePrevious');

export type UpdatePreferenceParams = UpdateablePreferences;
export const UpdatePreferencesCommand = new IpcCommand<UpdatePreferenceParams>(scope, 'preferences/update');

export interface SwitchModeParams {
	repoPath?: string;
	mode: Mode;
}
export const SwitchModeCommand = new IpcCommand<SwitchModeParams>(scope, 'switchMode');

export const CopyCloudLinkCommand = new IpcCommand(scope, 'cloud/copyLink');

export const CreateFromLocalPatchCommand = new IpcCommand(scope, 'local/createPatch');

export interface UpdateCreatePatchRepositoryCheckedStateParams {
	repoUri: string;
	checked: boolean | 'staged';
}
export const UpdateCreatePatchRepositoryCheckedStateCommand =
	new IpcCommand<UpdateCreatePatchRepositoryCheckedStateParams>(scope, 'create/repository/check');

export interface UpdateCreatePatchMetadataParams {
	title: string;
	description: string | undefined;
	visibility: DraftVisibility;
}
export const UpdateCreatePatchMetadataCommand = new IpcCommand<UpdateCreatePatchMetadataParams>(
	scope,
	'update/create/metadata',
);

export interface UpdatePatchDetailsMetadataParams {
	visibility: DraftVisibility;
}
export const UpdatePatchDetailsMetadataCommand = new IpcCommand<UpdatePatchDetailsMetadataParams>(
	scope,
	'update/draft/metadata',
);

export const UpdatePatchDetailsPermissionsCommand = new IpcCommand(scope, 'update/draft/permissions');

export const UpdatePatchUsersCommand = new IpcCommand(scope, 'update/users');

export interface UpdatePatchUserSelection {
	selection: DraftUserSelection;
	role: Exclude<DraftRole, 'owner'> | 'remove';
}
export const UpdatePatchUserSelectionCommand = new IpcCommand<UpdatePatchUserSelection>(scope, 'update/userSelection');

// REQUESTS

export type DidExplainParams =
	| {
			result: { summary: string; body: string };
			error?: never;
	  }
	| { error: { message: string } };
export const ExplainRequest = new IpcRequest<void, DidExplainParams>(scope, 'explain');

export type DidGenerateParams =
	| {
			title: string | undefined;
			description: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
export const GenerateRequest = new IpcRequest<void, DidGenerateParams>(scope, 'generate');

// NOTIFICATIONS

export interface DidChangeParams {
	state: Serialized<State>;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);

export type DidChangeCreateParams = Pick<Serialized<State>, 'create' | 'mode'>;
export const DidChangeCreateNotification = new IpcNotification<DidChangeCreateParams>(scope, 'create/didChange');

export type DidChangeDraftParams = Pick<Serialized<State>, 'draft' | 'mode'>;
export const DidChangeDraftNotification = new IpcNotification<DidChangeDraftParams>(scope, 'draft/didChange');

export type DidChangePreferencesParams = Pick<Serialized<State>, 'preferences'>;
export const DidChangePreferencesNotification = new IpcNotification<DidChangePreferencesParams>(
	scope,
	'preferences/didChange',
);

export interface DidChangePatchRepositoryParams {
	patch: PatchDetails;
}
export const DidChangePatchRepositoryNotification = new IpcNotification<DidChangePatchRepositoryParams>(
	scope,
	'draft/didChangeRepository',
);

export type DidChangeOrgSettings = Pick<Serialized<State>, 'orgSettings'>;
export const DidChangeOrgSettingsNotification = new IpcNotification<DidChangeOrgSettings>(
	scope,
	'org/settings/didChange',
);
