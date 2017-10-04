'use strict';
import { GitCommit, GitCommitLine, GitCommitType } from './commit';

export class GitBlameCommit extends GitCommit {

    constructor(
        repoPath: string,
        sha: string,
        fileName: string,
        author: string,
        date: Date,
        message: string,
        public lines: GitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super(GitCommitType.Blame, repoPath, sha, fileName, author, date, message, originalFileName, previousSha, previousFileName);
    }
}