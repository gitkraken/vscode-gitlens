'use strict';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitLogCommit } from './logCommit';

export declare type GitFileStatus = '!' | '?' | 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B';

export interface GitFile {
	status: GitFileStatus;
	readonly repoPath?: string;
	readonly indexStatus?: GitFileStatus;
	readonly workingTreeStatus?: GitFileStatus;
	readonly fileName: string;
	readonly originalFileName?: string;
}

export interface GitFileWithCommit extends GitFile {
	readonly commit: GitLogCommit;
}

export namespace GitFile {
	export function is(file: any | undefined): file is GitFile {
		return (
			file != null &&
			'fileName' in file &&
			typeof file.fileName === 'string' &&
			'status' in file &&
			typeof file.status === 'string' &&
			file.status.length === 1
		);
	}

	export function getFormattedDirectory(
		file: GitFile,
		includeOriginal: boolean = false,
		relativeTo?: string,
	): string {
		const directory = GitUri.getDirectory(file.fileName, relativeTo);
		return includeOriginal && (file.status === 'R' || file.status === 'C') && file.originalFileName
			? `${directory} ${Strings.pad(GlyphChars.ArrowLeft, 1, 1)} ${file.originalFileName}`
			: directory;
	}

	export function getFormattedPath(
		file: GitFile,
		options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {},
	): string {
		return GitUri.getFormattedPath(file.fileName, options);
	}

	export function getOriginalRelativePath(file: GitFile, relativeTo?: string): string {
		if (file.originalFileName == null || file.originalFileName.length === 0) return '';

		return GitUri.relativeTo(file.originalFileName, relativeTo);
	}

	export function getRelativePath(file: GitFile, relativeTo?: string): string {
		return GitUri.relativeTo(file.fileName, relativeTo);
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
		B: 'icon-status-unknown.svg',
	};

	export function getStatusIcon(status: GitFileStatus): string {
		return statusIconsMap[status] || statusIconsMap['X'];
	}

	const statusCodiconsMap = {
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
		B: '$(question)',
	};

	export function getStatusCodicon(status: GitFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
		return statusCodiconsMap[status] || missing;
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
		B: 'Unknown',
	};

	export function getStatusText(status: GitFileStatus): string {
		return statusTextMap[status] || statusTextMap['X'];
	}
}
