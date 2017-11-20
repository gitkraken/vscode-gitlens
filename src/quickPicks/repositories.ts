'use strict';
import { Iterables } from '../system';
import { QuickPickItem, QuickPickOptions, window } from 'vscode';
import { GitService, Repository } from '../gitService';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from '../quickPicks';

export class RepositoryQuickPickItem implements QuickPickItem {

    label: string;
    description: string;
    detail: string;

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

    static async show(git: GitService, placeHolder: string, goBackCommand?: CommandQuickPickItem): Promise<RepositoryQuickPickItem | CommandQuickPickItem | undefined> {
        const items = ([...Iterables.map(await git.getRepositories(), r => new RepositoryQuickPickItem(r))]) as (RepositoryQuickPickItem | CommandQuickPickItem)[];

        if (goBackCommand !== undefined) {
            items.splice(0, 0, goBackCommand);
        }

        // const scope = await Keyboard.instance.beginScope({ left: goBackCommand });

        const pick = await window.showQuickPick(items, {
            placeHolder: placeHolder,
            ignoreFocusOut: getQuickPickIgnoreFocusOut()
        } as QuickPickOptions);

        // await scope.dispose();

        return pick;
    }
}