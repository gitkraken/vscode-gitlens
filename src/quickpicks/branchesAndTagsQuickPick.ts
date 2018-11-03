'use strict';
import { CancellationToken, CancellationTokenSource, QuickPickItem, QuickPickOptions, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitTag } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Functions, Iterables } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';

export class BranchOrTagQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(
        public readonly branchOrTag: GitBranch | GitTag,
        checked?: boolean
    ) {
        if (branchOrTag instanceof GitBranch) {
            this.label = `${
                checked === true || (checked === undefined && branchOrTag.current)
                    ? `$(check)${GlyphChars.Space}`
                    : GlyphChars.Space.repeat(4)
            } ${branchOrTag.name}`;
            this.description = branchOrTag.remote ? `${GlyphChars.Space.repeat(2)} remote branch` : '';
        }
        else {
            this.label = `${GlyphChars.Space.repeat(4)} ${branchOrTag.name}`;
            this.description = `${GlyphChars.Space.repeat(2)} tag`;
        }
    }

    get current() {
        return this.branchOrTag instanceof GitBranch ? this.branchOrTag.current : false;
    }

    get name() {
        return this.branchOrTag.name;
    }

    get remote() {
        return this.branchOrTag instanceof GitBranch && this.branchOrTag.remote;
    }
}

export class BranchesAndTagsQuickPick {
    constructor(
        public readonly repoPath: string
    ) {}

    async show(
        placeHolder: string,
        options: { checked?: string; goBack?: CommandQuickPickItem } = {}
    ): Promise<BranchOrTagQuickPickItem | CommandQuickPickItem | undefined> {
        const cancellation = new CancellationTokenSource();

        try {
            const items = this.getItems(options, cancellation.token);
            const scope = await Container.keyboard.beginScope({ left: options.goBack || KeyNoopCommand });

            const pick = await window.showQuickPick(items, {
                placeHolder: placeHolder,
                ignoreFocusOut: getQuickPickIgnoreFocusOut()
            } as QuickPickOptions);

            if (pick === undefined) {
                cancellation.cancel();
            }
            await scope.dispose();

            return pick;
        }
        finally {
            cancellation.dispose();
        }
    }

    private async getItems(
        options: { checked?: string; goBack?: CommandQuickPickItem } = {},
        token: CancellationToken
    ) {
        const result = await Functions.cancellable(
            Promise.all([Container.git.getBranches(this.repoPath), Container.git.getTags(this.repoPath)]),
            token
        );
        if (result === undefined || token.isCancellationRequested) return [];

        const [branches, tags] = result;

        const items = [
            ...Iterables.filterMap(
                branches,
                b =>
                    !b.remote
                        ? new BranchOrTagQuickPickItem(
                              b,
                              options.checked !== undefined ? b.name === options.checked : undefined
                          )
                        : undefined
            ),
            ...Iterables.filterMap(
                branches,
                b =>
                    b.remote
                        ? new BranchOrTagQuickPickItem(
                              b,
                              options.checked !== undefined ? b.name === options.checked : undefined
                          )
                        : undefined
            ),
            ...tags.map(
                t =>
                    new BranchOrTagQuickPickItem(
                        t,
                        options.checked !== undefined ? t.name === options.checked : undefined
                    )
            )
        ] as (BranchOrTagQuickPickItem | CommandQuickPickItem)[];

        if (options.goBack !== undefined) {
            items.splice(0, 0, options.goBack);
        }

        return items;
    }
}
