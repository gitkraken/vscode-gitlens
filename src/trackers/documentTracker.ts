import type {
	ConfigurationChangeEvent,
	Event,
	Position,
	Range,
	TextDocument,
	TextDocumentChangeEvent,
	TextDocumentContentChangeEvent,
	TextEditor,
	TextLine,
} from 'vscode';
import { Disposable, EndOfLine, env, EventEmitter, Uri, window, workspace } from 'vscode';
import type { Container } from '../container';
import type { RepositoriesChangeEvent } from '../git/gitProviderService';
import type { GitUri } from '../git/gitUri';
import { isGitUri } from '../git/gitUri';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { once } from '../system/event';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { findTextDocument, isActiveDocument, isTextEditor } from '../system/utils';
import { TrackedGitDocument } from './trackedDocument';

export interface DocumentContentChangeEvent {
	readonly editor: TextEditor;
	readonly document: TrackedGitDocument;
	readonly contentChanges: readonly TextDocumentContentChangeEvent[];
}

export interface DocumentBlameStateChangeEvent {
	readonly editor: TextEditor;
	readonly document: TrackedGitDocument;
	readonly blameable: boolean;
}

export interface DocumentDirtyStateChangeEvent {
	readonly editor: TextEditor;
	readonly document: TrackedGitDocument;
	readonly dirty: boolean;
}

export interface DocumentDirtyIdleTriggerEvent {
	readonly editor: TextEditor;
	readonly document: TrackedGitDocument;
}

export class GitDocumentTracker implements Disposable {
	private _onDidChangeBlameState = new EventEmitter<DocumentBlameStateChangeEvent>();
	get onDidChangeBlameState(): Event<DocumentBlameStateChangeEvent> {
		return this._onDidChangeBlameState.event;
	}

	private _onDidChangeContent = new EventEmitter<DocumentContentChangeEvent>();
	get onDidChangeContent(): Event<DocumentContentChangeEvent> {
		return this._onDidChangeContent.event;
	}

	private _onDidChangeDirtyState = new EventEmitter<DocumentDirtyStateChangeEvent>();
	get onDidChangeDirtyState(): Event<DocumentDirtyStateChangeEvent> {
		return this._onDidChangeDirtyState.event;
	}

	private _onDidTriggerDirtyIdle = new EventEmitter<DocumentDirtyIdleTriggerEvent>();
	get onDidTriggerDirtyIdle(): Event<DocumentDirtyIdleTriggerEvent> {
		return this._onDidTriggerDirtyIdle.event;
	}

	private _dirtyIdleTriggerDelay: number;
	private _dirtyIdleTriggeredDebounced: Deferrable<(e: DocumentDirtyIdleTriggerEvent) => void> | undefined;
	private _dirtyStateChangedDebounced: Deferrable<(e: DocumentDirtyStateChangeEvent) => void> | undefined;
	private readonly _disposable: Disposable;
	private readonly _documentMap = new Map<TextDocument, Promise<TrackedGitDocument>>();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			window.onDidChangeActiveTextEditor(this.onActiveTextEditorChanged, this),
			workspace.onDidChangeTextDocument(this.onTextDocumentChanged, this),
			workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
			workspace.onDidSaveTextDocument(this.onTextDocumentSaved, this),
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
		);

		this._dirtyIdleTriggerDelay = configuration.get('advanced.blame.delayAfterEdit');
	}

	dispose() {
		this._disposable.dispose();

		void this.clear();
	}

	private onReady(): void {
		this.onConfigurationChanged();
		this.onActiveTextEditorChanged(window.activeTextEditor);
	}

	private _timer: ReturnType<typeof setTimeout> | undefined;
	private onActiveTextEditorChanged(editor: TextEditor | undefined) {
		if (editor != null && !isTextEditor(editor)) return;

		this._dirtyIdleTriggeredDebounced?.flush();
		this._dirtyIdleTriggeredDebounced?.cancel();
		this._dirtyIdleTriggeredDebounced = undefined;

		this._dirtyStateChangedDebounced?.flush();
		this._dirtyStateChangedDebounced?.cancel();
		this._dirtyStateChangedDebounced = undefined;

		if (this._timer != null) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}

		if (editor == null) {
			this._timer = setTimeout(() => {
				this._timer = undefined;

				void setContext('gitlens:activeFileStatus', undefined);
			}, 250);

			return;
		}

		const doc = this._documentMap.get(editor.document);
		if (doc != null) {
			void doc.then(
				d => d.activate(),
				() => {},
			);

			return;
		}

		// No need to activate this, as it is implicit in initialization if currently active
		void this.addCore(editor.document);
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		// Only rest the cached state if we aren't initializing
		if (
			e != null &&
			(configuration.changed(e, 'blame.ignoreWhitespace') || configuration.changed(e, 'advanced.caching.enabled'))
		) {
			void this.refreshDocuments();
		}

		if (configuration.changed(e, 'advanced.blame.delayAfterEdit')) {
			this._dirtyIdleTriggerDelay = configuration.get('advanced.blame.delayAfterEdit');
			this._dirtyIdleTriggeredDebounced?.flush();
			this._dirtyIdleTriggeredDebounced?.cancel();
			this._dirtyIdleTriggeredDebounced = undefined;
		}
	}

	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		void this.refreshDocuments({
			addedOrChangedRepoPaths: e.added.length
				? new Set<string>(e.added.map(r => r.path.toLowerCase()))
				: undefined,
			removedRepoPaths: e.removed.length ? new Set<string>(e.removed.map(r => r.path.toLowerCase())) : undefined,
		});
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (
			e.changed(
				RepositoryChange.Index,
				RepositoryChange.Heads,
				RepositoryChange.Status,
				RepositoryChange.Unknown,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			void this.refreshDocuments({ addedOrChangedRepoPaths: new Set([e.repository.path]) });
		}
	}

	private debouncedTextDocumentChanges = new WeakMap<
		TextDocument,
		Deferrable<Parameters<typeof workspace.onDidChangeTextDocument>[0]>
	>();

	private onTextDocumentChanged(e: TextDocumentChangeEvent) {
		const { scheme } = e.document.uri;
		if (!this.container.git.supportedSchemes.has(scheme)) return;

		let debouncedChange = this.debouncedTextDocumentChanges.get(e.document);
		if (debouncedChange == null) {
			debouncedChange = debounce(
				e => this.onTextDocumentChangedCore(e),
				50,
				([prev]: [TextDocumentChangeEvent], [next]: [TextDocumentChangeEvent]) => {
					return [
						{
							...next,
							// Aggregate content changes
							contentChanges: [...prev.contentChanges, ...next.contentChanges],
						} satisfies TextDocumentChangeEvent,
					];
				},
			);
			this.debouncedTextDocumentChanges.set(e.document, debouncedChange);
		}

		debouncedChange(e);
	}

	private async onTextDocumentChangedCore(e: TextDocumentChangeEvent) {
		this.debouncedTextDocumentChanges.delete(e.document);

		const doc = await (this._documentMap.get(e.document) ?? this.addCore(e.document));
		doc.refresh('doc-changed');

		const dirty = e.document.isDirty;
		const editor = window.activeTextEditor;

		// If we have an idle tracker, either reset or cancel it
		if (this._dirtyIdleTriggeredDebounced != null) {
			if (dirty) {
				this._dirtyIdleTriggeredDebounced({ editor: editor!, document: doc });
			} else {
				this._dirtyIdleTriggeredDebounced.cancel();
			}
		}

		// Only fire change events for the active document
		if (editor?.document === e.document) {
			this._onDidChangeContent.fire({ editor: editor, document: doc, contentChanges: e.contentChanges });
		}

		if (!doc.forceDirtyStateChangeOnNextDocumentChange && doc.dirty === dirty) return;

		doc.resetForceDirtyStateChangeOnNextDocumentChange();
		doc.dirty = dirty;

		// Only fire state change events for the active document
		if (editor == null || editor.document !== e.document) return;

		this.fireDocumentDirtyStateChanged({ editor: editor, document: doc, dirty: doc.dirty });
	}

	private onTextDocumentClosed(document: TextDocument) {
		void this.remove(document);
	}

	private async onTextDocumentSaved(document: TextDocument) {
		const doc = this._documentMap.get(document);
		if (doc != null) {
			void (await doc).update({ forceBlameChange: true });

			return;
		}

		// If we are saving the active document make sure we are tracking it
		if (isActiveDocument(document)) {
			void this.addCore(document);
		}
	}

	// private onVisibleEditorsChanged(editors: TextEditor[]) {
	//     if (this._documentMap.size === 0) return;

	//     // If we have no visible editors, or no "real" visible editors reset our cache
	//     if (editors.length === 0 || editors.every(e => !isTextEditor(e))) {
	//         this.clear();
	//     }
	// }

	add(document: TextDocument): Promise<TrackedGitDocument>;
	add(uri: Uri): Promise<TrackedGitDocument>;
	add(documentOrUri: TextDocument | Uri): Promise<TrackedGitDocument>;
	async add(documentOrUri: TextDocument | Uri): Promise<TrackedGitDocument> {
		let document;
		if (isGitUri(documentOrUri)) {
			try {
				document = await workspace.openTextDocument(documentOrUri.documentUri());
			} catch (ex) {
				const msg: string = ex?.toString() ?? '';
				if (env.language.startsWith('en')) {
					if (msg.includes('File seems to be binary and cannot be opened as text')) {
						document = new BinaryTextDocument(documentOrUri);
					} else if (
						msg.includes('File not found') ||
						msg.includes('Unable to read file') ||
						msg.includes('Unable to resolve non-existing file')
					) {
						// If we can't find the file, assume it is because the file has been renamed or deleted at some point
						document = new MissingRevisionTextDocument(documentOrUri);

						// const [fileName, repoPath] = await this.container.git.findWorkingFileName(documentOrUri, undefined, ref);
						// if (fileName == null) throw new Error(`Failed to add tracking for document: ${documentOrUri}`);

						// documentOrUri = await workspace.openTextDocument(path.resolve(repoPath!, fileName));
					} else {
						throw ex;
					}
				} else if (msg.includes('cannot open')) {
					// If we aren't in english, we can't figure out what the error might be (since the messages are translated), so just assume its missing
					document = new MissingRevisionTextDocument(documentOrUri);
				} else {
					throw ex;
				}
			}
		} else if (documentOrUri instanceof Uri) {
			document = await workspace.openTextDocument(documentOrUri);
		} else {
			document = documentOrUri;
		}

		const doc = this.addCore(document);
		return doc;
	}

	private async addCore(document: TextDocument): Promise<TrackedGitDocument> {
		const doc = TrackedGitDocument.create(
			document,
			// Always start out false, so we will fire the event if needed
			false,
			{
				onDidBlameStateChange: (e: DocumentBlameStateChangeEvent) => this._onDidChangeBlameState.fire(e),
			},
			this.container,
		);

		this._documentMap.set(document, doc);

		return doc;
	}

	async clear() {
		for (const d of this._documentMap.values()) {
			(await d).dispose();
		}

		this._documentMap.clear();
	}

	get(document: TextDocument): Promise<TrackedGitDocument> | undefined;
	get(uri: Uri): Promise<TrackedGitDocument> | undefined;
	get(documentOrUri: TextDocument | Uri): Promise<TrackedGitDocument> | undefined;
	get(documentOrUri: TextDocument | Uri): Promise<TrackedGitDocument> | undefined {
		if (documentOrUri instanceof Uri) {
			const document = findTextDocument(documentOrUri);
			if (document == null) return undefined;

			documentOrUri = document;
		}

		const doc = this._documentMap.get(documentOrUri);
		return doc;
	}

	async getOrAdd(documentOrUri: TextDocument | Uri): Promise<TrackedGitDocument> {
		if (documentOrUri instanceof Uri) {
			documentOrUri = findTextDocument(documentOrUri) ?? documentOrUri;
		}

		const doc = this.get(documentOrUri) ?? this.add(documentOrUri);
		return doc;
	}

	has(document: TextDocument): boolean;
	has(uri: Uri): boolean;
	has(documentOrUri: TextDocument | Uri): boolean {
		if (documentOrUri instanceof Uri) {
			const document = findTextDocument(documentOrUri);
			if (document == null) return false;

			documentOrUri = document;
		}

		return this._documentMap.has(documentOrUri);
	}

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

	private async remove(document: TextDocument, tracked?: TrackedGitDocument): Promise<void> {
		let docPromise;
		if (tracked != null) {
			docPromise = this._documentMap.get(document);
		}

		this._documentMap.delete(document);

		(tracked ?? (await docPromise))?.dispose();
	}

	private fireDocumentDirtyStateChanged(e: DocumentDirtyStateChangeEvent) {
		if (e.dirty) {
			queueMicrotask(() => {
				this._dirtyStateChangedDebounced?.cancel();
				if (window.activeTextEditor !== e.editor) return;

				this._onDidChangeDirtyState.fire(e);
			});

			if (this._dirtyIdleTriggerDelay > 0) {
				this._dirtyIdleTriggeredDebounced ??= debounce((e: DocumentDirtyIdleTriggerEvent) => {
					if (this._dirtyIdleTriggeredDebounced?.pending()) return;

					if (e.document.setIsDirtyIdle()) {
						this._onDidTriggerDirtyIdle.fire(e);
					}
				}, this._dirtyIdleTriggerDelay);

				this._dirtyIdleTriggeredDebounced({ editor: e.editor, document: e.document });
			}

			return;
		}

		this._dirtyStateChangedDebounced ??= debounce((e: DocumentDirtyStateChangeEvent) => {
			if (window.activeTextEditor !== e.editor) return;

			this._onDidChangeDirtyState.fire(e);
		}, 250);

		this._dirtyStateChangedDebounced(e);
	}

	private async refreshDocuments(changed?: {
		addedOrChangedRepoPaths?: Set<string>;
		removedRepoPaths?: Set<string>;
	}) {
		if (this._documentMap.size === 0) return;

		for await (const doc of this._documentMap.values()) {
			const repoPath = doc.uri.repoPath?.toLocaleLowerCase();
			if (repoPath == null) continue;

			if (changed?.removedRepoPaths?.has(repoPath)) {
				void this.remove(doc.document, doc);
			} else if (changed == null || changed?.addedOrChangedRepoPaths?.has(repoPath)) {
				doc.refresh('repo-changed');
			}
		}
	}
}

class EmptyTextDocument implements TextDocument {
	readonly eol: EndOfLine;
	readonly fileName: string;
	readonly isClosed: boolean;
	readonly isDirty: boolean;
	readonly isUntitled: boolean;
	readonly languageId: string;
	readonly lineCount: number;
	readonly uri: Uri;
	readonly version: number;

	constructor(public readonly gitUri: GitUri) {
		this.uri = gitUri.documentUri();

		this.eol = EndOfLine.LF;
		this.fileName = this.uri.fsPath;
		this.isClosed = false;
		this.isDirty = false;
		this.isUntitled = false;
		this.languageId = '';
		this.lineCount = 0;
		this.version = 0;
	}

	getText(_range?: Range | undefined): string {
		throw new Error('Method not supported.');
	}

	getWordRangeAtPosition(_position: Position, _regex?: RegExp | undefined): Range | undefined {
		throw new Error('Method not supported.');
	}

	lineAt(line: number): TextLine;
	lineAt(position: Position): TextLine;
	lineAt(_position: any): TextLine {
		throw new Error('Method not supported.');
	}

	offsetAt(_position: Position): number {
		throw new Error('Method not supported.');
	}

	positionAt(_offset: number): Position {
		throw new Error('Method not supported.');
	}

	save(): Thenable<boolean> {
		throw new Error('Method not supported.');
	}

	validatePosition(_position: Position): Position {
		throw new Error('Method not supported.');
	}

	validateRange(_range: Range): Range {
		throw new Error('Method not supported.');
	}
}

class BinaryTextDocument extends EmptyTextDocument {}
class MissingRevisionTextDocument extends EmptyTextDocument {}
