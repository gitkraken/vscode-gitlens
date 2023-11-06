import type { GitCloudPatch, GitPatch, GitRepositoryData } from '../../git/models/patch';
import type { Repository } from '../../git/models/repository';
import type { GkRepositoryId, RepositoryIdentityRequest } from './repositoryIdentities';

export interface LocalDraft {
	readonly draftType: 'local';

	patch: GitPatch;
}

export interface Draft {
	readonly draftType: 'cloud';
	readonly type: 'patch' | 'stash';
	readonly id: string;

	readonly createdBy: string; // userId of creator
	readonly organizationId?: string;

	readonly deepLinkUrl: string;
	readonly isPublic: boolean;
	readonly latestChangesetId: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly title: string;
	readonly description?: string;

	readonly user?: {
		readonly id: string;
		readonly name: string;
		readonly email: string;
	};

	changesets?: DraftChangeset[];
}

export interface DraftChangeset {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLinkUrl?: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly patches: GitCloudPatch[];
}

export interface DraftPatch {
	readonly id: string;
	// readonly draftId: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseBranchName: string;
	readonly baseCommitSha: string;

	readonly gitRepositoryId?: GkRepositoryId;

	contents?: string;
	repo?: Repository;
	repoData?: GitRepositoryData;
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

export interface CreateDraftChangesetRequest {
	parentChangesetId?: string | null;
	gitUserName?: string;
	gitUserEmail?: string;
	patches: CreateDraftPatchRequest[];
}

export interface CreateDraftChangesetResponse {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;

	readonly createdAt: string;
	readonly updatedAt: string;
	readonly patches: CreateDraftPatchResponse[];
}

export interface CreateDraftPatchRequest {
	baseCommitSha: string;
	baseBranchName: string;
	gitRepoData: RepositoryIdentityRequest;
}

export interface CreateDraftPatchResponse {
	readonly id: string;
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

export interface DraftResponse {
	readonly id: string;
	readonly type: 'patch' | 'stash';
	readonly createdBy: string;
	readonly organizationId?: string;

	readonly deepLink: string;
	readonly isPublic: boolean;
	readonly latestChangesetId: string;

	readonly createdAt: string;
	readonly updatedAt: string;

	readonly title: string;
	readonly description?: string;
}

export interface DraftChangesetResponse {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly patches: DraftPatchResponse[];
}

export interface DraftPatchResponse {
	readonly id: string;

	readonly changesetId: string;
	readonly userId: string;

	readonly baseCommitSha: string;
	readonly baseBranchName: string;

	readonly secureDownloadData: {
		readonly url: string;
		readonly method: string;
		readonly headers: {
			readonly Host: string[];
		};
	};

	readonly gitRepositoryId: GkRepositoryId;
	readonly gitRepositoryData: GitRepositoryData;

	readonly createdAt: string;
	readonly updatedAt: string;
}
