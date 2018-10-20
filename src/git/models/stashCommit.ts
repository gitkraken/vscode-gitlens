'use strict';
import { GitCommitType } from './commit';
import { GitFile, GitFileStatus } from './file';
import { GitLogCommit } from './logCommit';

export class GitStashCommit extends GitLogCommit {
    constructor(
        type: GitCommitType,
        public readonly stashName: string,
        repoPath: string,
        sha: string,
        date: Date,
        committedDate: Date,
        message: string,
        fileName: string,
        files: GitFile[],
        status?: GitFileStatus | undefined,
        originalFileName?: string | undefined,
        previousSha?: string | undefined,
        previousFileName?: string | undefined
    ) {
        super(
            type,
            repoPath,
            sha,
            'You',
            undefined,
            date,
            committedDate,
            message,
            fileName,
            files,
            status,
            originalFileName,
            previousSha === undefined ? `${sha}^` : previousSha,
            previousFileName
        );
    }

    get shortSha() {
        return this.stashName;
    }

    with(changes: {
        type?: GitCommitType;
        sha?: string | null;
        fileName?: string;
        date?: Date;
        committedDate?: Date;
        message?: string;
        originalFileName?: string | null;
        previousFileName?: string | null;
        previousSha?: string | null;
        status?: GitFileStatus;
        files?: GitFile[] | null;
    }): GitLogCommit {
        return new GitStashCommit(
            changes.type || this.type,
            this.stashName,
            this.repoPath,
            this.getChangedValue(changes.sha, this.sha)!,
            changes.date || this.date,
            changes.committedDate || this.committedDate,
            changes.message || this.message,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.files, this.files) || [],
            changes.status || this.status,
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName)
        );
    }
}
