'use strict';
import { GitCommitType } from './commit';
import { GitLogCommit } from './logCommit';
import { GitStatusFileStatus, IGitStatusFile } from './status';

export class GitStashCommit extends GitLogCommit {

    constructor(
        type: GitCommitType,
        public readonly stashName: string,
        repoPath: string,
        sha: string,
        date: Date,
        message: string,
        fileName: string,
        fileStatuses: IGitStatusFile[],
        status?: GitStatusFileStatus | undefined,
        originalFileName?: string | undefined,
        previousSha?: string | undefined,
        previousFileName?: string | undefined
    ) {
        super(
            type,
            repoPath,
            sha,
            'You',
            date,
            message,
            fileName,
            fileStatuses,
            status,
            originalFileName,
            previousSha === undefined ? `${sha}^` : previousSha,
            previousFileName
        );
    }

    get shortSha() {
        return this.stashName;
    }

    with(changes: { type?: GitCommitType, sha?: string | null, fileName?: string, date?: Date, message?: string, originalFileName?: string | null, previousFileName?: string | null, previousSha?: string | null, status?: GitStatusFileStatus, fileStatuses?: IGitStatusFile[] | null }): GitLogCommit {
        return new GitStashCommit(
            changes.type || this.type,
            this.stashName,
            this.repoPath,
            this.getChangedValue(changes.sha, this.sha)!,
            changes.date || this.date,
            changes.message || this.message,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.fileStatuses, this.fileStatuses) || [],
            changes.status || this.status,
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName)
        );
    }
}