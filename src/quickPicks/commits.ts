'use strict';
import { Iterables } from '../system';
import { QuickPickOptions, window } from 'vscode';
import { GitLog, GitService } from '../gitService';
import { Keyboard } from '../keyboard';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickPicks';

export class CommitsQuickPick {

    static async show(git: GitService, log: GitLog, placeHolder: string, goBackCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((log && Array.from(Iterables.map(log.commits.values(), c => new CommitQuickPickItem(c)))) || []) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}