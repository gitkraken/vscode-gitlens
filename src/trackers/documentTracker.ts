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
import { ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import type { RepositoriesChangeEvent } from '../git/gitProviderService';
import type { GitUri } from '../git/gitUri';
import { isGitUri } from '../git/gitUri';
import type { RepositoryChangeEvent } from '../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../git/models/repository';
import { configuration } from '../system/configuration';
import { debug } from '../system/decorators/log';
import { once } from '../system/event';
import type { Deferrable } from '../system/function';
import { debounce } from '../system/function';
import { filter, join, map } from '../system/iterable';
import { findTextDocument, isActiveDocument, isTextEditor } from '../system/utils';
import type { DocumentBlameStateChangeEvent } from './trackedDocument';
import { TrackedDocument } from './trackedDocument';

export * from './trackedDocument';

export interface DocumentContentChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly contentChanges: ReadonlyArray<TextDocumentContentChangeEvent>;
}

export interface DocumentDirtyStateChangeEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
	readonly dirty: boolean;
}

export interface DocumentDirtyIdleTriggerEvent<T> {
	readonly editor: TextEditor;
	readonly document: TrackedDocument<T>;
}

export class DocumentTracker<T> implements Disposable {
	private _onDidChangeBlameState = new EventEmitter<DocumentBlameStateChangeEvent<T>>();
	get onDidChangeBlameState(): Event<DocumentBlameStateChangeEvent<T>> {
		return this._onDidChangeBlameState.event;
	}

	private _onDidChangeContent = new EventEmitter<DocumentContentChangeEvent<T>>();
	get onDidChangeContent(): Event<DocumentContentChangeEvent<T>> {
		return this._onDidChangeContent.event;
	}

	private _onDidChangeDirtyState = new EventEmitter<DocumentDirtyStateChangeEvent<T>>();
	get onDidChangeDirtyState(): Event<DocumentDirtyStateChangeEvent<T>> {
		return this._onDidChangeDirtyState.event;
	}

	private _onDidTriggerDirtyIdle = new EventEmitter<DocumentDirtyIdleTriggerEvent<T>>();
	get onDidTriggerDirtyIdle(): Event<DocumentDirtyIdleTriggerEvent<T>> {
		return this._onDidTriggerDirtyIdle.event;
	}

	private _dirtyIdleTriggerDelay: number;
	private readonly _disposable: Disposable;
	protected readonly _documentMap = new Map<TextDocument, Promise<TrackedDocument<T>>>();

	constructor(protected readonly container: Container) {
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			window.onDidChangeActiveTextEditor(this.onActiveTextEditorChanged, this),
			// window.onDidChangeVisibleTextEditors(debounce(this.onVisibleEditorsChanged, 5000), this),
			workspace.onDidChangeTextDocument(debounce(this.onTextDocumentChanged, 50), this),
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

		if (this._timer != null) {
			clearTimeout(this._timer);
			this._timer = undefined;
		}

		if (editor == null) {
			this._timer = setTimeout(() => {
				this._timer = undefined;

				void setContext(ContextKeys.ActiveFileStatus, undefined);
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
			this.reset('config');
		}

		if (configuration.changed(e, 'advanced.blame.delayAfterEdit')) {
			this._dirtyIdleTriggerDelay = configuration.get('advanced.blame.delayAfterEdit');
			this._dirtyIdleTriggeredDebounced = undefined;
		}
	}

	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		this.reset(
			'repository',
			e.added.length ? new Set<string>(e.added.map(r => r.path)) : undefined,
			e.removed.length ? new Set<string>(e.removed.map(r => r.path)) : undefined,
		);
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
			this.reset('repository', new Set([e.repository.path]));
		}
	}

	private async onTextDocumentChanged(e: TextDocumentChangeEvent) {
		const { scheme } = e.document.uri;
		if (!this.container.git.supportedSchemes.has(scheme)) return;

		const doc = await (this._documentMap.get(e.document) ?? this.addCore(e.document));
		doc.reset('document');

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

	add(document: TextDocument): Promise<TrackedDocument<T>>;
	add(uri: Uri): Promise<TrackedDocument<T>>;
	add(documentOrUri: TextDocument | Uri): Promise<TrackedDocument<T>>;
	async add(documentOrUri: TextDocument | Uri): Promise<TrackedDocument<T>> {
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

	private async addCore(document: TextDocument): Promise<TrackedDocument<T>> {
		const doc = TrackedDocument.create<T>(
			document,
			// Always start out false, so we will fire the event if needed
			false,
			{
				onDidBlameStateChange: (e: DocumentBlameStateChangeEvent<T>) => this._onDidChangeBlameState.fire(e),
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

	get(document: TextDocument): Promise<TrackedDocument<T>> | undefined;
	get(uri: Uri): Promise<TrackedDocument<T>> | undefined;
	get(documentOrUri: TextDocument | Uri): Promise<TrackedDocument<T>> | undefined;
	get(documentOrUri: TextDocument | Uri): Promise<TrackedDocument<T>> | undefined {
		if (documentOrUri instanceof Uri) {
			const document = findTextDocument(documentOrUri);
			if (document == null) return undefined;

			documentOrUri = document;
		}

		const doc = this._documentMap.get(documentOrUri);
		return doc;
	}

	async getOrAdd(documentOrUri: TextDocument | Uri): Promise<TrackedDocument<T>> {
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

	private async remove(document: TextDocument, tracked?: TrackedDocument<T>): Promise<void> {
		let promise;
		if (tracked != null) {
			promise = this._documentMap.get(document);
		}

		this._documentMap.delete(document);

		(tracked ?? (await promise))?.dispose();
	}

	private _dirtyIdleTriggeredDebounced: Deferrable<(e: DocumentDirtyIdleTriggerEvent<T>) => void> | undefined;
	private _dirtyStateChangedDebounced: Deferrable<(e: DocumentDirtyStateChangeEvent<T>) => void> | undefined;
	private fireDocumentDirtyStateChanged(e: DocumentDirtyStateChangeEvent<T>) {
		if (e.dirty) {
			queueMicrotask(() => {
				this._dirtyStateChangedDebounced?.cancel();
				if (window.activeTextEditor !== e.editor) return;

				this._onDidChangeDirtyState.fire(e);
			});

			if (this._dirtyIdleTriggerDelay > 0) {
				if (this._dirtyIdleTriggeredDebounced == null) {
					this._dirtyIdleTriggeredDebounced = debounce(
						(e: DocumentDirtyIdleTriggerEvent<T>) => {
							if (this._dirtyIdleTriggeredDebounced?.pending!()) return;

							e.document.isDirtyIdle = true;
							this._onDidTriggerDirtyIdle.fire(e);
						},
						this._dirtyIdleTriggerDelay,
						{ track: true },
					);
				}

				this._dirtyIdleTriggeredDebounced({ editor: e.editor, document: e.document });
			}

			return;
		}

		if (this._dirtyStateChangedDebounced == null) {
			this._dirtyStateChangedDebounced = debounce((e: DocumentDirtyStateChangeEvent<T>) => {
				if (window.activeTextEditor !== e.editor) return;

				this._onDidChangeDirtyState.fire(e);
			}, 250);
		}

		this._dirtyStateChangedDebounced(e);
	}

	@debug<DocumentTracker<T>['reset']>({
		args: {
			1: c => (c != null ? join(c, ',') : ''),
			2: r => (r != null ? join(r, ',') : ''),
		},
	})
	private reset(reason: 'config' | 'repository', changedRepoPaths?: Set<string>, removedRepoPaths?: Set<string>) {
		void Promise.allSettled(
			map(
				filter(this._documentMap, ([key]) => typeof key === 'string'),
				async ([, promise]) => {
					const doc = await promise;

					if (removedRepoPaths?.has(doc.uri.repoPath!)) {
						void this.remove(doc.document, doc);
						return;
					}

					if (changedRepoPaths == null || changedRepoPaths.has(doc.uri.repoPath!)) {
						doc.reset(reason);
					}
				},
			),
		);
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
