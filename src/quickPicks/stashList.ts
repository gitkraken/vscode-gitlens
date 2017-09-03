'use strict';
import { Iterables, Strings } from '../system';
import { QuickPickOptions, window } from 'vscode';
import { Commands, StashSaveCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { GitService, GitStash } from '../gitService';
import { Keyboard } from '../keyboard';
import { CommandQuickPickItem, CommitQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickPicks';

export class StashListQuickPick {

    static async show(git: GitService, stash: GitStash, mode: 'list' | 'apply', goBackCommand?: CommandQuickPickItem, currentCommand?: CommandQuickPickItem): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ((stash && Array.from(Iterables.map(stash.commits.values(), c => new CommitQuickPickItem(c)))) || []) as (CommitQuickPickItem | CommandQuickPickItem)[];

        if (mode === 'list') {
            items.splice(0, 0, new CommandQuickPickItem({
                label: `$(plus) Stash Changes`,
                description: `${Strings.pad(GlyphChars.Dash, 2, 3)} stashes all changes`
            }, Commands.StashSave, [
                    {
                        goBackCommand: currentCommand
                    } as StashSaveCommandArgs
                ]));
        }

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            matchOnDescription: true,
            placeHolder: mode === 'apply'
                ? `Apply stashed changes to your working tree${GlyphChars.Ellipsis}`
                : `stashed changes ${GlyphChars.Dash} search by message, filename, or commit id`,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
            // onDidSelectItem: (item: QuickPickItem) => {
            //     scope.setKeyCommand('right', item);
            // }
        } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}