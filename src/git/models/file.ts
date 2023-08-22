import type { Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { formatPath } from '../../system/formatPath';
import { relativeDir, splitPath } from '../../system/path';
import { pad, pluralize } from '../../system/string';
import type { GitCommit } from './commit';

export declare type GitFileStatus = GitFileConflictStatus | GitFileIndexStatus | GitFileWorkingTreeStatus;

export const enum GitFileConflictStatus {
	AddedByBoth = 'AA',
	AddedByUs = 'AU',
	AddedByThem = 'UA',
	DeletedByBoth = 'DD',
	DeletedByUs = 'DU',
	DeletedByThem = 'UD',
	ModifiedByBoth = 'UU',
}

export const enum GitFileIndexStatus {
	Modified = 'M',
	Added = 'A',
	Deleted = 'D',
	Renamed = 'R',
	Copied = 'C',
	Unchanged = '.',
	Untracked = '?',
	Ignored = '!',
	UpdatedButUnmerged = 'U',
}

export const enum GitFileWorkingTreeStatus {
	Modified = 'M',
	Added = 'A',
	Deleted = 'D',
	Untracked = '?',
	Ignored = '!',
}

export interface GitFile {
	readonly path: string;
	readonly originalPath?: string;
	status: GitFileStatus;
	readonly repoPath?: string;

	readonly conflictStatus?: GitFileConflictStatus;
	readonly indexStatus?: GitFileIndexStatus;
	readonly workingTreeStatus?: GitFileWorkingTreeStatus;
}

export interface GitFileWithCommit extends GitFile {
	readonly commit: GitCommit;
}

export function isGitFile(file: any | undefined): file is GitFile {
	return (
		file != null &&
		'fileName' in file &&
		typeof file.fileName === 'string' &&
		'status' in file &&
		typeof file.status === 'string' &&
		file.status.length === 1
	);
}

export function getGitFileFormattedDirectory(
	file: GitFile,
	includeOriginal: boolean = false,
	relativeTo?: string,
): string {
	const directory = relativeDir(file.path, relativeTo);
	return includeOriginal && (file.status === 'R' || file.status === 'C') && file.originalPath
		? `${directory} ${pad(GlyphChars.ArrowLeft, 1, 1)} ${file.originalPath}`
		: directory;
}

export function getGitFileFormattedPath(
	file: GitFile,
	options: { relativeTo?: string; suffix?: string; truncateTo?: number } = {},
): string {
	return formatPath(file.path, options);
}

export function getGitFileOriginalRelativePath(file: GitFile, relativeTo?: string): string {
	if (!file.originalPath) return '';

	return splitPath(file.originalPath, relativeTo)[0];
}

export function getGitFileRelativePath(file: GitFile, relativeTo?: string): string {
	return splitPath(file.path, relativeTo)[0];
}

const statusIconsMap = {
	'.': undefined,
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
	U: 'icon-status-modified.svg',
};

export function getGitFileStatusIcon(status: GitFileStatus): string {
	return statusIconsMap[status] ?? 'icon-status-unknown.svg';
}

const statusCodiconsMap = {
	'.': undefined,
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
	U: '$(diff-modified)',
};

export function getGitFileStatusCodicon(status: GitFileStatus, missing: string = GlyphChars.Space.repeat(4)): string {
	return statusCodiconsMap[status] ?? missing;
}

const statusTextMap = {
	'.': 'Unchanged',
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
	U: 'Updated but Unmerged',
};

export function getGitFileStatusText(status: GitFileStatus): string {
	return statusTextMap[status] ?? 'Unknown';
}

export interface GitFileChangeStats {
	additions: number;
	deletions: number;
	changes: number;
}

export interface GitFileChangeShape {
	readonly path: string;
	readonly originalPath?: string | undefined;
	readonly status: GitFileStatus;
	readonly repoPath: string;
}

export class GitFileChange implements GitFileChangeShape {
	static is(file: any): file is GitFileChange {
		return file instanceof GitFileChange;
	}

	constructor(
		public readonly repoPath: string,
		public readonly path: string,
		public readonly status: GitFileStatus,
		public readonly originalPath?: string | undefined,
		public readonly previousSha?: string | undefined,
		public readonly stats?: GitFileChangeStats | undefined,
	) {}

	get hasConflicts() {
		switch (this.status) {
			case GitFileConflictStatus.AddedByThem:
			case GitFileConflictStatus.AddedByUs:
			case GitFileConflictStatus.AddedByBoth:
			case GitFileConflictStatus.DeletedByThem:
			case GitFileConflictStatus.DeletedByUs:
			case GitFileConflictStatus.DeletedByBoth:
			case GitFileConflictStatus.ModifiedByBoth:
				return true;

			default:
				return false;
		}
	}

	@memoize()
	get uri(): Uri {
		return Container.instance.git.getAbsoluteUri(this.path, this.repoPath);
	}

	@memoize()
	get originalUri(): Uri | undefined {
		return this.originalPath ? Container.instance.git.getAbsoluteUri(this.originalPath, this.repoPath) : undefined;
	}

	@memoize()
	getWorkingUri(): Promise<Uri | undefined> {
		return Container.instance.git.getWorkingUri(this.repoPath, this.uri);
	}

	formatStats(options?: {
		compact?: boolean;
		empty?: string;
		expand?: boolean;
		prefix?: string;
		separator?: string;
		suffix?: string;
	}): string {
		if (this.stats == null) return options?.empty ?? '';

		const { /*changes,*/ additions, deletions } = this.stats;
		if (/*changes < 0 && */ additions < 0 && deletions < 0) return options?.empty ?? '';

		const { compact = false, expand = false, prefix = '', separator = ' ', suffix = '' } = options ?? {};

		let status = prefix;

		if (additions) {
			status += expand ? `${pluralize('line', additions)} added` : `+${additions}`;
		} else if (!expand && !compact) {
			status += '+0';
		}

		// if (changes) {
		// 	status += `${additions ? separator : ''}${
		// 		expand ? `${pluralize('line', changes)} changed` : `~${changes}`
		// 	}`;
		// } else if (!expand && !compact) {
		// 	status += '~0';
		// }

		if (deletions) {
			status += `${/*changes |*/ additions ? separator : ''}${
				expand ? `${pluralize('line', deletions)} deleted` : `-${deletions}`
			}`;
		} else if (!expand && !compact) {
			status += '-0';
		}

		status += suffix;

		return status;
	}
}
