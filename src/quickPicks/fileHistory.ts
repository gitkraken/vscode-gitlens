'use strict';
import { Iterables } from '../system';
import { CancellationTokenSource, QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitUri, IGitLog } from '../gitProvider';
import { CommitQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';
import * as path from 'path';

export class FileHistoryQuickPick {

    static async show(log: IGitLog, uri: Uri, sha: string, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (log.truncated) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${log.maxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickFileHistory, [uri, 0, goBackCommand]));

            const last = Iterables.last(log.commits.values());
            items.push(new CommandQuickPickItem({
                label: `$(ellipsis) Show More Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Shows the next ${log.maxCount} commits`
            }, Commands.ShowQuickFileHistory, [new GitUri(uri, last), log.maxCount, goBackCommand]));
        }

        // Only show the full repo option if we are the root
        if (!goBackCommand) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(repo) Show Repository History`,
                description: null,
                detail: 'Shows the commit history of the repository'
            }, Commands.ShowQuickRepoHistory,
                [
                    undefined,
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

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        const commit = Iterables.first(log.commits.values());

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: `${commit.getFormattedPath()}${sha ? ` \u00a0\u2022\u00a0 ${sha.substring(0, 8)}` : ''}`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}