'use strict';
import { Iterables, Objects } from '../system';
import { DecorationRenderOptions, Disposable, Event, EventEmitter, ExtensionContext, OverviewRulerLane, Progress, ProgressLocation, TextDocument, TextDocumentChangeEvent, TextEditor, TextEditorDecorationType, TextEditorViewColumnChangeEvent, window, workspace } from 'vscode';
import { AnnotationProviderBase, TextEditorCorrelationKey } from './annotationProvider';
import { Keyboard, KeyboardScope, KeyCommand, Keys } from '../keyboard';
import { TextDocumentComparer } from '../comparers';
import { ExtensionKey, IConfig, LineHighlightLocations, themeDefaults } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { BlameabilityChangeEvent, GitContextTracker, GitService, GitUri } from '../gitService';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { HoverBlameAnnotationProvider } from './hoverBlameAnnotationProvider';
import { Logger } from '../logger';
import { RecentChangesAnnotationProvider } from './recentChangesAnnotationProvider';
import * as path from 'path';

export enum FileAnnotationType {
    Gutter = 'gutter',
    Hover = 'hover',
    RecentChanges = 'recentChanges'
}

export enum AnnotationClearReason {
    User = 'User',
    BlameabilityChanged = 'BlameabilityChanged',
    ColumnChanged = 'ColumnChanged',
    Disposing = 'Disposing',
    DocumentChanged = 'DocumentChanged',
    DocumentClosed = 'DocumentClosed'
}

enum AnnotationStatus {
    Computing = 'computing',
    Computed = 'computed'
}

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
    private _annotationProviders: Map<TextEditorCorrelationKey, AnnotationProviderBase> = new Map();
    private _config: IConfig;
    private _disposable: Disposable;
    private _keyboardScope: KeyboardScope | undefined = undefined;

    constructor(
        private context: ExtensionContext,
        private git: GitService,
        private gitContextTracker: GitContextTracker
    ) {
        super(() => this.dispose());

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [
            workspace.onDidChangeConfiguration(this._onConfigurationChanged, this)
        ];
        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._annotationProviders.forEach(async (p, key) => await this.clearCore(key, AnnotationClearReason.Disposing));

        Decorations.blameAnnotation && Decorations.blameAnnotation.dispose();
        Decorations.blameHighlight && Decorations.blameHighlight.dispose();

        this._annotationsDisposable && this._annotationsDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        let changed = false;

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
                    if (provider.annotationType === this._config.blame.file.annotationType) {
                        provider.reset(Decorations.blameAnnotation, Decorations.blameHighlight);
                    }
                    else {
                        this.showAnnotations(provider.editor, cfg.blame.file.annotationType);
                    }
                }
            }
        }
    }

    private async _onActiveTextEditorChanged(e: TextEditor) {
        const provider = this.getProvider(e);
        if (provider === undefined) {
            await setCommandContext(CommandContext.AnnotationStatus, undefined);
            await this.detachKeyboardHook();
        }
        else {
            await setCommandContext(CommandContext.AnnotationStatus, AnnotationStatus.Computed);
            await this.attachKeyboardHook();
        }
    }

    private _onBlameabilityChanged(e: BlameabilityChangeEvent) {
        if (e.blameable || e.editor === undefined) return;

        this.clear(e.editor, AnnotationClearReason.BlameabilityChanged);
    }

    private _onTextDocumentChanged(e: TextDocumentChangeEvent) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e.document)) continue;

            // We have to defer because isDirty is not reliable inside this event
            // https://github.com/Microsoft/vscode/issues/27231
            setTimeout(() => {
                // If the document is dirty all is fine, just kick out since the GitContextTracker will handle it
                if (e.document.isDirty) return;

                // If the document isn't dirty, it is very likely this event was triggered by an outside edit of this document
                // Which means the document has been reloaded and the annotations have been removed, so we need to update (clear) our state tracking
                this.clearCore(key, AnnotationClearReason.DocumentChanged);
            }, 1);
        }
    }

    private _onTextDocumentClosed(e: TextDocument) {
        for (const [key, p] of this._annotationProviders) {
            if (!TextDocumentComparer.equals(p.document, e)) continue;

            this.clearCore(key, AnnotationClearReason.DocumentClosed);
        }
    }

    private _onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
        // FYI https://github.com/Microsoft/vscode/issues/35602
        const provider = this.getProvider(e.textEditor);
        if (provider === undefined) {
            // If we don't find an exact match, do a fuzzy match (since we can't properly track editors)
            const fuzzyProvider = Iterables.find(this._annotationProviders.values(), p => p.editor.document === e.textEditor.document);
            if (fuzzyProvider == null) return;

            this.clearCore(fuzzyProvider.correlationKey, AnnotationClearReason.ColumnChanged);

            return;
        }

        provider.restore(e.textEditor);
    }

    private async _onVisibleTextEditorsChanged(editors: TextEditor[]) {
        let provider: AnnotationProviderBase | undefined;
        for (const e of editors) {
            provider = this.getProvider(e);
            if (provider === undefined) continue;

            provider.restore(e);
        }
    }

    private async attachKeyboardHook() {
        // Allows pressing escape to exit the annotations
        if (this._keyboardScope === undefined) {
            this._keyboardScope = await Keyboard.instance.beginScope({
                escape: {
                    onDidPressKey: async (key: Keys) => {
                        const e = window.activeTextEditor;
                        if (e === undefined) return undefined;

                        await this.clear(e, AnnotationClearReason.User);
                        return undefined;
                    }
                } as KeyCommand
            });
        }
    }

    private async detachKeyboardHook() {
        if (this._keyboardScope === undefined) return;

        await this._keyboardScope.dispose();
        this._keyboardScope = undefined;
    }

    async clear(editor: TextEditor, reason: AnnotationClearReason = AnnotationClearReason.User) {
        this.clearCore(AnnotationProviderBase.getCorrelationKey(editor), reason);
    }

    private async clearCore(key: TextEditorCorrelationKey, reason: AnnotationClearReason) {
        const provider = this._annotationProviders.get(key);
        if (provider === undefined) return;

        Logger.log(`${reason}:`, `Clear annotations for ${key}`);

        this._annotationProviders.delete(key);
        await provider.dispose();

        if (key === AnnotationProviderBase.getCorrelationKey(window.activeTextEditor)) {
            await setCommandContext(CommandContext.AnnotationStatus, undefined);
            await this.detachKeyboardHook();
        }

        if (this._annotationProviders.size === 0) {
            Logger.log(`Remove all listener registrations for annotations`);

            this._annotationsDisposable && this._annotationsDisposable.dispose();
            this._annotationsDisposable = undefined;
        }

        this._onDidToggleAnnotations.fire();
    }

    getAnnotationType(editor: TextEditor | undefined): FileAnnotationType | undefined {
        const provider = this.getProvider(editor);
        return provider !== undefined && this.git.isEditorBlameable(editor!) ? provider.annotationType : undefined;
    }

    getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
        if (editor === undefined || editor.document === undefined) return undefined;
        return this._annotationProviders.get(AnnotationProviderBase.getCorrelationKey(editor));
    }

    async showAnnotations(editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (editor === undefined || editor.document === undefined || !this.git.isEditorBlameable(editor)) return false;

        const currentProvider = this.getProvider(editor);
        if (currentProvider !== undefined && currentProvider.annotationType === type) {
            await currentProvider.selection(shaOrLine);
            return true;
        }

        return window.withProgress({ location: ProgressLocation.Window }, async (progress: Progress<{ message: string }>) => {
            const active = editor === window.activeTextEditor;
            await setCommandContext(CommandContext.AnnotationStatus, active ? AnnotationStatus.Computing : undefined);

            const computingAnnotations = this.showAnnotationsCore(currentProvider, editor, type, shaOrLine, progress);
            const result = await computingAnnotations;

            if (active) {
                await setCommandContext(CommandContext.AnnotationStatus, result ? AnnotationStatus.Computed : undefined);
            }

            return computingAnnotations;
        });
    }

    private async showAnnotationsCore(currentProvider: AnnotationProviderBase | undefined, editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number, progress?: Progress<{ message: string}>): Promise<boolean> {
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
        this.attachKeyboardHook();

        const gitUri = await GitUri.fromUri(editor.document.uri, this.git);

        let provider: AnnotationProviderBase | undefined = undefined;
        switch (type) {
            case FileAnnotationType.Gutter:
                provider = new GutterBlameAnnotationProvider(this.context, editor, Decorations.blameAnnotation, Decorations.blameHighlight, this.git, gitUri);
                break;

            case FileAnnotationType.Hover:
                provider = new HoverBlameAnnotationProvider(this.context, editor, Decorations.blameAnnotation, Decorations.blameHighlight, this.git, gitUri);
                break;

            case FileAnnotationType.RecentChanges:
                provider = new RecentChangesAnnotationProvider(this.context, editor, undefined, Decorations.recentChangesHighlight!, this.git, gitUri);
                break;
        }
        if (provider === undefined || !(await provider.validate())) return false;

        if (currentProvider !== undefined) {
            await this.clearCore(currentProvider.correlationKey, AnnotationClearReason.User);
        }

        if (!this._annotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for annotations`);

            const subscriptions: Disposable[] = [
                window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this),
                window.onDidChangeTextEditorViewColumn(this._onTextEditorViewColumnChanged, this),
                window.onDidChangeVisibleTextEditors(this._onVisibleTextEditorsChanged, this),
                workspace.onDidChangeTextDocument(this._onTextDocumentChanged, this),
                workspace.onDidCloseTextDocument(this._onTextDocumentClosed, this),
                this.gitContextTracker.onDidChangeBlameability(this._onBlameabilityChanged, this)
            ];

            this._annotationsDisposable = Disposable.from(...subscriptions);
        }

        this._annotationProviders.set(provider.correlationKey, provider);
        if (await provider.provideAnnotation(shaOrLine)) {
            this._onDidToggleAnnotations.fire();
            return true;
        }

        return false;
    }

    async toggleAnnotations(editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (!editor || !editor.document || (type === FileAnnotationType.RecentChanges ? !this.git.isTrackable(editor.document.uri) : !this.git.isEditorBlameable(editor))) return false;

        const provider = this.getProvider(editor);
        if (provider === undefined) return this.showAnnotations(editor, type, shaOrLine);

        const reopen = provider.annotationType !== type;
        await this.clearCore(provider.correlationKey, AnnotationClearReason.User);

        if (!reopen) return false;

        return this.showAnnotations(editor, type, shaOrLine);
    }
}