import { Uri } from 'vscode';
import { Repository } from './git/models/repository';
import { UriTrie } from './system/trie';

export class Repositories {
	private readonly _trie: UriTrie<Repository>;
	private _count: number = 0;

	constructor() {
		this._trie = new UriTrie<Repository>();
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

	remove(uri: Uri): boolean {
		const deleted = this._trie.delete(uri);
		if (deleted) {
			this._count--;
		}
		return deleted;
	}

	values(): IterableIterator<Repository> {
		return this._trie.getDescendants();
	}
}
