'use strict';
import { Iterables } from '../system';
import { QuickPickOptions, window } from 'vscode';
import { Commands, Keyboard } from '../commands';
import { GitService, IGitStash } from '../gitService';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickPicks';

export class StashListQuickPick {

    static async show(git: GitService, stash: IGitStash, mode: 'list' | 'apply', goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((stash && Array.from(Iterables.map(stash.commits.values(), c => new CommitQuickPickItem(c)))) || []) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (mode === 'list' && git.config.insiders) {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(repo-push) Stash Unstaged Changes`,
                description: `\u00a0 \u2014 \u00a0\u00a0 stashes only unstaged changes`
            }, Commands.StashSave, [undefined, true, currentCommand]));

            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(repo-push) Stash Changes`,
                description: `\u00a0 \u2014 \u00a0\u00a0 stashes all changes`
            }, Commands.StashSave, [undefined, undefined, currentCommand]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: mode === 'apply'
                ? `Apply stashed changes to your working tree\u2026`
                : `stashed changes \u2014 search by message, filename, or sha`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}