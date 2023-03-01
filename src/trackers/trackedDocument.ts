import type { Disposable, Event, TextDocument, TextEditor } from 'vscode';
import { EventEmitter } from 'vscode';
import { ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing } from '../git/models/constants';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getEditorIfActive, isActiveDocument } from '../system/utils';

export interface DocumentBlameStateChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly blameable: boolean;
}

export class TrackedDocument<T> implements Disposable {
	static async create<T>(
		document: TextDocument,
		dirty: boolean,
		eventDelegates: { onDidBlameStateChange(e: DocumentBlameStateChangeEvent<T>): void },
		container: Container,
	) {
		const doc = new TrackedDocument(document, dirty, eventDelegates, container);
		await doc.initialize();
		return doc;
	}

	private _onDidBlameStateChange = new EventEmitter<DocumentBlameStateChangeEvent<T>>();
	get onDidBlameStateChange(): Event<DocumentBlameStateChangeEvent<T>> {
		return this._onDidBlameStateChange.event;
	}

	state: T | undefined;

	private _disposable: Disposable | undefined;
	private _disposed: boolean = false;
	private _uri!: GitUri;

	private constructor(
		readonly document: TextDocument,
		public dirty: boolean,
		private _eventDelegates: { onDidBlameStateChange(e: DocumentBlameStateChangeEvent<T>): void },
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
			await this.update();
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
		return this._blameFailed ? false : this._isTracked;
	}

	private _isDirtyIdle: boolean = false;
	get isDirtyIdle() {
		return this._isDirtyIdle;
	}
	set isDirtyIdle(value: boolean) {
		this._isDirtyIdle = value;
	}

	get isRevision() {
		return this._uri != null ? Boolean(this._uri.sha) && this._uri.sha !== deletedOrMissing : false;
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
			await this.update();
		}
		void setContext(ContextKeys.ActiveFileStatus, this.getStatus());
	}

	is(document: TextDocument) {
		return document === this.document;
	}

	private _updateDebounced:
		| Deferrable<({ forceBlameChange }?: { forceBlameChange?: boolean | undefined }) => Promise<void>>
		| undefined;

	reset(reason: 'config' | 'document' | 'repository') {
		this._requiresUpdate = true;
		this._blameFailed = false;
		this._isDirtyIdle = false;

		if (this.state != null) {
			this.state = undefined;
			Logger.log(`Reset state for '${this.document.uri.toString(true)}', reason=${reason}`);
		}

		if (reason === 'repository' && isActiveDocument(this.document)) {
			if (this._updateDebounced == null) {
				this._updateDebounced = debounce(this.update.bind(this), 250);
			}

			void this._updateDebounced();
		}
	}

	private _blameFailed: boolean = false;
	setBlameFailure() {
		const wasBlameable = this.isBlameable;

		this._blameFailed = true;

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
	async update({ forceBlameChange }: { forceBlameChange?: boolean } = {}) {
		this._requiresUpdate = false;

		if (this._disposed || this._uri == null) {
			this._hasRemotes = false;
			this._isTracked = false;

			return;
		}

		this._isDirtyIdle = false;

		// Caches these before the awaits
		const active = getEditorIfActive(this.document);
		const wasBlameable = forceBlameChange ? undefined : this.isBlameable;

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

			void setContext(ContextKeys.ActiveFileStatus, this.getStatus());

			if (!this.initializing && wasBlameable !== blameable) {
				const e: DocumentBlameStateChangeEvent<T> = { editor: active, document: this, blameable: blameable };
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
		if (this.isRevision) {
			status += 'revision|';
		}
		if (this.hasRemotes) {
			status += 'remotes|';
		}

		return status ? status : undefined;
	}
}
