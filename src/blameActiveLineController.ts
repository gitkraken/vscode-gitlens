'use strict';
import { Functions, Objects } from './system';
import { DecorationOptions, DecorationInstanceRenderOptions, DecorationRenderOptions, Disposable, ExtensionContext, Range, StatusBarAlignment, StatusBarItem, TextDocumentChangeEvent, TextEditor, TextEditorDecorationType, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import BlameAnnotationController from './blameAnnotationController';
import BlameAnnotationFormatter, { BlameAnnotationFormat } from './blameAnnotationFormatter';
import { TextDocumentComparer, TextEditorComparer } from './comparers';
import { IBlameConfig, IConfig, StatusBarCommand } from './configuration';
import { DocumentSchemes } from './constants';
import GitProvider, { GitCommit, GitUri, IGitBlame, IGitCommitLine } from './gitProvider';
import * as moment from 'moment';

const activeLineDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

export default class BlameActiveLineController extends Disposable {

    private _activeEditorLineDisposable: Disposable | undefined;
    private _blame: Promise<IGitBlame> | undefined;
    private _config: IConfig;
    private _currentLine: number = -1;
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _editorIsDirty: boolean;
    private _statusBarItem: StatusBarItem | undefined;
    private _updateBlameDebounced: (line: number, editor: TextEditor) => Promise<void>;
    private _uri: GitUri;
    private _useCaching: boolean;

    constructor(context: ExtensionContext, private git: GitProvider, private annotationController: BlameAnnotationController) {
        super(() => this.dispose());

        this._updateBlameDebounced = Functions.debounce(this._updateBlame, 50);

        this._onConfigurationChanged();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(git.onDidRemoveCacheEntry(this._onRemoveCacheEntry, this));
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
            subscriptions.push(window.onDidChangeTextEditorSelection(this._onEditorSelectionChanged, this));
            subscriptions.push(workspace.onDidChangeTextDocument(this._onDocumentChanged, this));

            this._activeEditorLineDisposable = Disposable.from(...subscriptions);
        }
        else if (!trackActiveLine && this._activeEditorLineDisposable) {
            this._activeEditorLineDisposable.dispose();
            this._activeEditorLineDisposable = undefined;
        }

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onBlameAnnotationToggled() {
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onRemoveCacheEntry() {
        this._blame = undefined;
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private _onActiveTextEditorChanged(e: TextEditor) {
        this._currentLine = -1;

        const previousEditor = this._editor;
        previousEditor && previousEditor.setDecorations(activeLineDecoration, []);

        if (!e || !e.document || e.document.isUntitled ||
            (e.document.uri.scheme !== DocumentSchemes.File && e.document.uri.scheme !== DocumentSchemes.Git) ||
            (e.viewColumn === undefined && !this.git.hasGitUriForFile(e))) {
            this.clear(e);

            this._editor = undefined;

            return;
        }

        this._editor = e;
        this._uri = GitUri.fromUri(e.document.uri, this.git);
        const maxLines = this._config.advanced.caching.statusBar.maxLines;
        this._useCaching = this._config.advanced.caching.enabled && (maxLines <= 0 || e.document.lineCount <= maxLines);
        if (this._useCaching) {
            this._blame = this.git.getBlameForFile(this._uri.fsPath, this._uri.sha, this._uri.repoPath);
        }
        else {
            this._blame = undefined;
        }

        this._updateBlame(e.selection.active.line, e);
    }

    private _onEditorSelectionChanged(e: TextEditorSelectionChangeEvent): void {
        // Make sure this is for the editor we are tracking
        if (!TextEditorComparer.equals(e.textEditor, this._editor)) return;

        const line = e.selections[0].active.line;
        if (line === this._currentLine) return;
        this._currentLine = line;

        this._updateBlameDebounced(line, e.textEditor);
    }

    private _onDocumentChanged(e: TextDocumentChangeEvent) {
        // Make sure this is for the editor we are tracking
        if (!this._editor || !TextDocumentComparer.equals(e.document, this._editor.document)) return;

        const line = this._editor.selections[0].active.line;
        if (line === this._currentLine && this._editorIsDirty === this._editor.document.isDirty) return;
        this._currentLine = line;
        this._editorIsDirty = this._editor.document.isDirty;

        this._updateBlame(this._editor.selections[0].active.line, this._editor);
    }

    private async _updateBlame(line: number, editor: TextEditor) {
        line = line - this._uri.offset;

        let commitLine: IGitCommitLine;
        let commit: GitCommit;
        if (line >= 0) {
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

        this._statusBarItem && this._statusBarItem.hide();
    }

    async show(commit: GitCommit, blameLine: IGitCommitLine, editor: TextEditor) {
        if (this._config.statusBar.enabled) {
            this._statusBarItem.text = `$(git-commit) ${commit.author}, ${moment(commit.date).fromNow()}`;

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
                case StatusBarCommand.ShowQuickFileHistory:
                    this._statusBarItem.tooltip = 'Show File History';
                    break;
            }

            this._statusBarItem.show();
        }

        if (this._config.blame.annotation.activeLine !== 'off') {
            let activeLine = this._config.blame.annotation.activeLine;

            // Because the inline annotations can be noisy -- only show them if the document isn't dirty
            if (editor && editor.document && editor.document.isDirty) {
                editor.setDecorations(activeLineDecoration, []);
                switch (activeLine) {
                    case 'both':
                        activeLine = 'hover';
                        break;
                    case 'inline':
                        return;
                }
            }

            const offset = this._uri.offset;

            const config = {
                annotation: {
                    sha: true,
                    author: this._config.statusBar.enabled ? false : this._config.blame.annotation.author,
                    date: this._config.statusBar.enabled ? 'off' : this._config.blame.annotation.date,
                    message: true
                }
            } as IBlameConfig;

            // Escape single quotes because for some reason that breaks the ::before or ::after element
            // https://github.com/Microsoft/vscode/issues/19922 remove once this is released
            const annotation = BlameAnnotationFormatter.getAnnotation(config, commit, BlameAnnotationFormat.Unconstrained).replace(/\'/g, '\\\'');

            // Get the full commit message -- since blame only returns the summary
            let logCommit: GitCommit;
            if (!commit.isUncommitted) {
                const log = await this.git.getLogForFile(this._uri.fsPath, commit.sha, this._uri.repoPath, undefined, 1);
                logCommit = log && log.commits.get(commit.sha);
            }

            let hoverMessage: string | string[];
            if (activeLine !== 'inline') {
                // If the messages match (or we couldn't find the log), then this is a possible duplicate annotation
                const possibleDuplicate = !logCommit || logCommit.message === commit.message;
                // If we don't have a possible dupe or we aren't showing annotations get the hover message
                if (!possibleDuplicate || !this.annotationController.isAnnotating(editor)) {
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
                                color: 'rgba(153, 153, 153, 0.3)',
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