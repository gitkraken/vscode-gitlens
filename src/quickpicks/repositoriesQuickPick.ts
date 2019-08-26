'use strict';
import { window } from 'vscode';
import { Container } from '../container';
import { Iterables } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut } from './commonQuickPicks';
import { RepositoryQuickPickItem } from './gitQuickPicks';

export class RepositoriesQuickPick {
	static async show(
		placeHolder: string,
		goBackCommand?: CommandQuickPickItem
	): Promise<RepositoryQuickPickItem | CommandQuickPickItem | undefined> {
		const items: (RepositoryQuickPickItem | CommandQuickPickItem)[] = await Promise.all([
			...Iterables.map(await Container.git.getOrderedRepositories(), r =>
				RepositoryQuickPickItem.create(r, undefined, { branch: true, status: true })
			)
		]);

		if (goBackCommand !== undefined) {
			items.splice(0, 0, goBackCommand);
		}

		// const scope = await Container.keyboard.beginScope({ left: goBackCommand });

		const pick = await window.showQuickPick(items, {
			placeHolder: placeHolder,
			ignoreFocusOut: getQuickPickIgnoreFocusOut()
		});

		// await scope.dispose();

		return pick;
	}
}
