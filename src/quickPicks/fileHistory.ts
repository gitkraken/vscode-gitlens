'use strict';
import { Iterables } from '../system';
import { QuickPickOptions, Uri, window } from 'vscode';
import { Commands } from '../commands';
import { IGitLog } from '../gitProvider';
import { CommitQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';

export { CommandQuickPickItem, CommitQuickPickItem };

export class FileHistoryQuickPick {

    static async show(log: IGitLog, uri: Uri, maxCount: number, defaultMaxCount: number, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (maxCount !== 0 && items.length >= defaultMaxCount) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${defaultMaxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickFileHistory, [uri, 0, undefined, goBackCommand]));
        }

        // Only show the full repo option if we are the root
        if (!goBackCommand) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(repo) Show Repository History`,
                description: null,
                detail: 'Shows the commit history of the repository'
            }, Commands.ShowQuickRepoHistory, [undefined, undefined, undefined, new CommandQuickPickItem({
                label: `go back \u21A9`,
                description: null
            }, Commands.ShowQuickFileHistory, [uri, maxCount])]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const commit = Iterables.first(log.commits.values());

        return await window.showQuickPick(items, {
            matchOnDescription: true,
            matchOnDetail: true,
            placeHolder: commit.getFormattedPath(),
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);
    }
}