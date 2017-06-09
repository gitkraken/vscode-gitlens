'use strict';
import { GitCommitLine } from './commit';
import { GitLogCommit } from './logCommit';
import { GitStatusFileStatus, IGitStatusFile } from './status';

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
        lines?: GitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super('stash', repoPath, sha, fileName, 'You', date, message, status, fileStatuses, lines, originalFileName, previousSha, previousFileName);
    }

    get shortSha() {
        return this.stashName;
    }
}