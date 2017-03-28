'use strict';
import { IGitCommitLine } from './commit';
import { GitLogCommit } from './logCommit';
import { IGitStatusFile, GitStatusFileStatus } from './status';

export class GitStashCommit extends GitLogCommit {

    constructor(
        public stashName: string,
        repoPath: string,
        sha: string,
        fileName: string,
        date: Date,
        message: string,
        status?: GitStatusFileStatus,
        fileStatuses?: IGitStatusFile[],
        lines?: IGitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super('stash', repoPath, sha, fileName, undefined, date, message, status, fileStatuses, lines, originalFileName, previousSha, previousFileName);
    }
}