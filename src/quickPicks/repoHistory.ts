'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, Uri, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { IGitLog } from '../gitProvider';
import { CommitQuickPickItem } from './gitQuickPicks';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';

export class RepoHistoryQuickPick {

    static async show(log: IGitLog, uri: Uri, maxCount: number, defaultMaxCount: number, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileName}`))) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (maxCount !== 0 && items.length >= defaultMaxCount) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(sync) Show All Commits`,
                description: `\u00a0 \u2014 \u00a0\u00a0 Currently only showing the first ${defaultMaxCount} commits`,
                detail: `This may take a while`
            }, Commands.ShowQuickRepoHistory, [uri, 0, goBackCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        await Keyboard.instance.enterScope(['left', goBackCommand]);

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