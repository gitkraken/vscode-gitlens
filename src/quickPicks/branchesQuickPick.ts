'use strict';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';
import { GlyphChars } from '../constants';
import { GitBranch } from '../gitService';

export class BranchQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(
        public readonly branch: GitBranch
    ) {
        this.label = `${branch.current ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${branch.name}`;
        this.description = branch.remote ? `${GlyphChars.Space.repeat(2)} remote branch` : '';
    }
}

export class BranchesQuickPick {
    static async show(
        branches: GitBranch[],
        placeHolder: string,
        options: { goBackCommand?: CommandQuickPickItem } = {}
    ): Promise<BranchQuickPickItem | CommandQuickPickItem | undefined> {
        const items = branches.map(b => new BranchQuickPickItem(b)) as (BranchQuickPickItem | CommandQuickPickItem)[];

        if (options.goBackCommand !== undefined) {
            items.splice(0, 0, options.goBackCommand);
        }

        // const scope = await Container.keyboard.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);

        // await scope.dispose();

        return pick;
    }
}
