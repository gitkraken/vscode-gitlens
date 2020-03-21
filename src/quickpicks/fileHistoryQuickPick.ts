'use strict';
import { CancellationTokenSource, window } from 'vscode';
import { Commands, ShowQuickCurrentBranchHistoryCommandArgs, ShowQuickFileHistoryCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri, RemoteResource, RemoteResourceType } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables } from '../system';
import {
	CommandQuickPickItem,
	getQuickPickIgnoreFocusOut,
	ShowFileHistoryFromQuickPickItem,
	showQuickPickProgress,
} from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';
import { CommitQuickPickItem } from './gitQuickPicks';

export class FileHistoryQuickPick {
	static showProgress(placeHolder: string) {
		return showQuickPickProgress(placeHolder, {
			'alt+left': KeyNoopCommand,
			'alt+,': KeyNoopCommand,
			'alt+.': KeyNoopCommand,
		});
	}

	static async show(
		log: GitLog,
		uri: GitUri,
		placeHolder: string,
		options: {
			currentCommand?: CommandQuickPickItem;
			goBackCommand?: CommandQuickPickItem;
			nextPageCommand?: CommandQuickPickItem;
			previousPageCommand?: CommandQuickPickItem;
			pickerOnly?: boolean;
			progressCancellation?: CancellationTokenSource;
			showAllCommand?: CommandQuickPickItem;
			showInViewCommand?: CommandQuickPickItem;
		} = {},
	): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
		options = { pickerOnly: false, ...options };

		const items = Array.from(Iterables.map(log.commits.values(), c => CommitQuickPickItem.create(c))) as (
			| CommitQuickPickItem
			| CommandQuickPickItem
		)[];

		let index = 0;

		index++;
		items.splice(0, 0, new ShowFileHistoryFromQuickPickItem(log.repoPath, placeHolder, options.currentCommand));

		if (options.showInViewCommand !== undefined) {
			index++;
			items.splice(0, 0, options.showInViewCommand);
		}

		if (log.hasMore || log.sha) {
			if (options.showAllCommand !== undefined) {
				index++;
				items.splice(0, 0, options.showAllCommand);
			} else if (!options.pickerOnly) {
				const workingUri = await Container.git.getWorkingUri(log.repoPath, uri);
				if (workingUri) {
					const goBackCommandArgs: ShowQuickFileHistoryCommandArgs = {
						log: log,
						limit: log.limit,
						range: log.range,
						goBackCommand: options.goBackCommand,
					};

					const commandArgs: ShowQuickFileHistoryCommandArgs = {
						goBackCommand: new CommandQuickPickItem(
							{
								label: `go back ${GlyphChars.ArrowBack}`,
								description: `to history of ${uri.getFormattedPath()}${
									uri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${uri.shortSha}` : ''
								}`,
							},
							Commands.ShowQuickFileHistory,
							[uri, goBackCommandArgs],
						),
					};

					index++;
					items.splice(
						0,
						0,
						new CommandQuickPickItem(
							{
								label: '$(history) Show File History',
								description: `of ${GitUri.getFormattedPath(workingUri, { relativeTo: log.repoPath })}`,
							},
							Commands.ShowQuickFileHistory,
							[workingUri, commandArgs],
						),
					);
				}
			}

			if (options.nextPageCommand !== undefined) {
				index++;
				items.splice(0, 0, options.nextPageCommand);
			}

			if (options.previousPageCommand !== undefined) {
				index++;
				items.splice(0, 0, options.previousPageCommand);
			}
		}

		if (!options.pickerOnly) {
			const branch = await Container.git.getBranch(uri.repoPath);

			if (branch !== undefined) {
				const commandArgs: ShowQuickFileHistoryCommandArgs = {
					log: log,
					limit: log.limit,
					range: log.range,
				};

				const currentCommand = new CommandQuickPickItem(
					{
						label: `go back ${GlyphChars.ArrowBack}`,
						description: `to history of ${uri.getFormattedPath()}${
							uri.sha ? ` from ${GlyphChars.Space}$(git-commit) ${uri.shortSha}` : ''
						}`,
					},
					Commands.ShowQuickFileHistory,
					[uri, commandArgs],
				);

				// Only show the full repo option if we are the root
				if (options.goBackCommand === undefined) {
					const commandArgs: ShowQuickCurrentBranchHistoryCommandArgs = {
						goBackCommand: currentCommand,
					};
					items.splice(
						index++,
						0,
						new CommandQuickPickItem(
							{
								label: `${GlyphChars.SpaceThin}$(git-branch) Show Branch History`,
								description: `shows history of ${GlyphChars.Space}$(git-branch) ${branch.name}`,
							},
							Commands.ShowQuickCurrentBranchHistory,
							[undefined, commandArgs],
						),
					);
				}

				const remotes = await Container.git.getRemotes(uri.repoPath, { sort: true });
				if (remotes.length) {
					const resource: RemoteResource =
						uri.sha !== undefined
							? {
									type: RemoteResourceType.Revision,
									branch: branch.name,
									fileName: uri.relativePath,
									sha: uri.sha,
							  }
							: {
									type: RemoteResourceType.File,
									branch: branch.name,
									fileName: uri.relativePath,
							  };
					items.splice(index++, 0, new OpenRemotesCommandQuickPickItem(remotes, resource, currentCommand));
				}
			}

			if (options.goBackCommand) {
				items.splice(0, 0, options.goBackCommand);
			}
		}

		if (options.progressCancellation !== undefined && options.progressCancellation.token.isCancellationRequested) {
			return undefined;
		}

		const scope = await Container.keyboard.beginScope({
			'alt+left': options.goBackCommand,
			'alt+,': options.previousPageCommand,
			'alt+.': options.nextPageCommand,
		});

		options.progressCancellation && options.progressCancellation.cancel();

		const pick = await window.showQuickPick(items, {
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: placeHolder,
			ignoreFocusOut: getQuickPickIgnoreFocusOut(),
			// onDidSelectItem: (item: QuickPickItem) => {
			//     scope.setKeyCommand('right', item);
			// }
		});

		await scope.dispose();

		return pick;
	}
}
