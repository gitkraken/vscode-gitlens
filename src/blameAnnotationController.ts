'use strict';
import { Functions } from './system';
import { DecorationRenderOptions, Disposable, ExtensionContext, OverviewRulerLane, TextDocument, TextEditor, TextEditorDecorationType, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { BlameAnnotationProvider } from './blameAnnotationProvider';
import { TextDocumentComparer, TextEditorComparer } from './comparers';
import { IBlameConfig } from './configuration';
import GitProvider from './gitProvider';
import { Logger } from './logger';
import WhitespaceController from './whitespaceController';

export const blameDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    before: {
        margin: '0 1.75em 0 0'
    },
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

export let highlightDecoration: TextEditorDecorationType;

export default class BlameAnnotationController extends Disposable {

    private _annotationProviders: Map<number, BlameAnnotationProvider> = new Map();
    private _blameAnnotationsDisposable: Disposable;
    private _config: IBlameConfig;
    private _disposable: Disposable;
    private _whitespaceController: WhitespaceController | undefined;

    constructor(private context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._annotationProviders.forEach(async (p, i) => await this.clear(i));

        this._blameAnnotationsDisposable && this._blameAnnotationsDisposable.dispose();
        this._whitespaceController && this._whitespaceController.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        let toggleWhitespace = workspace.getConfiguration('gitlens.advanced.toggleWhitespace').get<boolean>('enabled');
        if (!toggleWhitespace) {
            // Until https://github.com/Microsoft/vscode/issues/11485 is fixed we need to toggle whitespace for non-monospace fonts and ligatures
            // TODO: detect monospace font
            toggleWhitespace = workspace.getConfiguration('editor').get<boolean>('fontLigatures');
        }

        if (toggleWhitespace && !this._whitespaceController) {
            this._whitespaceController = new WhitespaceController();
        }
        else if (!toggleWhitespace && this._whitespaceController) {
            this._whitespaceController.dispose();
            this._whitespaceController = undefined;
        }

        const config = workspace.getConfiguration('gitlens').get<IBlameConfig>('blame');

        if (config.annotation.highlight !== (this._config && this._config.annotation.highlight)) {
            highlightDecoration && highlightDecoration.dispose();

            switch (config.annotation.highlight) {
                case 'none':
                    highlightDecoration = undefined;
                    break;

                case 'gutter':
                    highlightDecoration = window.createTextEditorDecorationType({
                        dark: {
                            gutterIconPath: this.context.asAbsolutePath('images/blame-dark.svg'),
                            overviewRulerColor: 'rgba(255, 255, 255, 0.75)'
                        },
                        light: {
                            gutterIconPath: this.context.asAbsolutePath('images/blame-light.svg'),
                            overviewRulerColor: 'rgba(0, 0, 0, 0.75)'
                        },
                        gutterIconSize: 'contain',
                        overviewRulerLane: OverviewRulerLane.Right
                    });
                    break;

                case 'line':
                    highlightDecoration = window.createTextEditorDecorationType({
                        dark: {
                            backgroundColor: 'rgba(255, 255, 255, 0.15)',
                            overviewRulerColor: 'rgba(255, 255, 255, 0.75)'
                        },
                        light: {
                            backgroundColor: 'rgba(0, 0, 0, 0.15)',
                            overviewRulerColor: 'rgba(0, 0, 0, 0.75)'
                        },
                        overviewRulerLane: OverviewRulerLane.Right,
                        isWholeLine: true
                    });
                    break;

                case 'both':
                    highlightDecoration = window.createTextEditorDecorationType({
                        dark: {
                            backgroundColor: 'rgba(255, 255, 255, 0.15)',
                            gutterIconPath: this.context.asAbsolutePath('images/blame-dark.svg'),
                            overviewRulerColor: 'rgba(255, 255, 255, 0.75)'
                        },
                        light: {
                            backgroundColor: 'rgba(0, 0, 0, 0.15)',
                            gutterIconPath: this.context.asAbsolutePath('images/blame-light.svg'),
                            overviewRulerColor: 'rgba(0, 0, 0, 0.75)'
                        },
                        gutterIconSize: 'contain',
                        overviewRulerLane: OverviewRulerLane.Right,
                        isWholeLine: true
                    });
                    break;
            }
        }

        this._config = config;
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

    isAnnotating(editor: TextEditor): boolean {
        if (!editor || !editor.document) return false;
        if (editor.viewColumn === undefined && !this.git.hasGitUriForFile(editor)) return false;

        return !!this._annotationProviders.get(editor.viewColumn || -1);
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