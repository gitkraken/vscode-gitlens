export interface GitTreeEntry {
	ref: string;
	oid: string;
	path: string;
	size: number;
	type: 'blob' | 'tree';
}

export interface GitLsFilesEntry {
	mode: string;
	oid: string;
	path: string;
	stage: number;
}
