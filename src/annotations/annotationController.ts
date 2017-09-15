'use strict';
import { Functions, Objects } from '../system';
import { DecorationRenderOptions, Disposable, Event, EventEmitter, ExtensionContext, OverviewRulerLane, Progress, ProgressLocation, TextDocument, TextDocumentChangeEvent, TextEditor, TextEditorDecorationType, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { AnnotationProviderBase } from './annotationProvider';
import { Keyboard, KeyboardScope, KeyCommand, Keys } from '../keyboard';
import { TextDocumentComparer, TextEditorComparer } from '../comparers';
import { ExtensionKey, IConfig, LineHighlightLocations, themeDefaults } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { BlameabilityChangeEvent, GitContextTracker, GitService, GitUri } from '../gitService';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { HoverBlameAnnotationProvider } from './hoverBlameAnnotationProvider';
import { Logger } from '../logger';
import { RecentChangesAnnotationProvider } from './recentChangesAnnotationProvider';
import { WhitespaceController } from './whitespaceController';
import * as path from 'path';

export type FileAnnotationType = 'gutter' | 'hover' | 'recentChanges';
export const FileAnnotationType = {
    Gutter: 'gutter' as FileAnnotationType,
    Hover: 'hover' as FileAnnotationType,
    RecentChanges: 'recentChanges' as FileAnnotationType
};

export const Decorations = {
    blameAnnotation: window.createTextEditorDecorationType({
        isWholeLine: true,
        textDecoration: 'none'
    } as DecorationRenderOptions),
    blameHighlight: undefined as TextEditorDecorationType | undefined,
    recentChangesAnnotation: undefined as TextEditorDecorationType | undefined,
    recentChangesHighlight: undefined as TextEditorDecorationType | undefined
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

        Decorations.blameAnnotation && Decorations.blameAnnotation.dispose();
        Decorations.blameHighlight && Decorations.blameHighlight.dispose();

        this._annotationsDisposable && this._annotationsDisposable.dispose();
        this._whitespaceController && this._whitespaceController.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        let toggleWhitespace = workspace.getConfiguration(`${ExtensionKey}.advanced.toggleWhitespace`).get<boolean>('enabled');
        // Until https://github.com/Microsoft/vscode/issues/11485 is fixed we need to toggle whitespace for non-monospace fonts and ligatures
        // TODO: detect monospace vs non-monospace font

        // if (!toggleWhitespace) {
        //     // Since we know ligatures will break the whitespace rendering -- turn it back on
        //     toggleWhitespace = workspace.getConfiguration('editor').get<boolean>('fontLigatures', false);
        // }

        // If the setting is on and we aren't showing any annotations, make sure it is necessary (i.e. only when rendering whitespace)
        if (toggleWhitespace && this._annotationProviders.size === 0) {
            toggleWhitespace = (workspace.getConfiguration('editor').get<string>('renderWhitespace') !== 'none');
        }

        let changed = false;

        if (toggleWhitespace && this._whitespaceController === undefined) {
            changed = true;
            this._whitespaceController = new WhitespaceController();
        }
        else if (!toggleWhitespace && this._whitespaceController !== undefined) {
            changed = true;
            this._whitespaceController.dispose();
            this._whitespaceController = undefined;
        }

        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;
        const cfgBlameHighlight = cfg.blame.file.lineHighlight;
        const cfgChangesHighlight = cfg.recentChanges.file.lineHighlight;
        const cfgTheme = cfg.theme.lineHighlight;

        if (!Objects.areEquivalent(cfgBlameHighlight, this._config && this._config.blame.file.lineHighlight) ||
            !Objects.areEquivalent(cfgChangesHighlight, this._config && this._config.recentChanges.file.lineHighlight) ||
            !Objects.areEquivalent(cfgTheme, this._config && this._config.theme.lineHighlight)) {
            changed = true;

            Decorations.blameHighlight && Decorations.blameHighlight.dispose();

            if (cfgBlameHighlight.enabled) {
                Decorations.blameHighlight = window.createTextEditorDecorationType({
                    gutterIconSize: 'contain',
                    isWholeLine: true,
                    overviewRulerLane: OverviewRulerLane.Right,
                    dark: {
                        backgroundColor: cfgBlameHighlight.locations.includes(LineHighlightLocations.Line)
                            ? cfgTheme.dark.backgroundColor || themeDefaults.lineHighlight.dark.backgroundColor
                            : undefined,
                        gutterIconPath: cfgBlameHighlight.locations.includes(LineHighlightLocations.Gutter)
                            ? this.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                            : undefined,
                        overviewRulerColor: cfgBlameHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                            ? cfgTheme.dark.overviewRulerColor || themeDefaults.lineHighlight.dark.overviewRulerColor
                            : undefined
                    },
                    light: {
                        backgroundColor: cfgBlameHighlight.locations.includes(LineHighlightLocations.Line)
                            ? cfgTheme.light.backgroundColor || themeDefaults.lineHighlight.light.backgroundColor
                            : undefined,
                        gutterIconPath: cfgBlameHighlight.locations.includes(LineHighlightLocations.Gutter)
                            ? this.context.asAbsolutePath('images/light/highlight-gutter.svg')
                            : undefined,
                        overviewRulerColor: cfgBlameHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                            ? cfgTheme.light.overviewRulerColor || themeDefaults.lineHighlight.light.overviewRulerColor
                            : undefined
                    }
                });
            }
            else {
                Decorations.blameHighlight = undefined;
            }

            Decorations.recentChangesHighlight && Decorations.recentChangesHighlight.dispose();

            Decorations.recentChangesHighlight = window.createTextEditorDecorationType({
                gutterIconSize: 'contain',
                isWholeLine: true,
                overviewRulerLane: OverviewRulerLane.Right,
                dark: {
                    backgroundColor: cfgChangesHighlight.locations.includes(LineHighlightLocations.Line)
                        ? cfgTheme.dark.backgroundColor || themeDefaults.lineHighlight.dark.backgroundColor
                        : undefined,
                    gutterIconPath: cfgChangesHighlight.locations.includes(LineHighlightLocations.Gutter)
                        ? this.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                        : undefined,
                    overviewRulerColor: cfgChangesHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                        ? cfgTheme.dark.overviewRulerColor || themeDefaults.lineHighlight.dark.overviewRulerColor
                        : undefined
                },
                light: {
                    backgroundColor: cfgChangesHighlight.locations.includes(LineHighlightLocations.Line)
                        ? cfgTheme.light.backgroundColor || themeDefaults.lineHighlight.light.backgroundColor
                        : undefined,
                    gutterIconPath: cfgChangesHighlight.locations.includes(LineHighlightLocations.Gutter)
                        ? this.context.asAbsolutePath('images/light/highlight-gutter.svg')
                        : undefined,
                    overviewRulerColor: cfgChangesHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                        ? cfgTheme.light.overviewRulerColor || themeDefaults.lineHighlight.light.overviewRulerColor
                        : undefined
                }
            });
        }

        if (!Objects.areEquivalent(cfg.blame.file, this._config && this._config.blame.file) ||
            !Objects.areEquivalent(cfg.recentChanges.file, this._config && this._config.recentChanges.file) ||
            !Objects.areEquivalent(cfg.annotations, this._config && this._config.annotations) ||
            !Objects.areEquivalent(cfg.theme.annotations, this._config && this._config.theme.annotations)) {
            changed = true;
        }

        this._config = cfg;

        if (changed) {
            // Since the configuration has changed -- reset any visible annotations
            for (const provider of this._annotationProviders.values()) {
                if (provider === undefined) continue;

                if (provider.annotationType === FileAnnotationType.RecentChanges) {
                    provider.reset(Decorations.recentChangesAnnotation, Decorations.recentChangesHighlight);
                }
                else {
                    provider.reset(Decorations.blameAnnotation, Decorations.blameHighlight, this._whitespaceController);
                }
            }
        }
    }

    async clear(column: number) {
        const provider = this._annotationProviders.get(column);
        if (provider === undefined) return;

        this._annotationProviders.delete(column);
        await provider.dispose();

        if (this._annotationProviders.size === 0) {
            Logger.log(`Remove listener registrations for annotations`);

            await setCommandContext(CommandContext.AnnotationStatus, undefined);

            this._keyboardScope && this._keyboardScope.dispose();
            this._keyboardScope = undefined;

            this._annotationsDisposable && this._annotationsDisposable.dispose();
            this._annotationsDisposable = undefined;
        }

        this._onDidToggleAnnotations.fire();
    }

    getAnnotationType(editor: TextEditor | undefined): FileAnnotationType | undefined {
        const provider = this.getProvider(editor);
        return provider === undefined ? undefined : provider.annotationType;
    }

    getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
        if (editor === undefined || editor.document === undefined || !this.git.isEditorBlameable(editor)) return undefined;

        return this._annotationProviders.get(editor.viewColumn || -1);
    }

    private _keyboardScope: KeyboardScope | undefined = undefined;

    async showAnnotations(editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document || !this.git.isEditorBlameable(editor)) return false;

        const currentProvider = this._annotationProviders.get(editor.viewColumn || -1);
        if (currentProvider !== undefined && TextEditorComparer.equals(currentProvider.editor, editor)) {
            await currentProvider.selection(shaOrLine);
            return true;
        }

        return window.withProgress({ location: ProgressLocation.Window }, async (progress: Progress<{ message: string }>) => {
            await setCommandContext(CommandContext.AnnotationStatus, 'computing');

            const computingAnnotations = this._showAnnotationsCore(currentProvider, editor, type, shaOrLine, progress);
            const result = await computingAnnotations;

            await setCommandContext(CommandContext.AnnotationStatus, result ? 'computed' : undefined);

            return computingAnnotations;
        });
    }

    private async _showAnnotationsCore(currentProvider: AnnotationProviderBase | undefined, editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number, progress?: Progress<{ message: string}>): Promise<boolean> {
        if (progress !== undefined) {
            let annotationsLabel = 'annotations';
            switch (type) {
                case FileAnnotationType.Gutter:
                case FileAnnotationType.Hover:
                    annotationsLabel = 'blame annotations';
                    break;

                case FileAnnotationType.RecentChanges:
                    annotationsLabel = 'recent changes annotations';
                    break;
            }

            progress!.report({ message: `Computing ${annotationsLabel} for ${path.basename(editor.document.fileName)}` });
        }

        // Allows pressing escape to exit the annotations
        if (this._keyboardScope === undefined) {
            this._keyboardScope = await Keyboard.instance.beginScope({
                escape: {
                    onDidPressKey: (key: Keys) => {
                        const e = window.activeTextEditor;
                        if (e === undefined) return Promise.resolve(undefined);

                        this.clear(e.viewColumn || -1);
                        return Promise.resolve(undefined);
                    }
                } as KeyCommand
            });
        }

        const gitUri = await GitUri.fromUri(editor.document.uri, this.git);

        let provider: AnnotationProviderBase | undefined = undefined;
        switch (type) {
            case FileAnnotationType.Gutter:
                provider = new GutterBlameAnnotationProvider(this.context, editor, Decorations.blameAnnotation, Decorations.blameHighlight, this._whitespaceController, this.git, gitUri);
                break;

            case FileAnnotationType.Hover:
                provider = new HoverBlameAnnotationProvider(this.context, editor, Decorations.blameAnnotation, Decorations.blameHighlight, this._whitespaceController, this.git, gitUri);
                break;

            case FileAnnotationType.RecentChanges:
                provider = new RecentChangesAnnotationProvider(this.context, editor, undefined, Decorations.recentChangesHighlight!, this.git, gitUri);
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
            subscriptions.push(this.gitContextTracker.onDidChangeBlameability(this._onBlameabilityChanged, this));

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
        if (!editor || !editor.document || (type === FileAnnotationType.RecentChanges ? !this.git.isTrackable(editor.document.uri) : !this.git.isEditorBlameable(editor))) return false;

        const provider = this._annotationProviders.get(editor.viewColumn || -1);
        if (provider === undefined) return this.showAnnotations(editor, type, shaOrLine);

        const reopen = provider.annotationType !== type;
        await this.clear(provider.editor.viewColumn || -1);

        if (!reopen) return false;

        return this.showAnnotations(editor, type, shaOrLine);
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