import type { Event, FileChangeEvent, FileStat, FileSystemProvider, Uri } from 'vscode';
import { Disposable, EventEmitter, FileSystemError, FileType, workspace } from 'vscode';
import { isLinux } from '@env/platform.js';
import { Schemes } from '../constants.js';
import type { Container } from '../container.js';
import { relative } from '../system/-webview/path.js';
import { trace } from '../system/decorators/log.js';
import { map } from '../system/iterable.js';
import { Logger } from '../system/logger.js';
import { getScopedLogger } from '../system/logger.scope.js';
import { normalizePath } from '../system/path.js';
import { PromiseCache } from '../system/promiseCache.js';
import { TernarySearchTree } from '../system/searchTree.js';
import { ShowError } from './errors.js';
import { GitUri, isGitUri } from './gitUri.js';
import { deletedOrMissing } from './models/revision.js';
import type { GitTreeEntry, GitTreeType } from './models/tree.js';

const emptyArray = Object.freeze(new Uint8Array(0));
const emptyDisposable: Disposable = Object.freeze({ dispose: () => {} });

export function fromGitLensFSUri(uri: Uri): { path: string; ref: string; repoPath: string; submoduleSha?: string } {
	const gitUri = isGitUri(uri) ? uri : new GitUri(uri);
	return {
		path: gitUri.relativePath,
		ref: gitUri.sha!,
		repoPath: gitUri.repoPath!,
		submoduleSha: gitUri.submoduleSha,
	};
}

export class GitFileSystemProvider implements FileSystemProvider, Disposable {
	private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	get onDidChangeFile(): Event<FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private readonly _disposable: Disposable;
	private readonly _searchTreeMap = new PromiseCache<string, TernarySearchTree<string, GitTreeEntry>>({
		capacity: 50,
		accessTTL: 1000 * 60 * 10, // 10 minutes idle
	});

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			this._onDidChangeFile,
			workspace.registerFileSystemProvider(Schemes.GitLens, this, {
				isCaseSensitive: isLinux,
				isReadonly: true,
			}),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	copy?(source: Uri, _destination: Uri, _options: { readonly overwrite: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions(source);
	}
	createDirectory(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}
	delete(uri: Uri, _options: { readonly recursive: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}

	@trace()
	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		const { path, ref, repoPath } = fromGitLensFSUri(uri);

		const tree = await this.getTree(path, ref, repoPath);
		if (tree == null) throw FileSystemError.FileNotFound(uri);

		const items = [
			...map<GitTreeEntry, [string, FileType]>(tree, t => [
				path != null && path.length !== 0 ? normalizePath(relative(path, t.path)) : t.path,
				typeToFileType(t.type),
			]),
		];
		return items;
	}

	@trace()
	async readFile(uri: Uri): Promise<Uint8Array> {
		const scope = getScopedLogger();
		const { path, ref, repoPath, submoduleSha } = fromGitLensFSUri(uri);

		if (ref === deletedOrMissing) return emptyArray;

		// If this is a submodule, return the submodule commit format directly
		if (submoduleSha) {
			return new TextEncoder().encode(`Subproject commit ${submoduleSha}\n`);
		}

		const svc = this.container.git.getRepositoryService(repoPath);

		let data: Uint8Array | undefined;
		try {
			data = await svc.revision.getRevisionContent(ref, path);
		} catch (ex) {
			if (ShowError.is(ex, 'invalidObject') || ShowError.is(ex, 'invalidRevision')) {
				// Check the tree entry to determine if this is a regular file or submodule
				// For submodules (type 'commit' in git tree), return the standard git submodule diff format
				// This matches the format Git uses in diff output (see diff.c:show_submodule_diff_summary)
				const treeEntry = await svc.revision.getTreeEntryForRevision(ref, path);
				if (treeEntry?.type === 'commit') {
					return new TextEncoder().encode(`Subproject commit ${treeEntry.oid}\n`);
				}
			}

			if (ShowError.is(ex) && ex.details.reason !== 'other') {
				return emptyArray;
			}

			Logger.error(ex, scope, `Failed to read file for ${uri.toString(true)}`);
		}

		return data ?? emptyArray;
	}

	rename(oldUri: Uri, _newUri: Uri, _options: { readonly overwrite: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions(oldUri);
	}

	@trace()
	async stat(uri: Uri): Promise<FileStat> {
		const { path, ref, repoPath, submoduleSha } = fromGitLensFSUri(uri);

		if (ref === deletedOrMissing) {
			return { type: FileType.File, size: 0, ctime: 0, mtime: 0 };
		}

		// Submodules appear as files in diff views
		if (submoduleSha) {
			return { type: FileType.File, size: 0, ctime: 0, mtime: 0 };
		}

		let treeItem;

		const searchTree = this._searchTreeMap.get(ref);
		if (searchTree != null) {
			// Add the fake root folder to the path
			treeItem = (await searchTree).get(`/~/${path}`);
		} else {
			if (!path) {
				const tree = await this.getTree(path, ref, repoPath);
				if (tree == null) throw FileSystemError.FileNotFound(uri);

				return { type: FileType.Directory, size: 0, ctime: 0, mtime: 0 };
			}

			treeItem = await this.container.git
				.getRepositoryService(repoPath)
				.revision.getTreeEntryForRevision(ref, path);
		}

		if (treeItem == null) {
			throw FileSystemError.FileNotFound(uri);
		}

		return { type: typeToFileType(treeItem.type), size: treeItem.size, ctime: 0, mtime: 0 };
	}

	watch(): Disposable {
		return emptyDisposable;
	}

	writeFile(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}

	private async createSearchTree(ref: string, repoPath: string) {
		const searchTree = TernarySearchTree.forPaths<GitTreeEntry>();
		const trees = await this.container.git.getRepositoryService(repoPath).revision.getTreeForRevision(ref);

		// Add a fake root folder so that searches will work
		searchTree.set('~', { ref: '', oid: '', path: '~', size: 0, type: 'tree' });
		for (const item of trees) {
			searchTree.set(`~/${item.path}`, item);
		}

		return searchTree;
	}

	private getOrCreateSearchTree(ref: string, repoPath: string) {
		return this._searchTreeMap.getOrCreate(ref, () => this.createSearchTree(ref, repoPath));
	}

	private async getTree(path: string, ref: string, repoPath: string) {
		const searchTree = await this.getOrCreateSearchTree(ref, repoPath);
		// Add the fake root folder to the path
		return searchTree.findSuperstr(`/~/${path}`, true);
	}
}

function typeToFileType(type: GitTreeType | undefined | null) {
	switch (type) {
		case 'blob':
			return FileType.File;
		case 'tree':
			return FileType.Directory;
		case 'commit':
			// Submodules (gitlinks) appear as files in the diff view
			return FileType.File;
		default:
			return FileType.Unknown;
	}
}
