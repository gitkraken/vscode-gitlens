import type { Disposable, TextDocument } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitBlame } from '../git/models/blame';
import type { GitDiffFile } from '../git/models/diff';
import type { GitLog } from '../git/models/log';
import { debug, logName } from '../system/decorators/log';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { configuration } from '../system/vscode/configuration';
import { getEditorIfVisible, isActiveDocument, isVisibleDocument } from '../system/vscode/utils';
import type { DocumentBlameStateChangeEvent, GitDocumentTracker } from './documentTracker';

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

export interface TrackedGitDocumentStatus {
	blameable: boolean;
	tracked: boolean;

	dirtyIdle?: boolean;
}

@logName<TrackedGitDocument>((c, name) => `${name}(${Logger.toLoggable(c.document)})`)
export class TrackedGitDocument implements Disposable {
	static async create(
		container: Container,
		tracker: GitDocumentTracker,
		document: TextDocument,
		onDidBlameStateChange: (e: DocumentBlameStateChangeEvent) => void,
		visible: boolean,
		dirty: boolean,
	) {
		const doc = new TrackedGitDocument(container, tracker, document, onDidBlameStateChange, dirty);
		await doc.initialize(visible);
		return doc;
	}

	state: GitDocumentState | undefined;

	private _disposable: Disposable | undefined;
	private _disposed: boolean = false;
	private _tracked: boolean = false;
	private _pendingUpdates: { reason: string; forceBlameChange?: boolean; forceDirtyIdle?: boolean } | undefined;
	private _updateDebounced: Deferrable<TrackedGitDocument['update']> | undefined;
	private _uri!: GitUri;

	private constructor(
		private readonly container: Container,
		private readonly tracker: GitDocumentTracker,
		readonly document: TextDocument,
		private readonly _onDidChangeBlameState: (e: DocumentBlameStateChangeEvent) => void,
		public dirty: boolean,
	) {}

	dispose() {
		this.state = undefined;

		this._disposed = true;
		this._disposable?.dispose();
	}

	private _loading = false;

	@debug()
	private async initialize(visible: boolean): Promise<void> {
		this._uri = await GitUri.fromUri(this.document.uri);
		if (this._disposed) return;

		this._pendingUpdates = { ...this._pendingUpdates, reason: 'initialize', forceDirtyIdle: true };
		if (visible) {
			this._loading = true;
			void this.update().finally(() => (this._loading = false));
		}
	}

	private get blameable() {
		return this._blameFailure != null ? false : this._tracked;
	}

	get canDirtyIdle(): boolean {
		if (!this.document.isDirty) return false;

		const maxLines = configuration.get('advanced.blame.sizeThresholdAfterEdit');
		return !(maxLines > 0 && this.document.lineCount > maxLines);
	}

	private _dirtyIdle: boolean = false;
	setDirtyIdle(): boolean {
		this._dirtyIdle = this.canDirtyIdle;
		return this._dirtyIdle;
	}

	private _forceDirtyStateChangeOnNextDocumentChange: boolean = false;
	get forceDirtyStateChangeOnNextDocumentChange() {
		return this._forceDirtyStateChangeOnNextDocumentChange;
	}

	get lineCount(): number {
		return this.document.lineCount;
	}

	get uri(): GitUri {
		return this._uri;
	}

	async getStatus(): Promise<TrackedGitDocumentStatus> {
		if (this._pendingUpdates != null) {
			await this.update();
		}
		return {
			blameable: this.blameable,
			tracked: this._tracked,

			dirtyIdle: this._dirtyIdle,
		};
	}

	is(document: TextDocument) {
		return document === this.document;
	}

	@debug()
	refresh(reason: 'changed' | 'saved' | 'visible' | 'repositoryChanged') {
		if (this._pendingUpdates == null && reason === 'visible') return;

		const scope = getLogScope();

		this._blameFailure = undefined;
		this._dirtyIdle = false;

		if (this.state != null) {
			this.state = undefined;
			Logger.log(scope, `Reset state, reason=${reason}`);
		}

		switch (reason) {
			case 'changed':
				// Pending update here?
				return;
			case 'saved':
				this._pendingUpdates = { ...this._pendingUpdates, reason: reason, forceBlameChange: true };
				break;
			case 'repositoryChanged':
				this._pendingUpdates = { ...this._pendingUpdates, reason: reason };
				break;
		}

		// Only update the active document immediately if this isn't a "visible" change, since visible changes need to be debounced (vscode fires too many)
		if (isActiveDocument(this.document) && reason !== 'visible') {
			void this.update();
		} else if (isVisibleDocument(this.document)) {
			this._updateDebounced ??= debounce(this.update.bind(this), 100);
			void this._updateDebounced();
		}
	}

	private _blameFailure: Error | undefined;
	setBlameFailure(ex: Error) {
		const wasBlameable = this.blameable;

		this._blameFailure = ex;

		if (wasBlameable) {
			this._pendingUpdates = { ...this._pendingUpdates, reason: 'blame-failed', forceBlameChange: true };

			if (isActiveDocument(this.document)) {
				void this.update();
			}
		}
	}

	resetForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = false;
	}

	setForceDirtyStateChangeOnNextDocumentChange() {
		this._forceDirtyStateChangeOnNextDocumentChange = true;
	}

	@debug()
	private async update(): Promise<void> {
		const updates = this._pendingUpdates;
		this._pendingUpdates = undefined;

		if (this._disposed || this._uri == null) {
			this._tracked = false;

			return;
		}

		this._dirtyIdle = Boolean(this.document.isDirty && updates?.forceDirtyIdle && this.canDirtyIdle);
		// Cache before await
		const wasBlameable = updates?.forceBlameChange ? undefined : this.blameable;

		const repo = this.container.git.getRepository(this._uri);
		this._tracked = repo != null ? await this.container.git.isTracked(this._uri) : false;

		this.tracker.updateContext(this.document.uri, this.blameable, this._tracked);

		if (!this._loading && wasBlameable !== this.blameable) {
			const e: DocumentBlameStateChangeEvent = {
				editor: getEditorIfVisible(this.document),
				document: this,
				blameable: this.blameable,
			};
			this._onDidChangeBlameState(e);
		}
	}
}

export async function createTrackedGitDocument(
	container: Container,
	tracker: GitDocumentTracker,
	document: TextDocument,
	onDidChangeBlameState: (e: DocumentBlameStateChangeEvent) => void,
	visible: boolean,
	dirty: boolean,
) {
	return TrackedGitDocument.create(container, tracker, document, onDidChangeBlameState, visible, dirty);
}
