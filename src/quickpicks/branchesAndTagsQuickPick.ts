'use strict';
import { CancellationToken, CancellationTokenSource, QuickPickItem, QuickPickOptions, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitBranch, GitTag } from '../git/gitService';
import { Functions } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';

export class BranchQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(
        public readonly branch: GitBranch,
        checked?: boolean
    ) {
        checked = checked || (checked === undefined && branch.current);
        this.label = `${checked ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${branch.name}`;
        this.description = branch.remote ? `${GlyphChars.Space.repeat(2)} remote branch` : '';
    }

    get current() {
        return this.branch.current;
    }

    get item() {
        return this.branch;
    }

    get name() {
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

    constructor(
        public readonly tag: GitBranch | GitTag,
        checked?: boolean
    ) {
        this.label = `${checked ? `$(check)${GlyphChars.Space}` : GlyphChars.Space.repeat(4)} ${tag.name}`;
        this.description = `${GlyphChars.Space.repeat(2)} tag`;
    }

    get current() {
        return false;
    }

    get item() {
        return this.tag;
    }

    get name() {
        return this.tag.name;
    }

    get remote() {
        return false;
    }
}

export type BranchOrTagQuickPickItem = BranchQuickPickItem | TagQuickPickItem;

export interface BranchesAndTagsQuickPickOptions {
    autoPick?: boolean;
    checked?: string;
    filters?: {
        branches?(branch: GitBranch): boolean;
        tags?(tag: GitTag): boolean;
    };
    goBack?: CommandQuickPickItem;
    include?: 'branches' | 'tags' | 'all';
}

export class BranchesAndTagsQuickPick {
    constructor(
        public readonly repoPath: string
    ) {}

    async show(
        placeHolder: string,
        options: BranchesAndTagsQuickPickOptions = {}
    ): Promise<BranchOrTagQuickPickItem | CommandQuickPickItem | undefined> {
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

            let pick = await window.showQuickPick(
                items,
                {
                    placeHolder: placeHolder,
                    ignoreFocusOut: getQuickPickIgnoreFocusOut()
                } as QuickPickOptions,
                cancellation.token
            );

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

    private async getItems(options: BranchesAndTagsQuickPickOptions, token: CancellationToken) {
        const { checked, filters, goBack, include } = { include: 'all', ...options };

        let branches;
        let tags;
        switch (include) {
            case 'branches': {
                const result = await Functions.cancellable(Container.git.getBranches(this.repoPath), token);
                if (result === undefined || token.isCancellationRequested) return [];

                branches = result;
                break;
            }
            case 'tags': {
                const result = await Functions.cancellable(Container.git.getTags(this.repoPath), token);
                if (result === undefined || token.isCancellationRequested) return [];

                tags = result;
                break;
            }
            default: {
                const result = await Functions.cancellable(
                    Promise.all([Container.git.getBranches(this.repoPath), Container.git.getTags(this.repoPath)]),
                    token
                );
                if (result === undefined || token.isCancellationRequested) return [];

                [branches, tags] = result;
                break;
            }
        }

        const items: (BranchOrTagQuickPickItem | CommandQuickPickItem)[] = [];

        if (branches !== undefined) {
            const filter =
                filters !== undefined && typeof filters.branches === 'function' ? filters.branches : undefined;

            branches.sort((a, b) => (b.remote ? -1 : 1) - (a.remote ? -1 : 1) || a.name.localeCompare(b.name));
            for (const b of branches) {
                if (filter !== undefined && !filter(b)) continue;

                items.push(new BranchQuickPickItem(b, checked !== undefined ? b.name === checked : undefined));
            }
        }

        if (tags !== undefined) {
            const filter = filters !== undefined && typeof filters.tags === 'function' ? filters.tags : undefined;

            tags.sort((a, b) => a.name.localeCompare(b.name));
            for (const t of tags) {
                if (filter !== undefined && !filter(t)) continue;

                items.push(new TagQuickPickItem(t, checked !== undefined ? t.name === checked : undefined));
            }
        }

        if (goBack !== undefined) {
            items.splice(0, 0, goBack);
        }

        return items;
    }
}
