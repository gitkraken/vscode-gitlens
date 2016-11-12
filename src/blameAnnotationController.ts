'use strict';
import { Functions, IDeferred } from './system';
import { commands, Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { BlameAnnotationProvider } from './blameAnnotationProvider';
import { TextDocumentComparer, TextEditorComparer } from './comparers';
import { BuiltInCommands } from './constants';
import GitProvider from './gitProvider';
import { Logger } from './logger';

export default class BlameAnnotationController extends Disposable {
    private _annotationProviders: Map<number, BlameAnnotationProvider> = new Map();
    private _blameAnnotationsDisposable: Disposable;
    private _pendingWhitespaceToggleDisposable: Disposable;
    private _pendingClearAnnotations: Map<number, (() => void) & IDeferred> = new Map();
    private _pendingWhitespaceToggles: Set<number> = new Set();
    private _visibleColumns: Set<number>;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());
    }

    dispose() {
        for (const fn of this._pendingClearAnnotations.values()) {
            fn.cancel();
        }
        this._annotationProviders.forEach(async (p, i) => await this.clear(i));

        this._blameAnnotationsDisposable && this._blameAnnotationsDisposable.dispose();
        this._pendingWhitespaceToggleDisposable && this._pendingWhitespaceToggleDisposable.dispose();
    }

    async clear(column: number, toggleRenderWhitespace: boolean = true) {
        const provider = this._annotationProviders.get(column);
        if (!provider) return;

        this._annotationProviders.delete(column);
        await provider.dispose(toggleRenderWhitespace);

        if (this._annotationProviders.size === 0) {
            Logger.log(`Remove listener registrations for blame annotations`);
            this._blameAnnotationsDisposable && this._blameAnnotationsDisposable.dispose();
            this._blameAnnotationsDisposable = undefined;
        }
    }

    async showBlameAnnotation(editor: TextEditor, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document) return false;

        if (!this._blameAnnotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for blame annotations`);

            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeVisibleTextEditors(Functions.debounce(this._onVisibleTextEditorsChanged, 100), this));
            subscriptions.push(window.onDidChangeTextEditorViewColumn(this._onTextEditorViewColumnChanged, this));
            subscriptions.push(workspace.onDidCloseTextDocument(this._onTextDocumentClosed, this));

            this._blameAnnotationsDisposable = Disposable.from(...subscriptions);

            this._visibleColumns = this._getVisibleColumns(window.visibleTextEditors);
        }

        let provider = this._annotationProviders.get(editor.viewColumn);
        if (provider) {
            if (TextEditorComparer.equals(provider.editor, editor)) {
                await provider.setSelection(shaOrLine);
                return true;
            }
            await this.clear(provider.editor.viewColumn, false);
        }

        provider = new BlameAnnotationProvider(this.context, this.git, editor);
        this._annotationProviders.set(editor.viewColumn, provider);
        return provider.provideBlameAnnotation(shaOrLine);
    }

    async toggleBlameAnnotation(editor: TextEditor, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document) return false;

        let provider = this._annotationProviders.get(editor.viewColumn);
        if (!provider) return this.showBlameAnnotation(editor, shaOrLine);

        await this.clear(provider.editor.viewColumn);
        return false;
    }

    private _getVisibleColumns(editors: TextEditor[]): Set<number> {
        const set: Set<number> = new Set();
        for (const e of editors) {
            if (e.viewColumn === undefined) continue;

            set.add(e.viewColumn);
        }
        return set;
    }

    private _onActiveTextEditorChanged(e: TextEditor) {
        if (e.viewColumn === undefined || this._pendingWhitespaceToggles.size === 0) return;

        if (this._pendingWhitespaceToggles.has(e.viewColumn)) {
            Logger.log('ActiveTextEditorChanged:', `Remove pending whitespace toggle for column ${e.viewColumn}`);
            this._pendingWhitespaceToggles.delete(e.viewColumn);

            // HACK: Until https://github.com/Microsoft/vscode/issues/11485 is fixed -- toggle whitespace back on
            Logger.log('ActiveTextEditorChanged:', `Toggle whitespace rendering on`);
            commands.executeCommand(BuiltInCommands.ToggleRenderWhitespace);
        }

        if (this._pendingWhitespaceToggles.size === 0) {
            Logger.log('ActiveTextEditorChanged:', `Remove listener registrations for pending whitespace toggles`);
            this._pendingWhitespaceToggleDisposable.dispose();
            this._pendingWhitespaceToggleDisposable = undefined;
        }
    }

    private _onTextDocumentClosed(e: TextDocument) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e)) continue;

            Logger.log('TextDocumentClosed:', `Add pending clear of blame annotations for column ${key}`);

            // Since we don't know if a whole column is going away -- we don't know if we should reset the whitespace
            // So defer until onDidChangeVisibleTextEditors fires
            const fn = Functions.debounce(() => {
                this._pendingClearAnnotations.delete(key);
                this.clear(key);
            }, 250);
            this._pendingClearAnnotations.set(key, fn);

            fn();
        }
    }

    private async _onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
        this._visibleColumns = this._getVisibleColumns(window.visibleTextEditors);

        Logger.log('TextEditorViewColumnChanged:', `Clear blame annotations for column ${e.viewColumn}`);
        await this.clear(e.viewColumn);

        for (const [key, p] of this._annotationProviders) {
            if (!TextEditorComparer.equals(p.editor, e.textEditor)) continue;

            Logger.log('TextEditorViewColumnChanged:', `Clear blame annotations for column ${key}`);
            await this.clear(key, false);
        }
    }

    private async _onVisibleTextEditorsChanged(e: TextEditor[]) {
        if (e.every(_ => _.document.uri.scheme === 'inmemory')) return;

        this._visibleColumns = this._getVisibleColumns(e);

        for (const [key, fn] of this._pendingClearAnnotations) {
            Logger.log('VisibleTextEditorsChanged:', `Remove pending blame annotations for column ${key}`);
            fn.cancel();
            this._pendingClearAnnotations.delete(key);

            // Clear and reset the whitespace depending on if the column went away
            Logger.log('VisibleTextEditorsChanged:', `Clear blame annotations for column ${key}`);
            await this.clear(key, this._visibleColumns.has(key));
        }

        for (const [key, p] of this._annotationProviders) {
            if (e.some(_ => TextEditorComparer.equals(p.editor, _))) continue;

            Logger.log('VisibleTextEditorsChanged:', `Clear blame annotations for column ${key}`);
            const editor = window.activeTextEditor;
            if (p.requiresRenderWhitespaceToggle && (editor && editor.viewColumn !== key)) {
                this.clear(key, false);

                if (!this._pendingWhitespaceToggleDisposable) {
                    Logger.log('VisibleTextEditorsChanged:', `Add listener registrations for pending whitespace toggles`);
                    this._pendingWhitespaceToggleDisposable = window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this);
                }

                Logger.log('VisibleTextEditorsChanged:', `Add pending whitespace toggle for column ${key}`);
                this._pendingWhitespaceToggles.add(key);
            }
            else {
                this.clear(key);
            }
        }
    }
}