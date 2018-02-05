'use strict';
import { Strings } from '../../system';
import { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { GitUri } from '../gitUri';
import { GitLogCommit } from './logCommit';
import * as path from 'path';

export interface GitStatus {

    readonly branch: string;
    readonly repoPath: string;
    readonly sha: string;
    readonly state: {
        ahead: number;
        behind: number;
    };
    readonly upstream?: string;

    readonly files: GitStatusFile[];
}

export declare type GitStatusFileStatus = '!' | '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B';

export interface IGitStatusFile {
    status: GitStatusFileStatus;
    readonly fileName: string;
    readonly originalFileName?: string;
    readonly workTreeStatus: GitStatusFileStatus;
    readonly indexStatus: GitStatusFileStatus;
}

export interface IGitStatusFileWithCommit extends IGitStatusFile {
    readonly commit: GitLogCommit;
}

export class GitStatusFile implements IGitStatusFile {

    constructor(
        public readonly repoPath: string,
        public readonly indexStatus: GitStatusFileStatus,
        public readonly workTreeStatus: GitStatusFileStatus,
        public readonly fileName: string,
        public readonly originalFileName?: string
    ) { }

    get status(): GitStatusFileStatus {
        return (this.indexStatus || this.workTreeStatus || '?') as GitStatusFileStatus;
    }

    get staged() {
        return this.indexStatus !== undefined;
    }

    get uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.fileName));
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

    with(changes: { indexStatus?: GitStatusFileStatus | null, workTreeStatus?: GitStatusFileStatus | null, fileName?: string, originalFileName?: string | null }): GitStatusFile {
        return new GitStatusFile(
            this.repoPath,
            this.getChangedValue(changes.indexStatus, this.indexStatus) as GitStatusFileStatus,
            this.getChangedValue(changes.workTreeStatus, this.workTreeStatus) as GitStatusFileStatus,
            changes.fileName || this.fileName,
            this.getChangedValue(changes.originalFileName, this.originalFileName)
        );
    }

    protected getChangedValue<T>(change: T | null | undefined, original: T | undefined): T | undefined {
        if (change === undefined) return original;
        return change !== null ? change : undefined;
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
    return statusIconsMap[status] || statusIconsMap['X'];
}