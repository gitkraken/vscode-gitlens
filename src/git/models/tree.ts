'use strict';

export interface GitTree {
	commitSha: string;
	path: string;
	size: number;
	type: 'blob' | 'tree';
}
