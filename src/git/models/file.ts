import type { Uri } from 'vscode';
import { ThemeIcon } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { memoize } from '../../system/decorators/memoize';
import { pad, pluralize } from '../../system/string';
import { formatPath } from '../../system/vscode/formatPath';
import { relativeDir, splitPath } from '../../system/vscode/path';
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
	'!': 'diff-ignored',
	'?': 'diff-added',
	A: 'diff-added',
	D: 'diff-removed',
	M: 'diff-modified',
	R: 'diff-renamed',
	C: 'diff-added',
	AA: 'warning',
	AU: 'warning',
	UA: 'warning',
	DD: 'warning',
	DU: 'warning',
	UD: 'warning',
	UU: 'warning',
	T: 'diff-modified',
	U: 'diff-modified',
};

export function getGitFileStatusThemeIcon(status: GitFileStatus): ThemeIcon | undefined {
	const codicon = statusCodiconsMap[status];
	return codicon != null ? new ThemeIcon(codicon) : undefined;
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
	readonly repoPath: string;
	readonly path: string;
	readonly status: GitFileStatus;

	readonly originalPath?: string | undefined;
	readonly staged?: boolean;
}

export class GitFileChange implements GitFileChangeShape {
	constructor(
		public readonly repoPath: string,
		public readonly path: string,
		public readonly status: GitFileStatus,
		public readonly originalPath?: string | undefined,
		public readonly previousSha?: string | undefined,
		public readonly stats?: GitFileChangeStats | undefined,
		public readonly staged?: boolean,
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

	formatStats(
		style: 'short' | 'stats' | 'expanded',
		options?: {
			color?: boolean;
			empty?: string;
			prefix?: string;
			separator?: string;
		},
	): string {
		const { stats } = this;
		if (stats == null) return options?.empty ?? '';

		const { /*changes,*/ additions, deletions } = stats;
		if (/*changes < 0 && */ additions < 0 && deletions < 0) return options?.empty ?? '';

		const separator = options?.separator ?? ' ';

		const lineStats = [];

		if (additions) {
			const additionsText = style === 'expanded' ? `${pluralize('line', additions)} added` : `+${additions}`;
			if (options?.color && style !== 'short') {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">${additionsText}</span>`,
				);
			} else {
				lineStats.push(additionsText);
			}
		} else if (style === 'stats') {
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-addedResourceForeground);">+0</span>`,
				);
			} else {
				lineStats.push('+0');
			}
		}

		// if (changes) {
		// 	const changesText = style === 'expanded' ? `${pluralize('line', changes)} changed` : `~${changes}`;
		// 	if (options?.color && style !== 'short') {
		// 		lineStats.push(
		// 			/*html*/ `<span style="color:var(--vscode-gitDecoration-modifiedResourceForeground)">${changesText}</span>`,
		// 		);
		// 	} else {
		// 		lineStats.push(changesText);
		// 	}
		// } else if (style === 'stats') {
		// 	if (options?.color) {
		// 		lineStats.push(
		// 			/*html*/ `<span style="color:var(--vscode-gitDecoration-modifiedResourceForeground)">~0</span>`,
		// 		);
		// 	} else {
		// 		lineStats.push('~0');
		// 	}
		// }

		if (deletions) {
			const deletionsText = style === 'expanded' ? `${pluralize('line', deletions)} deleted` : `-${deletions}`;
			if (options?.color && style !== 'short') {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">${deletionsText}</span>`,
				);
			} else {
				lineStats.push(deletionsText);
			}
		} else if (style === 'stats') {
			if (options?.color) {
				lineStats.push(
					/*html*/ `<span style="color:var(--vscode-gitDecoration-deletedResourceForeground);">-0</span>`,
				);
			} else {
				lineStats.push('-0');
			}
		}

		let result = lineStats.join(separator);
		if (style === 'stats' && options?.color) {
			result = /*html*/ `<span style="background-color:var(--vscode-textCodeBlock-background);border-radius:3px;">&nbsp;${result}&nbsp;&nbsp;</span>`;
		}

		return `${options?.prefix ?? ''}${result}`;
	}
}

export function isGitFileChange(file: any): file is GitFileChange {
	return file instanceof GitFileChange;
}

export function mapFilesWithStats(files: GitFileChange[], filesWithStats: GitFileChange[]): GitFileChange[] {
	return files.map(file => {
		const stats = filesWithStats.find(f => f.path === file.path)?.stats;
		return stats != null
			? new GitFileChange(
					file.repoPath,
					file.path,
					file.status,
					file.originalPath,
					file.previousSha,
					stats,
					file.staged,
			  )
			: file;
	});
}
