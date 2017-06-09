'use strict';
import { Uri } from 'vscode';
import * as path from 'path';

export interface GitStatus {

    branch: string;
    repoPath: string;
    sha: string;
    state: {
        ahead: number;
        behind: number;
    };
    upstream?: string;

    files: GitStatusFile[];
}

export declare type GitStatusFileStatus = '!' | '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'U';

export interface IGitStatusFile {
    status: GitStatusFileStatus;
    fileName: string;
    originalFileName?: string;
}

export class GitStatusFile implements IGitStatusFile {

    originalFileName?: string;

    constructor(public repoPath: string, public status: GitStatusFileStatus, public fileName: string, public staged: boolean, originalFileName?: string) {
        this.originalFileName = originalFileName;
    }

    getIcon() {
        return getGitStatusIcon(this.status);
    }

    get Uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
    }
}

const statusOcticonsMap = {
    '!': '$(diff-ignored)',
    '?': '$(diff-added)',
    A: '$(diff-added)',
    C: '$(diff-added)',
    D: '$(diff-removed)',
    M: '$(diff-modified)',
    R: '$(diff-renamed)',
    U: '$(question)'
};

export function getGitStatusIcon(status: GitStatusFileStatus, missing: string = '\u00a0\u00a0\u00a0\u00a0'): string {
    return statusOcticonsMap[status] || missing;
}