'use strict';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './common';
import { GlyphChars } from '../constants';
import { GitBranch } from '../gitService';

export class BranchQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public branch: GitBranch) {
        this.label = `${branch.current ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${branch.name}`;
        this.description = branch.remote ? `${GlyphChars.Space.repeat(2)} remote branch` : '';
    }
}

export class BranchesQuickPick {

    static async show(branches: GitBranch[], placeHolder: string, goBackCommand?: CommandQuickPickItem): Promise<BranchQuickPickItem | CommandQuickPickItem | undefined> {

        const items = branches.map(_ => new BranchQuickPickItem(_)) as (BranchQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items,
            {
                placeHolder: placeHolder,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions);
        if (!pick) return undefined;

        // await scope.dispose();

        return pick;
    }
}