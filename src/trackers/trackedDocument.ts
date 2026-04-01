import type { Disposable, TextDocument, TextDocumentContentChangeEvent } from 'vscode';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { logName, trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import type { BlameSnapshot } from '../git/utils/blameSnapshot.js';
import { configuration } from '../system/-webview/configuration.js';
import { isActiveTextDocument, isVisibleTextDocument } from '../system/-webview/vscode/documents.js';
import { getOpenTextEditorIfVisible } from '../system/-webview/vscode/editors.js';
import type { DocumentBlameStateChangeEvent, GitDocumentTracker } from './documentTracker.js';

export interface TrackedGitDocumentStatus {
	blameable: boolean;
	tracked: boolean;

	dirtyIdle?: boolean;
}

@logName(c => `TrackedGitDocument(${Logger.toLoggable(c.document)})`)
export class TrackedGitDocument implements Disposable {
	static async create(
		container: Container,
		tracker: GitDocumentTracker,
		document: TextDocument,
		onDidBlameStateChange: (e: DocumentBlameStateChangeEvent) => void,
		visible: boolean,
		dirty: boolean,
	): Promise<TrackedGitDocument> {
		const doc = new TrackedGitDocument(container, tracker, document, onDidBlameStateChange, dirty);
		await doc.initialize(visible);
		return doc;
	}

	/** Baseline for in-memory dirty blame computation (no git process needed) */
	blameSnapshot: BlameSnapshot | undefined;
	/** Duration (ms) of the last fresh git blame for this document, used to throttle resets */
	lastBlameDuration = 0;

	private _disposable: Disposable | undefined;
	private _disposed: boolean = false;
	private _tracked: boolean = false;
	private _pendingUpdates: { reason: string; forceBlameChange?: boolean; forceDirtyIdle?: boolean } | undefined;
	private _updateDebounced: Deferrable<TrackedGitDocument['updateCore']> | undefined;
	private _updateInFlight: Promise<void> | undefined;
	private _uri!: GitUri;

	private constructor(
		private readonly container: Container,
		private readonly tracker: GitDocumentTracker,
		readonly document: TextDocument,
		private readonly _onDidChangeBlameState: (e: DocumentBlameStateChangeEvent) => void,
		public dirty: boolean,
	) {}

	dispose(): void {
		this.blameSnapshot = undefined;
		this._disposed = true;
		this._disposable?.dispose();
	}

	/** Record content changes for in-memory dirty blame incremental tracking */
	recordContentChanges(contentChanges: readonly TextDocumentContentChangeEvent[]): void {
		this.blameSnapshot?.recordContentChanges(contentChanges);
	}

	private _loading = false;

	@trace()
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
		return this._tracked;
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
	get forceDirtyStateChangeOnNextDocumentChange(): boolean {
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
		} else if (this._updateInFlight != null) {
			await this._updateInFlight;
		}
		return {
			blameable: this.blameable,
			tracked: this._tracked,

			dirtyIdle: this._dirtyIdle,
		};
	}

	is(document: TextDocument): boolean {
		return document === this.document;
	}

	@trace()
	refresh(reason: 'changed' | 'saved' | 'visible' | 'repositoryChanged'): void {
		if (this._pendingUpdates == null && reason === 'visible') return;

		this._dirtyIdle = false;

		switch (reason) {
			case 'changed':
				// Don't clear blame cache on edits — the in-memory dirty blame (BlameSnapshot)
				// handles dirty content without needing to re-run git blame.
				return;
			case 'saved':
				// Update on save, then check if the snapshot has drifted too far
				// or is too stale to trust — if so, discard and force a fresh git blame.
				if (this.blameSnapshot != null) {
					try {
						this.blameSnapshot = this.blameSnapshot.update(this.document.getText(), this.document.version);
						if (this.blameSnapshot.shouldReset(this.lastBlameDuration)) {
							this.blameSnapshot = undefined;
						}
					} catch (ex) {
						Logger.error(ex, 'TrackedGitDocument', 'Failed to update snapshot on save');
						this.blameSnapshot = undefined;
					}
				}
				// Don't force blame change if we have a valid baseline — the blame data
				// is already correct and a full refresh would cause auto-save thrashing.
				if (this.blameSnapshot == null) {
					this._pendingUpdates = { ...this._pendingUpdates, reason: reason, forceBlameChange: true };
				}
				break;
			case 'repositoryChanged':
				// Full reset on repository changes — git state changed externally
				this.blameSnapshot = undefined;
				this._pendingUpdates = { ...this._pendingUpdates, reason: reason };
				break;
		}

		// Only update the active document immediately if this isn't a "visible" change, since visible changes need to be debounced (vscode fires too many)
		if (isActiveTextDocument(this.document) && reason !== 'visible') {
			void this.update();
		} else if (isVisibleTextDocument(this.document)) {
			this._updateDebounced ??= debounce(this.updateCore.bind(this), 100);
			void this._updateDebounced();
		}
	}

	resetForceDirtyStateChangeOnNextDocumentChange(): void {
		this._forceDirtyStateChangeOnNextDocumentChange = false;
	}

	setForceDirtyStateChangeOnNextDocumentChange(): void {
		this._forceDirtyStateChangeOnNextDocumentChange = true;
	}

	private update(): Promise<void> {
		const p = this.updateCore();
		this._updateInFlight = p;
		void p.finally(() => {
			if (this._updateInFlight === p) {
				this._updateInFlight = undefined;
			}
		});
		return p;
	}

	@trace()
	private async updateCore(): Promise<void> {
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
				editor: getOpenTextEditorIfVisible(this.document),
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
): Promise<TrackedGitDocument> {
	return TrackedGitDocument.create(container, tracker, document, onDidChangeBlameState, visible, dirty);
}
