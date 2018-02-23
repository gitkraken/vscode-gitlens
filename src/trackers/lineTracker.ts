'use strict';
import { Functions, IDeferrable } from './../system';
import { Disposable, Event, EventEmitter, TextEditor, TextEditorSelectionChangeEvent, window } from 'vscode';
import { isTextEditor } from './../constants';

export { GitLineState } from './gitDocumentState';

export interface LinesChangeEvent {

    readonly editor: TextEditor | undefined;
    readonly lines: number[] | undefined;

    readonly reason: 'editor' | 'lines';
    readonly pending?: boolean;
}

export class LineTracker<T> extends Disposable {
    private _onDidChangeActiveLines = new EventEmitter<LinesChangeEvent>();
    get onDidChangeActiveLines(): Event<LinesChangeEvent> {
        return this._onDidChangeActiveLines.event;
    }

    private _disposable: Disposable | undefined;
    private _editor: TextEditor | undefined;

    private readonly _state: Map<number, T | undefined> = new Map();

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
        this._lines = editor !== undefined ? editor.selections.map(s => s.active.line) : undefined;

        this.fireLinesChanged({ editor: editor, lines: this._lines, reason: 'editor' });
    }

    private onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent) {
        // If this isn't for our cached editor and its not a real editor -- kick out
        if (this._editor !== e.textEditor && !isTextEditor(e.textEditor)) return;

        const reason = this._editor === e.textEditor ? 'lines' : 'editor';

        const lines = e.selections.map(s => s.active.line);
        if (this._editor === e.textEditor && this.includesAll(lines)) return;

        this.reset();
        this._editor = e.textEditor;
        this._lines = lines;

        this.fireLinesChanged({ editor: this._editor, lines: this._lines, reason: reason });
    }

    getState(line: number): T | undefined {
        return this._state.get(line);
    }

    setState(line: number, state: T | undefined) {
        this._state.set(line, state);
    }

    private _lines: number[] | undefined;
    get lines(): number[] | undefined {
        return this._lines;
    }

    includes(line: number): boolean {
        return this._lines !== undefined && this._lines.includes(line);
    }

    includesAll(lines: number[] | undefined): boolean {
        return LineTracker.includesAll(lines, this._lines);
    }

    reset() {
        this._state.clear();
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

        if (this._linesChangedDebounced !== undefined) {
            this._linesChangedDebounced.cancel();
        }

        this._disposable.dispose();
        this._disposable = undefined;
    }

    private _linesChangedDebounced: (((e: LinesChangeEvent) => void) & IDeferrable) | undefined;

    private fireLinesChanged(e: LinesChangeEvent) {
        if (e.lines === undefined) {
            setImmediate(() => {
                if (window.activeTextEditor !== e.editor) return;

                if (this._linesChangedDebounced !== undefined) {
                    this._linesChangedDebounced.cancel();
                }

                this._onDidChangeActiveLines.fire(e);
            });

            return;
        }

        if (this._linesChangedDebounced === undefined) {
            this._linesChangedDebounced = Functions.debounce((e: LinesChangeEvent) => {
                if (window.activeTextEditor !== e.editor) return;
                // Make sure we are still on the same lines
                if (!LineTracker.includesAll(e.lines , (e.editor && e.editor.selections.map(s => s.active.line)))) return;

                this._onDidChangeActiveLines.fire(e);
            }, 250, { track: true });
        }

        // If we have no pending moves, then fire an immediate pending event, and defer the real event
        if (!this._linesChangedDebounced.pending!()) {
            this._onDidChangeActiveLines.fire({ ...e, pending: true });
        }

        this._linesChangedDebounced(e);
    }

    static includesAll(lines1: number[] | undefined, lines2: number[] | undefined): boolean {
        if (lines1 === undefined && lines2 === undefined) return true;
        if (lines1 === undefined || lines2 === undefined) return false;

        return lines2.length === lines1.length && lines2.every((v, i) => v === lines1[i]);
    }
}