'use strict';
import { Strings } from '../../system';
import { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { GitUri } from '../gitUri';
import { GitLogCommit } from './logCommit';
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

export declare type GitStatusFileStatus = '!' | '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B';

export interface IGitStatusFile {
    status: GitStatusFileStatus;
    fileName: string;
    originalFileName?: string;
    workTreeStatus: GitStatusFileStatus;
    indexStatus: GitStatusFileStatus;
}

export interface IGitStatusFileWithCommit extends IGitStatusFile {
    commit: GitLogCommit;
}

export class GitStatusFile implements IGitStatusFile {

    originalFileName?: string;

    constructor(
        public repoPath: string,
        public status: GitStatusFileStatus,
        public workTreeStatus: GitStatusFileStatus,
        public indexStatus: GitStatusFileStatus,
        public fileName: string,
        public staged: boolean,
        originalFileName?: string
    ) {
        this.originalFileName = originalFileName;
    }

    getFormattedDirectory(includeOriginal: boolean = false): string {
        return GitStatusFile.getFormattedDirectory(this, includeOriginal);
    }

    getFormattedPath(separator: string = Strings.pad(GlyphChars.Dot, 2, 2)): string {
        return GitStatusFile.getFormattedPath(this, separator);
    }

    getOcticon() {
        return getGitStatusOcticon(this.status);
    }

    get Uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
    }

    static getFormattedDirectory(status: IGitStatusFile, includeOriginal: boolean = false, relativeTo?: string): string {
        const directory = GitUri.getDirectory(status.fileName, relativeTo);
        return (includeOriginal && status.status === 'R' && status.originalFileName)
            ? `${directory} ${Strings.pad(GlyphChars.ArrowLeft, 1, 1)} ${status.originalFileName}`
            : directory;
    }

    static getFormattedPath(status: IGitStatusFile, separator: string = Strings.pad(GlyphChars.Dot, 2, 2), relativeTo?: string): string {
        return GitUri.getFormattedPath(status.fileName, separator, relativeTo);
    }

    static getRelativePath(status: IGitStatusFile, relativeTo?: string): string {
        return GitUri.getRelativePath(status.fileName, relativeTo);
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
    T: '$(diff-modified)',
    U: '$(alert)',
    X: '$(question)',
    B: '$(question)'
};

export function getGitStatusOcticon(status: GitStatusFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
    return statusOcticonsMap[status] || missing;
}

const statusIconsMap = {
    '!': 'icon-status-ignored.svg',
    '?': 'icon-status-untracked.svg',
    A: 'icon-status-added.svg',
    C: 'icon-status-copied.svg',
    D: 'icon-status-deleted.svg',
    M: 'icon-status-modified.svg',
    R: 'icon-status-renamed.svg',
    T: 'icon-status-modified.svg',
    U: 'icon-status-conflict.svg',
    X: 'icon-status-unknown.svg',
    B: 'icon-status-unknown.svg'
};

export function getGitStatusIcon(status: GitStatusFileStatus): string {
    return statusIconsMap[status];
}