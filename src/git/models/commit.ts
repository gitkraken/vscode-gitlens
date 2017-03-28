'use strict';
import { Uri } from 'vscode';
import { Git } from '../git';
import * as path from 'path';

export interface IGitAuthor {
    name: string;
    lineCount: number;
}

export interface IGitCommit {
    type: GitCommitType;
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

export interface IGitCommitLine {
    sha: string;
    previousSha?: string;
    line: number;
    originalLine: number;
    code?: string;
}

export type GitCommitType = 'blame' | 'file' | 'repo';

export class GitCommit implements IGitCommit {

    type: GitCommitType;
    lines: IGitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;
    workingFileName?: string;
    private _isUncommitted: boolean | undefined;

    constructor(
        type: GitCommitType,
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
        this.type = type;
        this.fileName = this.fileName && this.fileName.replace(/, ?$/, '');

        this.lines = lines || [];
        this.originalFileName = originalFileName;
        this.previousSha = previousSha;
        this.previousFileName = previousFileName;
    }

    get shortSha() {
        return this.sha.substring(0, 8);
    }

    get isUncommitted(): boolean {
        if (this._isUncommitted === undefined) {
            this._isUncommitted = Git.isUncommitted(this.sha);
        }
        return this._isUncommitted;
    }

    get previousShortSha() {
        return this.previousSha && this.previousSha.substring(0, 8);
    }

    get previousUri(): Uri {
        return this.previousFileName ? Uri.file(path.resolve(this.repoPath, this.previousFileName)) : this.uri;
    }

    get uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.originalFileName || this.fileName));
    }

    getFormattedPath(separator: string = ' \u00a0\u2022\u00a0 '): string {
        const directory = Git.normalizePath(path.dirname(this.fileName));
        return (!directory || directory === '.')
            ? path.basename(this.fileName)
            : `${path.basename(this.fileName)}${separator}${directory}`;
    }
}