export interface GitTreeEntry {
	commitSha: string;
	path: string;
	size: number;
	type: 'blob' | 'tree';
}
