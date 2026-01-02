import type { GitStashCommit } from './commit.js';

export interface GitStash {
	readonly repoPath: string;
	readonly stashes: ReadonlyMap<string, GitStashCommit>;
}
