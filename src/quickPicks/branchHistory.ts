'use strict';
import { Iterables, Strings } from '../system';
import { CancellationTokenSource, QuickPickOptions, window } from 'vscode';
import { Commands, ShowCommitSearchCommandArgs, ShowQuickBranchHistoryCommandArgs } from '../commands';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri, RemoteResource } from '../gitService';
import { KeyNoopCommand } from '../keyboard';
import { OpenRemotesCommandQuickPickItem } from './remotes';

export class BranchHistoryQuickPick {

    static showProgress(branch: string) {
        return showQuickPickProgress(`${branch} history ${GlyphChars.Dash} search by commit message, filename, or commit id`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(log: GitLog, uri: GitUri | undefined, branch: string, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem, nextPageCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        const currentCommand = new CommandQuickPickItem({
            label: `go back ${GlyphChars.ArrowBack}`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} to ${GlyphChars.Space}$(git-branch) ${branch} history`
        }, Commands.ShowQuickBranchHistory, [
                uri,
                {
                    branch,
                    log,
                    maxCount: log.maxCount,
                    goBackCommand
                } as ShowQuickBranchHistoryCommandArgs
            ]);

        const remotes = (await Container.git.getRemotes((uri && uri.repoPath) || log.repoPath)).filter(r => r.provider !== undefined);
        if (remotes.length) {
            items.splice(0, 0, new OpenRemotesCommandQuickPickItem(remotes, {
                type: 'branch',
                branch
            } as RemoteResource, currentCommand));
        }

        items.splice(0, 0, new CommandQuickPickItem({
            label: `$(search) Show Commit Search`,
            description: `${Strings.pad(GlyphChars.Dash, 2, 3)} search for commits by message, author, files, or commit id`
        }, Commands.ShowCommitSearch, [
                GitUri.fromRepoPath(log.repoPath),
                {
                    goBackCommand: currentCommand
                } as ShowCommitSearchCommandArgs
            ]));

        let previousPageCommand: CommandQuickPickItem | undefined = undefined;

        if (log.truncated || log.sha) {
            if (log.truncated) {
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(sync) Show All Commits`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} this may take a while`
                }, Commands.ShowQuickBranchHistory, [
                        GitUri.fromRepoPath(log.repoPath),
                        {
                            branch,
                            maxCount: 0,
                            goBackCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]));
            }

            if (nextPageCommand) {
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} newer commits`
                }, Commands.ShowQuickBranchHistory, [
                        uri,
                        {
                            branch,
                            maxCount: log.maxCount,
                            nextPageCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]);

                const last = Iterables.last(log.commits.values());
                if (last != null) {
                    previousPageCommand = new CommandQuickPickItem({
                        label: `$(arrow-left) Show Previous Commits`,
                        description: `${Strings.pad(GlyphChars.Dash, 2, 3)} shows ${log.maxCount} older commits`
                    }, Commands.ShowQuickBranchHistory, [
                            new GitUri(uri ? uri : last.uri, last),
                            {
                                branch,
                                maxCount: log.maxCount,
                                goBackCommand,
                                nextPageCommand: npc
                            } as ShowQuickBranchHistoryCommandArgs
                        ]);

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
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}