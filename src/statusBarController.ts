'use strict';
import { ConfigurationChangeEvent, Disposable, StatusBarAlignment, StatusBarItem, TextEditor, window } from 'vscode';
import { Commands } from './commands';
import { configuration, IConfig, StatusBarCommand } from './configuration';
import { isTextEditor } from './constants';
import { Container } from './container';
import { LinesChangeEvent } from './trackers/gitLineTracker';
import { CommitFormatter, GitCommit, ICommitFormatOptions } from './gitService';

export class StatusBarController extends Disposable {

    private _disposable: Disposable;
    private _statusBarItem: StatusBarItem | undefined;

    constructor() {
        super(() => this.dispose());

        this._disposable = Disposable.from(
            configuration.onDidChange(this.onConfigurationChanged, this)
        );
        this.onConfigurationChanged(configuration.initializingChangeEvent);
    }

    dispose() {
        this.clear();

        this._statusBarItem && this._statusBarItem.dispose();

        Container.lineTracker.stop(this);
        this._disposable && this._disposable.dispose();
    }

    private onConfigurationChanged(e: ConfigurationChangeEvent) {
        const initializing = configuration.initializing(e);

        if (!initializing && !configuration.changed(e, configuration.name('statusBar').value)) return;

        const cfg = configuration.get<IConfig>();
        if (cfg.statusBar.enabled) {
            const alignment = cfg.statusBar.alignment !== 'left' ? StatusBarAlignment.Right : StatusBarAlignment.Left;

            if (configuration.changed(e, configuration.name('statusBar')('alignment').value)) {
                if (this._statusBarItem !== undefined && this._statusBarItem.alignment !== alignment) {
                    this._statusBarItem.dispose();
                    this._statusBarItem = undefined;
                }
            }

            this._statusBarItem = this._statusBarItem || window.createStatusBarItem(alignment, alignment === StatusBarAlignment.Right ? 1000 : 0);
            this._statusBarItem.command = cfg.statusBar.command;

            if (initializing || configuration.changed(e, configuration.name('statusBar')('enabled').value)) {
                Container.lineTracker.start(
                    this,
                    Disposable.from(Container.lineTracker.onDidChangeActiveLines(this.onActiveLinesChanged, this))
                );
            }
        }
        else {
            if (configuration.changed(e, configuration.name('statusBar')('enabled').value)) {
                Container.lineTracker.stop(this);

                if (this._statusBarItem !== undefined) {
                    this._statusBarItem.dispose();
                    this._statusBarItem = undefined;
                }
            }
        }
    }

    private onActiveLinesChanged(e: LinesChangeEvent) {
        // If we need to reduceFlicker, don't clear if only the selected lines changed
        let clear = !(Container.config.statusBar.reduceFlicker && e.reason === 'selection' && (e.pending || e.lines !== undefined));
        if (!e.pending && e.lines !== undefined) {
            const state = Container.lineTracker.getState(e.lines[0]);
            if (state !== undefined && state.commit !== undefined) {
                this.updateStatusBar(state.commit, e.editor!);

                return;
            }

            clear = true;
        }

        if (clear) {
            this.clear();
        }
    }

    async clear() {
        if (this._statusBarItem !== undefined) {
            this._statusBarItem.hide();
        }
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
}