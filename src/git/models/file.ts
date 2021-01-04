'use strict';
import { GlyphChars } from '../../constants';
import { Strings } from '../../system';
import { GitUri } from '../gitUri';
import { GitLogCommit } from './logCommit';

export declare type GitFileStatus = GitFileConflictStatus | GitFileIndexStatus | GitFileWorkingTreeStatus;

export enum GitFileConflictStatus {
	AddedByBoth = 'AA',
	AddedByUs = 'AU',
	AddedByThem = 'UA',
	DeletedByBoth = 'DD',
	DeletedByUs = 'DU',
	DeletedByThem = 'UD',
	ModifiedByBoth = 'UU',
}

export enum GitFileIndexStatus {
	Added = 'A',
	Deleted = 'D',
	Modified = 'M',
	Renamed = 'R',
	Copied = 'C',
}

export enum GitFileWorkingTreeStatus {
	Added = 'A',
	Deleted = 'D',
	Modified = 'M',
	Untracked = '?',
	Ignored = '!',
}

export interface GitFile {
	status: GitFileConflictStatus | GitFileIndexStatus | GitFileWorkingTreeStatus;
	readonly repoPath?: string;
	readonly conflictStatus?: GitFileConflictStatus;
	readonly indexStatus?: GitFileIndexStatus;
	readonly workingTreeStatus?: GitFileWorkingTreeStatus;
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
		D: 'icon-status-deleted.svg',
		M: 'icon-status-modified.svg',
		R: 'icon-status-renamed.svg',
		C: 'icon-status-copied.svg',
		AA: 'icon-status-conflict.svg',
		AU: 'icon-status-conflict.svg',
		UA: 'icon-status-conflict.svg',
		DD: 'icon-status-conflict.svg',
		DU: 'icon-status-conflict.svg',
		UD: 'icon-status-conflict.svg',
		UU: 'icon-status-conflict.svg',
		T: 'icon-status-modified.svg',
	};

	export function getStatusIcon(status: GitFileStatus): string {
		return statusIconsMap[status] ?? 'icon-status-unknown.svg';
	}

	const statusCodiconsMap = {
		'!': '$(diff-ignored)',
		'?': '$(diff-added)',
		A: '$(diff-added)',
		D: '$(diff-removed)',
		M: '$(diff-modified)',
		R: '$(diff-renamed)',
		C: '$(diff-added)',
		AA: '$(warning)',
		AU: '$(warning)',
		UA: '$(warning)',
		DD: '$(warning)',
		DU: '$(warning)',
		UD: '$(warning)',
		UU: '$(warning)',
		T: '$(diff-modified)',
	};

	export function getStatusCodicon(status: GitFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
		return statusCodiconsMap[status] ?? missing;
	}

	const statusTextMap = {
		'!': 'Ignored',
		'?': 'Untracked',
		A: 'Added',
		D: 'Deleted',
		M: 'Modified',
		R: 'Renamed',
		C: 'Copied',
		AA: 'Conflict',
		AU: 'Conflict',
		UA: 'Conflict',
		DD: 'Conflict',
		DU: 'Conflict',
		UD: 'Conflict',
		UU: 'Conflict',
		T: 'Modified',
	};

	export function getStatusText(status: GitFileStatus): string {
		return statusTextMap[status] ?? 'Unknown';
	}
}
