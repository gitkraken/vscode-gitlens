'use strict';
import { Uri } from 'vscode';
import { GitCommit, GitCommitType } from './commit';
import { Git } from '../git';
import { GitStatusFileStatus, IGitStatusFile } from './status';
import * as path from 'path';

export class GitLogCommit extends GitCommit {

    fileNames: string;
    fileStatuses: IGitStatusFile[];
    nextSha?: string;
    nextFileName?: string;
    parentShas: string[];
    status?: GitStatusFileStatus;

    constructor(
        type: GitCommitType,
        repoPath: string,
        sha: string,
        fileName: string,
        author: string,
        date: Date,
        message: string,
        status?: GitStatusFileStatus,
        fileStatuses?: IGitStatusFile[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super(type, repoPath, sha, fileName, author, date, message, originalFileName, previousSha, previousFileName);

        this.fileNames = this.fileName;

        if (fileStatuses) {
            this.fileStatuses = fileStatuses.filter(f => !!f.fileName);

            const fileStatus = this.fileStatuses[0];
            this.fileName = fileStatus.fileName;
            this.status = fileStatus.status;
        }
        else {
            if (fileName === undefined) {
                this.fileStatuses = [];
            }
            else {
                this.fileStatuses = [{ status: status, fileName: fileName, originalFileName: originalFileName } as IGitStatusFile];
            }
            this.status = status;
        }
    }

    get isMerge() {
        return this.parentShas && this.parentShas.length > 1;
    }

    get nextShortSha() {
        return this.nextSha && Git.shortenSha(this.nextSha);
    }

    get nextUri(): Uri {
        return this.nextFileName ? Uri.file(path.resolve(this.repoPath, this.nextFileName)) : this.uri;
    }

    getDiffStatus(): string {
        let added = 0;
        let deleted = 0;
        let changed = 0;

        for (const f of this.fileStatuses) {
            switch (f.status) {
                case 'A':
                case '?':
                    added++;
                    break;
                case 'D':
                    deleted++;
                    break;
                default:
                    changed++;
                    break;
            }
        }

        return `+${added} ~${changed} -${deleted}`;
    }

    toFileCommit(status: IGitStatusFile): GitLogCommit {
        return this.with({
            type: GitCommitType.File,
            fileName: status.fileName,
            originalFileName: status.originalFileName,
            previousFileName: status.originalFileName || status.fileName,
            status: status.status,
            fileStatuses: null
        });
    }

    with(changes: { type?: GitCommitType, sha?: string | null, fileName?: string, author?: string, date?: Date, message?: string, originalFileName?: string | null, previousFileName?: string | null, previousSha?: string | null, status?: GitStatusFileStatus, fileStatuses?: IGitStatusFile[] | null }): GitLogCommit {
        return new GitLogCommit(changes.type || this.type,
            this.repoPath,
            this.getChangedValue(changes.sha, this.sha)!,
            changes.fileName || this.fileName,
            changes.author || this.author,
            changes.date || this.date,
            changes.message || this.message,
            changes.status || this.status,
            this.getChangedValue(changes.fileStatuses, this.fileStatuses),
            this.getChangedValue(changes.originalFileName, this.originalFileName),
            this.getChangedValue(changes.previousSha, this.previousSha),
            this.getChangedValue(changes.previousFileName, this.previousFileName));
    }
}