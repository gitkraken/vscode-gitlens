'use strict';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { GitBranch, GitUri } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './quickPicks';
import * as path from 'path';

export class BranchQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(public branch: GitBranch) {
        this.label = `${branch.current ? '$(check)\u00a0' : '\u00a0\u00a0\u00a0\u00a0'} ${branch.name}`;
        this.description = branch.remote ? '\u00a0\u00a0 remote branch' : null;
    }
}

export class BranchesQuickPick {

    static async show(branches: GitBranch[], uri: GitUri, goBackCommand?: CommandQuickPickItem): Promise<BranchQuickPickItem | CommandQuickPickItem | undefined> {

        const items = branches.map(_ => new BranchQuickPickItem(_)) as (BranchQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items,
            {
                placeHolder: `Compare ${path.basename(uri.fsPath)} to \u2026`,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions);
        if (!pick) return undefined;

        // await scope.dispose();

        return pick;
    }
}