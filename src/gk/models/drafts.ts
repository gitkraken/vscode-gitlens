import type { GitCommit } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { GitPatch, PatchRevisionRange } from '../../git/models/patch';
import type { Repository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import type { GkRepositoryId, RepositoryIdentity, RepositoryIdentityRequest } from './repositoryIdentities';

export interface LocalDraft {
	readonly draftType: 'local';

	patch: GitPatch;
}

export interface Draft {
	readonly draftType: 'cloud';
	readonly type: 'patch' | 'stash';
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly author: {
		id: string;
		name: string;
		email: string | undefined;
		avatar?: string;
	};
	readonly organizationId?: string;
	readonly role: 'owner' | 'admin' | 'editor' | 'viewer';
	readonly isPublished: boolean;

	readonly title: string;
	readonly description?: string;

	readonly deepLinkUrl: string;
	readonly visibility: 'public' | 'private' | 'invite_only';

	readonly latestChangesetId: string;
	changesets?: DraftChangeset[];

	// readonly user?: {
	// 	readonly id: string;
	// 	readonly name: string;
	// 	readonly email: string;
	// };
}

export interface DraftChangeset {
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly draftId: string;
	readonly parentChangesetId: string | undefined;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLinkUrl?: string;

	readonly patches: DraftPatch[];
}

export interface DraftPatch {
	readonly type: 'cloud';
	readonly id: string;
	readonly createdAt: Date;
	readonly updatedAt: Date;
	readonly draftId: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseBranchName: string;
	/*readonly*/ baseRef: string;

	readonly gkRepositoryId: GkRepositoryId;
	// repoData?: GitRepositoryData;
	readonly secureLink: DraftPatchResponse['secureDownloadData'];

	commit?: GitCommit;
	contents?: string;
	files?: DraftPatchFileChange[];
	repository?: Repository | RepositoryIdentity;
}

export interface DraftPatchDetails {
	id: string;
	contents: string;
	files: DraftPatchFileChange[];
	repository: Repository | RepositoryIdentity;
}

export interface DraftPatchFileChange extends GitFileChangeShape {
	readonly gkRepositoryId: GkRepositoryId;
}

export interface CreateDraftChange {
	revision: PatchRevisionRange;
	contents?: string;
	repository: Repository;
}

export interface CreateDraftPatchRequestFromChange {
	contents: string;
	patch: DraftPatchCreateRequest;
	repository: Repository;
	user: GitUser | undefined;
}

export interface CreateDraftRequest {
	type: 'patch' | 'stash';
	title: string;
	description?: string;
	visibility: 'public' | 'private'; // TODO: support 'invite_only'
}

export interface CreateDraftResponse {
	id: string;
	deepLink: string;
}

export interface DraftResponse {
	readonly type: 'patch' | 'stash';
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly createdBy: string;
	readonly organizationId?: string;
	readonly role: 'owner' | 'admin' | 'editor' | 'viewer';

	readonly deepLink: string;
	readonly isPublished: boolean;
	readonly latestChangesetId: string;
	readonly visibility: 'public' | 'private' | 'invite_only';

	readonly title: string;
	readonly description?: string;
}

export interface DraftChangesetCreateRequest {
	parentChangesetId?: string | null;
	gitUserName?: string;
	gitUserEmail?: string;
	patches: DraftPatchCreateRequest[];
}

export interface DraftChangesetCreateResponse {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly draftId: string;
	readonly parentChangesetId: string | undefined;
	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;
	readonly patches: DraftPatchCreateResponse[];
}

export interface DraftChangesetResponse {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly draftId: string;
	readonly parentChangesetId: string | undefined;
	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;
	readonly patches: DraftPatchResponse[];
}

export interface DraftPatchCreateRequest {
	baseCommitSha: string;
	baseBranchName: string;
	gitRepoData: RepositoryIdentityRequest;
}

export interface DraftPatchCreateResponse {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly draftId: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseCommitSha: string;
	readonly baseBranchName: string;
	readonly gitRepositoryId: GkRepositoryId;

	readonly secureUploadData: {
		readonly headers: {
			readonly Host: string[];
		};
		readonly method: string;
		readonly url: string;
	};
}

export interface DraftPatchResponse {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly draftId: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseCommitSha: string;
	readonly baseBranchName: string;
	readonly gitRepositoryId: GkRepositoryId;

	readonly secureDownloadData: {
		readonly headers: {
			readonly Host: string[];
		};
		readonly method: string;
		readonly url: string;
	};
}
