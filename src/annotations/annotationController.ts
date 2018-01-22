'use strict';
import { Functions, Iterables } from '../system';
import { ConfigurationChangeEvent, DecorationRangeBehavior, DecorationRenderOptions, Disposable, Event, EventEmitter, OverviewRulerLane, Progress, ProgressLocation, TextDocument, TextEditor, TextEditorDecorationType, TextEditorViewColumnChangeEvent, ThemeColor, window, workspace } from 'vscode';
import { AnnotationProviderBase, TextEditorCorrelationKey } from './annotationProvider';
import { configuration, FileAnnotationType, IConfig, LineHighlightLocations } from '../configuration';
import { CommandContext, isTextEditor, setCommandContext } from '../constants';
import { Container } from '../container';
import { DocumentBlameStateChangeEvent, DocumentDirtyStateChangeEvent, GitDocumentState } from '../trackers/documentTracker';
import { GutterBlameAnnotationProvider } from './gutterBlameAnnotationProvider';
import { HeatmapBlameAnnotationProvider } from './heatmapBlameAnnotationProvider';
import { HoverBlameAnnotationProvider } from './hoverBlameAnnotationProvider';
import { KeyboardScope, KeyCommand, Keys } from '../keyboard';
import { Logger } from '../logger';
import { RecentChangesAnnotationProvider } from './recentChangesAnnotationProvider';
import * as path from 'path';

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
        rangeBehavior: DecorationRangeBehavior.ClosedClosed,
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
    private _disposable: Disposable;
    private _keyboardScope: KeyboardScope | undefined = undefined;

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this._annotationProviders.forEach(async (p, key) => await this.clearCore(key, AnnotationClearReason.Disposing));

        Decorations.blameAnnotation && Decorations.blameAnnotation.dispose();
        Decorations.blameHighlight && Decorations.blameHighlight.dispose();

        this._annotationsDisposable && this._annotationsDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        let cfg: IConfig | undefined;

        if (initializing ||
            configuration.changed(e, configuration.name('blame')('file')('lineHighlight').value)) {
            Decorations.blameHighlight && Decorations.blameHighlight.dispose();

            cfg = configuration.get<IConfig>();

            const cfgHighlight = cfg.blame.file.lineHighlight;

            if (cfgHighlight.enabled) {
                Decorations.blameHighlight = window.createTextEditorDecorationType({
                    gutterIconSize: 'contain',
                    isWholeLine: true,
                    overviewRulerLane: OverviewRulerLane.Right,
                    backgroundColor: cfgHighlight.locations.includes(LineHighlightLocations.Line)
                        ? new ThemeColor('gitlens.lineHighlightBackgroundColor')
                        : undefined,
                    overviewRulerColor: cfgHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                        ? new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
                        : undefined,
                    dark: {
                        gutterIconPath: cfgHighlight.locations.includes(LineHighlightLocations.Gutter)
                            ? Container.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                            : undefined
                    },
                    light: {
                        gutterIconPath: cfgHighlight.locations.includes(LineHighlightLocations.Gutter)
                            ? Container.context.asAbsolutePath('images/light/highlight-gutter.svg')
                            : undefined
                    }
                });
            }
            else {
                Decorations.blameHighlight = undefined;
            }
        }

        if (initializing ||
            configuration.changed(e, configuration.name('recentChanges')('file')('lineHighlight').value)) {
            Decorations.recentChangesHighlight && Decorations.recentChangesHighlight.dispose();

            if (cfg === undefined) {
                cfg = configuration.get<IConfig>();
            }
            const cfgHighlight = cfg.recentChanges.file.lineHighlight;

            Decorations.recentChangesHighlight = window.createTextEditorDecorationType({
                gutterIconSize: 'contain',
                isWholeLine: true,
                overviewRulerLane: OverviewRulerLane.Right,
                backgroundColor: cfgHighlight.locations.includes(LineHighlightLocations.Line)
                    ? new ThemeColor('gitlens.lineHighlightBackgroundColor')
                    : undefined,
                overviewRulerColor: cfgHighlight.locations.includes(LineHighlightLocations.OverviewRuler)
                    ? new ThemeColor('gitlens.lineHighlightOverviewRulerColor')
                    : undefined,
                dark: {
                    gutterIconPath: cfgHighlight.locations.includes(LineHighlightLocations.Gutter)
                        ? Container.context.asAbsolutePath('images/dark/highlight-gutter.svg')
                        : undefined
                },
                light: {
                    gutterIconPath: cfgHighlight.locations.includes(LineHighlightLocations.Gutter)
                        ? Container.context.asAbsolutePath('images/light/highlight-gutter.svg')
                        : undefined
                }
            });
        }

        if (initializing) return;

        if (configuration.changed(e, configuration.name('blame')('file').value) ||
            configuration.changed(e, configuration.name('recentChanges')('file').value) ||
            configuration.changed(e, configuration.name('annotations')('file').value)) {
            if (cfg === undefined) {
                cfg = configuration.get<IConfig>();
            }

            // Since the configuration has changed -- reset any visible annotations
            for (const provider of this._annotationProviders.values()) {
                if (provider === undefined) continue;

                if (provider.annotationType === FileAnnotationType.RecentChanges) {
                    provider.reset({ decoration: Decorations.recentChangesAnnotation, highlightDecoration: Decorations.recentChangesHighlight });
                }
                else {
                    if (provider.annotationType === cfg.blame.file.annotationType) {
                        provider.reset({ decoration: Decorations.blameAnnotation, highlightDecoration: Decorations.blameHighlight });
                    }
                    else {
                        this.showAnnotations(provider.editor, cfg.blame.file.annotationType);
                    }
                }
            }
        }
    }

    private onActiveTextEditorChanged(editor: TextEditor | undefined) {
        if (editor !== undefined && !isTextEditor(editor)) return;

        // Logger.log('AnnotationController.onActiveTextEditorChanged', editor && editor.document.uri.fsPath);

        const provider = this.getProvider(editor);
        if (provider === undefined) {
            setCommandContext(CommandContext.AnnotationStatus, undefined);
            this.detachKeyboardHook();
        }
        else {
            setCommandContext(CommandContext.AnnotationStatus, AnnotationStatus.Computed);
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
            const fuzzyProvider = Iterables.find(this._annotationProviders.values(), p => p.editor.document === e.textEditor.document);
            if (fuzzyProvider == null) return;

            this.clearCore(fuzzyProvider.correlationKey, AnnotationClearReason.ColumnChanged);

            return;
        }

        provider.restore(e.textEditor);
    }

    private async onVisibleTextEditorsChanged(editors: TextEditor[]) {
        let provider: AnnotationProviderBase | undefined;
        for (const e of editors) {
            provider = this.getProvider(e);
            if (provider === undefined) continue;

            provider.restore(e);
        }
    }

    async clear(editor: TextEditor, reason: AnnotationClearReason = AnnotationClearReason.User) {
        this.clearCore(AnnotationProviderBase.getCorrelationKey(editor), reason);
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

    async showAnnotations(editor: TextEditor | undefined, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (editor === undefined) return false; // || editor.viewColumn === undefined) return false;

        const trackedDocument = await Container.tracker.getOrAdd(editor.document);
        if (!trackedDocument.isBlameable) return false;

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

    async toggleAnnotations(editor: TextEditor | undefined, type: FileAnnotationType, shaOrLine?: string | number): Promise<boolean> {
        if (editor !== undefined) {
            const trackedDocument = await Container.tracker.getOrAdd(editor.document);
            if ((type === FileAnnotationType.RecentChanges && !trackedDocument.isTracked) || !trackedDocument.isBlameable) return false;
        }

        const provider = this.getProvider(editor);
        if (provider === undefined) return this.showAnnotations(editor!, type, shaOrLine);

        const reopen = provider.annotationType !== type;
        await this.clearCore(provider.correlationKey, AnnotationClearReason.User);

        if (!reopen) return false;

        return this.showAnnotations(editor, type, shaOrLine);
    }

    private async attachKeyboardHook() {
        // Allows pressing escape to exit the annotations
        if (this._keyboardScope === undefined) {
            this._keyboardScope = await Container.keyboard.beginScope({
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

    private async detachKeyboardHook() {
        if (this._keyboardScope === undefined) return;

        await this._keyboardScope.dispose();
        this._keyboardScope = undefined;
    }

    private async showAnnotationsCore(currentProvider: AnnotationProviderBase | undefined, editor: TextEditor, type: FileAnnotationType, shaOrLine?: string | number, progress?: Progress<{ message: string}>): Promise<boolean> {
        if (progress !== undefined) {
            let annotationsLabel = 'annotations';
            switch (type) {
                case FileAnnotationType.Gutter:
                case FileAnnotationType.Hover:
                    annotationsLabel = 'blame annotations';
                    break;

                case FileAnnotationType.Heatmap:
                    annotationsLabel = 'heatmap annotations';
                    break;

                case FileAnnotationType.RecentChanges:
                    annotationsLabel = 'recent changes annotations';
                    break;
            }

            progress!.report({ message: `Computing ${annotationsLabel} for ${path.basename(editor.document.fileName)}` });
        }

        // Allows pressing escape to exit the annotations
        this.attachKeyboardHook();

        const trackedDocument = await Container.tracker.getOrAdd(editor.document);

        let provider: AnnotationProviderBase | undefined = undefined;
        switch (type) {
            case FileAnnotationType.Gutter:
                provider = new GutterBlameAnnotationProvider(editor, trackedDocument, Decorations.blameAnnotation, Decorations.blameHighlight);
                break;

            case FileAnnotationType.Heatmap:
                provider = new HeatmapBlameAnnotationProvider(editor, trackedDocument, Decorations.blameAnnotation, undefined);
                break;

            case FileAnnotationType.Hover:
                provider = new HoverBlameAnnotationProvider(editor, trackedDocument, Decorations.blameAnnotation, Decorations.blameHighlight);
                break;

            case FileAnnotationType.RecentChanges:
                provider = new RecentChangesAnnotationProvider(editor, trackedDocument, undefined, Decorations.recentChangesHighlight!);
                break;
        }
        if (provider === undefined || !(await provider.validate())) return false;

        if (currentProvider !== undefined) {
            await this.clearCore(currentProvider.correlationKey, AnnotationClearReason.User);
        }

        if (!this._annotationsDisposable && this._annotationProviders.size === 0) {
            Logger.log(`Add listener registrations for annotations`);

            this._annotationsDisposable = Disposable.from(
                window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveTextEditorChanged, 50), this),
                window.onDidChangeTextEditorViewColumn(this.onTextEditorViewColumnChanged, this),
                window.onDidChangeVisibleTextEditors(this.onVisibleTextEditorsChanged, this),
                workspace.onDidCloseTextDocument(this.onTextDocumentClosed, this),
                Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
                Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this)
            );
        }

        this._annotationProviders.set(provider.correlationKey, provider);
        if (await provider.provideAnnotation(shaOrLine)) {
            this._onDidToggleAnnotations.fire();
            return true;
        }

        return false;
    }
}