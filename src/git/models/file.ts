import type { GitCommit } from './commit.js';
import type {
	GitFileConflictStatus,
	GitFileIndexStatus,
	GitFileStatus,
	GitFileWorkingTreeStatus,
} from './fileStatus.js';

export interface GitFile {
	readonly path: string;
	readonly originalPath?: string;
	status: GitFileStatus;
	readonly repoPath?: string;

	readonly conflictStatus?: GitFileConflictStatus;
	readonly indexStatus?: GitFileIndexStatus;
	readonly workingTreeStatus?: GitFileWorkingTreeStatus;

	/** Indicates this is a submodule (gitlink) rather than a regular file */
	readonly isSubmodule?: boolean;
}

export interface GitFileWithCommit extends GitFile {
	readonly commit: GitCommit;
}
