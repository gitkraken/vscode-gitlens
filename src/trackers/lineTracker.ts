'use strict';
import { Functions, IDeferrable } from './../system';
import { Disposable, Event, EventEmitter, TextEditor, TextEditorSelectionChangeEvent, window } from 'vscode';
import { isTextEditor } from './../constants';

export { GitLineState } from './gitDocumentState';

export interface LineChangeEvent {

    readonly editor: TextEditor | undefined;
    readonly line: number | undefined;

    readonly reason: 'editor' | 'line';
    readonly pending?: boolean;
}

export class LineTracker<T> extends Disposable {
    private _onDidChangeActiveLine = new EventEmitter<LineChangeEvent>();
    get onDidChangeActiveLine(): Event<LineChangeEvent> {
        return this._onDidChangeActiveLine.event;
    }

    private _disposable: Disposable | undefined;
    private _editor: TextEditor | undefined;

    state: T | undefined;

    constructor() {
        super(() => this.dispose());
    }

    dispose() {
        this.stop();
    }

    private onActiveTextEditorChanged(editor: TextEditor | undefined) {
        if (this._editor === editor) return;
        if (editor !== undefined && !isTextEditor(editor)) return;

        this.reset();
        this._editor = editor;
        this._line = editor !== undefined ? editor.selection.active.line : undefined;

        this.fireLineChanged({ editor: editor, line: this._line, reason: 'editor' });
    }

    private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
        // If this isn't for our cached editor and its not a real editor -- kick out
        if (this._editor !== e.textEditor && !isTextEditor(e.textEditor)) return;

        const reason = this._editor === e.textEditor ? 'line' : 'editor';

        const line = e.selections[0].active.line;
        if (this._editor === e.textEditor && this._line === line) return;

        this.reset();
        this._editor = e.textEditor;
        this._line = line;

        this.fireLineChanged({ editor: this._editor, line: this._line, reason: reason });
    }

    private _line: number | undefined;
    get line() {
        return this._line;
    }

    reset() {
        this.state = undefined;
    }

    start() {
        if (this._disposable !== undefined) return;

        this._disposable = Disposable.from(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 0), this),
            window.onDidChangeTextEditorSelection(this.onTextEditorSelectionChanged, this)
        );

        setImmediate(() => this.onActiveTextEditorChanged(window.activeTextEditor));
    }

    stop() {
        if (this._disposable === undefined) return;

        if (this._lineChangedDebounced !== undefined) {
            this._lineChangedDebounced.cancel();
        }

        this._disposable.dispose();
        this._disposable = undefined;
    }

    private _lineChangedDebounced: (((e: LineChangeEvent) => void) & IDeferrable) | undefined;

    private fireLineChanged(e: LineChangeEvent) {
        if (e.line === undefined) {
            setImmediate(() => {
                if (window.activeTextEditor !== e.editor) return;

                if (this._lineChangedDebounced !== undefined) {
                    this._lineChangedDebounced.cancel();
                }

                this._onDidChangeActiveLine.fire(e);
            });

            return;
        }

        if (this._lineChangedDebounced === undefined) {
            this._lineChangedDebounced = Functions.debounce((e: LineChangeEvent) => {
                if (window.activeTextEditor !== e.editor) return;
                // Make sure we are still on the same line
                if (e.line !== (e.editor && e.editor.selection.active.line)) return;

                this._onDidChangeActiveLine.fire(e);
            }, 250, { track: true });
        }

        // If we have no pending moves, then fire an immediate pending event, and defer the real event
        if (!this._lineChangedDebounced.pending!()) {
            this._onDidChangeActiveLine.fire({ ...e, pending: true });
        }

        this._lineChangedDebounced(e);
    }
}