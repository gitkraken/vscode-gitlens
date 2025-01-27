import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickStashListCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ShowQuickStashList);
	}

	execute(args?: ShowQuickStashListCommandArgs): Promise<void> {
		return executeGitCommand({
			command: 'stash',
			state: {
				subcommand: 'list',
				repo: args?.repoPath,
			},
		});
	}
}
