'use strict';
import { Objects } from './system';
import { Disposable, ExtensionContext, StatusBarAlignment, StatusBarItem, TextDocument, TextEditor, TextEditorSelectionChangeEvent, window, workspace } from 'vscode';
import { TextDocumentComparer } from './comparers';
import { IConfig, StatusBarCommand } from './configuration';
import GitProvider, { GitCommit, GitUri, IGitBlame } from './gitProvider';
import * as moment from 'moment';

export default class BlameStatusBarController extends Disposable {
    private _blame: Promise<IGitBlame> | undefined;
    private _config: IConfig;
    private _disposable: Disposable;
    private _document: TextDocument | undefined;
    private _statusBarItem: StatusBarItem | undefined;
    private _statusBarDisposable: Disposable | undefined;
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
        this._statusBarDisposable && this._statusBarDisposable.dispose();
        this._statusBarItem && this._statusBarItem.dispose();
        this._disposable && this._disposable.dispose();
    }

    private _onConfigure() {
        const config = workspace.getConfiguration('').get<IConfig>('gitlens');

        if (!Objects.areEquivalent(config.statusBar, this._config && this._config.statusBar)) {
            this._statusBarDisposable && this._statusBarDisposable.dispose();
            this._statusBarItem && this._statusBarItem.dispose();

            if (config.statusBar.enabled) {
                this._statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 1000);
                switch (config.statusBar.command) {
                    case StatusBarCommand.ToggleCodeLens:
                        if (config.codeLens.visibility !== 'ondemand') {
                            config.statusBar.command = StatusBarCommand.BlameAnnotate;
                        }
                        break;
                }
                this._statusBarItem.command = config.statusBar.command;

                const subscriptions: Disposable[] = [];

                subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
                subscriptions.push(window.onDidChangeTextEditorSelection(this._onActiveSelectionChanged, this));

                this._statusBarDisposable = Disposable.from(...subscriptions);
            }
            else {
                this._statusBarDisposable = undefined;
                this._statusBarItem = undefined;
            }
        }

        this._config = config;

        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    private async _onActiveTextEditorChanged(e: TextEditor): Promise<void> {
        if (!e || !e.document || e.document.isUntitled || (e.viewColumn === undefined && !this.git.hasGitUriForFile(e))) {
            this.clear();
            return;
        }

        this._document = e.document;
        this._uri = GitUri.fromUri(this._document.uri, this.git);
        const maxLines = this._config.advanced.caching.statusBar.maxLines;
        this._useCaching = this._config.advanced.caching.enabled && (maxLines <= 0 || this._document.lineCount <= maxLines);
        if (this._useCaching) {
            this._blame = this.git.getBlameForFile(this._uri.fsPath, this._uri.sha, this._uri.repoPath);
        }
        else {
            this._blame = undefined;
        }

        return this._showBlame(e.selection.active.line);
    }

    private async _onActiveSelectionChanged(e: TextEditorSelectionChangeEvent): Promise<void> {
        if (!TextDocumentComparer.equals(this._document, e.textEditor && e.textEditor.document)) return;

        return this._showBlame(e.selections[0].active.line);
    }

    private async _showBlame(line: number) {
        line = line - this._uri.offset;

        let commit: GitCommit;
        if (line >= 0) {
            if (this._useCaching) {
                const blame = await this._blame;
                if (!blame || !blame.lines.length) {
                    this.clear();
                    return;
                }

                const sha = blame.lines[line].sha;
                commit = blame.commits.get(sha);
            }
            else {
                const blameLine = await this.git.getBlameForLine(this._uri.fsPath, line, this._uri.sha, this._uri.repoPath);
                commit = blameLine && blameLine.commit;
            }
        }

        if (commit) {
            this.show(commit);
        }
        else {
            this.clear();
        }
    }

    clear() {
        this._statusBarItem && this._statusBarItem.hide();
        this._document = undefined;
        this._blame = undefined;
    }

    show(commit: GitCommit) {
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
}