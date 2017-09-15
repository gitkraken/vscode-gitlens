'use strict';
import { Functions, Objects } from './system';
import { debug, DecorationOptions, DecorationRenderOptions, Disposable, ExtensionContext, Range, StatusBarAlignment, StatusBarItem, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { AnnotationController, FileAnnotationType } from './annotations/annotationController';
import { Annotations, endOfLineIndex } from './annotations/annotations';
import { Commands } from './commands';
import { TextEditorComparer } from './comparers';
import { IConfig, StatusBarCommand } from './configuration';
import { DocumentSchemes, ExtensionKey } from './constants';
import { BlameabilityChangeEvent, CommitFormatter, GitCommit, GitCommitLine, GitContextTracker, GitService, GitUri, ICommitFormatOptions } from './gitService';
import { Logger } from './logger';

const annotationDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 3em',
        textDecoration: 'none'
    }
} as DecorationRenderOptions);

export type LineAnnotationType = 'trailing' | 'hover';
export const LineAnnotationType = {
    Trailing: 'trailing' as LineAnnotationType,
    Hover: 'hover' as LineAnnotationType
};

export class CurrentLineController extends Disposable {

    private _blameable: boolean;
    private _blameLineAnnotationState: { enabled: boolean, annotationType: LineAnnotationType, reason: 'user' | 'debugging' } | undefined = undefined;
    private _config: IConfig;
    private _currentLine: number = -1;
    private _debugSessionEndDisposable: Disposable | undefined;
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _isAnnotating: boolean = false;
    private _statusBarItem: StatusBarItem | undefined;
    private _trackCurrentLineDisposable: Disposable | undefined;
    private _updateBlameDebounced: (line: number, editor: TextEditor) => Promise<void>;
    private _uri: GitUri;

    constructor(context: ExtensionContext, private git: GitService, private gitContextTracker: GitContextTracker, private annotationController: AnnotationController) {
        super(() => this.dispose());

        this._updateBlameDebounced = Functions.debounce(this._updateBlame, 250);

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(git.onDidChangeGitCache(this._onGitCacheChanged, this));
        subscriptions.push(annotationController.onDidToggleAnnotations(this._onFileAnnotationsToggled, this));
        subscriptions.push(debug.onDidStartDebugSession(this._onDebugSessionStarted, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._clearAnnotations(this._editor, true);

        this._trackCurrentLineDisposable && this._trackCurrentLineDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();
        this._debugSessionEndDisposable && this._debugSessionEndDisposable.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        const cfg = workspace.getConfiguration().get<IConfig>(ExtensionKey)!;

        let changed = false;

        if (!Objects.areEquivalent(cfg.blame.line, this._config && this._config.blame.line)) {
            changed = true;
            this._blameLineAnnotationState = undefined;

            this._clearAnnotations(this._editor);
        }

        if (!Objects.areEquivalent(cfg.annotations.line.trailing, this._config && this._config.annotations.line.trailing) ||
            !Objects.areEquivalent(cfg.annotations.line.hover, this._config && this._config.annotations.line.hover) ||
            !Objects.areEquivalent(cfg.theme.annotations.line.trailing, this._config && this._config.theme.annotations.line.trailing)) {
            changed = true;
            this._clearAnnotations(this._editor);
        }

        if (!Objects.areEquivalent(cfg.statusBar, this._config && this._config.statusBar)) {
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
            else if (!cfg.statusBar.enabled && this._statusBarItem) {
                this._statusBarItem.dispose();
                this._statusBarItem = undefined;
            }
        }

        this._config = cfg;

        if (!changed) return;

        const trackCurrentLine = cfg.statusBar.enabled || cfg.blame.line.enabled || (this._blameLineAnnotationState && this._blameLineAnnotationState.enabled);
        if (trackCurrentLine && !this._trackCurrentLineDisposable) {
            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
            subscriptions.push(window.onDidChangeTextEditorSelection(this._onTextEditorSelectionChanged, this));
            subscriptions.push(this.gitContextTracker.onDidChangeBlameability(this._onBlameabilityChanged, this));

            this._trackCurrentLineDisposable = Disposable.from(...subscriptions);
        }
        else if (!trackCurrentLine && this._trackCurrentLineDisposable) {
            this._trackCurrentLineDisposable.dispose();
            this._trackCurrentLineDisposable = undefined;
        }

        this.refresh(window.activeTextEditor);
    }

    private _onActiveTextEditorChanged(editor?: TextEditor) {
        this.refresh(editor);
    }

    private _onBlameabilityChanged(e: BlameabilityChangeEvent) {
        this._blameable = e.blameable;
        if (!e.blameable || !this._editor) {
            this.clear(e.editor);
            return;
        }

        // Make sure this is for the editor we are tracking
        if (!TextEditorComparer.equals(this._editor, e.editor)) return;

        this._updateBlameDebounced(this._editor.selection.active.line, this._editor);
    }

    private _onDebugSessionStarted() {
        const state = this._blameLineAnnotationState !== undefined ? this._blameLineAnnotationState : this._config.blame.line;
        if (!state.enabled) return;

        this._debugSessionEndDisposable = debug.onDidTerminateDebugSession(this._onDebugSessionEnded, this);
        this.toggleAnnotations(window.activeTextEditor, state.annotationType, 'debugging');
    }

    private _onDebugSessionEnded() {
        this._debugSessionEndDisposable && this._debugSessionEndDisposable.dispose();
        this._debugSessionEndDisposable = undefined;

        if (this._blameLineAnnotationState === undefined || this._blameLineAnnotationState.enabled || this._blameLineAnnotationState.reason !== 'debugging') return;

        this.toggleAnnotations(window.activeTextEditor, this._blameLineAnnotationState.annotationType);
    }

    private _onFileAnnotationsToggled() {
        this.refresh(window.activeTextEditor);
    }

    private _onGitCacheChanged() {
        Logger.log('Git cache changed; resetting current line annotations');
        this.refresh(window.activeTextEditor);
    }

    private async _onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent): Promise<void> {
        // Make sure this is for the editor we are tracking
        if (!this._blameable || !TextEditorComparer.equals(this._editor, e.textEditor)) return;

        const line = e.selections[0].active.line;
        if (line === this._currentLine) return;

        this._currentLine = line;

        if (!this._uri && e.textEditor !== undefined) {
            this._uri = await GitUri.fromUri(e.textEditor.document.uri, this.git);
        }

        this._clearAnnotations(e.textEditor);
        this._updateBlameDebounced(line, e.textEditor);
    }

    private _isEditorBlameable(editor: TextEditor | undefined): boolean {
        if (editor === undefined || editor.document === undefined) return false;

        if (!this.git.isTrackable(editor.document.uri)) return false;
        if (editor.document.isUntitled && editor.document.uri.scheme === DocumentSchemes.File) return false;

        return this.git.isEditorBlameable(editor);
    }

    private async _updateBlame(line: number, editor: TextEditor) {
        line = line - this._uri.offset;

        let commit: GitCommit | undefined = undefined;
        let commitLine: GitCommitLine | undefined = undefined;
        // Since blame information isn't valid when there are unsaved changes -- don't show any status
        if (this._blameable && line >= 0) {
            const blameLine = await this.git.getBlameForLine(this._uri, line);
            commitLine = blameLine === undefined ? undefined : blameLine.line;
            commit = blameLine === undefined ? undefined : blameLine.commit;
        }

        if (commit !== undefined && commitLine !== undefined) {
            this.show(commit, commitLine, editor, line);
        }
        else {
            this.clear(editor);
        }
    }

    async clear(editor: TextEditor | undefined) {
        this._clearAnnotations(editor, true);
        this._statusBarItem && this._statusBarItem.hide();
    }

    private async _clearAnnotations(editor: TextEditor | undefined, force: boolean = false) {
        if (editor === undefined || (!this._isAnnotating && !force)) return;

        editor.setDecorations(annotationDecoration, []);
        this._isAnnotating = false;

        if (!force) return;

        // I have no idea why the decorators sometimes don't get removed, but if they don't try again with a tiny delay
        await Functions.wait(1);
        editor.setDecorations(annotationDecoration, []);
    }

    async refresh(editor?: TextEditor) {
        this._currentLine = -1;
        this._clearAnnotations(this._editor);

        if (editor === undefined || !this._isEditorBlameable(editor)) {
            this.clear(editor);
            this._editor = undefined;

            return;
        }

        this._blameable = editor !== undefined && editor.document !== undefined && !editor.document.isDirty;
        this._editor = editor;
        this._uri = await GitUri.fromUri(editor.document.uri, this.git);

        const maxLines = this._config.advanced.caching.maxLines;
        // If caching is on and the file is small enough -- kick off a blame for the whole file
        if (this._config.advanced.caching.enabled && (maxLines <= 0 || editor.document.lineCount <= maxLines)) {
            this.git.getBlameForFile(this._uri);
        }

        this._updateBlameDebounced(editor.selection.active.line, editor);
    }

    async show(commit: GitCommit, blameLine: GitCommitLine, editor: TextEditor, line: number) {
        // I have no idea why I need this protection -- but it happens
        if (editor.document === undefined) return;

        this._updateStatusBar(commit);
        await this._updateAnnotations(commit, blameLine, editor, line);
    }

    async showAnnotations(editor: TextEditor | undefined, type: LineAnnotationType, reason: 'user' | 'debugging' = 'user') {
        if (editor === undefined) return;

        const state = this._blameLineAnnotationState !== undefined ? this._blameLineAnnotationState : this._config.blame.line;
        if (!state.enabled || state.annotationType !== type) {
            this._blameLineAnnotationState = { enabled: true, annotationType: type, reason: reason };

            await this._clearAnnotations(editor);
            await this._updateBlame(editor.selection.active.line, editor);
        }
    }

    async toggleAnnotations(editor: TextEditor | undefined, type: LineAnnotationType, reason: 'user' | 'debugging' = 'user') {
        if (editor === undefined) return;

        const state = this._blameLineAnnotationState !== undefined ? this._blameLineAnnotationState : this._config.blame.line;
        this._blameLineAnnotationState = { enabled: !state.enabled, annotationType: type, reason: reason };

        await this._clearAnnotations(editor);
        await this._updateBlame(editor.selection.active.line, editor);
    }

    private async _updateAnnotations(commit: GitCommit, blameLine: GitCommitLine, editor: TextEditor, line?: number) {
        const cfg = this._config.blame.line;

        const state = this._blameLineAnnotationState !== undefined ? this._blameLineAnnotationState : cfg;
        if (!state.enabled) return;

        line = line === undefined ? blameLine.line + this._uri.offset : line;

        const decorationOptions: DecorationOptions[] = [];

        let showChanges = false;
        let showChangesStartIndex = 0;
        let showChangesInStartingWhitespace = false;

        let showDetails = false;
        let showDetailsStartIndex = 0;
        let showDetailsInStartingWhitespace = false;

        switch (state.annotationType) {
            case LineAnnotationType.Trailing: {
                const cfgAnnotations = this._config.annotations.line.trailing;

                showChanges = cfgAnnotations.hover.changes;
                showDetails = cfgAnnotations.hover.details;

                if (cfgAnnotations.hover.wholeLine) {
                    showChangesStartIndex = 0;
                    showChangesInStartingWhitespace = false;

                    showDetailsStartIndex = 0;
                    showDetailsInStartingWhitespace = false;
                }
                else {
                    showChangesStartIndex = endOfLineIndex;
                    showChangesInStartingWhitespace = true;

                    showDetailsStartIndex = endOfLineIndex;
                    showDetailsInStartingWhitespace = true;
                }

                const decoration = Annotations.trailing(commit, cfgAnnotations.format, cfgAnnotations.dateFormat === null ? this._config.defaultDateFormat : cfgAnnotations.dateFormat, this._config.theme);
                decoration.range = editor.document.validateRange(new Range(line, endOfLineIndex, line, endOfLineIndex));
                decorationOptions.push(decoration);

                break;
            }
            case LineAnnotationType.Hover: {
                const cfgAnnotations = this._config.annotations.line.hover;

                showChanges = cfgAnnotations.changes;
                showChangesStartIndex = 0;
                showChangesInStartingWhitespace = false;

                showDetails = cfgAnnotations.details;
                showDetailsStartIndex = 0;
                showDetailsInStartingWhitespace = false;

                break;
            }
        }

        if (showDetails || showChanges) {
            const annotationType = this.annotationController.getAnnotationType(editor);

            const firstNonWhitespace = editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;

            switch (annotationType) {
                case FileAnnotationType.Gutter: {
                    const cfgHover = this._config.annotations.file.gutter.hover;
                    if (cfgHover.details) {
                        showDetailsInStartingWhitespace = false;
                        if (cfgHover.wholeLine) {
                            // Avoid double annotations if we are showing the whole-file hover blame annotations
                            showDetails = false;
                        }
                        else {
                            if (showDetailsStartIndex === 0) {
                                showDetailsStartIndex = firstNonWhitespace === 0 ? 1 : firstNonWhitespace;
                            }
                            if (showChangesStartIndex === 0) {
                                showChangesInStartingWhitespace = true;
                                showChangesStartIndex = firstNonWhitespace === 0 ? 1 : firstNonWhitespace;
                            }
                        }
                    }

                    break;
                }
                case FileAnnotationType.Hover: {
                    const cfgHover = this._config.annotations.file.hover;
                    showDetailsInStartingWhitespace = false;
                    if (cfgHover.wholeLine) {
                        // Avoid double annotations if we are showing the whole-file hover blame annotations
                        showDetails = false;
                        showChangesStartIndex = 0;
                    }
                    else {
                        if (showDetailsStartIndex === 0) {
                            showDetailsStartIndex = firstNonWhitespace === 0 ? 1 : firstNonWhitespace;
                        }
                        if (showChangesStartIndex === 0) {
                            showChangesInStartingWhitespace = true;
                            showChangesStartIndex = firstNonWhitespace === 0 ? 1 : firstNonWhitespace;
                        }
                    }

                    break;
                }
                case FileAnnotationType.RecentChanges: {
                    const cfgChanges = this._config.annotations.file.recentChanges.hover;
                    if (cfgChanges.details) {
                        if (cfgChanges.wholeLine) {
                            // Avoid double annotations if we are showing the whole-file hover blame annotations
                            showDetails = false;
                        }
                        else {
                            showDetailsInStartingWhitespace = false;
                        }
                    }

                    if (cfgChanges.changes) {
                        if (cfgChanges.wholeLine) {
                            // Avoid double annotations if we are showing the whole-file hover blame annotations
                            showChanges = false;
                        }
                        else {
                            showChangesInStartingWhitespace = false;
                        }
                    }

                    break;
                }
            }

            if (showDetails) {
                // Get the full commit message -- since blame only returns the summary
                let logCommit: GitCommit | undefined = undefined;
                if (!commit.isUncommitted) {
                    logCommit = await this.git.getLogCommit(this._uri.repoPath, this._uri.fsPath, commit.sha);
                }

                // I have no idea why I need this protection -- but it happens
                if (editor.document === undefined) return;

                const decoration = Annotations.detailsHover(logCommit || commit, this._config.defaultDateFormat, this.git.hasRemotes((logCommit || commit).repoPath));
                decoration.range = editor.document.validateRange(new Range(line, showDetailsStartIndex, line, endOfLineIndex));
                decorationOptions.push(decoration);

                if (showDetailsInStartingWhitespace && showDetailsStartIndex !== 0 && decoration.range.end.character !== 0) {
                    decorationOptions.push(Annotations.withRange(decoration, 0, firstNonWhitespace));
                }
            }

            if (showChanges) {
                const decoration = await Annotations.changesHover(commit, line, this._uri, this.git);

                // I have no idea why I need this protection -- but it happens
                if (editor.document === undefined) return;

                decoration.range = editor.document.validateRange(new Range(line, showChangesStartIndex, line, endOfLineIndex));
                decorationOptions.push(decoration);

                if (showChangesInStartingWhitespace && showChangesStartIndex !== 0 && decoration.range.end.character !== 0) {
                    decorationOptions.push(Annotations.withRange(decoration, 0, firstNonWhitespace));
                }
            }
        }

        if (decorationOptions.length) {
            editor.setDecorations(annotationDecoration, decorationOptions);
            this._isAnnotating = true;
        }
    }

    private _updateStatusBar(commit: GitCommit) {
        const cfg = this._config.statusBar;
        if (!cfg.enabled || this._statusBarItem === undefined) return;

        this._statusBarItem.text = `$(git-commit) ${CommitFormatter.fromTemplate(cfg.format, commit, {
            truncateMessageAtNewLine: true,
            dateFormat: cfg.dateFormat === null ? this._config.defaultDateFormat : cfg.dateFormat
        } as ICommitFormatOptions)}`;

        switch (cfg.command) {
            case StatusBarCommand.BlameAnnotate:
                this._statusBarItem.tooltip = 'Toggle Blame Annotations';
                break;
            case StatusBarCommand.ShowBlameHistory:
                this._statusBarItem.tooltip = 'Open Blame History Explorer';
                break;
            case StatusBarCommand.ShowFileHistory:
                this._statusBarItem.tooltip = 'Open File History Explorer';
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
}