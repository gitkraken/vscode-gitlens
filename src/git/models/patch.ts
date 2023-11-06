import type { Uri } from 'vscode';
import type { GitCommit } from './commit';
import type { GitDiffFiles } from './diff';
import type { Repository } from './repository';

/**
 * For a single commit `sha` is the commit SHA and `baseSha` is its parent `<sha>^`
 * For a commit range `sha` is the tip SHA and `baseSha` is the base SHA
 * For a WIP `sha` is the "uncommitted" SHA and `baseSha` is the current HEAD SHA
 */
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

	baseRef?: string;
	commit?: GitCommit;
	files?: GitDiffFiles['files'];
	range?: RevisionRange;
	repository?: Repository;
}
