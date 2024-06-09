import type { Disposable, Event, TextDocument } from 'vscode';
import { EventEmitter } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitBlame } from '../git/models/blame';
import type { GitDiffFile } from '../git/models/diff';
import type { GitLog } from '../git/models/log';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getEditorIfActive, isActiveDocument } from '../system/utils';
import type { DocumentBlameStateChangeEvent } from './documentTracker';

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

export class TrackedGitDocument implements Disposable {
	static async create(
		document: TextDocument,
		dirty: boolean,
		eventDelegates: { onDidBlameStateChange(e: DocumentBlameStateChangeEvent): void },
		container: Container,
	) {
		const doc = new TrackedGitDocument(document, dirty, eventDelegates, container);
		await doc.initialize();
		return doc;
	}

	private _onDidBlameStateChange = new EventEmitter<DocumentBlameStateChangeEvent>();
	get onDidBlameStateChange(): Event<DocumentBlameStateChangeEvent> {
		return this._onDidBlameStateChange.event;
	}

	state: GitDocumentState | undefined;

	private _disposable: Disposable | undefined;
	private _disposed: boolean = false;
	private _uri!: GitUri;

	private constructor(
		readonly document: TextDocument,
		public dirty: boolean,
		private _eventDelegates: { onDidBlameStateChange(e: DocumentBlameStateChangeEvent): void },
		private readonly container: Container,
	) {}

	dispose() {
		this.state = undefined;

		this._disposed = true;
		this._disposable?.dispose();
	}

	private initializing = true;
	private async initialize(): Promise<void> {
		const uri = this.document.uri;

		this._uri = await GitUri.fromUri(uri);
		if (!this._disposed) {
			await this.update({ forceDirtyIdle: true });
		}

		this.initializing = false;
	}

	private _forceDirtyStateChangeOnNextDocumentChange: boolean = false;
	get forceDirtyStateChangeOnNextDocumentChange() {
		return this._forceDirtyStateChangeOnNextDocumentChange;
	}

	private _hasRemotes: boolean = false;
	get hasRemotes() {
		return this._hasRemotes;
	}

	get isBlameable() {
		return this._blameFailed != null ? false : this._isTracked;
	}

	get canDirtyIdle(): boolean {
		if (!this.document.isDirty) return false;

		const maxLines = configuration.get('advanced.blame.sizeThresholdAfterEdit');
		return !(maxLines > 0 && this.document.lineCount > maxLines);
	}

	private _isDirtyIdle: boolean = false;
	get isDirtyIdle() {
		return this._isDirtyIdle;
	}

	setIsDirtyIdle(): boolean {
		if (!this.canDirtyIdle) return false;

		this._isDirtyIdle = true;
		return true;
	}

	private _isTracked: boolean = false;
	get isTracked() {
		return this._isTracked;
	}

	get lineCount(): number {
		return this.document.lineCount;
	}

	get uri(): GitUri {
		return this._uri;
	}

	async activate(): Promise<void> {
		if (this._requiresUpdate) {
			await this.update({ forceDirtyIdle: true });
		}
		void setContext('gitlens:activeFileStatus', this.getStatus());
	}

	is(document: TextDocument) {
		return document === this.document;
	}

	private _updateDebounced:
		| Deferrable<(options?: { forceBlameChange?: boolean | undefined }) => Promise<void>>
		| undefined;

	refresh(reason: 'doc-changed' | 'repo-changed') {
		this._requiresUpdate = true;
		this._blameFailed = undefined;
		this._isDirtyIdle = false;

		if (this.state != null) {
			this.state = undefined;
			Logger.log(`Reset state for '${this.document.uri.toString(true)}', reason=${reason}`);
		}

		if (reason === 'repo-changed' && isActiveDocument(this.document)) {
			if (this._updateDebounced == null) {
				this._updateDebounced = debounce(this.update.bind(this), 250);
			}

			void this._updateDebounced();
		}
	}

	private _blameFailed: Error | undefined;
	setBlameFailure(ex: Error) {
		const wasBlameable = this.isBlameable;

		this._blameFailed = ex;

		if (wasBlameable && isActiveDocument(this.document)) {
			void this.update({ forceBlameChange: true });
		}
	}

	resetForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = false;
	}

	setForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = true;
	}

	private _requiresUpdate: boolean = true;
	async update(options?: { forceBlameChange?: boolean; forceDirtyIdle?: boolean }): Promise<void> {
		this._requiresUpdate = false;

		if (this._disposed || this._uri == null) {
			this._hasRemotes = false;
			this._isTracked = false;

			return;
		}

		if (this.document.isDirty && options?.forceDirtyIdle && this.canDirtyIdle) {
			this._isDirtyIdle = true;
		} else {
			this._isDirtyIdle = false;
		}

		// Caches these before the awaits
		const active = getEditorIfActive(this.document);
		const wasBlameable = options?.forceBlameChange ? undefined : this.isBlameable;

		const repo = this.container.git.getRepository(this._uri);
		if (repo == null) {
			this._isTracked = false;
			this._hasRemotes = false;
		} else {
			[this._isTracked, this._hasRemotes] = await Promise.all([
				this.container.git.isTracked(this._uri),
				repo.hasRemotes(),
			]);
		}

		if (active != null) {
			const blameable = this.isBlameable;

			void setContext('gitlens:activeFileStatus', this.getStatus());

			if (!this.initializing && wasBlameable !== blameable) {
				const e: DocumentBlameStateChangeEvent = { editor: active, document: this, blameable: blameable };
				this._onDidBlameStateChange.fire(e);
				this._eventDelegates.onDidBlameStateChange(e);
			}
		}
	}

	private getStatus() {
		let status = '';
		if (this.isTracked) {
			status += 'tracked|';
		}
		if (this.isBlameable) {
			status += 'blameable|';
		}
		if (this.hasRemotes) {
			status += 'remotes|';
		}

		return status ? status : undefined;
	}
}
