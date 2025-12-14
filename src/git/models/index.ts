import type { GitFile } from './file';
import type { GitFileConflictStatus } from './fileStatus';

export type GitIndexVersion = 'normal' | 'base' | 'current' | 'incoming';
export interface GitIndexFile {
	mode: string;
	oid: string;
	path: string;
	version: GitIndexVersion | undefined;
}

export interface GitConflictRevision {
	readonly mode: string;
	readonly oid: string;
	readonly version: GitIndexVersion | undefined;
}

export interface GitConflictFile extends GitFile {
	readonly path: string;
	readonly repoPath: string;
	readonly status: GitFileConflictStatus;
	readonly conflictStatus: GitFileConflictStatus;

	readonly base?: GitConflictRevision;
	readonly current?: GitConflictRevision;
	readonly incoming?: GitConflictRevision;
}
