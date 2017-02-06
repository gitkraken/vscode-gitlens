'use strict';
import { Objects } from './system';
import { DecorationOptions, DecorationInstanceRenderOptions, DecorationRenderOptions, Disposable, ExtensionContext, Range, StatusBarAlignment, StatusBarItem, TextEditorDecorationType, TextEditor, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import BlameAnnotationFormatter, { BlameAnnotationFormat } from './blameAnnotationFormatter';
import { TextEditorComparer } from './comparers';
import { IBlameConfig, IConfig, StatusBarCommand } from './configuration';
import { DocumentSchemes } from './constants';
import GitProvider, { GitCommit, GitUri, IGitBlame, IGitCommitLine } from './gitProvider';
import { Logger } from './logger';
import * as moment from 'moment';

const activeLineDecoration: TextEditorDecorationType = window.createTextEditorDecorationType({
    after: {
        margin: '0 0 0 4em'
    }
} as DecorationRenderOptions);

export default class BlameStatusBarController extends Disposable {

    private _activeEditorLineDisposable: Disposable | undefined;
    private _blame: Promise<IGitBlame> | undefined;
    private _config: IConfig;
    private _disposable: Disposable;
    private _editor: TextEditor | undefined;
    private _statusBarItem: StatusBarItem | undefined;
    private _uri: GitUri;
    private _useCaching: boolean;

    constructor(context: ExtensionContext, private git: GitProvider) {
        super(() => this.dispose());

        this._onConfigure();

        const subscriptions: Disposable[] = [];

        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigure, this));

        this._disposable = Disposable.from(...subscriptions);
    }

    dispose() {
        this._editor && this._editor.setDecorations(activeLineDecoration, []);

        this._activeEditorLineDisposable && this._activeEditorLineDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigure() {
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
            if (!config.blame.annotation.activeLine.enabled && this._editor) {
                this._editor.setDecorations(activeLineDecoration, []);
            }
        }

        this._config = config;

        if (!changed) return;

        let trackActiveLine = config.statusBar.enabled || config.blame.annotation.activeLine.enabled;
        if (trackActiveLine && !this._activeEditorLineDisposable) {
            const subscriptions: Disposable[] = [];

            subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
            subscriptions.push(window.onDidChangeTextEditorSelection(this._onActiveSelectionChanged, this));

            this._activeEditorLineDisposable = Disposable.from(...subscriptions);
        }
        else if (!trackActiveLine && this._activeEditorLineDisposable) {
            this._activeEditorLineDisposable.dispose();
            this._activeEditorLineDisposable = undefined;
        }

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private async _onActiveTextEditorChanged(e: TextEditor): Promise<void> {
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

        return await this._showBlame(e.selection.active.line, e);
    }

    private async _onActiveSelectionChanged(e: TextEditorSelectionChangeEvent): Promise<void> {
        if (!TextEditorComparer.equals(e.textEditor, this._editor)) return;

        return await this._showBlame(e.selections[0].active.line, e.textEditor);
    }

    private async _showBlame(line: number, editor: TextEditor) {
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

                try {
                    commitLine = blame.lines[line];
                    const sha = commitLine.sha;
                    commit = blame.commits.get(sha);
                }
                catch (ex) {
                    Logger.error(`DEBUG(${this._uri.toString()}): Line ${line} not found in blame; lines=${blame.lines.length}, uriOffset=${this._uri.offset}, repoPath=${blame.repoPath}`);
                    throw ex;
                }
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

    show(commit: GitCommit, blameLine: IGitCommitLine, editor: TextEditor) {
        if (this._config.statusBar.enabled) {
            this._statusBarItem.text = `$(git-commit) ${commit.author}, ${moment(commit.date).fromNow()}`;

            switch (this._config.statusBar.command) {
                case StatusBarCommand.BlameAnnotate:
                    this._statusBarItem.tooltip = 'Toggle Blame Annotations';
                    break;
                case StatusBarCommand.ShowBlameHistory:
                    this._statusBarItem.tooltip = 'Open Blame History';
                    break;
                case StatusBarCommand.ShowFileHistory:
                    this._statusBarItem.tooltip = 'Open File History';
                    break;
                case StatusBarCommand.DiffWithPrevious:
                    this._statusBarItem.tooltip = 'Compare to Previous Commit';
                    break;
                case StatusBarCommand.ToggleCodeLens:
                    this._statusBarItem.tooltip = 'Toggle Blame CodeLens';
                    break;
                case StatusBarCommand.ShowQuickFileHistory:
                    this._statusBarItem.tooltip = 'View Git File History';
                    break;
            }

            this._statusBarItem.show();
        }

        if (this._config.blame.annotation.activeLine.enabled) {
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
            const annotation = BlameAnnotationFormatter.getAnnotation(config, commit, BlameAnnotationFormat.Unconstrained).replace(/\'/g, '\\\'');
            const hoverMessage = BlameAnnotationFormatter.getAnnotationHover(config, blameLine, commit);

            const decorationOptions = {
                range: editor.document.validateRange(new Range(blameLine.line + offset, 1000000, blameLine.line + offset, 1000000)),
                hoverMessage: hoverMessage,
                renderOptions: {
                    after: {
                        color: 'rgba(153, 153, 153, 0.3)',
                        contentText: annotation
                    }
                } as DecorationInstanceRenderOptions
            } as DecorationOptions;

            editor.setDecorations(activeLineDecoration, [decorationOptions]);
        }
    }
}