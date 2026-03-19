import { isAbsolute as _isAbsolute, basename, dirname } from 'path';
import { isLinux, isWindows } from './platform.js';
import type { Uri } from './uri.js';
import { hasScheme, parseUri } from './uri.js';

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
	return hasScheme(path);
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

export function getBestPath(pathOrUri: string): string {
	if (!hasScheme(pathOrUri)) return normalizePath(pathOrUri);

	const uri = parseUri(pathOrUri);
	return normalizePath(uri.scheme === 'file' ? uri.fsPath : uri.path);
}

export function isChild(path: string, base: string): boolean {
	if (!base.startsWith('/')) {
		base = `/${base}`;
	}

	return (
		isDescendant(path, base) && path.substring(base.length + (base.endsWith('/') ? 0 : 1)).split('/').length === 1
	);
}

export function isDescendant(path: string, base: string, ignoreCase?: boolean): boolean {
	let basePath = getBestPath(base);
	if (!basePath.startsWith('/')) {
		basePath = `${basePath}/`;
	}

	// Handles folder globs and ensure ending with a trailing slash
	if (basePath.endsWith('/*')) {
		basePath = basePath.substring(0, basePath.length - 1);
	} else if (!basePath.endsWith('/')) {
		basePath = `${basePath}/`;
	}

	let p = getBestPath(path);
	if (!p.startsWith('/')) {
		p = `${p}/`;
	}

	if (ignoreCase ?? !isLinux) {
		basePath = basePath.toLowerCase();
		p = p.toLowerCase();
	}

	return p.startsWith(basePath);
}

export function relative(from: string, to: string, ignoreCase?: boolean): string {
	from = hasScheme(from) ? parseUri(from).path : normalizePath(from);
	to = hasScheme(to) ? parseUri(to).path : normalizePath(to);

	const index = commonBaseIndex(`${to}/`, `${from}/`, '/', ignoreCase);
	return index > 0 ? to.substring(index + 1) : to;
}

export function relativeDir(relativePath: string, relativeTo?: string): string {
	const dirPath = dirname(relativePath);
	if (!dirPath || dirPath === '.' || dirPath === relativeTo) return '';
	if (!relativeTo) return dirPath;

	const [relativeDirPath] = splitPath(dirPath, relativeTo);
	return relativeDirPath;
}

export function splitPath(
	pathOrUri: string,
	root: string | undefined,
	splitOnBaseIfMissing: boolean = false,
	ignoreCase?: boolean,
): [path: string, root: string] {
	pathOrUri = getBestPath(pathOrUri);

	if (root) {
		let repoUri: Uri | undefined;
		if (hasScheme(root)) {
			repoUri = parseUri(root);
			root = getBestPath(root);
		} else {
			root = normalizePath(root);
		}

		const index = commonBaseIndex(`${root}/`, `${pathOrUri}/`, '/', ignoreCase);
		if (index > 0) {
			root = pathOrUri.substring(0, index);
			pathOrUri = pathOrUri.substring(index + 1);
		} else if (pathOrUri.startsWith('/')) {
			pathOrUri = pathOrUri.slice(1);
		}

		if (repoUri != null) {
			root = repoUri.with({ path: root }).toString();
		}
	} else {
		root = normalizePath(splitOnBaseIfMissing ? dirname(pathOrUri) : '');
		pathOrUri = splitOnBaseIfMissing ? basename(pathOrUri) : pathOrUri;
	}

	return [pathOrUri, root];
}
