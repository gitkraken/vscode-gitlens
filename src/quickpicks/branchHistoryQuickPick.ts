'use strict';
import { CancellationTokenSource, window } from 'vscode';
import { Commands, ShowQuickBranchHistoryCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri, RemoteResourceType } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables, Strings } from '../system';
import {
    CommandQuickPickItem,
    CommitQuickPickItem,
    getQuickPickIgnoreFocusOut,
    showQuickPickProgress
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';

export class BranchHistoryQuickPick {
    static showProgress(branch: string) {
        return showQuickPickProgress(
            `${branch} history ${GlyphChars.Dash} search by commit message, filename, or commit id`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            }
        );
    }

    static async show(
        log: GitLog,
        uri: GitUri | undefined,
        branch: string,
        progressCancellation: CancellationTokenSource,
        goBackCommand?: CommandQuickPickItem,
        nextPageCommand?: CommandQuickPickItem
    ): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (
            | CommitQuickPickItem
            | CommandQuickPickItem)[];

        const currentCommandArgs: ShowQuickBranchHistoryCommandArgs = {
            branch: branch,
            log: log,
            maxCount: log.maxCount,
            goBackCommand: goBackCommand
        };
        const currentCommand = new CommandQuickPickItem(
            {
                label: `go back ${GlyphChars.ArrowBack}`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to ${
                    GlyphChars.Space
                }$(git-branch) ${branch} history`
            },
            Commands.ShowQuickBranchHistory,
            [uri, currentCommandArgs]
        );

        const remotes = await Container.git.getRemotes((uri && uri.repoPath) || log.repoPath);
        if (remotes.length) {
            items.splice(
                0,
                0,
                new OpenRemotesCommandQuickPickItem(
                    remotes,
                    {
                        type: RemoteResourceType.Branch,
                        branch: branch
                    },
                    currentCommand
                )
            );
        }

        let previousPageCommand: CommandQuickPickItem | undefined = undefined;

        if (log.truncated || log.sha) {
            if (log.truncated) {
                const commandArgs: ShowQuickBranchHistoryCommandArgs = {
                    branch: branch,
                    maxCount: 0,
                    goBackCommand: goBackCommand
                };
                items.splice(
                    0,
                    0,
                    new CommandQuickPickItem(
                        {
                            label: '$(sync) Show All Commits',
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                        },
                        Commands.ShowQuickBranchHistory,
                        [GitUri.fromRepoPath(log.repoPath), commandArgs]
                    )
                );
            }

            if (nextPageCommand) {
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const commandArgs: ShowQuickBranchHistoryCommandArgs = {
                    branch: branch,
                    maxCount: log.maxCount,
                    nextPageCommand: nextPageCommand
                };
                const npc = new CommandQuickPickItem(
                    {
                        label: '$(arrow-right) Show Next Commits',
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} newer commits`
                    },
                    Commands.ShowQuickBranchHistory,
                    [uri, commandArgs]
                );

                const last = Iterables.last(log.commits.values());
                if (last != null) {
                    const commandArgs: ShowQuickBranchHistoryCommandArgs = {
                        branch: branch,
                        maxCount: log.maxCount,
                        goBackCommand: goBackCommand,
                        nextPageCommand: npc
                    };
                    previousPageCommand = new CommandQuickPickItem(
                        {
                            label: '$(arrow-left) Show Previous Commits',
                            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} older commits`
                        },
                        Commands.ShowQuickBranchHistory,
                        [new GitUri(uri ? uri : last.uri, last), commandArgs]
                    );

                    items.splice(0, 0, previousPageCommand);
                }
            }
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        if (progressCancellation.token.isCancellationRequested) return undefined;

        const scope = await Container.keyboard.beginScope({
            left: goBackCommand,
            ',': previousPageCommand,
            '.': nextPageCommand
        });

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${branch} history ${GlyphChars.Dash} search by commit message, filename, or commit id`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        });

        await scope.dispose();

        return pick;
    }
}
