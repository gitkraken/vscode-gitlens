import { Uri } from 'vscode';
import { maybeUri, normalizePath } from '../path';

const slash = 47;
const vslsHasPrefixRegex = /^[/|\\]~(?:\d+?|external)(?:[/|\\]|$)/;
const vslsRootUriRegex = /^[/|\\]~(?:\d+?|external)(?:[/|\\]|$)/;

export function addVslsPrefixIfNeeded(path: string): string;
export function addVslsPrefixIfNeeded(uri: Uri): Uri;
export function addVslsPrefixIfNeeded(pathOrUri: string | Uri): string | Uri;
export function addVslsPrefixIfNeeded(pathOrUri: string | Uri): string | Uri {
	if (typeof pathOrUri === 'string') {
		if (maybeUri(pathOrUri)) {
			pathOrUri = Uri.parse(pathOrUri);
		}
	}

	if (typeof pathOrUri === 'string') {
		if (hasVslsPrefix(pathOrUri)) return pathOrUri;

		pathOrUri = normalizePath(pathOrUri);
		return `/~0${pathOrUri.charCodeAt(0) === slash ? pathOrUri : `/${pathOrUri}`}`;
	}

	let path = pathOrUri.fsPath;
	if (hasVslsPrefix(path)) return pathOrUri;

	path = normalizePath(path);
	return pathOrUri.with({ path: `/~0${path.charCodeAt(0) === slash ? path : `/${path}`}` });
}

export function hasVslsPrefix(path: string): boolean {
	return vslsHasPrefixRegex.test(path);
}

export function isVslsRoot(path: string): boolean {
	return vslsRootUriRegex.test(path);
}
