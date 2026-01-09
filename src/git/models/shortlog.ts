import type { GitContributor } from './contributor.js';

export interface GitShortLog {
	readonly repoPath: string;
	readonly contributors: GitContributor[];
}
