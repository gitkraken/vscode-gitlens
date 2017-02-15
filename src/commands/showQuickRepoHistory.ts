'use strict';
import { Iterables } from '../system';
import { commands, QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Command } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommandQuickPickItem, CommitQuickPickItem, FileQuickPickItem, ShowAllCommitsQuickPickItem } from './quickPickItems';
import * as moment from 'moment';

export default class ShowQuickRepoHistoryCommand extends Command {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(uri?: Uri, maxCount?: number, commitPick?: CommitQuickPickItem) {
        if (!(uri instanceof Uri)) {
            const document = window.activeTextEditor && window.activeTextEditor.document;
            if (document) {
                uri = document.uri;
            }
        }

        if (maxCount == null) {
            maxCount = this.git.config.advanced.maxQuickHistory;
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = GitUri.fromUri(uri, this.git);
                repoPath = gitUri.repoPath;

                if (!repoPath) {
                    repoPath = await this.git.getRepoPathFromFile(gitUri.fsPath);
                }
            }

            if (!repoPath) {
                repoPath = this.repoPath;
            }

            if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

            let log = await this.git.getLogForRepo(repoPath, undefined, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show repository history`);

            const commits = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileName}`))) as QuickPickItem[];
            let placeHolder = 'Search by commit message, filename, or sha';
            if (maxCount !== 0 && commits.length === this.git.config.advanced.maxQuickHistory) {
                // placeHolder += `; Only showing the first ${this.git.config.advanced.maxQuickHistory} commits`;
                // commits.push(new ShowAllCommitsQuickPickItem(this.git.config.advanced.maxQuickHistory));
                commits.splice(0, 0, new ShowAllCommitsQuickPickItem(this.git.config.advanced.maxQuickHistory));
            }

            let pick: QuickPickItem;
            if (!commitPick) {
                pick = await window.showQuickPick(commits, {
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: placeHolder
                } as QuickPickOptions);

                if (!pick) return undefined;
                if (pick instanceof ShowAllCommitsQuickPickItem) {
                    return commands.executeCommand(Commands.ShowQuickRepoHistory, uri, 0);
                }

                commitPick = pick as CommitQuickPickItem;
            }

            const files: (FileQuickPickItem | CommandQuickPickItem)[] = commitPick.commit.fileName
                .split(', ')
                .filter(_ => !!_)
                .map(f => new FileQuickPickItem(commitPick.commit, f));

            files.push({
                label: `go back \u21A9`,
                description: null,
                command: Commands.ShowQuickRepoHistory,
                args: [uri, maxCount]
            } as CommandQuickPickItem);

            pick = await window.showQuickPick(files, {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: `${commitPick.commit.sha} \u2022 ${commitPick.commit.author}, ${moment(commitPick.commit.date).fromNow()}`
            } as QuickPickOptions);

            if (!pick) return undefined;

            if (!(pick instanceof FileQuickPickItem)) {
                const commandPick = pick && pick as CommandQuickPickItem;
                if (commandPick) {
                    return commands.executeCommand(commandPick.command, ...(commandPick.args || []));
                }
            }

            const filePick = pick as FileQuickPickItem;
            // Get the most recent commit -- so that we can find the real working filename if there was a rename
            const workingCommit = await this.git.findMostRecentCommitForFile(filePick.uri.fsPath, filePick.sha);

            log = await this.git.getLogForFile(filePick.uri.fsPath, filePick.sha, undefined, undefined, 2);
            if (!log) return window.showWarningMessage(`Unable to open diff`);

            const commit = Iterables.find(log.commits.values(), c => c.sha === commitPick.commit.sha);

            const items: CommandQuickPickItem[] = [
                {
                    label: `$(diff) Compare with Working Tree`,
                    description: `$(git-commit) ${commit.sha} \u00a0 $(git-compare) \u00a0 $(file-text) ${(workingCommit || commit).fileName}`,
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
                label: `$(versions) Show History of ${commit.fileName}`,
                description: `\u2022 since $(git-commit) ${commit.sha}`,
                command: Commands.ShowQuickFileHistory,
                args: [new GitUri(commit.uri, commit)]
            } as CommandQuickPickItem);

            items.push({
                label: `$(versions) Show Full History of ${commit.fileName}`,
                description: `\u2022 this could fail if the file was renamed`,
                command: Commands.ShowQuickFileHistory,
                args: [commit.uri] // TODO: This won't work for renames
            } as CommandQuickPickItem);

            items.push({
                label: `go back \u21A9`,
                description: null,
                command: Commands.ShowQuickRepoHistory,
                args: [uri, maxCount, commitPick]
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
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
    }
}