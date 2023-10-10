import type { TextDocument, Uri } from 'vscode';
import type { GitBlame } from '../git/models/blame';
import type { GitDiffFile } from '../git/models/diff';
import type { GitLog } from '../git/models/log';
import { DocumentTracker } from './documentTracker';

interface CachedItem<T> {
	item: Promise<T>;
	errorMessage?: string;
}

export type CachedBlame = CachedItem<GitBlame>;
export type CachedDiff = CachedItem<GitDiffFile>;
export type CachedLog = CachedItem<GitLog>;

export class GitDocumentState {
	private readonly blameCache = new Map<string, CachedBlame>();
	private readonly diffCache = new Map<string, CachedDiff>();
	private readonly logCache = new Map<string, CachedLog>();

	clearBlame(key?: string): void {
		if (key == null) {
			this.blameCache.clear();
			return;
		}
		this.blameCache.delete(key);
	}

	clearDiff(key?: string): void {
		if (key == null) {
			this.diffCache.clear();
			return;
		}
		this.diffCache.delete(key);
	}

	clearLog(key?: string): void {
		if (key == null) {
			this.logCache.clear();
			return;
		}
		this.logCache.delete(key);
	}

	getBlame(key: string): CachedBlame | undefined {
		return this.blameCache.get(key);
	}

	getDiff(key: string): CachedDiff | undefined {
		return this.diffCache.get(key);
	}

	getLog(key: string): CachedLog | undefined {
		return this.logCache.get(key);
	}

	setBlame(key: string, value: CachedBlame | undefined) {
		if (value == null) {
			this.blameCache.delete(key);
			return;
		}
		this.blameCache.set(key, value);
	}

	setDiff(key: string, value: CachedDiff | undefined) {
		if (value == null) {
			this.diffCache.delete(key);
			return;
		}
		this.diffCache.set(key, value);
	}

	setLog(key: string, value: CachedLog | undefined) {
		if (value == null) {
			this.logCache.delete(key);
			return;
		}
		this.logCache.set(key, value);
	}
}

export class GitDocumentTracker extends DocumentTracker<GitDocumentState> {
	resetCache(document: TextDocument, affects: 'blame' | 'diff' | 'log'): Promise<void>;
	resetCache(uri: Uri, affects: 'blame' | 'diff' | 'log'): Promise<void>;
	async resetCache(documentOrUri: TextDocument | Uri, affects: 'blame' | 'diff' | 'log'): Promise<void> {
		const doc = this.get(documentOrUri);
		if (doc == null) return;

		switch (affects) {
			case 'blame':
				(await doc).state?.clearBlame();
				break;
			case 'diff':
				(await doc).state?.clearDiff();
				break;
			case 'log':
				(await doc).state?.clearLog();
				break;
		}
	}
}
