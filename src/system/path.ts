'use strict';
import { basename, dirname } from 'path';
import { Uri } from 'vscode';
import { isWindows } from '@env/platform';
// TODO@eamodio don't import from string here since it will break the tests because of ESM dependencies
// import { CharCode } from './string';

export { basename, dirname, extname, isAbsolute, join as joinPaths, relative } from 'path';

const driveLetterNormalizeRegex = /(?<=^\/?)([A-Z])(?=:\/)/;
const pathNormalizeRegex = /\\/g;
const slash = 47; //slash;

export function isChild(uri: Uri, baseUri: Uri): boolean;
export function isChild(uri: Uri, basePath: string): boolean;
export function isChild(path: string, basePath: string): boolean;
export function isChild(uriOrPath: Uri | string, baseUriOrPath: Uri | string): boolean {
	if (typeof baseUriOrPath === 'string') {
		if (baseUriOrPath.charCodeAt(0) !== slash) {
			baseUriOrPath = `/${baseUriOrPath}`;
		}

		return (
			isDescendent(uriOrPath, baseUriOrPath) &&
			(typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.path)
				.substr(baseUriOrPath.length + (baseUriOrPath.endsWith('/') ? 0 : 1))
				.split('/').length === 1
		);
	}

	return (
		isDescendent(uriOrPath, baseUriOrPath) &&
		(typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.path)
			.substr(baseUriOrPath.path.length + (baseUriOrPath.path.endsWith('/') ? 0 : 1))
			.split('/').length === 1
	);
}

export function isDescendent(uri: Uri, baseUri: Uri): boolean;
export function isDescendent(uri: Uri, basePath: string): boolean;
export function isDescendent(path: string, basePath: string): boolean;
export function isDescendent(uriOrPath: Uri | string, baseUriOrPath: Uri | string): boolean;
export function isDescendent(uriOrPath: Uri | string, baseUriOrPath: Uri | string): boolean {
	if (typeof baseUriOrPath === 'string') {
		baseUriOrPath = normalizePath(baseUriOrPath);
		if (baseUriOrPath.charCodeAt(0) !== slash) {
			baseUriOrPath = `/${baseUriOrPath}`;
		}
	}

	if (typeof uriOrPath === 'string') {
		uriOrPath = normalizePath(uriOrPath);
		if (uriOrPath.charCodeAt(0) !== slash) {
			uriOrPath = `/${uriOrPath}`;
		}
	}

	if (typeof baseUriOrPath === 'string') {
		return (
			baseUriOrPath.length === 1 ||
			(typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.path).startsWith(
				baseUriOrPath.endsWith('/') ? baseUriOrPath : `${baseUriOrPath}/`,
			)
		);
	}

	if (typeof uriOrPath === 'string') {
		return (
			baseUriOrPath.path.length === 1 ||
			uriOrPath.startsWith(baseUriOrPath.path.endsWith('/') ? baseUriOrPath.path : `${baseUriOrPath.path}/`)
		);
	}

	return (
		baseUriOrPath.scheme === uriOrPath.scheme &&
		baseUriOrPath.authority === uriOrPath.authority &&
		(baseUriOrPath.path.length === 1 ||
			uriOrPath.path.startsWith(baseUriOrPath.path.endsWith('/') ? baseUriOrPath.path : `${baseUriOrPath.path}/`))
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

export function splitPath(filePath: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
	if (repoPath) {
		filePath = normalizePath(filePath);
		repoPath = normalizePath(repoPath);

		const normalizedRepoPath = (
			repoPath.charCodeAt(repoPath.length - 1) === slash ? repoPath : `${repoPath}/`
		).toLowerCase();
		if (filePath.toLowerCase().startsWith(normalizedRepoPath)) {
			filePath = filePath.substring(normalizedRepoPath.length);
		}
	} else {
		repoPath = normalizePath(extract ? dirname(filePath) : repoPath!);
		filePath = normalizePath(extract ? basename(filePath) : filePath);
	}

	return [filePath, repoPath];
}
