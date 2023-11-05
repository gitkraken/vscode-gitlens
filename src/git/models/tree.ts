export interface GitTreeEntry {
	commitSha: string;
	path: string;
	size: number;
	type: 'blob' | 'tree';
}

export interface GitLsFilesEntry {
	mode: string;
	path: string;
	object: string;
	stage: number;
}
