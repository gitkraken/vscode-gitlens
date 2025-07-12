import type { GitCommit } from './commit';
import type { GitFileConflictStatus, GitFileIndexStatus, GitFileStatus, GitFileWorkingTreeStatus } from './fileStatus';

export interface GitFile {
	readonly path: string;
	readonly originalPath?: string;
	status: GitFileStatus;
	readonly repoPath?: string;

	readonly conflictStatus?: GitFileConflictStatus;
	readonly indexStatus?: GitFileIndexStatus;
	readonly workingTreeStatus?: GitFileWorkingTreeStatus;
}

export interface GitFileWithCommit extends GitFile {
	readonly commit: GitCommit;
}
