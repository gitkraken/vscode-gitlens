'use strict';
import { GitAuthor, GitCommit, GitCommitLine } from './commit';

export interface GitBlame {
    repoPath: string;
    authors: Map<string, GitAuthor>;
    commits: Map<string, GitCommit>;
    lines: GitCommitLine[];
}

export interface GitBlameLine {
    author: GitAuthor;
    commit: GitCommit;
    line: GitCommitLine;
}

export interface GitBlameLines extends GitBlame {
    allLines: GitCommitLine[];
}

export interface GitBlameCommitLines {
    author: GitAuthor;
    commit: GitCommit;
    lines: GitCommitLine[];
}