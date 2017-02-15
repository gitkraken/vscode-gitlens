'use strict';
import { Iterables } from '../system';
import { commands, QuickPickItem, QuickPickOptions, TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { EditorCommand } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitQuickPickItem, ShowAllCommitsQuickPickItem } from './quickPickItems';
import * as moment from 'moment';

export default class ShowQuickFileHistoryCommand extends EditorCommand {

    constructor(private git: GitProvider) {
        super(Commands.ShowQuickFileHistory);
    }

    async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri, maxCount?: number) {
        if (!(uri instanceof Uri)) {
            if (!editor.document) return undefined;
            uri = editor.document.uri;
        }

        const gitUri = GitUri.fromUri(uri, this.git);

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, undefined, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show file history. File is probably not under source control`);

            const commits = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as QuickPickItem[];
            if (maxCount !== 0 && commits.length === this.git.config.advanced.maxQuickHistory) {
                commits.splice(0, 0, new ShowAllCommitsQuickPickItem(this.git.config.advanced.maxQuickHistory));
            }

            commits.splice(0, 0, {
                label: `$(repo) Show Repository History`,
                command: Commands.ShowQuickRepoHistory
            } as CommandQuickPickItem);

            const pick = await window.showQuickPick(commits, {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: `${Iterables.first(log.commits.values()).fileName}`
            } as QuickPickOptions);

            if (!pick) return undefined;

            if (pick instanceof ShowAllCommitsQuickPickItem) {
                return commands.executeCommand(Commands.ShowQuickFileHistory, uri, 0);
            }

            if (!(pick instanceof CommitQuickPickItem)) {
                const commandPick = pick && pick as CommandQuickPickItem;
                if (commandPick) {
                    return commands.executeCommand(commandPick.command, ...(commandPick.args || []));
                }
            }

            const commitPick = pick as CommitQuickPickItem;
            const commit = commitPick.commit;

            const items: CommandQuickPickItem[] = [
                {
                    label: `$(diff) Compare with Working Tree`,
                    description: `$(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-text) ${commit.fileName}`,
                    command: Commands.DiffWithWorking,
                    args: [commit.uri, commit]
                }
            ];

            if (commit.previousSha) {
                items.push({
                    label: `$(diff) Compare with Previous Commit`,
                    description: `$(git-commit) ${commit.previousSha} \u00a0 $(git-compare) \u00a0 $(git-commit) ${commit.sha}`,
                    command: Commands.DiffWithPrevious,
                    args: [commit.uri, commit]
                });
            }

            items.push({
                label: `go back \u21A9`,
                description: null,
                command: Commands.ShowQuickFileHistory,
                args: [uri, maxCount]
            } as CommandQuickPickItem);

            const commandPick = await window.showQuickPick(items, {
                matchOnDescription: true,
                placeHolder: `${commit.fileName} \u2022 ${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()} \u2022 ${commit.message}`
            } as QuickPickOptions);

            if (commandPick) {
                return commands.executeCommand(commandPick.command, ...(commandPick.args || []));
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickFileHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show file history. See output channel for more details`);
        }
    }
}