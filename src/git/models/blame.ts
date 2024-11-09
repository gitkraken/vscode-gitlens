import type { GitCommit, GitCommitLine } from './commit';

export interface GitBlame {
	readonly repoPath: string;
	readonly authors: Map<string, GitBlameAuthor>;
	readonly commits: Map<string, GitCommit>;
	readonly lines: GitCommitLine[];
}

export interface GitBlameAuthor {
	name: string;
	lineCount: number;
}

export interface GitBlameLine {
	readonly author?: GitBlameAuthor;
	readonly commit: GitCommit;
	readonly line: GitCommitLine;
}
