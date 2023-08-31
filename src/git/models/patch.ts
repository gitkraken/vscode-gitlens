import type { Uri } from 'vscode';
import type { GitCommit } from './commit';
import type { GitDiffFiles } from './diff';
import type { Repository } from './repository';

export interface LocalPatch {
	readonly type: 'local';

	patch: GitPatch;
}

export interface GitPatch {
	readonly type: 'file';
	readonly id?: undefined;
	readonly uri: Uri;
	readonly contents: string;

	baseRef?: string;
	files?: GitDiffFiles['files'];
	repo?: Repository;
	commit?: GitCommit;
}

export interface GitCloudPatch {
	readonly type: 'cloud';
	readonly id: string;
	readonly uri: Uri;
	readonly contents: string;

	baseRef?: string;
	files?: GitDiffFiles['files'];
	repo: Repository;
	commit?: GitCommit;
}
