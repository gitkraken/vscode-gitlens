'use strict';
import { CancellationTokenSource, window } from 'vscode';
import { Container } from '../container';
import { GitLog } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables } from '../system';
import {
	CommandQuickPickItem,
	getQuickPickIgnoreFocusOut,
	MessageQuickPickItem,
	showQuickPickProgress,
} from './commonQuickPicks';
import { CommitQuickPickItem } from './gitQuickPicks';

export interface CommitsQuickPickOptions {
	goBackCommand?: CommandQuickPickItem;
	showAllCommand?: CommandQuickPickItem;
	showInViewCommand?: CommandQuickPickItem;
}

export class CommitsQuickPick {
	static showProgress(message: string) {
		return showQuickPickProgress(message, {
			'alt+left': KeyNoopCommand,
			'alt+,': KeyNoopCommand,
			'alt+.': KeyNoopCommand,
		});
	}

	static async show(
		log: GitLog | undefined,
		placeHolder: string,
		progressCancellation: CancellationTokenSource,
		options: CommitsQuickPickOptions = {},
	): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
		const items = CommitsQuickPick.getItems(log, options);

		if (progressCancellation.token.isCancellationRequested) return undefined;

		const scope = await Container.keyboard.beginScope({ 'alt+left': options.goBackCommand });

		progressCancellation.cancel();

		const pick = await window.showQuickPick(items, {
			matchOnDescription: true,
			placeHolder: placeHolder,
			ignoreFocusOut: getQuickPickIgnoreFocusOut(),
			// onDidSelectItem: (item: QuickPickItem) => {
			//     scope.setKeyCommand('alt+right', item);
			// }
		});

		await scope.dispose();

		return pick;
	}

	static async getItems(
		log: GitLog | undefined | Promise<GitLog | undefined>,
		options: CommitsQuickPickOptions = {},
	) {
		log = await log;
		const items = ((log && [...Iterables.map(log.commits.values(), c => CommitQuickPickItem.create(c))]) || [
			new MessageQuickPickItem('No results found'),
		]) as (CommitQuickPickItem | CommandQuickPickItem)[];

		if (options.showInViewCommand !== undefined) {
			items.splice(0, 0, options.showInViewCommand);
		}

		if (options.showAllCommand !== undefined) {
			items.splice(0, 0, options.showAllCommand);
		}

		if (options.goBackCommand !== undefined) {
			items.splice(0, 0, options.goBackCommand);
		}

		return items;
	}
}
