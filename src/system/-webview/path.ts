// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { basename, dirname } from 'path';
import { FileType, Uri, workspace } from 'vscode';
import { isLinux } from '@env/platform';
import { Schemes } from '../../constants';
import { commonBaseIndex, isFolderGlob, normalizePath } from '../path';

const hasSchemeRegex = /^([a-zA-Z][\w+.-]+):/;

export function getBestPath(uri: Uri): string;
export function getBestPath(pathOrUri: string | Uri): string;
export function getBestPath(pathOrUri: string | Uri): string {
	if (typeof pathOrUri === 'string') {
		if (!hasSchemeRegex.test(pathOrUri)) return normalizePath(pathOrUri);

		pathOrUri = Uri.parse(pathOrUri, true);
	}

	return normalizePath(pathOrUri.scheme === Schemes.File ? pathOrUri.fsPath : pathOrUri.path);
}

export function getFolderGlobUri(uri: Uri): Uri {
	return Uri.joinPath(uri, '*');
}

export function isChild(path: string, base: string | Uri): boolean;
export function isChild(uri: Uri, base: string | Uri): boolean;
export function isChild(pathOrUri: string | Uri, base: string | Uri): boolean {
	if (typeof base === 'string') {
		if (!base.startsWith('/')) {
			base = `/${base}`;
		}

		return (
			isDescendant(pathOrUri, base) &&
			(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
				.substring(base.length + (base.endsWith('/') ? 0 : 1))
				.split('/').length === 1
		);
	}

	return (
		isDescendant(pathOrUri, base) &&
		(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
			.substring(base.path.length + (base.path.endsWith('/') ? 0 : 1))
			.split('/').length === 1
	);
}

export function isDescendant(path: string, base: string | Uri, ignoreCase?: boolean): boolean;
export function isDescendant(uri: Uri, base: string | Uri, ignoreCase?: boolean): boolean;
export function isDescendant(pathOrUri: string | Uri, base: string | Uri, ignoreCase?: boolean): boolean;
export function isDescendant(pathOrUri: string | Uri, baseOrUri: string | Uri, ignoreCase?: boolean): boolean {
	// If both are URIs, ensure the scheme and authority match
	if (typeof pathOrUri !== 'string' && typeof baseOrUri !== 'string') {
		if (pathOrUri.scheme !== baseOrUri.scheme || pathOrUri.authority !== baseOrUri.authority) {
			return false;
		}
	}

	let base = getBestPath(baseOrUri);
	if (!base.startsWith('/')) {
		base = `${base}/`;
	}

	// Handles folder globs and ensure ending with a trailing slash
	if (base.endsWith('/*')) {
		base = base.substring(0, base.length - 1);
	} else if (!base.endsWith('/')) {
		base = `${base}/`;
	}

	let path = getBestPath(pathOrUri);
	if (!path.startsWith('/')) {
		path = `${path}/`;
	}

	if (ignoreCase ?? !isLinux) {
		base = base.toLowerCase();
		path = path.toLowerCase();
	}

	return path.startsWith(base);
}

export function isFolderGlobUri(uri: Uri): boolean {
	return isFolderGlob(uri.path);
}

export async function isFolderUri(uri: Uri): Promise<boolean> {
	try {
		const stats = await workspace.fs.stat(uri);
		if ((stats.type & FileType.Directory) === FileType.Directory) {
			return true;
		}
	} catch {}

	return false;
}

export function relative(from: string, to: string, ignoreCase?: boolean): string {
	from = hasSchemeRegex.test(from) ? Uri.parse(from, true).path : normalizePath(from);
	to = hasSchemeRegex.test(to) ? Uri.parse(to, true).path : normalizePath(to);

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
	pathOrUri: string | Uri,
	root: string | undefined,
	splitOnBaseIfMissing: boolean = false,
	ignoreCase?: boolean,
): [path: string, root: string] {
	pathOrUri = getBestPath(pathOrUri);

	if (root) {
		let repoUri;
		if (hasSchemeRegex.test(root)) {
			repoUri = Uri.parse(root, true);
			root = getBestPath(repoUri);
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
