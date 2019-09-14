'use strict';
import { CancellationTokenSource, window } from 'vscode';
import { Commands, ShowQuickBranchHistoryCommandArgs } from '../commands';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitLog, GitUri, RemoteResourceType } from '../git/gitService';
import { KeyNoopCommand } from '../keyboard';
import { Iterables } from '../system';
import { CommandQuickPickItem, getQuickPickIgnoreFocusOut, showQuickPickProgress } from './commonQuickPicks';
import { OpenRemotesCommandQuickPickItem } from './remotesQuickPick';
import { CommitQuickPickItem } from './gitQuickPicks';

export class BranchHistoryQuickPick {
	static showProgress(branch: string) {
		return showQuickPickProgress(
			`${branch} history ${GlyphChars.Dash} search by commit message, filename, or commit id`,
			{
				'alt+left': KeyNoopCommand,
				'alt+,': KeyNoopCommand,
				'alt+.': KeyNoopCommand
			}
		);
	}

	static async show(
		log: GitLog,
		uri: GitUri | undefined,
		branch: string,
		progressCancellation: CancellationTokenSource,
		goBackCommand?: CommandQuickPickItem,
		nextPageCommand?: CommandQuickPickItem
	): Promise<CommitQuickPickItem | CommandQuickPickItem | undefined> {
		const items = Array.from(Iterables.map(log.commits.values(), c => CommitQuickPickItem.create(c))) as (
			| CommitQuickPickItem
			| CommandQuickPickItem)[];

		const currentCommandArgs: ShowQuickBranchHistoryCommandArgs = {
			branch: branch,
			log: log,
			maxCount: log.maxCount,
			goBackCommand: goBackCommand
		};
		const currentCommand = new CommandQuickPickItem(
			{
				label: `go back ${GlyphChars.ArrowBack}`,
				description: `to history of ${GlyphChars.Space}$(git-branch) ${branch}`
			},
			Commands.ShowQuickBranchHistory,
			[uri, currentCommandArgs]
		);

		const remotes = await Container.git.getRemotes((uri && uri.repoPath) || log.repoPath, { sort: true });
		if (remotes.length) {
			items.splice(
				0,
				0,
				new OpenRemotesCommandQuickPickItem(
					remotes,
					{
						type: RemoteResourceType.Branch,
						branch: branch
					},
					currentCommand
				)
			);
		}

		let previousPageCommand: CommandQuickPickItem | undefined = undefined;

		if (log.truncated || log.sha) {
			if (log.truncated) {
				const commandArgs: ShowQuickBranchHistoryCommandArgs = {
					branch: branch,
					maxCount: 0,
					goBackCommand: goBackCommand
				};
				items.splice(
					0,
					0,
					new CommandQuickPickItem(
						{
							label: '$(sync) Show All Commits',
							description: 'this may take a while'
						},
						Commands.ShowQuickBranchHistory,
						[GitUri.fromRepoPath(log.repoPath), commandArgs]
					)
				);
			}

			if (nextPageCommand) {
				items.splice(0, 0, nextPageCommand);
			}

			if (log.truncated) {
				const commandArgs: ShowQuickBranchHistoryCommandArgs = {
					branch: branch,
					maxCount: log.maxCount,
					nextPageCommand: nextPageCommand
				};
				const npc = new CommandQuickPickItem(
					{
						label: '$(arrow-right) Show Next Commits',
						description: `shows ${log.maxCount} newer commits`
					},
					Commands.ShowQuickBranchHistory,
					[uri, commandArgs]
				);

				const last = Iterables.last(log.commits.values());
				if (last != null) {
					const commandArgs: ShowQuickBranchHistoryCommandArgs = {
						branch: branch,
						maxCount: log.maxCount,
						goBackCommand: goBackCommand,
						nextPageCommand: npc
					};
					previousPageCommand = new CommandQuickPickItem(
						{
							label: '$(arrow-left) Show Previous Commits',
							description: `shows ${log.maxCount} older commits`
						},
						Commands.ShowQuickBranchHistory,
						[new GitUri(uri ? uri : last.uri, last), commandArgs]
					);

					items.splice(0, 0, previousPageCommand);
				}
			}
		}

		if (goBackCommand) {
			items.splice(0, 0, goBackCommand);
		}

		if (progressCancellation.token.isCancellationRequested) return undefined;

		const scope = await Container.keyboard.beginScope({
			'alt+left': goBackCommand,
			'alt+,': previousPageCommand,
			'alt+.': nextPageCommand
		});

		progressCancellation.cancel();

		const pick = await window.showQuickPick(items, {
			matchOnDescription: true,
			matchOnDetail: true,
			placeHolder: `${branch} history ${GlyphChars.Dash} search by commit message, filename, or commit id`,
			ignoreFocusOut: getQuickPickIgnoreFocusOut()
			// onDidSelectItem: (item: QuickPickItem) => {
			//     scope.setKeyCommand('right', item);
			// }
		});

		await scope.dispose();

		return pick;
	}
}
