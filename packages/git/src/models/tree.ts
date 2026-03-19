export type GitTreeType = 'blob' | 'tree' | 'commit';

export interface GitTreeEntry {
	ref: string;
	oid: string;
	path: string;
	size: number;
	/** Type of tree entry: 'blob' for files, 'tree' for directories, 'commit' for submodules */
	type: GitTreeType;
}
