import type { GitStashCommit } from './commit';

export interface GitStash {
	readonly repoPath: string;
	readonly stashes: Map<string, GitStashCommit>;
}
