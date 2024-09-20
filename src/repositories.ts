import { isLinux } from '@env/platform';
import type { Uri } from 'vscode';
import { Schemes } from './constants';
import type { RevisionUriData } from './git/gitProvider';
import { decodeGitLensRevisionUriAuthority } from './git/gitUri.authority';
import type { Repository } from './git/models/repository';
import { normalizePath } from './system/path';
import { UriTrie } from './system/trie';
import { addVslsPrefixIfNeeded } from './system/vscode/path';

const slash = 47; //CharCode.Slash;

export type RepoComparisonKey = string & { __type__: 'RepoComparisonKey' };

export function asRepoComparisonKey(uri: Uri): RepoComparisonKey {
	const { path } = normalizeRepoUri(uri);
	return path as RepoComparisonKey;
}

export function normalizeRepoUri(uri: Uri): { path: string; ignoreCase: boolean } {
	let path;
	switch (uri.scheme.toLowerCase()) {
		case Schemes.File:
			path = normalizePath(uri.fsPath);
			return { path: path, ignoreCase: !isLinux };

		case Schemes.Git:
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}
			return { path: path, ignoreCase: !isLinux };

		case Schemes.GitLens: {
			path = uri.path;

			const metadata = decodeGitLensRevisionUriAuthority<RevisionUriData>(uri.authority);
			if (metadata.uncPath != null && !path.startsWith(metadata.uncPath)) {
				path = `${metadata.uncPath}${uri.path}`;
			}

			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.startsWith('//') ? path : path.slice(1);
			}
			return { path: path, ignoreCase: !isLinux };
		}
		case Schemes.Virtual:
		case Schemes.GitHub: {
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}

			// TODO@eamodio Revisit this, as we can't strip off the authority details (e.g. metadata) ultimately (since you in theory could have a workspace with more than 1 virtual repo which are the same except for the authority)
			const authority = uri.authority?.split('+', 1)[0];
			return { path: authority ? `${authority}/${path}` : path, ignoreCase: false };
		}
		case Schemes.Vsls:
		case Schemes.VslsScc:
			// Check if this is a root live share folder, if so add the required prefix (required to match repos correctly)
			path = addVslsPrefixIfNeeded(uri.path);
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}

			return { path: path, ignoreCase: false };

		case Schemes.PRs: {
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}

			const authority = uri.authority?.split('+', 1)[0];
			if (authority === Schemes.GitHub) {
				return { path: authority ? `${authority}/${path}` : path, ignoreCase: false };
			}

			return { path: path, ignoreCase: !isLinux };
		}
		default:
			path = uri.path;
			if (path.charCodeAt(path.length - 1) === slash) {
				path = path.slice(1, -1);
			} else {
				path = path.slice(1);
			}
			return { path: path, ignoreCase: false };
	}
}

export class Repositories {
	private readonly _trie: UriTrie<Repository>;
	private _count: number = 0;

	constructor() {
		this._trie = new UriTrie<Repository>(normalizeRepoUri);
	}

	get count(): number {
		return this._count;
	}

	add(repository: Repository): boolean {
		const added = this._trie.set(repository.uri, repository);
		if (added) {
			this._count++;
		}
		return added;
	}

	clear(): void {
		this._count = 0;
		this._trie.clear();
	}

	forEach(fn: (repository: Repository) => void, thisArg?: unknown): void {
		for (const value of this._trie.getDescendants()) {
			fn.call(thisArg, value);
		}
	}

	get(uri: Uri): Repository | undefined {
		return this._trie.get(uri);
	}

	getClosest(uri: Uri): Repository | undefined {
		return this._trie.getClosest(uri);
	}

	has(uri: Uri): boolean {
		return this._trie.has(uri);
	}

	remove(uri: Uri, dispose: boolean = true): boolean {
		const deleted = this._trie.delete(uri, dispose);
		if (deleted) {
			this._count--;
		}
		return deleted;
	}

	values(): IterableIterator<Repository> {
		return this._trie.getDescendants();
	}
}
