'use strict';
import { Disposable, Event, EventEmitter, TextDocument, TextEditor, Uri } from 'vscode';
import { CommandContext, getEditorIfActive, isActiveDocument, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitRevision, Repository, RepositoryChange, RepositoryChangeEvent } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Functions } from '../system';

export interface DocumentBlameStateChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly blameable: boolean;
}

export class TrackedDocument<T> implements Disposable {
	private _onDidBlameStateChange = new EventEmitter<DocumentBlameStateChangeEvent<T>>();
	get onDidBlameStateChange(): Event<DocumentBlameStateChangeEvent<T>> {
		return this._onDidBlameStateChange.event;
	}

	state: T | undefined;

	private _disposable: Disposable | undefined;
	private _disposed: boolean = false;
	private _repo: Promise<Repository | undefined>;
	private _uri!: GitUri;

	constructor(
		private readonly _document: TextDocument,
		public readonly key: string,
		public dirty: boolean,
		private _eventDelegates: { onDidBlameStateChange(e: DocumentBlameStateChangeEvent<T>): void },
	) {
		this._repo = this.initialize(_document.uri);
	}

	dispose() {
		this._disposed = true;
		this.reset('dispose');
		this._disposable && this._disposable.dispose();
	}

	private async initialize(uri: Uri): Promise<Repository | undefined> {
		// Since there is a bit of a chicken & egg problem with the DocumentTracker and the GitService, wait for the GitService to load if it isn't
		if (Container.git === undefined) {
			if (!(await Functions.waitUntil(() => Container.git !== undefined, 2000))) {
				Logger.log(
					`TrackedDocument.initialize(${uri.toString(true)})`,
					'Timed out waiting for the GitService to start',
				);
				throw new Error('TrackedDocument timed out waiting for the GitService to start');
			}
		}

		this._uri = await GitUri.fromUri(uri);
		if (this._disposed) return undefined;

		const repo = await Container.git.getRepository(this._uri);
		if (this._disposed) return undefined;

		if (repo !== undefined) {
			this._disposable = repo.onDidChange(this.onRepositoryChanged, this);
		}

		await this.update({ initializing: true, repo: repo });

		return repo;
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Repository)) return;

		// Reset any cached state
		this.reset('repository');
		void this.update();
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
		if (this._blameFailed) return false;

		return this._isTracked;
	}

	private _isDirtyIdle: boolean = false;
	get isDirtyIdle() {
		return this._isDirtyIdle;
	}
	set isDirtyIdle(value: boolean) {
		this._isDirtyIdle = value;
	}

	get isRevision() {
		return this._uri !== undefined
			? Boolean(this._uri.sha) && this._uri.sha !== GitRevision.deletedOrMissing
			: false;
	}

	private _isTracked: boolean = false;
	get isTracked() {
		return this._isTracked;
	}

	get lineCount(): number {
		return this._document.lineCount;
	}

	get uri() {
		return this._uri;
	}

	activate() {
		void setCommandContext(CommandContext.ActiveFileStatus, this.getStatus());
	}

	async ensureInitialized() {
		await this._repo;
	}

	is(document: TextDocument) {
		return document === this._document;
	}

	reset(reason: 'config' | 'dispose' | 'document' | 'repository') {
		this._blameFailed = false;
		this._isDirtyIdle = false;

		if (this.state === undefined) return;

		// // Don't remove broken blame on change (since otherwise we'll have to run the broken blame again)
		// if (!this.state.hasErrors) {

		this.state = undefined;
		Logger.log(`Reset state for '${this.key}', reason=${reason}`);

		// }
	}

	private _blameFailed: boolean = false;
	setBlameFailure() {
		const wasBlameable = this.isBlameable;

		this._blameFailed = true;

		if (wasBlameable && isActiveDocument(this._document)) {
			void this.update({ forceBlameChange: true });
		}
	}

	resetForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = false;
	}

	setForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = true;
	}

	async update(options: { forceBlameChange?: boolean; initializing?: boolean; repo?: Repository } = {}) {
		if (this._disposed || this._uri === undefined) {
			this._hasRemotes = false;
			this._isTracked = false;

			return;
		}

		this._isDirtyIdle = false;

		const active = getEditorIfActive(this._document);
		const wasBlameable = options.forceBlameChange ? undefined : this.isBlameable;

		this._isTracked = await Container.git.isTracked(this._uri);

		let repo = undefined;
		if (this._isTracked) {
			repo = options.repo;
			if (repo === undefined) {
				repo = await this._repo;
			}
		}

		if (repo !== undefined) {
			this._hasRemotes = await repo.hasRemotes();
		} else {
			this._hasRemotes = false;
		}

		if (active !== undefined) {
			const blameable = this.isBlameable;

			void setCommandContext(CommandContext.ActiveFileStatus, this.getStatus());

			if (!options.initializing && wasBlameable !== blameable) {
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
