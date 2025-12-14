export interface GitTreeEntry {
	ref: string;
	oid: string;
	path: string;
	size: number;
	type: 'blob' | 'tree';
}
