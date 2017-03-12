'use strict';
import { Iterables } from '../system';
import { CancellationTokenSource, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard, KeyNoopCommand } from '../commands';
import { GitUri, IGitLog } from '../gitProvider';
import { CommitQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './quickPicks';
import * as path from 'path';

export class FileHistoryQuickPick {

    static showProgress(maxCount?: number) {
        return showQuickPickProgress(`Loading file history \u2014 ${maxCount ? ` limited to ${maxCount} commits` : ` this may take a while`}\u2026`,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(log: IGitLog, uri: GitUri, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem, nextPageCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        let previousPageCommand: CommandQuickPickItem;

        let index = 0;
        if (log.truncated || uri.sha) {
            index++;
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 this may take a while`
            }, Commands.ShowQuickFileHistory, [Uri.file(uri.fsPath), 0, goBackCommand]));

            if (nextPageCommand) {
                index++;
                items.splice(0, 0, nextPageCommand);
            }

            if (log.truncated) {
                const npc = new CommandQuickPickItem({
                    label: `$(arrow-right) Show Next Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} newer commits`
                }, Commands.ShowQuickFileHistory, [uri, log.maxCount, goBackCommand, undefined, nextPageCommand]);

                const last = Iterables.last(log.commits.values());

                previousPageCommand = new CommandQuickPickItem({
                    label: `$(arrow-left) Show Previous Commits`,
                    description: `\u00a0 \u2014 \u00a0\u00a0 shows ${log.maxCount} older commits`
                }, Commands.ShowQuickFileHistory, [new GitUri(uri, last), log.maxCount, goBackCommand, undefined, npc]);

                index++;
                items.splice(0, 0, previousPageCommand);
            }
        }

        // Only show the full repo option if we are the root
        if (!goBackCommand) {
            items.splice(index, 0, new CommandQuickPickItem({
                label: `$(repo) Show Repository History`,
                description: `\u00a0 \u2014 \u00a0\u00a0 shows the repository commit history`
            }, Commands.ShowQuickRepoHistory,
                [
                    undefined,
                    undefined,
                    new CommandQuickPickItem({
                        label: `go back \u21A9`,
                        description: `\u00a0 \u2014 \u00a0\u00a0 to history of \u00a0$(file-text) ${path.basename(uri.fsPath)}`
                    }, Commands.ShowQuickFileHistory, [uri, log.maxCount, undefined, log])
                ]));
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

        const commit = Iterables.first(log.commits.values());

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.getFormattedPath()}${uri.sha ? ` \u00a0\u2022\u00a0 ${uri.sha.substring(0, 8)}` : ''}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}