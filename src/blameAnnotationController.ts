'use strict';
import { Functions, IDeferred } from './system';
import { Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { BlameAnnotationProvider } from './blameAnnotationProvider';
import { TextDocumentComparer, TextEditorComparer } from './comparers';
import GitProvider from './gitProvider';
import { Logger } from './logger';
import WhitespaceController from './whitespaceController';

export default class BlameAnnotationController extends Disposable {

    private _annotationProviders: Map<number, BlameAnnotationProvider> = new Map();
    private _blameAnnotationsDisposable: Disposable;
    private _pendingClearAnnotations: Map<number, (() => void) & IDeferred> = new Map();
    private _visibleColumns: Set<number>;
    private _whitespaceController: WhitespaceController;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        this._whitespaceController = new WhitespaceController(context);
    }

    dispose() {
        for (const fn of this._pendingClearAnnotations.values()) {
            fn.cancel();
        }
        this._annotationProviders.forEach(async (p, i) => await this.clear(i));

        this._blameAnnotationsDisposable && this._blameAnnotationsDisposable.dispose();
        this._whitespaceController && this._whitespaceController.dispose();
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
        if (editor.viewColumn === undefined && !this.git.hasGitUriForFile(editor)) return false;

        const currentProvider = this._annotationProviders.get(editor.viewColumn || -1);
        if (currentProvider && TextEditorComparer.equals(currentProvider.editor, editor)) {
            await currentProvider.setSelection(shaOrLine);
            return true;
        }

        const provider = new BlameAnnotationProvider(this.context, this.git, this._whitespaceController, editor);
        if (!await provider.supportsBlame()) return false;

        if (currentProvider) {
            await this.clear(currentProvider.editor.viewColumn || -1, false);
        }

        if (!this._blameAnnotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for blame annotations`);

            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeVisibleTextEditors(Functions.debounce(this._onVisibleTextEditorsChanged, 100), this));
            subscriptions.push(window.onDidChangeTextEditorViewColumn(this._onTextEditorViewColumnChanged, this));
            subscriptions.push(workspace.onDidCloseTextDocument(this._onTextDocumentClosed, this));

            this._blameAnnotationsDisposable = Disposable.from(...subscriptions);

            this._visibleColumns = this._getVisibleColumns(window.visibleTextEditors);
        }

        this._annotationProviders.set(editor.viewColumn || -1, provider);
        return provider.provideBlameAnnotation(shaOrLine);
    }

    async toggleBlameAnnotation(editor: TextEditor, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document) return false;
        if (editor.viewColumn === undefined && !this.git.hasGitUriForFile(editor)) return false;

        let provider = this._annotationProviders.get(editor.viewColumn || -1);
        if (!provider) return this.showBlameAnnotation(editor, shaOrLine);

        await this.clear(provider.editor.viewColumn || -1);
        return false;
    }

    private _getVisibleColumns(editors: TextEditor[]): Set<number> {
        const set: Set<number> = new Set();
        for (const e of editors) {
            if (e.viewColumn === undefined && !this.git.hasGitUriForFile(e)) continue;
            set.add(e.viewColumn);
        }
        return set;
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

        const viewColumn = e.viewColumn || -1;

        Logger.log('TextEditorViewColumnChanged:', `Clear blame annotations for column ${viewColumn}`);
        await this.clear(viewColumn);

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
            if (editor && (editor.viewColumn || -1) !== key) {
                this.clear(key, false);
            }
            else {
                this.clear(key);
            }
        }
    }
}