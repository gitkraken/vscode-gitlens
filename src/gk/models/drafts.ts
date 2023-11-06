import type { GitCommit } from '../../git/models/commit';
import type { GitFileChangeShape } from '../../git/models/file';
import type { GitPatch } from '../../git/models/patch';
import type { Repository } from '../../git/models/repository';
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
	readonly createdBy: string; // userId of creator
	readonly author?: {
		readonly id: string;
		readonly name: string;
		readonly email: string | undefined;
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
	repoData?: RepositoryIdentity;
	readonly secureLink: DraftPatchResponse['secureDownloadData'];

	commit?: GitCommit;
	contents?: string;
	files?: GitFileChangeShape[];
	repository?: Repository;
}

export interface CreateDraftChange {
	baseSha: string;
	contents: string;
	repository: Repository;
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
	readonly isPublished: boolean;

	readonly title: string;
	readonly description?: string;

	readonly deepLink: string;
	readonly isPublic: boolean;
	readonly latestChangesetId: string;
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
	// readonly gitRepositoryData: RepositoryIdentity;

	readonly secureDownloadData: {
		readonly headers: {
			readonly Host: string[];
		};
		readonly method: string;
		readonly url: string;
	};
}
