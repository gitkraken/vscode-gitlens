import { executeGitCommand } from '../commands';
import type { Container } from '../container';
import { Command, command, Commands } from './common';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickStashListCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ShowQuickStashList);
	}

	execute(args?: ShowQuickStashListCommandArgs) {
		return executeGitCommand({
			command: 'stash',
			state: {
				subcommand: 'list',
				repo: args?.repoPath,
			},
		});
	}
}
