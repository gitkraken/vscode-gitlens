import { GlyphChars } from '../../../constants';
import { formatPath } from '../../../system/-webview/formatPath';
import { relativeDir, splitPath } from '../../../system/-webview/path';
import { pad } from '../../../system/string';
import type { GitFile } from '../../models/file';

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
