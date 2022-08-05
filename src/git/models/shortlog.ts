import type { GitContributor } from './contributor';

export interface GitShortLog {
	readonly repoPath: string;
	readonly contributors: GitContributor[];
}
