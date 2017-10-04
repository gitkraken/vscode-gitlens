'use strict';
import { GitCommitType } from './commit';
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
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super(GitCommitType.Stash, repoPath, sha, fileName, 'You', date, message, status, fileStatuses, originalFileName, previousSha, previousFileName);
    }

    get shortSha() {
        return this.stashName;
    }
}