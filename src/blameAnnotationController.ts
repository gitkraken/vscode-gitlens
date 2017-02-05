'use strict';
import { Functions } from './system';
import { Disposable, ExtensionContext, TextDocument, TextEditor, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { BlameAnnotationProvider } from './blameAnnotationProvider';
import { TextDocumentComparer, TextEditorComparer } from './comparers';
// import { IAdvancedConfig } from './configuration';
import GitProvider from './gitProvider';
import { Logger } from './logger';
import WhitespaceController from './whitespaceController';

export default class BlameAnnotationController extends Disposable {

    private _annotationProviders: Map<number, BlameAnnotationProvider> = new Map();
    private _blameAnnotationsDisposable: Disposable;
    private _disposable: Disposable;
    private _whitespaceController: WhitespaceController | undefined;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        this._onConfigure();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigure, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._annotationProviders.forEach(async (p, i) => await this.clear(i));

        this._blameAnnotationsDisposable && this._blameAnnotationsDisposable.dispose();
        this._whitespaceController && this._whitespaceController.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigure() {
        const toggleWhitespace = workspace.getConfiguration('gitlens.advanced.toggleWhitespace').get<boolean>('enabled');
        if (toggleWhitespace && !this._whitespaceController) {
            this._whitespaceController = new WhitespaceController();
        }
        else if (!toggleWhitespace && this._whitespaceController) {
            this._whitespaceController.dispose();
        }
    }

    async clear(column: number) {
        const provider = this._annotationProviders.get(column);
        if (!provider) return;

        this._annotationProviders.delete(column);
        await provider.dispose();

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
            await this.clear(currentProvider.editor.viewColumn || -1);
        }

        if (!this._blameAnnotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for blame annotations`);

            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeVisibleTextEditors(Functions.debounce(this._onVisibleTextEditorsChanged, 100), this));
            subscriptions.push(window.onDidChangeTextEditorViewColumn(this._onTextEditorViewColumnChanged, this));
            subscriptions.push(workspace.onDidCloseTextDocument(this._onTextDocumentClosed, this));

            this._blameAnnotationsDisposable = Disposable.from(...subscriptions);
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

    private _onTextDocumentClosed(e: TextDocument) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e)) continue;

            Logger.log('TextDocumentClosed:', `Clear blame annotations for column ${key}`);
            this.clear(key);
        }
    }

    private async _onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
        const viewColumn = e.viewColumn || -1;

        Logger.log('TextEditorViewColumnChanged:', `Clear blame annotations for column ${viewColumn}`);
        await this.clear(viewColumn);

        for (const [key, p] of this._annotationProviders) {
            if (!TextEditorComparer.equals(p.editor, e.textEditor)) continue;

            Logger.log('TextEditorViewColumnChanged:', `Clear blame annotations for column ${key}`);
            await this.clear(key);
        }
    }

    private async _onVisibleTextEditorsChanged(e: TextEditor[]) {
        if (e.every(_ => _.document.uri.scheme === 'inmemory')) return;

        for (const [key, p] of this._annotationProviders) {
            if (e.some(_ => TextEditorComparer.equals(p.editor, _))) continue;

            Logger.log('VisibleTextEditorsChanged:', `Clear blame annotations for column ${key}`);
            this.clear(key);
        }
    }
}