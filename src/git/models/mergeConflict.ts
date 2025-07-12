export interface MergeConflict {
	repoPath: string;
	branch: string;
	target: string;
	files: MergeConflictFile[];
}

export interface MergeConflictFile {
	path: string;
}
