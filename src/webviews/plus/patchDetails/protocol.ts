import type { TextDocumentShowOptions } from 'vscode';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { PatchRevisionRange } from '@gitlens/git/models/patch.js';
import type { GkRepositoryId } from '@gitlens/git/models/repositoryIdentities.js';
import type { DateTimeFormat } from '@gitlens/utils/date.js';
import type { Config } from '../../../config.js';
import type { GlRepository } from '../../../git/models/repository.js';
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
} from '../../../plus/drafts/models/drafts.js';
import type { OrganizationMember } from '../../../plus/gk/models/organization.js';
import type { Serialized } from '../../../system/serialize.js';
import type { WebviewState } from '../../protocol.js';

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
	repositories: GlRepository[] | undefined;
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
	aiEnabled: boolean;
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

export interface State extends WebviewState<'gitlens.patchDetails' | 'gitlens.views.patchDetails'> {
	mode: Mode;

	preferences: Preferences;
	orgSettings: {
		ai: boolean;
		byob: boolean;
	};

	draft?: DraftDetails;
	create?: CreatePatchState;
}

// COMMAND PARAMS

export interface ApplyPatchParams {
	details: DraftDetails;
	targetRef?: string; // a branch name. default to HEAD if not supplied
	target: 'current' | 'branch' | 'worktree';
	selected: PatchDetails['id'][];
}

export interface ArchiveDraftParams {
	reason?: Exclude<DraftArchiveReason, 'committed'>;
}

export interface CreatePatchParams {
	title: string;
	description?: string;
	changesets: Record<string, Change>;
	visibility: DraftVisibility;
	userSelections?: DraftUserSelection[];
}

export interface OpenInCommitGraphParams {
	repoPath: string;
	ref: string;
}

export interface DraftPatchCheckedParams {
	patch: PatchDetails;
	checked: boolean;
}

export interface ExecuteFileActionParams extends DraftPatchFileChange {
	showOptions?: TextDocumentShowOptions;
}

export type UpdatePreferenceParams = UpdateablePreferences;

export interface SwitchModeParams {
	repoPath?: string;
	mode: Mode;
}

export interface UpdateCreatePatchRepositoryCheckedStateParams {
	repoUri: string;
	checked: boolean | 'staged';
}

export interface UpdateCreatePatchMetadataParams {
	title: string;
	description: string | undefined;
	visibility: DraftVisibility;
}

export interface UpdatePatchDetailsMetadataParams {
	visibility: DraftVisibility;
}

export interface UpdatePatchUserSelection {
	selection: DraftUserSelection;
	role: Exclude<DraftRole, 'owner'> | 'remove';
}

// REQUEST RESULTS

export type DidExplainParams =
	| {
			result: { summary: string; body: string };
			error?: never;
	  }
	| { error: { message: string } };

export type DidGenerateParams =
	| {
			title: string | undefined;
			description: string | undefined;
			error?: undefined;
	  }
	| { error: { message: string } };
