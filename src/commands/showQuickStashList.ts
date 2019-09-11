'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, StashListQuickPick } from '../quickpicks';
import { ActiveEditorCachedCommand, command, Commands, getCommandUri, getRepoPathOrActiveOrPrompt } from './common';
import { ShowQuickCommitDetailsCommandArgs } from './showQuickCommitDetails';

export interface ShowQuickStashListCommandArgs {
	goBackCommand?: CommandQuickPickItem;
}

@command()
export class ShowQuickStashListCommand extends ActiveEditorCachedCommand {
	constructor() {
		super(Commands.ShowQuickStashList);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ShowQuickStashListCommandArgs) {
		uri = getCommandUri(uri, editor);

		const repoPath = await getRepoPathOrActiveOrPrompt(
			uri,
			editor,
			`Show stashes for which repository${GlyphChars.Ellipsis}`
		);
		if (!repoPath) return undefined;

		const progressCancellation = StashListQuickPick.showProgress('list');

		try {
			const stash = await Container.git.getStashList(repoPath);
			if (stash === undefined) return window.showWarningMessage('Unable to show stashes');

			if (progressCancellation.token.isCancellationRequested) return undefined;

			// Create a command to get back to here
			const currentCommandArgs: ShowQuickStashListCommandArgs = {
				goBackCommand: args && args.goBackCommand
			};
			const currentCommand = new CommandQuickPickItem(
				{
					label: `go back ${GlyphChars.ArrowBack}`,
					description: 'to stashes'
				},
				Commands.ShowQuickStashList,
				[uri, currentCommandArgs]
			);

			const pick = await StashListQuickPick.show(
				stash,
				'list',
				progressCancellation,
				args && args.goBackCommand,
				currentCommand
			);
			if (pick === undefined) return undefined;

			if (pick instanceof CommandQuickPickItem) return pick.execute();

			const commandArgs: ShowQuickCommitDetailsCommandArgs = {
				commit: pick.item,
				sha: pick.item.sha,
				goBackCommand: currentCommand
			};
			return commands.executeCommand(Commands.ShowQuickCommitDetails, pick.item.toGitUri(), commandArgs);
		} catch (ex) {
			Logger.error(ex, 'ShowQuickStashListCommand');
			return Messages.showGenericErrorMessage('Unable to show stashes');
		} finally {
			progressCancellation.cancel();
		}
	}
}
