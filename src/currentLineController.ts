'use strict';
import { Functions, IDeferrable } from './system';
import { CancellationToken, ConfigurationChangeEvent, debug, DecorationRangeBehavior, DecorationRenderOptions, Disposable, Hover, HoverProvider, languages, Position, Range, StatusBarAlignment, StatusBarItem, TextDocument, TextEditor, TextEditorDecorationType, window } from 'vscode';
import { Annotations } from './annotations/annotations';
import { Commands } from './commands';
import { configuration, FileAnnotationType, IConfig, LineAnnotationType, StatusBarCommand } from './configuration';
import { isTextEditor, RangeEndOfLineIndex } from './constants';
import { Container } from './container';
import { DocumentBlameStateChangeEvent, DocumentDirtyIdleTriggerEvent, DocumentDirtyStateChangeEvent, GitDocumentState, TrackedDocument } from './trackers/documentTracker';
import { CommitFormatter, GitCommit, GitCommitLine, ICommitFormatOptions } from './gitService';
import { GitLineState, LineChangeEvent, LineTracker } from './trackers/lineTracker';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 3em',
        textDecoration: 'none'
    },
    rangeBehavior: DecorationRangeBehavior.ClosedClosed
} as DecorationRenderOptions);

class AnnotationState {

    constructor(private _enabled: boolean, private _annotationType: LineAnnotationType) { }

    get annotationType(): LineAnnotationType {
        return this._annotationType;
    }

    get enabled(): boolean {
        return this.suspended ? false : this._enabled;
    }

    private _suspendReason?: 'debugging' | 'dirty';
    get suspended(): boolean {
        return this._suspendReason !== undefined;
    }

    reset(enabled: boolean, annotationType: LineAnnotationType): boolean {
        // returns whether or not a refresh is required

        if (this._enabled === enabled && this._annotationType === annotationType && !this.suspended) return false;

        this._enabled = enabled;
        this._annotationType = annotationType;
        this._suspendReason = undefined;

        return true;
    }

    resume(reason: 'debugging' | 'dirty'): boolean {
        // returns whether or not a refresh is required

        const refresh = this._suspendReason !== undefined;
        this._suspendReason = undefined;
        return refresh;
    }

    suspend(reason: 'debugging' | 'dirty'): boolean {
        // returns whether or not a refresh is required

        const refresh = this._suspendReason === undefined;
        this._suspendReason = reason;
        return refresh;
    }
}

export class CurrentLineController extends Disposable {

    private _blameAnnotationState: AnnotationState | undefined;
    private _editor: TextEditor | undefined;
    private _lineTracker: LineTracker<GitLineState>;
    private _statusBarItem: StatusBarItem | undefined;

    private _disposable: Disposable;
    private _debugSessionEndDisposable: Disposable | undefined;
    private _hoverProviderDisposable: Disposable | undefined;
    private _lineTrackingDisposable: Disposable | undefined;

    constructor() {
        super(() => this.dispose());

        this._lineTracker = new LineTracker<GitLineState>();

        this._disposable = Disposable.from(
            this._lineTracker,
            configuration.onDidChange(this.onConfigurationChanged, this),
            Container.annotations.onDidToggleAnnotations(this.onFileAnnotationsToggled, this),
            debug.onDidStartDebugSession(this.onDebugSessionStarted, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.clearAnnotations(this._editor);

        this.unregisterHoverProviders();

        this._debugSessionEndDisposable && this._debugSessionEndDisposable.dispose();
        this._lineTrackingDisposable && this._lineTrackingDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();

        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        const cfg = configuration.get<IConfig>();

        let changed = false;

        if (initializing || configuration.changed(e, configuration.name('blame')('line').value)) {
            changed = true;
            this._blameAnnotationState = undefined;
        }

        if (initializing ||
            configuration.changed(e, configuration.name('annotations')('line')('trailing').value) ||
            configuration.changed(e, configuration.name('annotations')('line')('hover').value)) {
            changed = true;
            this.unregisterHoverProviders();
        }

        if (initializing || configuration.changed(e, configuration.name('statusBar').value)) {
            changed = true;

            if (cfg.statusBar.enabled) {
                const alignment = cfg.statusBar.alignment !== 'left' ? StatusBarAlignment.Right : StatusBarAlignment.Left;
                if (this._statusBarItem !== undefined && this._statusBarItem.alignment !== alignment) {
                    this._statusBarItem.dispose();
                    this._statusBarItem = undefined;
                }

                this._statusBarItem = this._statusBarItem || window.createStatusBarItem(alignment, alignment === StatusBarAlignment.Right ? 1000 : 0);
                this._statusBarItem.command = cfg.statusBar.command;
            }
            else if (this._statusBarItem !== undefined) {
                this._statusBarItem.dispose();
                this._statusBarItem = undefined;
            }
        }

        if (!changed) return;

        const trackCurrentLine = cfg.statusBar.enabled || cfg.blame.line.enabled ||
            (this._blameAnnotationState !== undefined && this._blameAnnotationState.enabled);

        if (trackCurrentLine) {
            this._lineTracker.start();

            this._lineTrackingDisposable = this._lineTrackingDisposable || Disposable.from(
                this._lineTracker.onDidChangeActiveLine(this.onActiveLineChanged, this),
                Container.tracker.onDidChangeBlameState(this.onBlameStateChanged, this),
                Container.tracker.onDidChangeDirtyState(this.onDirtyStateChanged, this),
                Container.tracker.onDidTriggerDirtyIdle(this.onDirtyIdleTriggered, this)
            );
        }
        else {
            this._lineTracker.stop();

            if (this._lineTrackingDisposable !== undefined) {
                this._lineTrackingDisposable.dispose();
                this._lineTrackingDisposable = undefined;
            }
        }

        this.refresh(window.activeTextEditor, { full: true });
    }

    private onActiveLineChanged(e: LineChangeEvent) {
        if (!e.pending && e.line !== undefined) {
            this.refresh(e.editor);

            return;
        }

        this.clear(e.editor);
    }

    private onBlameStateChanged(e: DocumentBlameStateChangeEvent<GitDocumentState>) {
        if (e.blameable) {
            this.refresh(e.editor);

            return;
        }

        this.clear(e.editor);
    }

    private onDebugSessionStarted() {
        if (this.suspendBlameAnnotations('debugging', window.activeTextEditor)) {
            this._debugSessionEndDisposable = debug.onDidTerminateDebugSession(this.onDebugSessionEnded, this);
        }
    }

    private onDebugSessionEnded() {
        if (this._debugSessionEndDisposable !== undefined) {
            this._debugSessionEndDisposable.dispose();
            this._debugSessionEndDisposable = undefined;
        }

        this.resumeBlameAnnotations('debugging', window.activeTextEditor);
    }

    private onDirtyIdleTriggered(e: DocumentDirtyIdleTriggerEvent<GitDocumentState>) {
        const maxLines = configuration.get<number>(configuration.name('advanced')('blame')('sizeThresholdAfterEdit').value);
        if (maxLines > 0 && e.document.document.lineCount > maxLines) return;

        this.resumeBlameAnnotations('dirty', window.activeTextEditor);
    }

    private async onDirtyStateChanged(e: DocumentDirtyStateChangeEvent<GitDocumentState>) {
        if (e.dirty) {
            this.suspendBlameAnnotations('dirty', window.activeTextEditor);
        }
        else {
            this.resumeBlameAnnotations('dirty', window.activeTextEditor, { force: true });
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

        this._lineTracker.reset();
        this.unregisterHoverProviders();
        this._statusBarItem && this._statusBarItem.hide();
    }

    async provideDetailsHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        if (this._editor === undefined || this._editor.document !== document) return undefined;
        if (this._lineTracker.line !== position.line) return undefined;

        const commit = this._lineTracker.state !== undefined ? this._lineTracker.state.commit : undefined;
        if (commit === undefined) return undefined;

        const fileAnnotations = await Container.annotations.getAnnotationType(this._editor);
        // Avoid double annotations if we are showing the whole-file hover blame annotations
        if ((fileAnnotations === FileAnnotationType.Gutter && Container.config.annotations.file.gutter.hover.details) ||
            (fileAnnotations === FileAnnotationType.Hover && Container.config.annotations.file.hover.details)) {
            return undefined;
        }

        const state = this.getBlameAnnotationState();
        const wholeLine = state.annotationType === LineAnnotationType.Hover || (state.annotationType === LineAnnotationType.Trailing && Container.config.annotations.line.trailing.hover.wholeLine) ||
            fileAnnotations === FileAnnotationType.Hover || (fileAnnotations === FileAnnotationType.Gutter && Container.config.annotations.file.gutter.hover.wholeLine);

        const range = document.validateRange(new Range(position.line, wholeLine ? 0 : RangeEndOfLineIndex, position.line, RangeEndOfLineIndex));
        if (!wholeLine && range.start.character !== position.character) return undefined;

        // Get the full commit message -- since blame only returns the summary
        let logCommit = this._lineTracker.state !== undefined ? this._lineTracker.state.logCommit : undefined;
        if (logCommit === undefined && !commit.isUncommitted) {
            logCommit = await Container.git.getLogCommitForFile(commit.repoPath, commit.uri.fsPath, { ref: commit.sha });
            if (logCommit !== undefined) {
                // Preserve the previous commit from the blame commit
                logCommit.previousSha = commit.previousSha;
                logCommit.previousFileName = commit.previousFileName;

                if (this._lineTracker.state !== undefined) {
                    this._lineTracker.state.logCommit = logCommit;
                }
            }
        }

        const trackedDocument = await Container.tracker.get(document);
        if (trackedDocument === undefined) return undefined;

        const message = Annotations.getHoverMessage(logCommit || commit, Container.config.defaultDateFormat, trackedDocument.hasRemotes, Container.config.blame.file.annotationType);
        return new Hover(message, range);
    }

    async provideChangesHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined> {
        if (this._editor === undefined || this._editor.document !== document) return undefined;
        if (this._lineTracker.line !== position.line) return undefined;

        const commit = this._lineTracker.state !== undefined ? this._lineTracker.state.commit : undefined;
        if (commit === undefined) return undefined;

        const fileAnnotations = await Container.annotations.getAnnotationType(this._editor);
        // Avoid double annotations if we are showing the whole-file hover blame annotations
        if ((fileAnnotations === FileAnnotationType.Gutter && Container.config.annotations.file.gutter.hover.changes) ||
            (fileAnnotations === FileAnnotationType.Hover && Container.config.annotations.file.hover.changes)) {
            return undefined;
        }

        const state = this.getBlameAnnotationState();
        const wholeLine = state.annotationType === LineAnnotationType.Hover || (state.annotationType === LineAnnotationType.Trailing && Container.config.annotations.line.trailing.hover.wholeLine) ||
            fileAnnotations === FileAnnotationType.Hover || (fileAnnotations === FileAnnotationType.Gutter && Container.config.annotations.file.gutter.hover.wholeLine);

        const range = document.validateRange(new Range(position.line, wholeLine ? 0 : RangeEndOfLineIndex, position.line, RangeEndOfLineIndex));
        if (!wholeLine && range.start.character !== position.character) return undefined;

        const trackedDocument = await Container.tracker.get(document);
        if (trackedDocument === undefined) return undefined;

        const hover = await Annotations.changesHover(commit, position.line, trackedDocument.uri);
        if (hover.hoverMessage === undefined) return undefined;

        return new Hover(hover.hoverMessage, range);
    }

    async show(commit: GitCommit, blameLine: GitCommitLine, editor: TextEditor, line: number) {
        // I have no idea why I need this protection -- but it happens
        if (editor.document === undefined) return;

        if (editor.document.isDirty) {
            const trackedDocument = await Container.tracker.get(editor.document);
            if (trackedDocument !== undefined) {
                trackedDocument.setForceDirtyStateChangeOnNextDocumentChange();
            }
        }

        this.updateStatusBar(commit, editor);
        this.updateTrailingAnnotation(commit, blameLine, editor, line);
    }

    async showAnnotations(editor: TextEditor | undefined, type: LineAnnotationType) {
        this.setBlameAnnotationState(true, type, editor);
    }

    async toggleAnnotations(editor: TextEditor | undefined, type: LineAnnotationType) {
        if (editor === undefined) return;

        const state = this.getBlameAnnotationState();
        this.setBlameAnnotationState(!state.enabled, type, editor);
    }

    private async resumeBlameAnnotations(reason: 'debugging' | 'dirty', editor: TextEditor | undefined, options: { force?: boolean } = {}) {
        if (!options.force && (this._blameAnnotationState === undefined || !this._blameAnnotationState.suspended)) return;

        let refresh = false;
        if (this._blameAnnotationState !== undefined) {
            refresh = this._blameAnnotationState.resume(reason);
        }

        if (editor === undefined || (!options.force && !refresh)) return;

        await this.refresh(editor);
    }

    private async suspendBlameAnnotations(reason: 'debugging' | 'dirty', editor: TextEditor | undefined, options: { force?: boolean } = {}) {
        const state = this.getBlameAnnotationState();

        // If we aren't enabled, suspend doesn't matter
        if (this._blameAnnotationState === undefined && !state.enabled) return false;

        if (this._blameAnnotationState === undefined) {
            this._blameAnnotationState = new AnnotationState(state.enabled, state.annotationType);
        }
        const refresh = this._blameAnnotationState.suspend(reason);

        if (editor === undefined || (!options.force && !refresh)) return;

        await this.refresh(editor);
        return true;
    }

    private async setBlameAnnotationState(enabled: boolean, type: LineAnnotationType, editor: TextEditor | undefined) {
        let refresh = true;
        if (this._blameAnnotationState === undefined) {
            this._blameAnnotationState = new AnnotationState(enabled, type);
        }
        else {
            refresh = this._blameAnnotationState.reset(enabled, type);
        }

        if (editor === undefined || !refresh) return;

        await this.refresh(editor);
    }

    private clearAnnotations(editor: TextEditor | undefined) {
        if (editor === undefined) return;

        editor.setDecorations(annotationDecoration, []);
    }

    private getBlameAnnotationState() {
        if (this._blameAnnotationState !== undefined) return this._blameAnnotationState;

        return {
            enabled: Container.config.blame.line.enabled || Container.config.statusBar.enabled,
            annotationType: Container.config.blame.line.annotationType
        };
    }

    private _updateBlameDebounced: ((line: number, editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>) => void) & IDeferrable;
    private async refresh(editor: TextEditor | undefined, options: { full?: boolean, trackedDocument?: TrackedDocument<GitDocumentState> } = {}) {
        if (editor === undefined && this._editor === undefined) return;

        if (editor === undefined || this._lineTracker.line === undefined) {
            this.clear(this._editor);

            return;
        }

        if (this._editor !== editor) {
            // If we are changing editor, consider this a full refresh
            options.full = true;

            // Clear any annotations on the previously active editor
            this.clearAnnotations(this._editor);

            this._editor = editor;
        }

        const state = this.getBlameAnnotationState();
        if (state.enabled) {
            if (options.trackedDocument === undefined) {
                options.trackedDocument = await Container.tracker.getOrAdd(editor.document);
            }

            if (options.trackedDocument.isBlameable) {
                if (state.enabled && (options.full || this._hoverProviderDisposable === undefined)) {
                    this.registerHoverProviders(editor, state.annotationType === LineAnnotationType.Trailing ? Container.config.annotations.line.trailing.hover : Container.config.annotations.line.hover);
                }

                if (this._updateBlameDebounced === undefined) {
                    this._updateBlameDebounced = Functions.debounce(this.updateBlame, 50, { track: true });
                }
                this._updateBlameDebounced(this._lineTracker.line, editor, options.trackedDocument);

                return;
            }
        }

        await this.clear(editor);
    }

    private registerHoverProviders(editor: TextEditor | undefined, providers: { details: boolean, changes: boolean }) {
        this.unregisterHoverProviders();

        if (editor === undefined) return;
        if (!providers.details && !providers.changes) return;

        const subscriptions: Disposable[] = [];
        if (providers.changes) {
            subscriptions.push(languages.registerHoverProvider({ pattern: editor.document.uri.fsPath }, { provideHover: this.provideChangesHover.bind(this) } as HoverProvider));
        }
        if (providers.details) {
            subscriptions.push(languages.registerHoverProvider({ pattern: editor.document.uri.fsPath }, { provideHover: this.provideDetailsHover.bind(this) } as HoverProvider));
        }

        this._hoverProviderDisposable = Disposable.from(...subscriptions);
    }

    private unregisterHoverProviders() {
        if (this._hoverProviderDisposable !== undefined) {
            this._hoverProviderDisposable.dispose();
            this._hoverProviderDisposable = undefined;
        }
    }

    private async updateBlame(line: number, editor: TextEditor, trackedDocument: TrackedDocument<GitDocumentState>) {
        this._lineTracker.reset();

        // Make sure we are still on the same line and not pending
        if (this._lineTracker.line !== line || this._updateBlameDebounced.pending!()) return;

        const blameLine = editor.document.isDirty
            ? await Container.git.getBlameForLineContents(trackedDocument.uri, line, editor.document.getText())
            : await Container.git.getBlameForLine(trackedDocument.uri, line);

        let commit;
        let commitLine;

        // Make sure we are still on the same line, blameable, and not pending, after the await
        if (this._lineTracker.line === line && trackedDocument.isBlameable && !this._updateBlameDebounced.pending!()) {
            const state = this.getBlameAnnotationState();
            if (state.enabled) {
                commitLine = blameLine === undefined ? undefined : blameLine.line;
                commit = blameLine === undefined ? undefined : blameLine.commit;
            }
        }

        if (this._lineTracker.state === undefined) {
            this._lineTracker.state = new GitLineState(commit);
        }

        if (commit !== undefined && commitLine !== undefined) {
            this.show(commit, commitLine, editor, line);

            return;
        }

        this.clear(editor);
    }

    private updateStatusBar(commit: GitCommit, editor: TextEditor) {
        const cfg = Container.config.statusBar;
        if (!cfg.enabled || this._statusBarItem === undefined || !isTextEditor(editor)) return;

        this._statusBarItem.text = `$(git-commit) ${CommitFormatter.fromTemplate(cfg.format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: cfg.dateFormat === null ? Container.config.defaultDateFormat : cfg.dateFormat
        } as ICommitFormatOptions)}`;

        switch (cfg.command) {
            case StatusBarCommand.ToggleFileBlame:
                this._statusBarItem.tooltip = 'Toggle Blame Annotations';
                break;
            case StatusBarCommand.DiffWithPrevious:
                this._statusBarItem.command = Commands.DiffLineWithPrevious;
                this._statusBarItem.tooltip = 'Compare Line Revision with Previous';
                break;
            case StatusBarCommand.DiffWithWorking:
                this._statusBarItem.command = Commands.DiffLineWithWorking;
                this._statusBarItem.tooltip = 'Compare Line Revision with Working';
                break;
            case StatusBarCommand.ToggleCodeLens:
                this._statusBarItem.tooltip = 'Toggle Git CodeLens';
                break;
            case StatusBarCommand.ShowQuickCommitDetails:
                this._statusBarItem.tooltip = 'Show Commit Details';
                break;
            case StatusBarCommand.ShowQuickCommitFileDetails:
                this._statusBarItem.tooltip = 'Show Line Commit Details';
                break;
            case StatusBarCommand.ShowQuickFileHistory:
                this._statusBarItem.tooltip = 'Show File History';
                break;
            case StatusBarCommand.ShowQuickCurrentBranchHistory:
                this._statusBarItem.tooltip = 'Show Branch History';
                break;
        }

        this._statusBarItem.show();
    }

    private async updateTrailingAnnotation(commit: GitCommit, blameLine: GitCommitLine, editor: TextEditor, line?: number) {
        const cfg = Container.config.blame.line;
        if (!cfg.enabled || cfg.annotationType !== LineAnnotationType.Trailing || !isTextEditor(editor)) return;

        line = line === undefined ? blameLine.line : line;

        const cfgTrailing = Container.config.annotations.line.trailing;
        const decoration = Annotations.trailing(commit, cfgTrailing.format, cfgTrailing.dateFormat === null ? Container.config.defaultDateFormat : cfgTrailing.dateFormat);
        decoration.range = editor.document.validateRange(new Range(line, RangeEndOfLineIndex, line, RangeEndOfLineIndex));

        editor.setDecorations(annotationDecoration, [decoration]);
    }
}