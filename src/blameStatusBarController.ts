'use strict';
import { Objects } from './system';
import { Disposable, ExtensionContext, StatusBarAlignment, StatusBarItem, TextEditor, window, workspace } from 'vscode';
import { IConfig, IStatusBarConfig, StatusBarCommand } from './configuration';
import { WorkspaceState } from './constants';
import GitProvider, { IGitBlameLine } from './gitProvider';
import * as moment from 'moment';

export default class BlameStatusBarController extends Disposable {
    private _config: IStatusBarConfig;
    private _disposable: Disposable;
    private _statusBarItem: StatusBarItem|null;
    private _statusBarDisposable: Disposable|null;

    constructor(private context: ExtensionContext, private git: GitProvider) {
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

        if (!Objects.areEquivalent(config.statusBar, this._config)) {
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
                    case StatusBarCommand.GitViewHistory:
                        if (!this.context.workspaceState.get(WorkspaceState.HasGitHistoryExtension, false)) {
                            config.statusBar.command = StatusBarCommand.BlameExplorer;
                        }
                        break;
                }
                this._statusBarItem.command = config.statusBar.command;

                const subscriptions: Disposable[] = [];

                subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveSelectionChanged, this));
                subscriptions.push(window.onDidChangeTextEditorSelection(e => this._onActiveSelectionChanged(e.textEditor)));

                this._statusBarDisposable = Disposable.from(...subscriptions);
            } else {
                this._statusBarDisposable = null;
                this._statusBarItem = null;
            }
        }

        this._config = config.statusBar;
    }

    private async _onActiveSelectionChanged(editor: TextEditor): Promise<void> {
        if (!editor || !editor.document || editor.document.isUntitled) {
            this.clear();
            return;
        }

        const blame = await this.git.getBlameForLine(editor.document.uri.fsPath, editor.selection.active.line);
        if (blame) {
            this.show(blame);
        }
        else {
            this.clear();
        }
    }

    clear() {
        this._statusBarItem && this._statusBarItem.hide();
    }

    show(blameLine: IGitBlameLine) {
        const commit = blameLine.commit;
        this._statusBarItem.text = `$(git-commit) ${commit.author}, ${moment(commit.date).fromNow()}`;
        //this._statusBarItem.tooltip = [`Last changed by ${commit.author}`, moment(commit.date).format('MMMM Do, YYYY h:MMa'), '', commit.message].join('\n');

        switch (this._config.command) {
            case StatusBarCommand.BlameAnnotate:
                this._statusBarItem.tooltip = 'Toggle Blame Annotations';
                break;
            case StatusBarCommand.BlameExplorer:
                this._statusBarItem.tooltip = 'Open Blame History';
                break;
            case StatusBarCommand.DiffWithPrevious:
                this._statusBarItem.tooltip = 'Compare to Previous Commit';
                break;
            case StatusBarCommand.ToggleCodeLens:
                this._statusBarItem.tooltip = 'Toggle Blame CodeLens';
                break;
            case StatusBarCommand.GitViewHistory:
                this._statusBarItem.tooltip = 'View Git File History';
                break;
        }

        this._statusBarItem.show();
    }
}