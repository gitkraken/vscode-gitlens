import type { GitFileConflictStatus, GitFileStatus } from '../models/fileStatus.js';

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

const statusTextMap = {
	'.': 'Unchanged',
	'!': 'Ignored',
	'?': 'Untracked',
	A: 'Added',
	D: 'Deleted',
	M: 'Modified',
	R: 'Renamed',
	C: 'Copied',
	AA: 'Added (Both)',
	AU: 'Added (Current)',
	UA: 'Added (Incoming)',
	DD: 'Deleted (Both)',
	DU: 'Deleted (Current)',
	UD: 'Deleted (Incoming)',
	UU: 'Modified (Both)',
	T: 'Modified',
	U: 'Updated but Unmerged',
};

export function getGitFileStatusText(status: GitFileStatus | keyof typeof statusTextMap): string {
	return statusTextMap[status] ?? 'Unknown';
}

const conflictStatuses = new Set<string>(['U', 'AA', 'AU', 'UA', 'DD', 'DU', 'UD', 'UU']);

export function isConflictStatus(status: string | undefined): status is 'U' | GitFileConflictStatus {
	return status != null && conflictStatuses.has(status);
}

/** Repo-relative pathspec entries for a file. Renames/copies need BOTH sides: git applies pathspec limiting
 *  before rename detection, so `git diff -- <new>` drops the old path's deletion and the patch reads as a
 *  bare add (applying it duplicates the file instead of renaming it). */
export function getFileDiffPathspecs(file: { path: string; originalPath?: string }): string[] {
	return file.originalPath ? [file.path, file.originalPath] : [file.path];
}
