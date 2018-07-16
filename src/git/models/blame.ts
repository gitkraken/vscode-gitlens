'use strict';
import { GitBlameCommit } from './blameCommit';
import { GitAuthor, GitCommitLine } from './commit';

export interface GitBlame {
    readonly repoPath: string;
    readonly authors: Map<string, GitAuthor>;
    readonly commits: Map<string, GitBlameCommit>;
    readonly lines: GitCommitLine[];
}

export interface GitBlameLine {
    readonly author?: GitAuthor;
    readonly commit: GitBlameCommit;
    readonly line: GitCommitLine;
}

export interface GitBlameLines extends GitBlame {
    readonly allLines: GitCommitLine[];
}

export interface GitBlameCommitLines {
    readonly author: GitAuthor;
    readonly commit: GitBlameCommit;
    readonly lines: GitCommitLine[];
}
