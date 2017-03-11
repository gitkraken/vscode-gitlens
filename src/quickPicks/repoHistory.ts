'use strict';
import { Iterables } from '../system';
import { CancellationTokenSource, QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { IGitLog } from '../gitProvider';
import { CommitQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';

export class RepoHistoryQuickPick {

    static async show(log: IGitLog, uri: Uri, sha: string, progressCancellation: CancellationTokenSource, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileNames}`))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (log.truncated) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${log.maxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickRepoHistory, [uri, undefined, 0, goBackCommand]));

            const last = Iterables.last(log.commits.values());
            items.push(new CommandQuickPickItem({
                label: `$(ellipsis) Show More Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Shows the next ${log.maxCount} commits`
            }, Commands.ShowQuickRepoHistory, [uri, last.sha, log.maxCount, goBackCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        if (progressCancellation.token.isCancellationRequested) return undefined;

        await Keyboard.instance.enterScope(['left', goBackCommand]);

        progressCancellation.cancel();

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: 'Search by commit message, filename, or sha',
            ignoreFocusOut: getQuickPickIgnoreFocusOut(),
            onDidSelectItem: (item: QuickPickItem) => {
                Keyboard.instance.setKeyCommand('right', item);
            }
        } as QuickPickOptions);

        await Keyboard.instance.exitScope();

        return pick;
    }
}