'use strict';
import { basename, dirname } from 'path';
import { Uri } from 'vscode';
import { isWindows } from '@env/platform';
import { CharCode } from './string';

export { basename, dirname, extname, isAbsolute, join as joinPaths, relative } from 'path';

const driveLetterNormalizeRegex = /(?<=^\/?)([A-Z])(?=:\/)/;
const pathNormalizeRegex = /\\/g;

export function isChild(uri: Uri, baseUri: Uri): boolean;
export function isChild(uri: Uri, basePath: string): boolean;
export function isChild(path: string, basePath: string): boolean;
export function isChild(uriOrPath: Uri | string, baseUriOrPath: Uri | string): boolean {
	if (typeof baseUriOrPath === 'string') {
		if (baseUriOrPath.charCodeAt(0) !== CharCode.Slash) {
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
		if (baseUriOrPath.charCodeAt(0) !== CharCode.Slash) {
			baseUriOrPath = `/${baseUriOrPath}`;
		}
	}

	if (typeof uriOrPath === 'string') {
		uriOrPath = normalizePath(uriOrPath);
		if (uriOrPath.charCodeAt(0) !== CharCode.Slash) {
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

export function normalizePath(fileName: string): string {
	if (fileName == null || fileName.length === 0) return fileName;

	let normalized = fileName.replace(pathNormalizeRegex, '/');

	if (normalized.charCodeAt(normalized.length - 1) === CharCode.Slash) {
		normalized = normalized.slice(0, -1);
	}

	if (isWindows) {
		// Ensure that drive casing is normalized (lower case)
		normalized = normalized.replace(driveLetterNormalizeRegex, drive => drive.toLowerCase());
	}

	return normalized;
}

export function splitPath(filePath: string, repoPath: string | undefined, extract: boolean = true): [string, string] {
	if (repoPath) {
		filePath = normalizePath(filePath);
		repoPath = normalizePath(repoPath);

		const normalizedRepoPath = (
			repoPath.charCodeAt(repoPath.length - 1) === CharCode.Slash ? repoPath : `${repoPath}/`
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
