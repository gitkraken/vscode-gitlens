'use strict';
import { Functions, IDeferrable } from '../system';
import { ConfigurationChangeEvent, Disposable, Event, EventEmitter, Range, TextDocumentChangeEvent, TextEditor, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { TextDocumentComparer } from '../comparers';
import { configuration } from '../configuration';
import { CommandContext, isTextEditor, RangeEndOfLineIndex, setCommandContext } from '../constants';
import { GitChangeEvent, GitChangeReason, GitService, GitUri, Repository, RepositoryChangeEvent } from '../gitService';
import { Logger } from '../logger';

export enum BlameabilityChangeReason {
    BlameFailed = 'blame-failed',
    DocumentChanged = 'document-changed',
    EditorChanged = 'editor-changed',
    RepoChanged = 'repo-changed'
}

export interface BlameabilityChangeEvent {
    editor: TextEditor | undefined;

    blameable: boolean;
    dirty: boolean;
    reason: BlameabilityChangeReason;
}

export interface DirtyStateChangeEvent {
    editor: TextEditor | undefined;

    dirty: boolean;
}

export interface LineDirtyStateChangeEvent extends DirtyStateChangeEvent {
    line: number;
    lineDirty: boolean;
}

interface Context {
    editor?: TextEditor;
    repo?: Repository;
    repoDisposable?: Disposable;
    state: ContextState;
    uri?: GitUri;
}

interface ContextState {
    blameable?: boolean;
    dirty: boolean;
    line?: number;
    lineDirty?: boolean;
    revision?: boolean;
    tracked?: boolean;
}

export class GitContextTracker extends Disposable {

    private _onDidChangeBlameability = new EventEmitter<BlameabilityChangeEvent>();
    get onDidChangeBlameability(): Event<BlameabilityChangeEvent> {
        return this._onDidChangeBlameability.event;
    }

    private _onDidChangeDirtyState = new EventEmitter<DirtyStateChangeEvent>();
    get onDidChangeDirtyState(): Event<DirtyStateChangeEvent> {
        return this._onDidChangeDirtyState.event;
    }

    private _onDidChangeLineDirtyState = new EventEmitter<LineDirtyStateChangeEvent>();
    get onDidChangeLineDirtyState(): Event<LineDirtyStateChangeEvent> {
        return this._onDidChangeLineDirtyState.event;
    }

    private readonly _context: Context = { state: { dirty: false } };
    private readonly _disposable: Disposable;
    private _listenersDisposable: Disposable | undefined;
    private _fireDirtyStateChangedDebounced: (() => void) & IDeferrable;

    private _checkLineDirtyStateChangedDebounced: (() => void) & IDeferrable;
    private _fireLineDirtyStateChangedDebounced: (() => void) & IDeferrable;

    private _insiders = false;

    constructor(
        private readonly git: GitService
    ) {
        super(() => this.dispose());

        this._fireDirtyStateChangedDebounced = Functions.debounce(this.fireDirtyStateChanged, 1000);

        this._checkLineDirtyStateChangedDebounced = Functions.debounce(this.checkLineDirtyStateChanged, 1000);
        this._fireLineDirtyStateChangedDebounced = Functions.debounce(this.fireLineDirtyStateChanged, 1000);

        this._disposable = Disposable.from(
            workspace.onDidChangeConfiguration(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this._listenersDisposable && this._listenersDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _lineTrackingEnabled: boolean = false;

    setLineTracking(editor: TextEditor | undefined, enabled: boolean) {
        if (this._context.editor !== editor) return;

        // If we are changing line tracking, reset the current line info, so we will refresh
        if (this._lineTrackingEnabled !== enabled) {
            this._context.state.line = undefined;
            this._context.state.lineDirty = undefined;
        }
        this._lineTrackingEnabled = enabled;
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const section = configuration.name('insiders').value;
        if (initializing || configuration.changed(e, section)) {
            this._insiders = configuration.get<boolean>(section);

            if (!initializing) {
                this.updateContext(BlameabilityChangeReason.EditorChanged, window.activeTextEditor, true);
            }
        }

        if (initializing || e.affectsConfiguration('git.enabled', null!)) {
            const enabled = workspace.getConfiguration('git', null!).get<boolean>('enabled', true);
            if (this._listenersDisposable !== undefined) {
                this._listenersDisposable.dispose();
                this._listenersDisposable = undefined;
            }

            setCommandContext(CommandContext.Enabled, enabled);

            if (enabled) {
                this._listenersDisposable = Disposable.from(
                    window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 50), this),
                    workspace.onDidChangeTextDocument(this.onTextDocumentChanged, this),
                    window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this),
                    this.git.onDidBlameFail(this.onBlameFailed, this),
                    this.git.onDidChange(this.onGitChanged, this)
                );

                this.updateContext(BlameabilityChangeReason.EditorChanged, window.activeTextEditor, true);
            }
            else {
                this.updateContext(BlameabilityChangeReason.EditorChanged, window.activeTextEditor, false);
            }
        }
    }

    private onActiveTextEditorChanged(editor: TextEditor | undefined) {
        if (editor === this._context.editor) return;
        if (editor !== undefined && !isTextEditor(editor)) return;

        // Logger.log('GitContextTracker.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

        // Reset the current line info, so we will refresh
        this._context.state.line = undefined;
        this._context.state.lineDirty = undefined;

        this.updateContext(BlameabilityChangeReason.EditorChanged, editor, true);
    }

    private onBlameFailed(key: string) {
        if (this._context.editor === undefined || key !== this.git.getCacheEntryKey(this._context.editor.document.uri)) return;

        this.updateBlameability(BlameabilityChangeReason.BlameFailed, false);
    }

    private onGitChanged(e: GitChangeEvent) {
        if (e.reason !== GitChangeReason.Repositories) return;

        this.updateRemotes();
    }

    private onRepoChanged(e: RepositoryChangeEvent) {
        this.updateContext(BlameabilityChangeReason.RepoChanged, this._context.editor);
        this.updateRemotes();
    }

    private onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (this._context.editor === undefined || !TextDocumentComparer.equals(this._context.editor.document, e.document)) return;

        const dirty = e.document.isDirty;
        const line = (this._context.editor && this._context.editor.selection.active.line) || -1;

        let changed = false;
        if (this._context.state.dirty !== dirty || this._context.state.line !== line) {
            changed = true;

            this._context.state.dirty = dirty;
            if (this._context.state.line !== line) {
                this._context.state.lineDirty = undefined;
            }
            this._context.state.line = line;

            if (dirty) {
                this._fireDirtyStateChangedDebounced.cancel();
                setImmediate(() => this.fireDirtyStateChanged());
            }
            else {
                this._fireDirtyStateChangedDebounced();
            }
        }

        if (!this._lineTrackingEnabled || !this._insiders) return;

        // If the file dirty state hasn't changed, check if the line has
        if (!changed) {
            this._checkLineDirtyStateChangedDebounced();

            return;
        }

        this._context.state.lineDirty = dirty;

        if (dirty) {
            this._fireLineDirtyStateChangedDebounced.cancel();
            setImmediate(() => this.fireLineDirtyStateChanged());
        }
        else {
            this._fireLineDirtyStateChangedDebounced();
        }
    }

    private async checkLineDirtyStateChanged() {
        const line = this._context.state.line;
        if (this._context.editor === undefined || line === undefined || line < 0) return;

        // Since we only care about this one line, just pass empty lines to align the contents for blaming (and also skip using the cache)
        const contents = `${' \n'.repeat(line)}${this._context.editor.document.getText(new Range(line, 0, line, RangeEndOfLineIndex))}\n`;
        const blameLine = await this.git.getBlameForLineContents(this._context.uri!, line, contents, { skipCache: true });
        const lineDirty = blameLine !== undefined && blameLine.commit.isUncommitted;

        if (this._context.state.lineDirty !== lineDirty) {
            this._context.state.lineDirty = lineDirty;

            this._fireLineDirtyStateChangedDebounced.cancel();
            setImmediate(() => this.fireLineDirtyStateChanged());
        }
    }

    private fireDirtyStateChanged() {
        if (this._insiders) {
            this._onDidChangeDirtyState.fire({
                editor: this._context.editor,
                dirty: this._context.state.dirty
            } as DirtyStateChangeEvent);
        }
        else {
            this.updateBlameability(BlameabilityChangeReason.DocumentChanged);
        }
    }

    private fireLineDirtyStateChanged() {
        this._onDidChangeLineDirtyState.fire({
            editor: this._context.editor,
            dirty: this._context.state.dirty,
            line: this._context.state.line,
            lineDirty: this._context.state.lineDirty
        } as LineDirtyStateChangeEvent);
    }

    private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
        if (this._context.state.line === e.selections[0].active.line) return;

        this._context.state.line = undefined;
        this._context.state.lineDirty = false;
    }

    private async updateContext(reason: BlameabilityChangeReason, editor: TextEditor | undefined, force: boolean = false) {
        try {
            let dirty = false;
            let revision = false;
            let tracked = false;
            if (force || this._context.editor !== editor) {
                this._context.editor = editor;
                this._context.repo = undefined;
                if (this._context.repoDisposable !== undefined) {
                    this._context.repoDisposable.dispose();
                    this._context.repoDisposable = undefined;
                }

                if (editor !== undefined) {
                    this._context.uri = await GitUri.fromUri(editor.document.uri, this.git);

                    const repo = await this.git.getRepository(this._context.uri);
                    if (repo !== undefined) {
                        this._context.repo = repo;
                        this._context.repoDisposable = repo.onDidChange(this.onRepoChanged, this);
                    }

                    dirty = editor.document.isDirty;
                    revision = !!this._context.uri.sha;
                    tracked = await this.git.isTracked(this._context.uri);
                }
                else {
                    this._context.uri = undefined;
                    this._context.state.blameable = false;
                }
            }
            // Since the revision or tracked state could have changed, update it
            else if (this._context.uri !== undefined) {
                revision = !!this._context.uri.sha;
                tracked = await this.git.isTracked(this._context.uri);
            }

            if (this._context.state.revision !== revision) {
                this._context.state.revision = revision;
                setCommandContext(CommandContext.ActiveIsRevision, revision);
            }

            if (this._context.state.tracked !== tracked) {
                this._context.state.tracked = tracked;
                setCommandContext(CommandContext.ActiveFileIsTracked, tracked);
            }

            if (this._context.state.dirty !== dirty) {
                this._context.state.dirty = dirty;
                if (this._insiders) {
                    this._fireDirtyStateChangedDebounced();
                }
            }

            this.updateBlameability(reason, undefined, force);
            this.updateRemotes();
        }
        catch (ex) {
            Logger.error(ex, 'GitContextTracker.updateContext');
        }
    }

    private updateBlameability(reason: BlameabilityChangeReason, blameable?: boolean, force: boolean = false) {
        try {
            if (blameable === undefined) {
                blameable = this._insiders
                    ? this._context.state.tracked
                    : this._context.state.tracked && !this._context.state.dirty;
            }

            if (!force && this._context.state.blameable === blameable) return;

            this._context.state.blameable = blameable;

            setCommandContext(CommandContext.ActiveIsBlameable, blameable);
            this._onDidChangeBlameability.fire({
                editor: this._context.editor,
                blameable: blameable!,
                dirty: this._context.state.dirty,
                reason: reason
            } as BlameabilityChangeEvent);
        }
        catch (ex) {
            Logger.error(ex, 'GitContextTracker.updateBlameability');
        }
    }

    private async updateRemotes() {
        try {
            let hasRemotes = false;
            if (this._context.repo !== undefined) {
                hasRemotes = await this._context.repo.hasRemote();
            }

            setCommandContext(CommandContext.ActiveHasRemote, hasRemotes);

            if (!hasRemotes) {
                const repositories = await this.git.getRepositories();
                for (const repo of repositories) {
                    if (repo === this._context.repo) continue;

                    hasRemotes = await repo.hasRemotes();
                    if (hasRemotes) break;
                }
            }

            setCommandContext(CommandContext.HasRemotes, hasRemotes);
        }
        catch (ex) {
            Logger.error(ex, 'GitContextTracker.updateRemotes');
        }
    }
}