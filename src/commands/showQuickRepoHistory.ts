'use strict';
import { Iterables } from '../system';
import { commands, QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Command } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommitQuickPickItem, CompareQuickPickItem, FileQuickPickItem, ShowAllCommitsQuickPickItem } from './quickPickItems';
import * as moment from 'moment';

export default class ShowQuickRepoHistoryCommand extends Command {

    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(uri?: Uri, maxCount?: number) {
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

            const log = await this.git.getLogForRepo(repoPath, maxCount);
            if (!log) return window.showWarningMessage(`Unable to show repository history`);

            const commits = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileName}`))) as QuickPickItem[];
            let placeHolder = '';
            if (maxCount !== 0 && commits.length === this.git.config.advanced.maxQuickHistory) {
                placeHolder = `Only showing the first ${this.git.config.advanced.maxQuickHistory} commits`;
                commits.push(new ShowAllCommitsQuickPickItem(this.git.config.advanced.maxQuickHistory));
            }

            const pick = await window.showQuickPick(commits, {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: placeHolder
            } as QuickPickOptions);

            if (!pick) return undefined;
            if (pick instanceof ShowAllCommitsQuickPickItem) {
                return commands.executeCommand(Commands.ShowQuickRepoHistory, uri, 0);
            }

            const commitPick = pick as CommitQuickPickItem;
            const files = commitPick.commit.fileName.split(', ').map(f => new FileQuickPickItem(commitPick.commit, f));
            const filePick = await window.showQuickPick(files, {
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: `${commitPick.commit.sha} \u2022 ${commitPick.commit.author}, ${moment(commitPick.commit.date).fromNow()}`
            } as QuickPickOptions);

            if (filePick) {
                const log = await this.git.getLogForFile(filePick.uri.fsPath);
                if (!log) return window.showWarningMessage(`Unable to open diff`);

                const commit = Iterables.find(log.commits.values(), c => c.sha === commitPick.commit.sha);

                let command: Commands | undefined = Commands.DiffWithWorking;
                if (commit.previousSha) {
                    const items: CompareQuickPickItem[] = [
                        {
                            label: `Compare with Working Tree`,
                            description: `\u2022 ${commit.sha}  $(git-compare)  ${commit.fileName}`,
                            detail: null,
                            command: Commands.DiffWithWorking
                        },
                        {
                            label: `Compare with Previous Commit`,
                            description: `\u2022 ${commit.previousSha}  $(git-compare)  ${commit.sha}`,
                            detail: null,
                            command: Commands.DiffWithPrevious
                        }
                    ];

                    const comparePick = await window.showQuickPick(items, {
                        matchOnDescription: true,
                        placeHolder: `${commit.fileName} \u2022 ${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()}`
                    } as QuickPickOptions);

                    command = comparePick ? comparePick.command : undefined;
                }

                if (command) {
                    return commands.executeCommand(command, commit.uri, commit);
                }
            }

            return undefined;
        }
        catch (ex) {
            Logger.error('[GitLens.ShowQuickRepoHistoryCommand]', 'getLogLocations', ex);
            return window.showErrorMessage(`Unable to show repository history. See output channel for more details`);
        }
    }
}