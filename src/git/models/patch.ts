import type { Uri } from 'vscode';
import type { GitCommit } from './commit';
import type { GitDiffFiles } from './diff';
import type { Repository } from './repository';

export interface GitPatch {
	readonly _brand: 'file';
	readonly id?: undefined;
	readonly uri: Uri;
	readonly contents: string;

	baseRef?: string;
	files?: GitDiffFiles['files'];
	repo?: Repository;
	commit?: GitCommit;
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
	readonly _brand: 'cloud';
	readonly id: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseBranchName: string;
	readonly baseCommitSha: string;

	readonly gitRepositoryId?: string;

	contents?: string;

	baseRef?: string;
	files?: GitDiffFiles['files'];
	repo?: Repository;
	repoData?: GitRepositoryData;
	commit?: GitCommit;
}
