import { Commands } from '../constants';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/command';
import { Command } from './base';

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
