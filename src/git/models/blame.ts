'use strict';
import { GitAuthor, GitCommitLine } from './commit';
import { GitBlameCommit } from './blameCommit';

export interface GitBlame {
    repoPath: string;
    authors: Map<string, GitAuthor>;
    commits: Map<string, GitBlameCommit>;
    lines: GitCommitLine[];
}

export interface GitBlameLine {
    author: GitAuthor;
    commit: GitBlameCommit;
    line: GitCommitLine;
}

export interface GitBlameLines extends GitBlame {
    allLines: GitCommitLine[];
}

export interface GitBlameCommitLines {
    author: GitAuthor;
    commit: GitBlameCommit;
    lines: GitCommitLine[];
}