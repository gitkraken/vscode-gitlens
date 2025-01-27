// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { isAbsolute as _isAbsolute, basename, dirname } from 'path';
import { FileType, Uri, workspace } from 'vscode';
import { Schemes } from '../../constants';
import { commonBaseIndex, isFolderGlob, normalizePath } from '../path';

const hasSchemeRegex = /^([a-zA-Z][\w+.-]+):/;
const slash = 47;

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
		if (base.charCodeAt(0) !== slash) {
			base = `/${base}`;
		}

		return (
			isDescendant(pathOrUri, base) &&
			(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
				.substring(base.length + (base.charCodeAt(base.length - 1) === slash ? 0 : 1))
				.split('/').length === 1
		);
	}

	return (
		isDescendant(pathOrUri, base) &&
		(typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.path)
			.substring(base.path.length + (base.path.charCodeAt(base.path.length - 1) === slash ? 0 : 1))
			.split('/').length === 1
	);
}

export function isDescendant(path: string, base: string | Uri): boolean;
export function isDescendant(uri: Uri, base: string | Uri): boolean;
export function isDescendant(pathOrUri: string | Uri, base: string | Uri): boolean;
export function isDescendant(pathOrUri: string | Uri, base: string | Uri): boolean {
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
				base.charCodeAt(base.length - 1) === slash ? base : `${base}/`,
			)
		);
	}

	if (typeof pathOrUri === 'string') {
		return (
			base.path.length === 1 ||
			pathOrUri.startsWith(base.path.charCodeAt(base.path.length - 1) === slash ? base.path : `${base.path}/`)
		);
	}

	return (
		base.scheme === pathOrUri.scheme &&
		base.authority === pathOrUri.authority &&
		(base.path.length === 1 ||
			pathOrUri.path.startsWith(
				base.path.charCodeAt(base.path.length - 1) === slash ? base.path : `${base.path}/`,
			))
	);
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
		} else if (pathOrUri.charCodeAt(0) === slash) {
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
