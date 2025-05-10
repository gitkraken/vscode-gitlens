import { isAbsolute as _isAbsolute, basename } from 'path';
import { isLinux, isWindows } from '@env/platform';

export { basename, dirname, extname, join as joinPaths } from 'path';

const driveLetterNormalizeRegex = /(^\/?)([a-zA-Z])(?=:\/)/;
const hasSchemeRegex = /^([a-zA-Z][\w+.-]+):/;
const pathNormalizeRegex = /\\/g;
const slash = 47;

export function arePathsEqual(a: string, b: string, ignoreCase?: boolean): boolean {
	if (ignoreCase || (ignoreCase == null && !isLinux)) {
		a = a.toLowerCase();
		b = b.toLowerCase();
	}
	return normalizePath(a) === normalizePath(b);
}

export function commonBase(s: string[], delimiter: string, ignoreCase?: boolean): string | undefined {
	if (s.length === 0) return undefined;

	let common = s[0];
	for (let i = 1; i < s.length; i++) {
		const index = commonBaseIndex(common, s[i], delimiter, ignoreCase);
		if (index === 0) return undefined;
		common = common.substring(0, index + 1);
	}

	return common;
}

export function commonBaseIndex(s1: string, s2: string, delimiter: string, ignoreCase?: boolean): number {
	if (s1.length === 0 || s2.length === 0) return 0;

	if (ignoreCase ?? !isLinux) {
		s1 = s1.toLowerCase();
		s2 = s2.toLowerCase();
	}

	let char;
	let index = 0;
	for (let i = 0; i < s1.length; i++) {
		char = s1[i];
		if (char !== s2[i]) break;

		if (char === delimiter) {
			index = i;
		}
	}

	return index;
}

export function getScheme(path: string): string | undefined {
	return hasSchemeRegex.exec(path)?.[1];
}

export function isAbsolute(path: string): boolean {
	return !maybeUri(path) && _isAbsolute(path);
}

export function isFolderGlob(path: string): boolean {
	return basename(path) === '*';
}

export function maybeUri(path: string): boolean {
	return hasSchemeRegex.test(path);
}

export function normalizePath(path: string): string {
	if (!path) return path;

	path = path.replace(pathNormalizeRegex, '/');
	if (path.charCodeAt(path.length - 1) === slash) {
		// Don't remove the trailing slash on Windows root folders, such as z:\
		if (!isWindows || path.length !== 3 || path[1] !== ':') {
			path = path.slice(0, -1);
		}
	}

	if (isWindows) {
		// Ensure that drive casing is normalized (lower case) and no leading slash
		path = path.replace(driveLetterNormalizeRegex, (_, _slash, d: string) => d.toLowerCase());
	}

	return path;
}

export function stripFolderGlob(path: string): string {
	return isFolderGlob(path) ? path.slice(0, -2) : path;
}
