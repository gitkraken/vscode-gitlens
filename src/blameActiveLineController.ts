'use strict';
import { Functions, Objects } from './system';
import { DecorationOptions, DecorationInstanceRenderOptions, DecorationRenderOptions, Disposable, ExtensionContext, Range, StatusBarAlignment, StatusBarItem, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { BlameabilityChangeEvent, BlameabilityTracker } from './blameabilityTracker';
import { BlameAnnotationController } from './blameAnnotationController';
import { BlameAnnotationFormat, BlameAnnotationFormatter } from './blameAnnotationFormatter';
import { TextEditorComparer } from './comparers';
import { IBlameConfig, IConfig, StatusBarCommand } from './configuration';
import { DocumentSchemes } from './constants';
import { GitCommit, GitProvider, GitUri, IGitBlame, IGitCommitLine } from './gitProvider';
import * as moment from 'moment';

const activeLineDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

export class BlameActiveLineController extends Disposable {

    private _activeEditorLineDisposable: Disposable | undefined;
    private _blame: Promise<IGitBlame> | undefined;
    private _blameable: boolean;
    private _config: IConfig;
    private _currentLine: number = -1;
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _statusBarItem: StatusBarItem | undefined;
    private _updateBlameDebounced: (line: number, editor: TextEditor) => Promise<void>;
    private _uri: GitUri;
    private _useCaching: boolean;

    constructor(context: ExtensionContext, private git: GitProvider, private blameabilityTracker: BlameabilityTracker, private annotationController: BlameAnnotationController) {
        super(() => this.dispose());

        this._updateBlameDebounced = Functions.debounce(this._updateBlame, 50);

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(git.onDidChangeGitCache(this._onGitCacheChanged, this));
        subscriptions.push(annotationController.onDidToggleBlameAnnotations(this._onBlameAnnotationToggled, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._editor && this._editor.setDecorations(activeLineDecoration, []);

        this._activeEditorLineDisposable && this._activeEditorLineDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigurationChanged() {
        const config = workspace.getConfiguration('').get<IConfig>('gitlens');

        let changed: boolean = false;

        if (!Objects.areEquivalent(config.statusBar, this._config && this._config.statusBar)) {
            changed = true;
            if (config.statusBar.enabled) {
                this._statusBarItem = this._statusBarItem || window.createStatusBarItem(StatusBarAlignment.Right, 1000);
                switch (config.statusBar.command) {
                    case StatusBarCommand.ToggleCodeLens:
                        if (config.codeLens.visibility !== 'ondemand') {
                            config.statusBar.command = StatusBarCommand.BlameAnnotate;
                        }
                        break;
                }
                this._statusBarItem.command = config.statusBar.command;
            }
            else if (!config.statusBar.enabled && this._statusBarItem) {
                this._statusBarItem.dispose();
                this._statusBarItem = undefined;
            }
        }

        if (!Objects.areEquivalent(config.blame.annotation.activeLine, this._config && this._config.blame.annotation.activeLine)) {
            changed = true;
            if (config.blame.annotation.activeLine !== 'off' && this._editor) {
                this._editor.setDecorations(activeLineDecoration, []);
            }
        }

        this._config = config;

        if (!changed) return;

        let trackActiveLine = config.statusBar.enabled || config.blame.annotation.activeLine !== 'off';
        if (trackActiveLine && !this._activeEditorLineDisposable) {
            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
            subscriptions.push(window.onDidChangeTextEditorSelection(this._onTextEditorSelectionChanged, this));
            subscriptions.push(this.blameabilityTracker.onDidChange(this._onBlameabilityChanged, this));

            this._activeEditorLineDisposable = Disposable.from(...subscriptions);
        }
        else if (!trackActiveLine && this._activeEditorLineDisposable) {
            this._activeEditorLineDisposable.dispose();
            this._activeEditorLineDisposable = undefined;
        }

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private isEditorBlameable(editor: TextEditor): boolean {
        if (!editor || !editor.document) return false;

        const scheme = editor.document.uri.scheme;
        if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Git && scheme !== DocumentSchemes.GitLensGit) return false;

        if (editor.document.isUntitled && scheme !== DocumentSchemes.Git && scheme !== DocumentSchemes.GitLensGit) return false;

        return this.git.isEditorBlameable(editor);
    }

    private async _onActiveTextEditorChanged(editor: TextEditor) {
        this._currentLine = -1;

        const previousEditor = this._editor;
        previousEditor && previousEditor.setDecorations(activeLineDecoration, []);

        if (!this.isEditorBlameable(editor)) {
            this.clear(editor);

            this._editor = undefined;

            return;
        }

        this._blameable = editor && editor.document && !editor.document.isDirty;
        this._editor = editor;
        this._uri = await GitUri.fromUri(editor.document.uri, this.git);
        const maxLines = this._config.advanced.caching.statusBar.maxLines;
        this._useCaching = this._config.advanced.caching.enabled && (maxLines <= 0 || editor.document.lineCount <= maxLines);
        if (this._useCaching) {
            this._blame = this.git.getBlameForFile(this._uri.fsPath, this._uri.sha, this._uri.repoPath);
        }
        else {
            this._blame = undefined;
        }

        this._updateBlame(editor.selection.active.line, editor);
    }

    private _onBlameabilityChanged(e: BlameabilityChangeEvent) {
        this._blameable = e.blameable;
        if (!e.blameable || !this._editor) {
            this.clear(e.editor);
            return;
        }

        // Make sure this is for the editor we are tracking
        if (!TextEditorComparer.equals(this._editor, e.editor)) return;

        this._updateBlame(this._editor.selection.active.line, this._editor);
    }

    private _onBlameAnnotationToggled() {
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onGitCacheChanged() {
        this._blame = undefined;
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onTextEditorSelectionChanged(e: TextEditorSelectionChangeEvent): void {
        // Make sure this is for the editor we are tracking
        if (!this._blameable || !TextEditorComparer.equals(this._editor, e.textEditor)) return;

        const line = e.selections[0].active.line;
        if (line === this._currentLine) return;
        this._currentLine = line;

        this._updateBlameDebounced(line, e.textEditor);
    }

    private async _updateBlame(line: number, editor: TextEditor) {
        line = line - this._uri.offset;

        let commit: GitCommit;
        let commitLine: IGitCommitLine;
        // Since blame information isn't valid when there are unsaved changes -- don't show any status
        if (this._blameable && line >= 0) {
            if (this._useCaching) {
                const blame = this._blame && await this._blame;
                if (!blame || !blame.lines.length) {
                    this.clear(editor);
                    return;
                }

                commitLine = blame.lines[line];
                const sha = commitLine && commitLine.sha;
                commit = sha && blame.commits.get(sha);
            }
            else {
                const blameLine = await this.git.getBlameForLine(this._uri.fsPath, line, this._uri.sha, this._uri.repoPath);
                commitLine = blameLine && blameLine.line;
                commit = blameLine && blameLine.commit;
            }
        }

        if (commit) {
            this.show(commit, commitLine, editor);
        }
        else {
            this.clear(editor);
        }
    }

    clear(editor: TextEditor, previousEditor?: TextEditor) {
        editor && editor.setDecorations(activeLineDecoration, []);
        // I have no idea why the decorators sometimes don't get removed, but if they don't try again with a tiny delay
        if (editor) {
            setTimeout(() => editor.setDecorations(activeLineDecoration, []), 1);
        }

        this._statusBarItem && this._statusBarItem.hide();
    }

    async show(commit: GitCommit, blameLine: IGitCommitLine, editor: TextEditor) {
        // I have no idea why I need this protection -- but it happens
        if (!editor.document) return;

        if (this._config.statusBar.enabled) {
            switch (this._config.statusBar.date) {
                case 'off':
                    this._statusBarItem.text = `$(git-commit) ${commit.author}`;
                    break;
                case 'absolute':
                    const dateFormat = this._config.statusBar.dateFormat || 'MMMM Do, YYYY h:MMa';
                    let date: string;
                    try {
                        date = moment(commit.date).format(dateFormat);
                    } catch (ex) {
                        date = moment(commit.date).format('MMMM Do, YYYY h:MMa');
                    }
                    this._statusBarItem.text = `$(git-commit) ${commit.author}, ${date}`;
                    break;
                default:
                    this._statusBarItem.text = `$(git-commit) ${commit.author}, ${moment(commit.date).fromNow()}`;
                    break;
            }

            switch (this._config.statusBar.command) {
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
                    this._statusBarItem.tooltip = 'Compare with Previous Commit';
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
                case StatusBarCommand.ShowQuickFileHistory:
                    this._statusBarItem.tooltip = 'Show Repository History';
                    break;
            }

            this._statusBarItem.show();
        }

        if (this._config.blame.annotation.activeLine !== 'off') {
            const activeLine = this._config.blame.annotation.activeLine;
            const offset = this._uri.offset;

            const config = {
                annotation: {
                    sha: true,
                    author: this._config.statusBar.enabled ? false : this._config.blame.annotation.author,
                    date: this._config.statusBar.enabled ? 'off' : this._config.blame.annotation.date,
                    message: true
                }
            } as IBlameConfig;

            const annotation = BlameAnnotationFormatter.getAnnotation(config, commit, BlameAnnotationFormat.Unconstrained);

            // Get the full commit message -- since blame only returns the summary
            let logCommit: GitCommit;
            if (!commit.isUncommitted) {
                const log = await this.git.getLogForFile(this._uri.fsPath, commit.sha, this._uri.repoPath, undefined, 1);
                logCommit = log && log.commits.get(commit.sha);
            }

            // I have no idea why I need this protection -- but it happens
            if (!editor.document) return;

            let hoverMessage: string | string[];
            if (activeLine !== 'inline') {
                // If the messages match (or we couldn't find the log), then this is a possible duplicate annotation
                const possibleDuplicate = !logCommit || logCommit.message === commit.message;
                // If we don't have a possible dupe or we aren't showing annotations get the hover message
                if (!commit.isUncommitted && (!possibleDuplicate || !this.annotationController.isAnnotating(editor))) {
                    hoverMessage = BlameAnnotationFormatter.getAnnotationHover(config, blameLine, logCommit || commit);
                }
            }

            let decorationOptions: DecorationOptions;
            switch (activeLine) {
                case 'both':
                case 'inline':
                    decorationOptions = {
                        range: editor.document.validateRange(new Range(blameLine.line + offset, 0, blameLine.line + offset, 1000000)),
                        hoverMessage: hoverMessage,
                        renderOptions: {
                            after: {
                                color: 'rgba(153, 153, 153, 0.35)',
                                contentText: annotation
                            }
                        } as DecorationInstanceRenderOptions
                    } as DecorationOptions;
                    break;

                case 'hover':
                    decorationOptions = {
                        range: editor.document.validateRange(new Range(blameLine.line + offset, 0, blameLine.line + offset, 1000000)),
                        hoverMessage: hoverMessage
                    } as DecorationOptions;
                    break;
            }

            decorationOptions && editor.setDecorations(activeLineDecoration, [decorationOptions]);
        }
    }
}