'use strict';

export interface IGitStatus {

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

export class GitStatusFile {

    originalFileName?: string;

    constructor(public repoPath: string, public status: GitStatusFileStatus, public staged: boolean, public fileName: string, originalFileName?: string) {
        this.originalFileName = originalFileName;
    }

    getIcon() {
        return getGitStatusIcon(this.status);
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