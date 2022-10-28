import type { GitStashCommit } from './commit';

export interface GitStash {
	readonly repoPath: string;
	readonly commits: Map<string, GitStashCommit>;
}
