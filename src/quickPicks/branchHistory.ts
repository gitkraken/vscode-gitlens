'use strict';
import { Arrays, Iterables } from '../system';
import { CancellationTokenSource, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand, ShowCommitSearchCommandArgs, ShowQuickBranchHistoryCommandArgs } from '../commands';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './common';
import { GitLog, GitService, GitUri, RemoteResource } from '../gitService';
import { OpenRemotesCommandQuickPickItem } from './remotes';

export class BranchHistoryQuickPick {

    static showProgress(branch: string) {
        return showQuickPickProgress(`${branch} history \u2014 search by commit message, filename, or commit id`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(git: GitService, log: GitLog, uri: GitUri | undefined, branch: string, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem, nextPageCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        const currentCommand = new CommandQuickPickItem({
            label: `go back \u21A9`,
            description: `\u00a0 \u2014 \u00a0\u00a0 to \u00a0$(git-branch) ${branch} history`
        }, Commands.ShowQuickBranchHistory, [
                uri,
                {
                    branch,
                    log,
                    maxCount: log.maxCount,
                    goBackCommand
                } as ShowQuickBranchHistoryCommandArgs
            ]);

        const remotes = Arrays.uniqueBy(await git.getRemotes((uri && uri.repoPath) || git.repoPath), _ => _.url, _ => !!_.provider);
        if (remotes.length) {
            items.splice(0, 0, new OpenRemotesCommandQuickPickItem(remotes, {
                type: 'branch',
                branch
            } as RemoteResource, currentCommand));
        }

        items.splice(0, 0, new CommandQuickPickItem({
            label: `$(search) Show Commit Search`,
            description: `\u00a0 \u2014 \u00a0\u00a0 search for commits by message, author, files, or commit id`
        }, Commands.ShowCommitSearch, [
                new GitUri(Uri.file(log.repoPath), { fileName: '', repoPath: log.repoPath }),
                {
                    goBackCommand: currentCommand
                } as ShowCommitSearchCommandArgs
            ]));

        let previousPageCommand: CommandQuickPickItem | undefined = undefined;

        if (log.truncated || log.sha) {
            if (log.truncated) {
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(sync) Show All Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 this may take a while`
                }, Commands.ShowQuickBranchHistory, [
                        new GitUri(Uri.file(log.repoPath), { fileName: '', repoPath: log.repoPath }),
                        {
                            branch,
                            maxCount: 0,
                            goBackCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]));
            }
            else {
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(history) Show Branch History`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows \u00a0$(git-branch) ${branch} history`
                }, Commands.ShowQuickBranchHistory, [
                        new GitUri(Uri.file(log.repoPath), { fileName: '', repoPath: log.repoPath }),
                        {
                            branch,
                            goBackCommand: currentCommand
                        } as ShowQuickBranchHistoryCommandArgs
                    ]));
            }

            if (nextPageCommand) {
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} newer commits`
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
                        description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} older commits`
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

        const scope = await Keyboard.instance.beginScope({
            left: goBackCommand,
            ',': previousPageCommand,
            '.': nextPageCommand
        });

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${branch} history \u2014 search by commit message, filename, or commit id`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}