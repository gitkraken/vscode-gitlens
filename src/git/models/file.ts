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

	/** For submodule (gitlink) entries, contains the submodule's commit SHAs */
	readonly submodule?: { readonly oid: string; readonly previousOid?: string } | undefined;
}

export interface GitFileWithCommit extends GitFile {
	readonly commit: GitCommit;
}
