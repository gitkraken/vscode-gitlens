import { isLinux } from '@env/platform';
import type { Event, FileChangeEvent, FileStat, FileSystemProvider, Uri } from 'vscode';
import { Disposable, EventEmitter, FileSystemError, FileType, workspace } from 'vscode';
import { Schemes } from '../constants';
import type { Container } from '../container';
import { debug } from '../system/decorators/log';
import { map } from '../system/iterable';
import { normalizePath } from '../system/path';
import { TernarySearchTree } from '../system/searchTree';
import { relative } from '../system/vscode/path';
import { GitUri, isGitUri } from './gitUri';
import { deletedOrMissing } from './models/revision';
import type { GitTreeEntry } from './models/tree';

const emptyArray = new Uint8Array(0);

export function fromGitLensFSUri(uri: Uri): { path: string; ref: string; repoPath: string } {
	const gitUri = isGitUri(uri) ? uri : GitUri.fromRevisionUri(uri);
	return { path: gitUri.relativePath, ref: gitUri.sha!, repoPath: gitUri.repoPath! };
}

export class GitFileSystemProvider implements FileSystemProvider, Disposable {
	private readonly _disposable: Disposable;
	private readonly _searchTreeMap = new Map<string, Promise<TernarySearchTree<string, GitTreeEntry>>>();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			workspace.registerFileSystemProvider(Schemes.GitLens, this, {
				isCaseSensitive: isLinux,
				isReadonly: true,
			}),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	get onDidChangeFile(): Event<FileChangeEvent[]> {
		return this._onDidChangeFile.event;
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

	@debug()
	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		const { path, ref, repoPath } = fromGitLensFSUri(uri);

		const tree = await this.getTree(path, ref, repoPath);
		if (tree === undefined) throw FileSystemError.FileNotFound(uri);

		const items = [
			...map<GitTreeEntry, [string, FileType]>(tree, t => [
				path != null && path.length !== 0 ? normalizePath(relative(path, t.path)) : t.path,
				typeToFileType(t.type),
			]),
		];
		return items;
	}

	@debug()
	async readFile(uri: Uri): Promise<Uint8Array> {
		const { path, ref, repoPath } = fromGitLensFSUri(uri);

		if (ref === deletedOrMissing) return emptyArray;

		const data = await this.container.git.getRevisionContent(repoPath, path, ref);
		return data != null ? data : emptyArray;
	}

	rename(oldUri: Uri, _newUri: Uri, _options: { readonly overwrite: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions(oldUri);
	}

	@debug()
	async stat(uri: Uri): Promise<FileStat> {
		const { path, ref, repoPath } = fromGitLensFSUri(uri);

		if (ref === deletedOrMissing) {
			return {
				type: FileType.File,
				size: 0,
				ctime: 0,
				mtime: 0,
			};
		}

		let treeItem;

		const searchTree = this._searchTreeMap.get(ref);
		if (searchTree != null) {
			// Add the fake root folder to the path
			treeItem = (await searchTree).get(`/~/${path}`);
		} else {
			if (path == null || path.length === 0) {
				const tree = await this.getTree(path, ref, repoPath);
				if (tree == null) throw FileSystemError.FileNotFound(uri);

				return {
					type: FileType.Directory,
					size: 0,
					ctime: 0,
					mtime: 0,
				};
			}

			treeItem = await this.container.git.getTreeEntryForRevision(repoPath, path, ref);
		}

		if (treeItem == null) throw FileSystemError.FileNotFound(uri);

		return {
			type: typeToFileType(treeItem.type),
			size: treeItem.size,
			ctime: 0,
			mtime: 0,
		};
	}

	watch(): Disposable {
		return {
			dispose: () => {
				// nothing to dispose
			},
		};
	}

	writeFile(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}

	private async createSearchTree(ref: string, repoPath: string) {
		const searchTree = TernarySearchTree.forPaths<GitTreeEntry>();
		const trees = await this.container.git.getTreeForRevision(repoPath, ref);

		// Add a fake root folder so that searches will work
		searchTree.set('~', { ref: '', oid: '', path: '~', size: 0, type: 'tree' });
		for (const item of trees) {
			searchTree.set(`~/${item.path}`, item);
		}

		return searchTree;
	}

	private getOrCreateSearchTree(ref: string, repoPath: string) {
		let searchTree = this._searchTreeMap.get(ref);
		if (searchTree === undefined) {
			searchTree = this.createSearchTree(ref, repoPath);
			this._searchTreeMap.set(ref, searchTree);
		}

		return searchTree;
	}

	private async getTree(path: string, ref: string, repoPath: string) {
		const searchTree = await this.getOrCreateSearchTree(ref, repoPath);
		// Add the fake root folder to the path
		return searchTree.findSuperstr(`/~/${path}`, true);
	}
}

function typeToFileType(type: 'blob' | 'tree' | undefined | null) {
	switch (type) {
		case 'blob':
			return FileType.File;
		case 'tree':
			return FileType.Directory;
		default:
			return FileType.Unknown;
	}
}
