'use strict';
import { Uri } from 'vscode';
import Git from './git';
import * as path from 'path';

export interface IGitEnricher<T> {
    enrich(data: string, ...args: any[]): T;
}

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

export interface IGitAuthor {
    name: string;
    lineCount: number;
}

interface IGitCommit {
    repoPath: string;
    sha: string;
    fileName: string;
    author: string;
    date: Date;
    message: string;
    lines: IGitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;

    readonly isUncommitted: boolean;
    previousUri: Uri;
    uri: Uri;
}

export class GitCommit implements IGitCommit {

    lines: IGitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;
    private _isUncommitted: boolean | undefined;

    constructor(
        public repoPath: string,
        public sha: string,
        public fileName: string,
        public author: string,
        public date: Date,
        public message: string,
        lines?: IGitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        this.fileName = this.fileName.replace(/, ?$/, '');

        this.lines = lines || [];
        this.originalFileName = originalFileName;
        this.previousSha = previousSha;
        this.previousFileName = previousFileName;
    }

    get isUncommitted(): boolean {
        if (this._isUncommitted === undefined) {
            this._isUncommitted = Git.isUncommitted(this.sha);
        }
        return this._isUncommitted;
    }

    get previousUri(): Uri {
        return this.previousFileName ? Uri.file(path.join(this.repoPath, this.previousFileName)) : this.uri;
    }

    get uri(): Uri {
        return Uri.file(path.join(this.repoPath, this.originalFileName || this.fileName));
    }

    getFormattedPath(separator: string = ' \u00a0\u2022\u00a0 '): string {
        const directory = path.dirname(this.fileName);
        return (!directory || directory === '.')
            ? path.basename(this.fileName)
            : `${path.basename(this.fileName)}${separator}${directory}`;
    }
}

export type GitLogType = 'file' | 'repo';

export class GitLogCommit extends GitCommit {

    fileStatuses: { status: GitFileStatus, fileName: string }[];
    status: GitFileStatus;

    constructor(
        public type: GitLogType,
        repoPath: string,
        sha: string,
        fileName: string,
        author: string,
        date: Date,
        message: string,
        status?: GitFileStatus,
        fileStatuses?: { status: GitFileStatus, fileName: string }[],
        lines?: IGitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        super(repoPath, sha, fileName, author, date, message, lines, originalFileName, previousSha, previousFileName);
        this.status = status;

        if (fileStatuses) {
            this.fileStatuses = fileStatuses.filter(_ => !!_.fileName);
        }
        else {
            this.fileStatuses = [{ status: status, fileName: fileName }];
        }
    }
}

export interface IGitCommitLine {
    sha: string;
    previousSha?: string;
    line: number;
    originalLine: number;
    code?: string;
}

export interface IGitLog {
    repoPath: string;
    authors: Map<string, IGitAuthor>;
    commits: Map<string, GitLogCommit>;
}

export declare type GitFileStatus = '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'U';

export class GitFileStatusItem {

    staged: boolean;
    status: GitFileStatus;
    fileName: string;

    constructor(public repoPath: string, status: string) {
        this.fileName = status.substring(3);
        this.parseStatus(status);
    }

    private parseStatus(status: string) {
        const indexStatus = status[0].trim();
        const workTreeStatus = status[1].trim();

        this.staged = !!indexStatus;
        this.status = (indexStatus || workTreeStatus || 'U') as GitFileStatus;
    }
}

const statusOcticonsMap = {
    '?': '$(diff-ignored)',
    A: '$(diff-added)',
    C: '$(diff-added)',
    D: '$(diff-removed)',
    M: '$(diff-modified)',
    R: '$(diff-renamed)',
    U: '$(question)'
};
export function getGitStatusIcon(status: GitFileStatus, missing: string = '\u00a0\u00a0\u00a0\u00a0'): string {
    return statusOcticonsMap[status] || missing;
}