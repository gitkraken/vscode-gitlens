'use strict';
import { Arrays, Iterables } from '../system';
import { CancellationTokenSource, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './common';
import { GitService, GitUri, IGitLog } from '../gitService';
import { OpenRemotesCommandQuickPickItem } from './remotes';

export class BranchHistoryQuickPick {

    static showProgress(branch: string) {
        return showQuickPickProgress(`${branch} history \u2014 search by commit message, filename, or sha`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(git: GitService, log: IGitLog, uri: GitUri | undefined, branch: string, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem, nextPageCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        const currentCommand = new CommandQuickPickItem({
            label: `go back \u21A9`,
            description: `\u00a0 \u2014 \u00a0\u00a0 to \u00a0$(git-branch) ${branch} history`
        }, Commands.ShowQuickBranchHistory, [uri, branch, log.maxCount, goBackCommand, log]);

        const remotes = Arrays.uniqueBy(await git.getRemotes((uri && uri.repoPath) || git.repoPath), _ => _.url, _ => !!_.provider);
        if (remotes.length) {
            items.splice(0, 0, new OpenRemotesCommandQuickPickItem(remotes, 'branch', branch, currentCommand));
        }

        let previousPageCommand: CommandQuickPickItem;

        if (log.truncated || log.sha) {
            if (log.truncated) {
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(sync) Show All Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 this may take a while`
                }, Commands.ShowQuickBranchHistory, [
                        new GitUri(Uri.file(log.repoPath), { fileName: '', repoPath: log.repoPath }),
                        branch,
                        0,
                        goBackCommand
                    ]));
            }
            else {
                items.splice(0, 0, new CommandQuickPickItem({
                    label: `$(history) Show Branch History`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows \u00a0$(git-branch) ${branch} history`
                }, Commands.ShowQuickBranchHistory, [
                        new GitUri(Uri.file(log.repoPath), { fileName: '', repoPath: log.repoPath }),
                        branch,
                        undefined,
                        currentCommand
                    ]));
            }

            if (nextPageCommand) {
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} newer commits`
                }, Commands.ShowQuickBranchHistory, [uri, branch, log.maxCount, goBackCommand, undefined, nextPageCommand]);

                const last = Iterables.last(log.commits.values());

                previousPageCommand = new CommandQuickPickItem({
                    label: `$(arrow-left) Show Previous Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} older commits`
                }, Commands.ShowQuickBranchHistory, [new GitUri(uri ? uri : last.uri, last), branch, log.maxCount, goBackCommand, undefined, npc]);

                items.splice(0, 0, previousPageCommand);
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
            placeHolder: `${branch} history \u2014 search by commit message, filename, or sha`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}