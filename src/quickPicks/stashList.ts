'use strict';
import { Iterables } from '../system';
import { QuickPickOptions, window } from 'vscode';
import { Keyboard } from '../commands';
import { IGitStash } from '../gitService';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickPicks';

export class StashListQuickPick {

    static async show(stash: IGitStash, placeHolder?: string, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((stash && Array.from(Iterables.map(stash.commits.values(), c => new CommitQuickPickItem(c, ` \u2014 ${c.fileNames}`)))) || []) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: placeHolder || `stash list \u2014 search by message, filename, or sha`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}