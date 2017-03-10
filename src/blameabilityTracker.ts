'use strict';
import { Disposable, Event, EventEmitter, TextDocument, TextDocumentChangeEvent, TextEditor, window, workspace } from 'vscode';
import { CommandContext, setCommandContext } from './commands';
import { TextDocumentComparer } from './comparers';
import { GitProvider } from './gitProvider';

export interface BlameabilityChangeEvent {
    blameable: boolean;
    editor: TextEditor;
}

export class BlameabilityTracker extends Disposable {

    private _onDidChange = new EventEmitter<BlameabilityChangeEvent>();
    get onDidChange(): Event<BlameabilityChangeEvent> {
        return this._onDidChange.event;
    }

    private _disposable: Disposable;
    private _documentChangeDisposable: Disposable;
    private _editor: TextEditor;
    private _isBlameable: boolean;

    constructor(private git: GitProvider) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
        subscriptions.push(workspace.onDidSaveTextDocument(this._onTextDocumentSaved, this));
        subscriptions.push(this.git.onDidBlameFail(this._onBlameFailed, this));

        this._disposable = Disposable.from(...subscriptions);

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        this._documentChangeDisposable && this._documentChangeDisposable.dispose();
    }

    private _onActiveTextEditorChanged(editor: TextEditor) {
        this._editor = editor;
        let blameable = editor && editor.document && !editor.document.isDirty;

        if (blameable) {
            blameable = this.git.getBlameability(editor.document.fileName);
        }

        this._subscribeToDocumentChanges();
        this.updateBlameability(blameable, true);
    }

    private _onBlameFailed(key: string) {
        const fileName = this._editor && this._editor.document && this._editor.document.fileName;
        if (!fileName || key !== this.git.getCacheEntryKey(fileName)) return;

        this.updateBlameability(false);
    }

    private _onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (!TextDocumentComparer.equals(this._editor && this._editor.document, e && e.document)) return;

        // Can't unsubscribe here because undo doesn't trigger any other event
        //this._unsubscribeToDocumentChanges();
        //this.updateBlameability(false);

        // We have to defer because isDirty is not reliable inside this event
        setTimeout(() => this.updateBlameability(!e.document.isDirty), 1);
    }

    private _onTextDocumentSaved(e: TextDocument) {
        if (!TextDocumentComparer.equals(this._editor && this._editor.document, e)) return;

        // Don't need to resubscribe as we aren't unsubscribing on document changes anymore
        //this._subscribeToDocumentChanges();
        this.updateBlameability(!e.isDirty);
    }

    private _subscribeToDocumentChanges() {
        this._unsubscribeToDocumentChanges();
        this._documentChangeDisposable = workspace.onDidChangeTextDocument(this._onTextDocumentChanged, this);
    }

    private _unsubscribeToDocumentChanges() {
        this._documentChangeDisposable && this._documentChangeDisposable.dispose();
        this._documentChangeDisposable = undefined;
    }

    private updateBlameability(blameable: boolean, force: boolean = false) {
        if (!force && this._isBlameable === blameable) return;

        setCommandContext(CommandContext.IsBlameable, blameable);
        this._onDidChange.fire({
            blameable: blameable,
            editor: this._editor
        });
    }
}