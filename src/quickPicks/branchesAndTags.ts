'use strict';
import { CancellationTokenSource, QuickPickItem, QuickPickOptions, window } from 'vscode';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitTag } from '../gitService';
import { KeyNoopCommand } from '../keyboard';

export class BranchOrTagQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

    constructor(
        public readonly branchOrTag: GitBranch | GitTag
    ) {
        if (branchOrTag instanceof GitBranch) {
            this.label = `${branchOrTag.current ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${branchOrTag.name}`;
            this.description = branchOrTag.remote ? `${GlyphChars.Space.repeat(2)} remote branch` : '';
        }
        else {
            this.label = `${GlyphChars.Space.repeat(4)} ${branchOrTag.name}`;
            this.description = `${GlyphChars.Space.repeat(2)} tag`;
        }
    }

    get name() {
        return this.branchOrTag.name;
    }

    get remote() {
        return this.branchOrTag instanceof GitBranch && this.branchOrTag.remote;
    }
}

export class BranchesAndTagsQuickPick {

    static showProgress(placeHolder: string) {
        return showQuickPickProgress(placeHolder,
            {
                left: KeyNoopCommand,
                ',': KeyNoopCommand,
                '.': KeyNoopCommand
            });
    }

    static async show(branches: GitBranch[], tags: GitTag[], placeHolder: string, options: { goBackCommand?: CommandQuickPickItem, progressCancellation?: CancellationTokenSource } = {}): Promise<BranchOrTagQuickPickItem | CommandQuickPickItem | undefined> {
        const items = [
            ...branches.filter(b => !b.remote).map(b => new BranchOrTagQuickPickItem(b)),
            ...tags.map(t => new BranchOrTagQuickPickItem(t)),
            ...branches.filter(b => b.remote).map(b => new BranchOrTagQuickPickItem(b))
        ] as (BranchOrTagQuickPickItem | CommandQuickPickItem)[];

        if (options.goBackCommand !== undefined) {
            items.splice(0, 0, options.goBackCommand);
        }

        if (options.progressCancellation !== undefined && options.progressCancellation.token.isCancellationRequested) return undefined;

        const scope = await Container.keyboard.beginScope({ left: options.goBackCommand || KeyNoopCommand });

        options.progressCancellation && options.progressCancellation.cancel();

        const pick = await window.showQuickPick(items,
            {
                placeHolder: placeHolder,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions);

        await scope.dispose();

        return pick;
    }
}