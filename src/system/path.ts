'use strict';
import { basename, dirname } from 'path';
import { Uri } from 'vscode';
import { isLinux, isWindows } from '@env/platform';
// TODO@eamodio don't import from string here since it will break the tests because of ESM dependencies
// import { CharCode } from './string';

export { basename, dirname, extname, isAbsolute, join as joinPaths, relative } from 'path';

const driveLetterNormalizeRegex = /(?<=^\/?)([A-Z])(?=:\/)/;
const pathNormalizeRegex = /\\/g;
const slash = 47; //slash;

export function commonBase(s1: string, s2: string, delimiter: string, ignoreCase?: boolean): string | undefined {
	const index = commonBaseIndex(s1, s2, delimiter, ignoreCase);
	return index > 0 ? s1.substring(0, index + 1) : undefined;
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

export function isChild(path: string, base: string | Uri): boolean;
export function isChild(uri: Uri, base: string | Uri): boolean;
export function isChild(pathOrUri: string | Uri, base: string | Uri): boolean {
	if (typeof base === 'string') {
		if (base.charCodeAt(0) !== slash) {
			base = `/${base}`;
		}

		return (
			isDescendent(pathOrUri, base) &&
			(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
				.substr(base.length + (base.endsWith('/') ? 0 : 1))
				.split('/').length === 1
		);
	}

	return (
		isDescendent(pathOrUri, base) &&
		(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
			.substr(base.path.length + (base.path.endsWith('/') ? 0 : 1))
			.split('/').length === 1
	);
}

export function isDescendent(path: string, base: string | Uri): boolean;
export function isDescendent(uri: Uri, base: string | Uri): boolean;
export function isDescendent(pathOrUri: string | Uri, base: string | Uri): boolean;
export function isDescendent(pathOrUri: string | Uri, base: string | Uri): boolean {
	if (typeof base === 'string') {
		base = normalizePath(base);
		if (base.charCodeAt(0) !== slash) {
			base = `/${base}`;
		}
	}

	if (typeof pathOrUri === 'string') {
		pathOrUri = normalizePath(pathOrUri);
		if (pathOrUri.charCodeAt(0) !== slash) {
			pathOrUri = `/${pathOrUri}`;
		}
	}

	if (typeof base === 'string') {
		return (
			base.length === 1 ||
			(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path).startsWith(
				base.endsWith('/') ? base : `${base}/`,
			)
		);
	}

	if (typeof pathOrUri === 'string') {
		return base.path.length === 1 || pathOrUri.startsWith(base.path.endsWith('/') ? base.path : `${base.path}/`);
	}

	return (
		base.scheme === pathOrUri.scheme &&
		base.authority === pathOrUri.authority &&
		(base.path.length === 1 || pathOrUri.path.startsWith(base.path.endsWith('/') ? base.path : `${base.path}/`))
	);
}

export function isFolderGlob(path: string): boolean {
	return basename(path) === '*';
}

export function normalizePath(path: string): string {
	if (!path) return path;

	path = path.replace(pathNormalizeRegex, '/');
	if (path.charCodeAt(path.length - 1) === slash) {
		path = path.slice(0, -1);
	}

	if (isWindows) {
		// Ensure that drive casing is normalized (lower case)
		path = path.replace(driveLetterNormalizeRegex, drive => drive.toLowerCase());
	}

	return path;
}

export function splitPath(
	path: string,
	repoPath: string | undefined,
	splitOnBaseIfMissing: boolean = false,
	ignoreCase?: boolean,
): [string, string] {
	if (repoPath) {
		path = normalizePath(path);
		repoPath = normalizePath(repoPath);

		const index = commonBaseIndex(`${repoPath}/`, path, '/', ignoreCase);
		if (index > 0) {
			repoPath = path.substring(0, index);
			path = path.substring(index + 1);
		}
	} else {
		repoPath = normalizePath(splitOnBaseIfMissing ? dirname(path) : repoPath ?? '');
		path = normalizePath(splitOnBaseIfMissing ? basename(path) : path);
	}

	return [path, repoPath];
}
