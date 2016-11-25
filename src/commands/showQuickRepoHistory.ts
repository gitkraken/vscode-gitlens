'use strict';
import { Iterables } from '../system';
import { commands, QuickPickOptions, Uri, window } from 'vscode';
import { Command } from './commands';
import { Commands } from '../constants';
import GitProvider, { GitUri } from '../gitProvider';
import { Logger } from '../logger';
import { CommitQuickPickItem, CompareQuickPickItem, FileQuickPickItem } from './quickPickItems';
import * as moment from 'moment';
export default class ShowQuickRepoHistoryCommand extends Command {
    constructor(private git: GitProvider, public repoPath: string) {
        super(Commands.ShowQuickRepoHistory);
    }

    async execute(uri?: Uri) {
        if (!(uri instanceof Uri)) {
            const document = window.activeTextEditor && window.activeTextEditor.document;
            if (document) {
                uri = document.uri;
            }
        }

        try {
            let repoPath: string;
            if (uri instanceof Uri) {
                const gitUri = GitUri.fromUri(uri);
                repoPath = gitUri.repoPath;

                if (!repoPath) {
                    repoPath = await this.git.getRepoPathFromFile(gitUri.fsPath);
                }
            }

            if (!repoPath) {
                repoPath = this.repoPath;
            }

            if (!repoPath) return window.showWarningMessage(`Unable to show repository history`);

            const log = await this.git.getLogForRepo(repoPath);
            if (!log) return window.showWarningMessage(`Unable to show repository history`);

            const items = Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileName}`));
            const commitPick = await window.showQuickPick(Array.from(items), <QuickPickOptions>{
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (commitPick) {
                const items = commitPick.commit.fileName.split(', ').map(f => new FileQuickPickItem(commitPick.commit, f));
                const filePick = await window.showQuickPick(items, <QuickPickOptions>{
                    matchOnDescription: true,
                    matchOnDetail: true,
                    placeHolder: `${commitPick.commit.sha} \u2022 ${commitPick.commit.author}, ${moment(commitPick.commit.date).fromNow()}`
                });

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

                        const comparePick = await window.showQuickPick(items, <QuickPickOptions>{
                            matchOnDescription: true,
                            placeHolder: `${commit.fileName} \u2022 ${commit.sha} \u2022 ${commit.author}, ${moment(commit.date).fromNow()}`
                        });

                        command = comparePick ? comparePick.command : undefined;
                    }

                    if (command) {
                        return commands.executeCommand(command, commit.uri, commit);
                    }
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