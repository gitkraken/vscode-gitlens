import type { Uri } from 'vscode';
import type { GitCommit } from './commit';
import type { GitDiffFiles } from './diff';
import type { Repository } from './repository';

/**
 * For a single commit `to` is the commit SHA and `from` is its parent `<sha>^`
 * For a commit range `to` is the tip SHA and `from` is the base SHA
 * For a WIP `to` is the "uncommitted" SHA and `from` is the current HEAD SHA
 */
export interface PatchRevisionRange {
	from: string;
	to: string;
}

export interface GitPatch {
	readonly type: 'local';
	readonly contents: string;

	readonly id?: undefined;
	readonly uri?: Uri;

	baseRef?: string;
	commit?: GitCommit;
	files?: GitDiffFiles['files'];
	repository?: Repository;
}
