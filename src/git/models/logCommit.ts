'use strict';
import { Uri } from 'vscode';
import { GitCommit, IGitCommitLine } from './commit';
import { IGitStatusFile, GitStatusFileStatus } from './status';
import * as path from 'path';

export type GitLogType = 'file' | 'repo';

export class GitLogCommit extends GitCommit {

    fileNames: string;
    fileStatuses: IGitStatusFile[];
    nextSha?: string;
    nextFileName?: string;
    parentShas: string[];
    status: GitStatusFileStatus;

    constructor(
        public type: GitLogType,
        repoPath: string,
        sha: string,
        fileName: string,
        author: string,
        date: Date,
        message: string,
        status?: GitStatusFileStatus,
        fileStatuses?: IGitStatusFile[],
        lines?: IGitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super(repoPath, sha, fileName, author, date, message, lines, originalFileName, previousSha, previousFileName);
        this.status = status;

        this.fileNames = this.fileName;

        if (fileStatuses) {
            this.fileStatuses = fileStatuses.filter(_ => !!_.fileName);
            this.fileName = this.fileStatuses[0].fileName;
        }
        else {
            this.fileStatuses = [{ status: status, fileName: fileName }];
        }
    }

    get isMerge() {
        return this.parentShas && this.parentShas.length > 1;
    }

    get nextShortSha() {
        return this.nextSha && this.nextSha.substring(0, 8);
    }

    get nextUri(): Uri {
        return this.nextFileName ? Uri.file(path.resolve(this.repoPath, this.nextFileName)) : this.uri;
    }
}