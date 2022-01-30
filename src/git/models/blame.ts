import { GitAuthor, GitCommit2, GitCommitLine } from './commit';

export interface GitBlame {
	readonly repoPath: string;
	readonly authors: Map<string, GitAuthor>;
	readonly commits: Map<string, GitCommit2>;
	readonly lines: GitCommitLine[];
}

export interface GitBlameLine {
	readonly author?: GitAuthor;
	readonly commit: GitCommit2;
	readonly line: GitCommitLine;
}

export interface GitBlameLines extends GitBlame {
	readonly allLines: GitCommitLine[];
}

export interface GitBlameCommitLines {
	readonly author: GitAuthor;
	readonly commit: GitCommit2;
	readonly lines: GitCommitLine[];
}
