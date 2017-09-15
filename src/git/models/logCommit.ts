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
            this.fileStatuses = fileStatuses.filter(_ => !!_.fileName);

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
        const added = this.fileStatuses.filter(_ => _.status === 'A' || _.status === '?').length;
        const deleted = this.fileStatuses.filter(_ => _.status === 'D').length;
        const changed = this.fileStatuses.filter(_ => _.status !== 'A' && _.status !== '?' && _.status !== 'D').length;
        return `+${added} ~${changed} -${deleted}`;
    }
}