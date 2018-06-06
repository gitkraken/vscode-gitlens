'use strict';
import { ConfigurationChangeEvent, debug, DecorationRangeBehavior, DecorationRenderOptions, Disposable, Range, TextEditor, TextEditorDecorationType, window } from 'vscode';
import { Annotations } from './annotations';
import { configuration } from './../configuration';
import { isTextEditor } from './../constants';
import { Container } from './../container';
import { LinesChangeEvent } from './../trackers/gitLineTracker';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 3em',
        textDecoration: 'none'
    },
    rangeBehavior: DecorationRangeBehavior.ClosedOpen
} as DecorationRenderOptions);

export class LineAnnotationController extends Disposable {

    private _disposable: Disposable;
    private _debugSessionEndDisposable: Disposable | undefined;
    private _editor: TextEditor | undefined;
    private _enabled: boolean = false;

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this),
            Container.fileAnnotations.onDidToggleAnnotations(this.onFileAnnotationsToggled, this),
            debug.onDidStartDebugSession(this.onDebugSessionStarted, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.clearAnnotations(this._editor);

        this._debugSessionEndDisposable && this._debugSessionEndDisposable.dispose();

        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (!initializing && !configuration.changed(e, configuration.name('currentLine').value)) return;

        if (initializing || configuration.changed(e, configuration.name('currentLine')('enabled').value)) {
            if (Container.config.currentLine.enabled) {
                this._enabled = true;
                this.resume();
            }
            else {
                this._enabled = false;
                this.setLineTracker(false);
            }
        }

        this.refresh(window.activeTextEditor);
    }

    private _suspended?: 'debugging' | 'user';
    get suspended() {
        return !this._enabled || this._suspended !== undefined;
    }

    resume(reason: 'debugging' | 'user' = 'user') {
        this.setLineTracker(true);

        switch (reason) {
            case 'debugging':
                if (this._suspended !== 'user') {
                    this._suspended = undefined;
                    return true;
                }
                break;

            case 'user':
                if (this._suspended !== undefined) {
                    this._suspended = undefined;
                    return true;
                }
                break;
        }

        return false;
    }

    suspend(reason: 'debugging' | 'user' = 'user') {
        this.setLineTracker(false);

        if (this._suspended !== 'user') {
            this._suspended = reason;
            return true;
        }

        return false;
    }

    private onActiveLinesChanged(e: LinesChangeEvent) {
        if (!e.pending && e.lines !== undefined) {
            this.refresh(e.editor);

            return;
        }

        this.clear(e.editor);
    }

    private onDebugSessionStarted() {
        if (this._debugSessionEndDisposable === undefined) {
            this._debugSessionEndDisposable = debug.onDidTerminateDebugSession(this.onDebugSessionEnded, this);
        }

        if (this.suspend('debugging')) {
            this.refresh(window.activeTextEditor);
        }
    }

    private onDebugSessionEnded() {
        if (this._debugSessionEndDisposable !== undefined) {
            this._debugSessionEndDisposable.dispose();
            this._debugSessionEndDisposable = undefined;
        }

        if (this.resume('debugging')) {
            this.refresh(window.activeTextEditor);
        }
    }

    private onFileAnnotationsToggled() {
        this.refresh(window.activeTextEditor);
    }

    async clear(editor: TextEditor | undefined) {
        if (this._editor !== editor && this._editor !== undefined) {
            this.clearAnnotations(this._editor);
        }
        this.clearAnnotations(editor);
    }

    async toggle(editor: TextEditor | undefined) {
        this._enabled = !(this._enabled && !this.suspended);

        if (this._enabled) {
            if (this.resume('user')) {
                await this.refresh(editor);
            }
        }
        else {
            if (this.suspend('user')) {
                await this.refresh(editor);
            }
        }
    }

    private clearAnnotations(editor: TextEditor | undefined) {
        if (editor === undefined || (editor as any)._disposed === true) return;

        editor.setDecorations(annotationDecoration, []);
    }

    private async refresh(editor: TextEditor | undefined) {
        if (editor === undefined && this._editor === undefined) return;

        const lines = Container.lineTracker.lines;
        if (editor === undefined || lines === undefined || !isTextEditor(editor)) return this.clear(this._editor);

        if (this._editor !== editor) {
            // Clear any annotations on the previously active editor
            this.clear(this._editor);

            this._editor = editor;
        }

        const cfg = Container.config.currentLine;
        if (this.suspended) return this.clear(editor);

        const trackedDocument = await Container.tracker.getOrAdd(editor.document);
        if (!trackedDocument.isBlameable && this.suspended) return this.clear(editor);

        // Make sure the editor hasn't died since the await above and that we are still on the same line(s)
        if (editor.document === undefined || !Container.lineTracker.includesAll(lines)) return;

        const scrollable = Container.config.currentLine.scrollable;

        const decorations = [];
        for (const l of lines) {
            const state = Container.lineTracker.getState(l);
            if (state === undefined || state.commit === undefined) continue;

            const decoration = Annotations.trailing(state.commit, cfg.format, cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat, scrollable);
            decoration.range = editor.document.validateRange(new Range(l, Number.MAX_SAFE_INTEGER, l, Number.MAX_SAFE_INTEGER));
            decorations.push(decoration);
        }

        editor.setDecorations(annotationDecoration, decorations);
    }

    private setLineTracker(enabled: boolean) {
        if (enabled) {
            if (!Container.lineTracker.isSubscribed(this)) {
                Container.lineTracker.start(
                    this,
                    Disposable.from(
                        Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this)
                    )
                );
            }

            return;
        }

        Container.lineTracker.stop(this);
    }
}
