'use strict';
import { commands, Disposable, Event, EventEmitter, TextDocument, TextDocumentChangeEvent, TextEditor, window, workspace } from 'vscode';
import { TextDocumentComparer } from './comparers';
import { BuiltInCommands } from './constants';
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

        this._unsubscribeToDocumentChanges();
        this.updateBlameability(false);
    }

    private _onTextDocumentSaved(e: TextDocument) {
        if (!TextDocumentComparer.equals(this._editor && this._editor.document, e)) return;

        this._subscribeToDocumentChanges();
        this.updateBlameability(true);
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

        commands.executeCommand(BuiltInCommands.SetContext, 'gitlens:isBlameable', blameable);
        this._onDidChange.fire({
            blameable: blameable,
            editor: this._editor
        });
    }
}