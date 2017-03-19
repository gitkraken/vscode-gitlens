'use strict';
import { GitCommit, IGitAuthor, IGitCommitLine } from './commit';

export interface IGitBlame {
    repoPath: string;
    authors: Map<string, IGitAuthor>;
    commits: Map<string, GitCommit>;
    lines: IGitCommitLine[];
}

export interface IGitBlameLine {
    author: IGitAuthor;
    commit: GitCommit;
    line: IGitCommitLine;
}

export interface IGitBlameLines extends IGitBlame {
    allLines: IGitCommitLine[];
}

export interface IGitBlameCommitLines {
    author: IGitAuthor;
    commit: GitCommit;
    lines: IGitCommitLine[];
}