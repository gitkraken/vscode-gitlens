'use strict';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { Container } from '../container';
import { Repository } from '../git/gitService';
import { Iterables } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';

export class RepositoryQuickPickItem implements QuickPickItem {
    label: string;
    description: string;
    detail: string | undefined;

    constructor(
        public readonly repository: Repository
    ) {
        this.label = repository.name;
        this.description = repository.path;
    }

    get repoPath(): string {
        return this.repository.path;
    }
}

export class RepositoriesQuickPick {
    static async show(
        placeHolder: string,
        goBackCommand?: CommandQuickPickItem
    ): Promise<RepositoryQuickPickItem | CommandQuickPickItem | undefined> {
        const items = [
            ...Iterables.map(await Container.git.getOrderedRepositories(), r => new RepositoryQuickPickItem(r))
        ] as (RepositoryQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand !== undefined) {
            items.splice(0, 0, goBackCommand);
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
