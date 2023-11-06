import type { GitCommit } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { GitPatch, PatchRevisionRange } from '../../git/models/patch';
import type { Repository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import type { Brand } from '../../system/brand';
import type { GkRepositoryId, RepositoryIdentityRequest } from './repositoryIdentities';

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
	readonly isPublished: boolean;

	readonly title: string;
	readonly description?: string;

	readonly deepLinkUrl: string;
	readonly deepLinkAccess: 'public' | 'private';

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
	files?: PatchFileChange[];
	repository?: Repository;
}

export interface DraftPatchDetails {
	id: string;
	contents: string;
	files: PatchFileChange[];
	repository: Repository | undefined;
}

export interface PatchFileChange extends GitFileChangeShape {
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
	isPublic: boolean;
	organizationId?: string;
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

	readonly deepLink: string;
	readonly isPublic: boolean;
	readonly isPublished: boolean;
	readonly latestChangesetId: string;

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
	readonly gitRepositoryId: Brand<GkRepositoryId>;

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
	readonly gitRepositoryId: Brand<GkRepositoryId>;

	readonly secureDownloadData: {
		readonly headers: {
			readonly Host: string[];
		};
		readonly method: string;
		readonly url: string;
	};
}
