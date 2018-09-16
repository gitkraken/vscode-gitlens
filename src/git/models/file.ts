'use strict';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitLogCommit } from './logCommit';

export declare type GitFileStatus = '!' | '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B';

export interface GitFile {
    status: GitFileStatus;
    readonly repoPath: string;
    readonly indexStatus: GitFileStatus | undefined;
    readonly workingTreeStatus: GitFileStatus | undefined;
    readonly fileName: string;
    readonly originalFileName?: string;
}

export interface GitFileWithCommit extends GitFile {
    readonly commit: GitLogCommit;
}

export namespace GitFile {
    export function getFormattedDirectory(
        file: GitFile,
        includeOriginal: boolean = false,
        relativeTo?: string
    ): string {
        const directory = GitUri.getDirectory(file.fileName, relativeTo);
        return includeOriginal && file.status === 'R' && file.originalFileName
            ? `${directory} ${Strings.pad(GlyphChars.ArrowLeft, 1, 1)} ${file.originalFileName}`
            : directory;
    }

    export function getFormattedPath(
        file: GitFile,
        options: { relativeTo?: string; separator?: string; suffix?: string } = {}
    ): string {
        return GitUri.getFormattedPath(file.fileName, options);
    }

    export function getRelativePath(file: GitFile, relativeTo?: string): string {
        return GitUri.getRelativePath(file.fileName, relativeTo);
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

    export function getStatusIcon(status: GitFileStatus): string {
        return statusIconsMap[status] || statusIconsMap['X'];
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

    export function getStatusOcticon(status: GitFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
        return statusOcticonsMap[status] || missing;
    }

    const statusTextMap = {
        '!': 'Ignored',
        '?': 'Untracked',
        A: 'Added',
        C: 'Copied',
        D: 'Deleted',
        M: 'Modified',
        R: 'Renamed',
        T: 'Modified',
        U: 'Conflict',
        X: 'Unknown',
        B: 'Unknown'
    };

    export function getStatusText(status: GitFileStatus): string {
        return statusTextMap[status] || statusTextMap['X'];
    }
}
