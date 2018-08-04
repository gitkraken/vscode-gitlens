'use strict';
import * as path from 'path';
import {
    ConfigurationChangeEvent,
    DecorationRangeBehavior,
    DecorationRenderOptions,
    Disposable,
    Event,
    EventEmitter,
    OverviewRulerLane,
    Progress,
    ProgressLocation,
    TextDocument,
    TextEditor,
    TextEditorDecorationType,
    TextEditorViewColumnChangeEvent,
    ThemeColor,
    window,
    workspace
} from 'vscode';
import { AnnotationsToggleMode, configuration, FileAnnotationType, HighlightLocations } from '../configuration';
import { CommandContext, isTextEditor, setCommandContext } from '../constants';
import { Container } from '../container';
import { KeyboardScope, KeyCommand, Keys } from '../keyboard';
import { Logger } from '../logger';
import { Functions, Iterables } from '../system';
import {
    DocumentBlameStateChangeEvent,
    DocumentDirtyStateChangeEvent,
    GitDocumentState
} from '../trackers/gitDocumentTracker';
import { AnnotationProviderBase, AnnotationStatus, TextEditorCorrelationKey } from './annotationProvider';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { HeatmapBlameAnnotationProvider } from './heatmapBlameAnnotationProvider';
import { RecentChangesAnnotationProvider } from './recentChangesAnnotationProvider';

export enum AnnotationClearReason {
    User = 'User',
    BlameabilityChanged = 'BlameabilityChanged',
    ColumnChanged = 'ColumnChanged',
    Disposing = 'Disposing',
    DocumentChanged = 'DocumentChanged',
    DocumentClosed = 'DocumentClosed'
}

export const Decorations = {
    blameAnnotation: window.createTextEditorDecorationType({
        rangeBehavior: DecorationRangeBehavior.ClosedOpen,
        textDecoration: 'none'
    } as DecorationRenderOptions),
    blameHighlight: undefined as TextEditorDecorationType | undefined,
    heatmapAnnotation: window.createTextEditorDecorationType({} as DecorationRenderOptions),
    heatmapHighlight: undefined as TextEditorDecorationType | undefined,
    recentChangesAnnotation: undefined as TextEditorDecorationType | undefined,
    recentChangesHighlight: undefined as TextEditorDecorationType | undefined
};

export class FileAnnotationController implements Disposable {
    private _onDidToggleAnnotations = new EventEmitter<void>();
    get onDidToggleAnnotations(): Event<void> {
        return this._onDidToggleAnnotations.event;
    }

    private _annotationsDisposable: Disposable | undefined;
    private _annotationProviders: Map<TextEditorCorrelationKey, AnnotationProviderBase> = new Map();
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _keyboardScope: KeyboardScope | undefined = undefined;
    private readonly _toggleModes: Map<FileAnnotationType, AnnotationsToggleMode>;
    private _annotationType: FileAnnotationType | undefined = undefined;

    constructor() {
        this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));

        this._toggleModes = new Map();
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.clearAll();

        Decorations.blameAnnotation && Decorations.blameAnnotation.dispose();
        Decorations.blameHighlight && Decorations.blameHighlight.dispose();

        this._annotationsDisposable && this._annotationsDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const cfg = Container.config;

        if (initializing || configuration.changed(e, configuration.name('blame')('highlight').value)) {
            Decorations.blameHighlight && Decorations.blameHighlight.dispose();

            const cfgHighlight = cfg.blame.highlight;

            if (cfgHighlight.enabled) {
                Decorations.blameHighlight = window.createTextEditorDecorationType({
                    gutterIconSize: 'contain',
                    isWholeLine: true,
                    overviewRulerLane: OverviewRulerLane.Right,
                    backgroundColor: cfgHighlight.locations.includes(HighlightLocations.Line)
                        ? new ThemeColor('gitlens.lineHighlightBackgroundColor')
                        : undefined,
                    overviewRulerColor: cfgHighlight.locations.includes(HighlightLocations.Overview)
                        ? new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
                        : undefined,
                    dark: {
                        gutterIconPath: cfgHighlight.locations.includes(HighlightLocations.Gutter)
                            ? Container.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                            : undefined
                    },
                    light: {
                        gutterIconPath: cfgHighlight.locations.includes(HighlightLocations.Gutter)
                            ? Container.context.asAbsolutePath('images/light/highlight-gutter.svg')
                            : undefined
                    }
                });
            }
            else {
                Decorations.blameHighlight = undefined;
            }
        }

        if (initializing || configuration.changed(e, configuration.name('recentChanges')('highlight').value)) {
            Decorations.recentChangesAnnotation && Decorations.recentChangesAnnotation.dispose();

            const cfgHighlight = cfg.recentChanges.highlight;

            Decorations.recentChangesAnnotation = window.createTextEditorDecorationType({
                gutterIconSize: 'contain',
                isWholeLine: true,
                overviewRulerLane: OverviewRulerLane.Right,
                backgroundColor: cfgHighlight.locations.includes(HighlightLocations.Line)
                    ? new ThemeColor('gitlens.lineHighlightBackgroundColor')
                    : undefined,
                overviewRulerColor: cfgHighlight.locations.includes(HighlightLocations.Overview)
                    ? new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
                    : undefined,
                dark: {
                    gutterIconPath: cfgHighlight.locations.includes(HighlightLocations.Gutter)
                        ? Container.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                        : undefined
                },
                light: {
                    gutterIconPath: cfgHighlight.locations.includes(HighlightLocations.Gutter)
                        ? Container.context.asAbsolutePath('images/light/highlight-gutter.svg')
                        : undefined
                }
            });
        }

        if (initializing || configuration.changed(e, configuration.name('blame')('toggleMode').value)) {
            this._toggleModes.set(FileAnnotationType.Blame, cfg.blame.toggleMode);
            if (!initializing && cfg.blame.toggleMode === AnnotationsToggleMode.File) {
                this.clearAll();
            }
        }

        if (initializing || configuration.changed(e, configuration.name('heatmap')('toggleMode').value)) {
            this._toggleModes.set(FileAnnotationType.Heatmap, cfg.heatmap.toggleMode);
            if (!initializing && cfg.heatmap.toggleMode === AnnotationsToggleMode.File) {
                this.clearAll();
            }
        }

        if (initializing || configuration.changed(e, configuration.name('recentChanges')('toggleMode').value)) {
            this._toggleModes.set(FileAnnotationType.RecentChanges, cfg.recentChanges.toggleMode);
            if (!initializing && cfg.recentChanges.toggleMode === AnnotationsToggleMode.File) {
                this.clearAll();
            }
        }

        if (initializing) return;

        if (
            configuration.changed(e, configuration.name('blame').value) ||
            configuration.changed(e, configuration.name('recentChanges').value) ||
            configuration.changed(e, configuration.name('heatmap').value) ||
            configuration.changed(e, configuration.name('hovers').value)
        ) {
            // Since the configuration has changed -- reset any visible annotations
            for (const provider of this._annotationProviders.values()) {
                if (provider === undefined) continue;

                if (provider.annotationType === FileAnnotationType.RecentChanges) {
                    provider.reset({
                        decoration: Decorations.recentChangesAnnotation!,
                        highlightDecoration: Decorations.recentChangesHighlight
                    });
                }
                else if (provider.annotationType === FileAnnotationType.Blame) {
                    provider.reset({
                        decoration: Decorations.blameAnnotation,
                        highlightDecoration: Decorations.blameHighlight
                    });
                }
                else {
                    this.show(provider.editor, FileAnnotationType.Heatmap);
                }
            }
        }
    }

    private async onActiveTextEditorChanged(editor: TextEditor | undefined) {
        if (editor !== undefined && !isTextEditor(editor)) return;

        this._editor = editor;
        // Logger.log('AnnotationController.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

        if (this.isInWindowToggle()) {
            await this.show(editor, this._annotationType!);

            return;
        }

        const provider = this.getProvider(editor);
        if (provider === undefined) {
            setCommandContext(CommandContext.AnnotationStatus, undefined);
            this.detachKeyboardHook();
        }
        else {
            setCommandContext(CommandContext.AnnotationStatus, provider.status);
            this.attachKeyboardHook();
        }
    }

    private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
        // Only care if we are becoming un-blameable
        if (e.blameable) return;

        const editor = window.activeTextEditor;
        if (editor === undefined) return;

        this.clear(editor, AnnotationClearReason.BlameabilityChanged);
    }

    private onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
        for (const [key, p] of this._annotationProviders) {
            if (!e.document.is(p.document)) continue;

            this.clearCore(key, AnnotationClearReason.DocumentChanged);
        }
    }

    private onTextDocumentClosed(document: TextDocument) {
        if (!Container.git.isTrackable(document.uri)) return;

        for (const [key, p] of this._annotationProviders) {
            if (p.document !== document) continue;

            this.clearCore(key, AnnotationClearReason.DocumentClosed);
        }
    }

    private onTextEditorViewColumnChanged(e: TextEditorViewColumnChangeEvent) {
        // FYI https://github.com/Microsoft/vscode/issues/35602
        const provider = this.getProvider(e.textEditor);
        if (provider === undefined) {
            // If we don't find an exact match, do a fuzzy match (since we can't properly track editors)
            const fuzzyProvider = Iterables.find(
                this._annotationProviders.values(),
                p => p.editor.document === e.textEditor.document
            );
            if (fuzzyProvider == null) return;

            this.clearCore(fuzzyProvider.correlationKey, AnnotationClearReason.ColumnChanged);

            return;
        }

        provider.restore(e.textEditor);
    }

    private onVisibleTextEditorsChanged(editors: TextEditor[]) {
        let provider: AnnotationProviderBase | undefined;
        for (const e of editors) {
            provider = this.getProvider(e);
            if (provider === undefined) continue;

            provider.restore(e);
        }
    }

    isInWindowToggle(): boolean {
        return this.getToggleMode(this._annotationType) === AnnotationsToggleMode.Window;
    }

    private getToggleMode(annotationType: FileAnnotationType | undefined): AnnotationsToggleMode {
        if (annotationType === undefined) return AnnotationsToggleMode.File;

        return this._toggleModes.get(annotationType) || AnnotationsToggleMode.File;
    }

    clear(editor: TextEditor, reason: AnnotationClearReason = AnnotationClearReason.User) {
        if (this.isInWindowToggle()) {
            return this.clearAll();
        }

        return this.clearCore(AnnotationProviderBase.getCorrelationKey(editor), reason);
    }

    async clearAll() {
        this._annotationType = undefined;
        for (const [key] of this._annotationProviders) {
            await this.clearCore(key, AnnotationClearReason.Disposing);
        }
    }

    async getAnnotationType(editor: TextEditor | undefined): Promise<FileAnnotationType | undefined> {
        const provider = this.getProvider(editor);
        if (provider === undefined) return undefined;

        const trackedDocument = await Container.tracker.get(editor!.document);
        if (trackedDocument === undefined || !trackedDocument.isBlameable) return undefined;

        return provider.annotationType;
    }

    getProvider(editor: TextEditor | undefined): AnnotationProviderBase | undefined {
        if (editor === undefined || editor.document === undefined) return undefined;
        return this._annotationProviders.get(AnnotationProviderBase.getCorrelationKey(editor));
    }

    async show(
        editor: TextEditor | undefined,
        type: FileAnnotationType,
        shaOrLine?: string | number
    ): Promise<boolean> {
        if (this.getToggleMode(type) === AnnotationsToggleMode.Window) {
            let first = this._annotationType === undefined;
            const reset = !first && this._annotationType !== type;

            this._annotationType = type;

            if (reset) {
                await this.clearAll();
                first = true;
            }

            if (first) {
                for (const e of window.visibleTextEditors) {
                    if (e === editor) continue;

                    this.show(e, type);
                }
            }
        }

        if (editor === undefined) return false; // || editor.viewColumn === undefined) return false;
        this._editor = editor;

        const trackedDocument = await Container.tracker.getOrAdd(editor.document);
        if (!trackedDocument.isBlameable) return false;

        const currentProvider = this.getProvider(editor);
        if (currentProvider !== undefined && currentProvider.annotationType === type) {
            await currentProvider.selection(shaOrLine);
            return true;
        }

        const provider = await window.withProgress(
            { location: ProgressLocation.Window },
            async (progress: Progress<{ message: string }>) => {
                await setCommandContext(CommandContext.AnnotationStatus, AnnotationStatus.Computing);

                const computingAnnotations = this.showAnnotationsCore(
                    currentProvider,
                    editor,
                    type,
                    shaOrLine,
                    progress
                );
                const provider = await computingAnnotations;

                if (editor === this._editor) {
                    await setCommandContext(CommandContext.AnnotationStatus, provider && provider.status);
                }

                return computingAnnotations;
            }
        );

        return provider !== undefined;
    }

    async toggle(
        editor: TextEditor | undefined,
        type: FileAnnotationType,
        shaOrLine?: string | number
    ): Promise<boolean> {
        if (editor !== undefined) {
            const trackedDocument = await Container.tracker.getOrAdd(editor.document);
            if (
                (type === FileAnnotationType.RecentChanges && !trackedDocument.isTracked) ||
                !trackedDocument.isBlameable
            ) {
                return false;
            }
        }

        const provider = this.getProvider(editor);
        if (provider === undefined) return this.show(editor!, type, shaOrLine);

        const reopen = provider.annotationType !== type;

        if (this.isInWindowToggle()) {
            await this.clearAll();
        }
        else {
            await this.clearCore(provider.correlationKey, AnnotationClearReason.User);
        }

        if (!reopen) return false;

        return this.show(editor, type, shaOrLine);
    }

    private async attachKeyboardHook() {
        // Allows pressing escape to exit the annotations
        if (this._keyboardScope === undefined) {
            this._keyboardScope = await Container.keyboard.beginScope({
                escape: {
                    onDidPressKey: async (key: Keys) => {
                        const e = this._editor;
                        if (e === undefined) return undefined;

                        await this.clear(e, AnnotationClearReason.User);
                        return undefined;
                    }
                } as KeyCommand
            });
        }
    }

    private async clearCore(key: TextEditorCorrelationKey, reason: AnnotationClearReason) {
        const provider = this._annotationProviders.get(key);
        if (provider === undefined) return;

        Logger.log(`${reason}:`, `Clear annotations for ${key}`);

        this._annotationProviders.delete(key);
        await provider.dispose();

        if (this._annotationProviders.size === 0 || key === AnnotationProviderBase.getCorrelationKey(this._editor)) {
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

    private async detachKeyboardHook() {
        if (this._keyboardScope === undefined) return;

        await this._keyboardScope.dispose();
        this._keyboardScope = undefined;
    }

    private async showAnnotationsCore(
        currentProvider: AnnotationProviderBase | undefined,
        editor: TextEditor,
        type: FileAnnotationType,
        shaOrLine?: string | number,
        progress?: Progress<{ message: string }>
    ): Promise<AnnotationProviderBase | undefined> {
        if (progress !== undefined) {
            let annotationsLabel = 'annotations';
            switch (type) {
                case FileAnnotationType.Blame:
                    annotationsLabel = 'blame annotations';
                    break;

                case FileAnnotationType.Heatmap:
                    annotationsLabel = 'heatmap annotations';
                    break;

                case FileAnnotationType.RecentChanges:
                    annotationsLabel = 'recent changes annotations';
                    break;
            }

            progress!.report({
                message: `Computing ${annotationsLabel} for ${path.basename(editor.document.fileName)}`
            });
        }

        // Allows pressing escape to exit the annotations
        this.attachKeyboardHook();

        const trackedDocument = await Container.tracker.getOrAdd(editor.document);

        let provider: AnnotationProviderBase | undefined = undefined;
        switch (type) {
            case FileAnnotationType.Blame:
                provider = new GutterBlameAnnotationProvider(
                    editor,
                    trackedDocument,
                    Decorations.blameAnnotation,
                    Decorations.blameHighlight
                );
                break;

            case FileAnnotationType.Heatmap:
                provider = new HeatmapBlameAnnotationProvider(
                    editor,
                    trackedDocument,
                    Decorations.heatmapAnnotation,
                    Decorations.heatmapHighlight
                );
                break;

            case FileAnnotationType.RecentChanges:
                provider = new RecentChangesAnnotationProvider(
                    editor,
                    trackedDocument,
                    Decorations.recentChangesAnnotation!,
                    Decorations.recentChangesHighlight
                );
                break;
        }
        if (provider === undefined || !(await provider.validate())) return undefined;

        if (currentProvider !== undefined) {
            await this.clearCore(currentProvider.correlationKey, AnnotationClearReason.User);
        }

        if (!this._annotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for annotations`);

            this._annotationsDisposable = Disposable.from(
                window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 50), this),
                window.onDidChangeTextEditorViewColumn(this.onTextEditorViewColumnChanged, this),
                window.onDidChangeVisibleTextEditors(Functions.debounce(this.onVisibleTextEditorsChanged, 50), this),
                workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
                Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
                Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this)
            );
        }

        this._annotationProviders.set(provider.correlationKey, provider);
        if (await provider.provideAnnotation(shaOrLine)) {
            this._onDidToggleAnnotations.fire();
            return provider;
        }

        return undefined;
    }
}
