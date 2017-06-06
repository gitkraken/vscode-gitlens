'use strict';
import { Functions, Objects } from '../system';
import { DecorationRenderOptions, Disposable, Event, EventEmitter, ExtensionContext, OverviewRulerLane, TextDocument, TextDocumentChangeEvent, TextEditor, TextEditorDecorationType, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { TextDocumentComparer, TextEditorComparer } from '../comparers';
import { BlameLineHighlightLocations, ExtensionKey, FileAnnotationType, IConfig, themeDefaults } from '../configuration';
import { BlameabilityChangeEvent, GitContextTracker, GitService, GitUri } from '../gitService';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { HoverBlameAnnotationProvider } from './hoverBlameAnnotationProvider';
import { Logger } from '../logger';
import { WhitespaceController } from './whitespaceController';

export const Decorations = {
    annotation: window.createTextEditorDecorationType({
        isWholeLine: true
    } as DecorationRenderOptions),
    highlight: undefined as TextEditorDecorationType | undefined
};

export class AnnotationController extends Disposable {

    private _onDidToggleAnnotations = new EventEmitter<void>();
    get onDidToggleAnnotations(): Event<void> {
        return this._onDidToggleAnnotations.event;
    }

    private _annotationsDisposable: Disposable | undefined;
    private _annotationProviders: Map<number, AnnotationProviderBase> = new Map();
    private _config: IConfig;
    private _disposable: Disposable;
    private _whitespaceController: WhitespaceController | undefined;

    constructor(private context: ExtensionContext, private git: GitService, private gitContextTracker: GitContextTracker) {
        super(() => this.dispose());

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._annotationProviders.forEach(async (p, i) => await this.clear(i));

        Decorations.annotation && Decorations.annotation.dispose();
        Decorations.highlight && Decorations.highlight.dispose();

        this._annotationsDisposable && this._annotationsDisposable.dispose();
        this._whitespaceController && this._whitespaceController.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        let toggleWhitespace = workspace.getConfiguration(`${ExtensionKey}.advanced.toggleWhitespace`).get<boolean>('enabled');
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

        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
        const cfgHighlight = cfg.blame.file.lineHighlight;
        const cfgTheme = cfg.theme.lineHighlight;

        let changed = false;

        if (!Objects.areEquivalent(cfgHighlight, this._config && this._config.blame.file.lineHighlight) ||
            !Objects.areEquivalent(cfgTheme, this._config && this._config.theme.lineHighlight)) {
            changed = true;

            Decorations.highlight && Decorations.highlight.dispose();

            if (cfgHighlight.enabled) {
                Decorations.highlight = window.createTextEditorDecorationType({
                    gutterIconSize: 'contain',
                    isWholeLine: true,
                    overviewRulerLane: OverviewRulerLane.Right,
                    dark: {
                        backgroundColor: cfgHighlight.locations.includes(BlameLineHighlightLocations.Line)
                            ? cfgTheme.dark.backgroundColor || themeDefaults.lineHighlight.dark.backgroundColor
                            : undefined,
                        gutterIconPath: cfgHighlight.locations.includes(BlameLineHighlightLocations.Gutter)
                            ? this.context.asAbsolutePath('images/blame-dark.svg')
                            : undefined,
                        overviewRulerColor: cfgHighlight.locations.includes(BlameLineHighlightLocations.OverviewRuler)
                            ? cfgTheme.dark.overviewRulerColor || themeDefaults.lineHighlight.dark.overviewRulerColor
                            : undefined
                    },
                    light: {
                        backgroundColor: cfgHighlight.locations.includes(BlameLineHighlightLocations.Line)
                            ? cfgTheme.light.backgroundColor || themeDefaults.lineHighlight.light.backgroundColor
                            : undefined,
                        gutterIconPath: cfgHighlight.locations.includes(BlameLineHighlightLocations.Gutter)
                            ? this.context.asAbsolutePath('images/blame-light.svg')
                            : undefined,
                        overviewRulerColor: cfgHighlight.locations.includes(BlameLineHighlightLocations.OverviewRuler)
                            ? cfgTheme.light.overviewRulerColor || themeDefaults.lineHighlight.light.overviewRulerColor
                            : undefined
                    }
                });
            }
            else {
                Decorations.highlight = undefined;
            }
        }

        if (!Objects.areEquivalent(cfg.blame.file, this._config && this._config.blame.file) ||
            !Objects.areEquivalent(cfg.annotations, this._config && this._config.annotations) ||
            !Objects.areEquivalent(cfg.theme.annotations, this._config && this._config.theme.annotations)) {
            changed = true;
        }

        this._config = cfg;

        if (changed) {
            // Since the configuration has changed -- reset any visible annotations
            for (const provider of this._annotationProviders.values()) {
                if (provider === undefined) continue;

                provider.reset();
            }
        }
    }

    async clear(column: number) {
        const provider = this._annotationProviders.get(column);
        if (!provider) return;

        this._annotationProviders.delete(column);
        await provider.dispose();

        if (this._annotationProviders.size === 0) {
            Logger.log(`Remove listener registrations for annotations`);
            this._annotationsDisposable && this._annotationsDisposable.dispose();
            this._annotationsDisposable = undefined;
        }

        this._onDidToggleAnnotations.fire();
    }

    getAnnotationType(editor: TextEditor): FileAnnotationType | undefined {
        const provider = this.getProvider(editor);
        return provider === undefined ? undefined : provider.annotationType;
    }

    getProvider(editor: TextEditor): AnnotationProviderBase | undefined {
        if (!editor || !editor.document || !this.git.isEditorBlameable(editor)) return undefined;

        return this._annotationProviders.get(editor.viewColumn || -1);
    }

    async showAnnotations(editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document || !this.git.isEditorBlameable(editor)) return false;

        const currentProvider = this._annotationProviders.get(editor.viewColumn || -1);
        if (currentProvider && TextEditorComparer.equals(currentProvider.editor, editor)) {
            await currentProvider.selection(shaOrLine);
            return true;
        }

        const gitUri = await GitUri.fromUri(editor.document.uri, this.git);

        let provider: AnnotationProviderBase | undefined = undefined;
        switch (type) {
            case FileAnnotationType.Gutter:
                provider = new GutterBlameAnnotationProvider(this.context, editor, Decorations.annotation, Decorations.highlight, this._whitespaceController, this.git, gitUri);
                break;
            case FileAnnotationType.Hover:
                provider = new HoverBlameAnnotationProvider(this.context, editor, Decorations.annotation, Decorations.highlight, this._whitespaceController, this.git, gitUri);
                break;
        }
        if (provider === undefined || !(await provider.validate())) return false;

        if (currentProvider) {
            await this.clear(currentProvider.editor.viewColumn || -1);
        }

        if (!this._annotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for annotations`);

            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeVisibleTextEditors(Functions.debounce(this._onVisibleTextEditorsChanged, 100), this));
            subscriptions.push(window.onDidChangeTextEditorViewColumn(this._onTextEditorViewColumnChanged, this));
            subscriptions.push(workspace.onDidChangeTextDocument(this._onTextDocumentChanged, this));
            subscriptions.push(workspace.onDidCloseTextDocument(this._onTextDocumentClosed, this));
            subscriptions.push(this.gitContextTracker.onDidBlameabilityChange(this._onBlameabilityChanged, this));

            this._annotationsDisposable = Disposable.from(...subscriptions);
        }

        this._annotationProviders.set(editor.viewColumn || -1, provider);
        if (await provider.provideAnnotation(shaOrLine)) {
            this._onDidToggleAnnotations.fire();
            return true;
        }
        return false;
    }

    async toggleAnnotations(editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document || !this.git.isEditorBlameable(editor)) return false;

        const provider = this._annotationProviders.get(editor.viewColumn || -1);
        if (provider === undefined) return this.showAnnotations(editor, type, shaOrLine);

        await this.clear(provider.editor.viewColumn || -1);
        return false;
    }

    private _onBlameabilityChanged(e: BlameabilityChangeEvent) {
        if (e.blameable || !e.editor) return;

        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e.editor.document)) continue;

            Logger.log('BlameabilityChanged:', `Clear annotations for column ${key}`);
            this.clear(key);
        }
    }

    private _onTextDocumentChanged(e: TextDocumentChangeEvent) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e.document)) continue;

            // TODO: Rework this once https://github.com/Microsoft/vscode/issues/27231 is released in v1.13
            // We have to defer because isDirty is not reliable inside this event
            setTimeout(() => {
                // If the document is dirty all is fine, just kick out since the GitContextTracker will handle it
                if (e.document.isDirty) return;

                // If the document isn't dirty, it is very likely this event was triggered by an outside edit of this document
                // Which means the document has been reloaded and the annotations have been removed, so we need to update (clear) our state tracking
                Logger.log('TextDocumentChanged:', `Clear annotations for column ${key}`);
                this.clear(key);
            }, 1);
        }
    }

    private _onTextDocumentClosed(e: TextDocument) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e)) continue;

            Logger.log('TextDocumentClosed:', `Clear annotations for column ${key}`);
            this.clear(key);
        }
    }

    private async _onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
        const viewColumn = e.viewColumn || -1;

        Logger.log('TextEditorViewColumnChanged:', `Clear annotations for column ${viewColumn}`);
        await this.clear(viewColumn);

        for (const [key, p] of this._annotationProviders) {
            if (!TextEditorComparer.equals(p.editor, e.textEditor)) continue;

            Logger.log('TextEditorViewColumnChanged:', `Clear annotations for column ${key}`);
            await this.clear(key);
        }
    }

    private async _onVisibleTextEditorsChanged(e: TextEditor[]) {
        if (e.every(_ => _.document.uri.scheme === 'inmemory')) return;

        for (const [key, p] of this._annotationProviders) {
            if (e.some(_ => TextEditorComparer.equals(p.editor, _))) continue;

            Logger.log('VisibleTextEditorsChanged:', `Clear annotations for column ${key}`);
            this.clear(key);
        }
    }
}