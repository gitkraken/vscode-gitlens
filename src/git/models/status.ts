'use strict';
import { Strings } from '../../system';
import { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { GitUri } from '../gitUri';
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

    getFormattedDirectory(includeOriginal: boolean = false): string {
        return GitStatusFile.getFormattedDirectory(this, includeOriginal);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2)): string {
        return GitUri.getFormattedPath(this.fileName, separator);
    }

    getOcticon() {
        return getGitStatusOcticon(this.status);
    }

    get Uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
    }

    static getFormattedDirectory(status: IGitStatusFile, includeOriginal: boolean = false): string {
        const directory = GitUri.getDirectory(status.fileName);
        return (includeOriginal && status.status === 'R' && status.originalFileName)
            ? `${directory} ${Strings.pad(GlyphChars.ArrowLeft, 1, 1)} ${status.originalFileName}`
            : directory;
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

export function getGitStatusOcticon(status: GitStatusFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
    return statusOcticonsMap[status] || missing;
}