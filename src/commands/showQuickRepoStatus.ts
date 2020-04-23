'use strict';
import { executeGitCommand } from '../commands';
import { Command, command, Commands } from './common';
import { CommandQuickPickItem } from '../quickpicks';

export interface ShowQuickRepoStatusCommandArgs {
	goBackCommand?: CommandQuickPickItem;
}

export interface ShowQuickRepoStatusCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickRepoStatusCommand extends Command {
	constructor() {
		super(Commands.ShowQuickRepoStatus);
	}

	async execute(args?: ShowQuickRepoStatusCommandArgs) {
		return executeGitCommand({
			command: 'status',
			state: {
				repo: args?.repoPath,
			},
		});

		// uri = getCommandUri(uri, editor);

		// try {
		// 	const repoPath = await getRepoPathOrActiveOrPrompt(
		// 		uri,
		// 		editor,
		// 		`Show status for which repository${GlyphChars.Ellipsis}`,
		// 	);
		// 	if (!repoPath) return undefined;

		// 	const status = await Container.git.getStatusForRepo(repoPath);
		// 	if (status === undefined) return window.showWarningMessage('Unable to show repository status');

		// 	const pick = await RepoStatusQuickPick.show(status, args && args.goBackCommand);
		// 	if (pick === undefined) return undefined;

		// 	if (pick instanceof CommandQuickPickItem) return pick.execute();

		// 	return undefined;
		// } catch (ex) {
		// 	Logger.error(ex, 'ShowQuickRepoStatusCommand');
		// 	return Messages.showGenericErrorMessage('Unable to show repository status');
		// }
	}
}
