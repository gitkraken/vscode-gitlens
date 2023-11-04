import type { Uri } from 'vscode';
import type { GitCommit } from './commit';
import type { GitDiffFiles } from './diff';
import type { Repository } from './repository';

export interface RevisionRange {
	baseSha: string;
	sha: string | undefined;
	branchName?: string; // TODO remove this
}

export interface GitPatch {
	readonly type: 'local';
	readonly contents: string;

	readonly id?: undefined;
	readonly uri?: Uri;

	files?: GitDiffFiles['files'];
	range?: RevisionRange;
	repo?: Repository;
	commit?: GitCommit;

	baseRef?: string;
}

export interface GitRepositoryData {
	readonly id: string;
	readonly createdAt: string;
	readonly updatedAt: string;

	readonly initialCommitSha?: string;
	readonly remote?: {
		readonly url?: string;
		readonly domain?: string;
		readonly path?: string;
	};
	readonly provider?: {
		readonly id?: string;
		readonly repoDomain?: string;
		readonly repoName?: string;
		readonly repoOwnerDomain?: string;
	};
}

export interface GitCloudPatch {
	readonly type: 'cloud';
	contents?: string;

	readonly id: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseBranchName: string;
	readonly baseCommitSha: string;

	readonly gitRepositoryId?: string;

	repoData?: GitRepositoryData;

	files?: GitDiffFiles['files'];
	range?: RevisionRange;
	repo?: Repository;
	commit?: GitCommit;

	baseRef?: string;
}
