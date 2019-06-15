'use strict';
import { CancellationToken, CancellationTokenSource, QuickPickItem, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitReference, GitService, GitTag } from '../git/gitService';
import { Functions } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';

export class RefQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(public readonly ref: string, checked?: boolean) {
        this.label = `${checked ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${GitService.shortenSha(
            ref
        )}`;
        this.description = '';
    }

    get current() {
        return false;
    }

    get item() {
        const ref: GitReference = { name: this.ref, ref: this.ref };
        return ref;
    }

    get remote() {
        return false;
    }
}

export class BranchQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(public readonly branch: GitBranch, showCheckmarks: boolean, checked?: boolean) {
        checked = showCheckmarks && (checked || (checked === undefined && branch.current));
        this.label = `${
            checked ? `$(check)${GlyphChars.Space.repeat(2)}` : showCheckmarks ? GlyphChars.Space.repeat(6) : ''
        }${branch.name}`;
        this.description = branch.remote
            ? `${GlyphChars.Space.repeat(2)} remote branch`
            : branch.current
            ? 'current branch'
            : '';
    }

    get current() {
        return this.branch.current;
    }

    get item() {
        return this.branch;
    }

    get ref() {
        return this.branch.name;
    }

    get remote() {
        return this.branch.remote;
    }
}

export class TagQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(public readonly tag: GitTag, showCheckmarks: boolean, checked?: boolean) {
        checked = showCheckmarks && checked;
        this.label = `${
            checked ? `$(check)${GlyphChars.Space.repeat(2)}` : showCheckmarks ? GlyphChars.Space.repeat(6) : ''
        }${tag.name}`;
        this.description = `${GlyphChars.Space.repeat(2)} tag`;
    }

    get current() {
        return false;
    }

    get item() {
        return this.tag;
    }

    get ref() {
        return this.tag.name;
    }

    get remote() {
        return false;
    }
}

export type ReferencesQuickPickItem = BranchQuickPickItem | TagQuickPickItem | RefQuickPickItem;

export interface ReferencesQuickPickOptions {
    allowEnteringRefs?: boolean;
    autoPick?: boolean;
    checked?: string;
    checkmarks: boolean;
    filterBranches?(branch: GitBranch): boolean;
    filterTags?(tag: GitTag): boolean;
    goBack?: CommandQuickPickItem;
    include?: 'branches' | 'tags' | 'all';
}

export class ReferencesQuickPick {
    constructor(public readonly repoPath: string | undefined) {}

    async show(
        placeHolder: string,
        options: ReferencesQuickPickOptions = { checkmarks: true }
    ): Promise<ReferencesQuickPickItem | CommandQuickPickItem | undefined> {
        const cancellation = new CancellationTokenSource();

        let scope;
        if (options.goBack) {
            scope = await Container.keyboard.beginScope({ left: options.goBack });
        }

        let autoPick;
        try {
            let items = this.getItems(options, cancellation.token);
            if (options.autoPick) {
                items = items.then(itms => {
                    if (itms.length <= 1) {
                        autoPick = itms[0];
                        cancellation.cancel();
                    }
                    return itms;
                });
            }

            let pick;
            if (options.allowEnteringRefs) {
                placeHolder += `${GlyphChars.Space.repeat(3)}(select or enter a reference)`;

                const quickpick = window.createQuickPick<ReferencesQuickPickItem | CommandQuickPickItem>();
                quickpick.busy = true;
                quickpick.enabled = false;
                quickpick.placeholder = placeHolder;
                quickpick.ignoreFocusOut = getQuickPickIgnoreFocusOut();
                quickpick.show();

                quickpick.items = await items;
                quickpick.busy = false;
                quickpick.enabled = true;

                pick = await new Promise<ReferencesQuickPickItem | CommandQuickPickItem | undefined>(resolve => {
                    cancellation.token.onCancellationRequested(() => quickpick.hide());

                    quickpick.onDidHide(() => resolve(undefined));
                    quickpick.onDidAccept(async () => {
                        if (quickpick.selectedItems.length === 0) {
                            quickpick.busy = true;
                            quickpick.enabled = false;

                            const ref = quickpick.value;
                            if (
                                this.repoPath === undefined ||
                                (await Container.git.validateReference(this.repoPath, ref))
                            ) {
                                resolve(new RefQuickPickItem(ref));
                            }
                            else {
                                quickpick.title = 'You must enter a valid reference';
                                quickpick.busy = false;
                                quickpick.enabled = true;
                                return;
                            }
                        }
                        else {
                            resolve(quickpick.selectedItems[0]);
                        }

                        quickpick.hide();
                    });
                });

                quickpick.dispose();
            }
            else {
                pick = await window.showQuickPick(
                    items,
                    {
                        placeHolder: placeHolder,
                        ignoreFocusOut: getQuickPickIgnoreFocusOut()
                    },
                    cancellation.token
                );
            }

            if (pick === undefined && autoPick !== undefined) {
                pick = autoPick;
            }

            if (pick === undefined) {
                cancellation.cancel();
            }

            return pick;
        }
        finally {
            if (scope !== undefined) {
                await scope.dispose();
            }

            cancellation.dispose();
        }
    }

    private async getItems(
        { checked, checkmarks, goBack, ...options }: ReferencesQuickPickOptions,
        token: CancellationToken
    ) {
        const branchesAndOrTags = await Functions.cancellable(
            Container.git.getBranchesAndOrTags(this.repoPath, {
                include: options.include || 'all',
                filterBranches: options.filterBranches,
                filterTags: options.filterTags,
                sort: true
            }),
            token
        );
        if (branchesAndOrTags === undefined || token.isCancellationRequested) return [];

        const items: (BranchQuickPickItem | TagQuickPickItem | CommandQuickPickItem)[] = [];

        for (const bt of branchesAndOrTags) {
            if (checkmarks && checked === bt.name) {
                items.splice(
                    0,
                    0,
                    new (GitBranch.is(bt) ? BranchQuickPickItem : TagQuickPickItem)(bt as any, checkmarks, true)
                );
            }
            else {
                items.push(
                    new (GitBranch.is(bt) ? BranchQuickPickItem : TagQuickPickItem)(
                        bt as any,
                        checkmarks,
                        checked === undefined ? undefined : false
                    )
                );
            }
        }

        if (goBack !== undefined) {
            items.splice(0, 0, goBack);
        }

        return items;
    }
}
