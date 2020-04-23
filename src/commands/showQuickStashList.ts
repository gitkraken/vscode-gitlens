'use strict';
import { executeGitCommand } from '../commands';
import { Command, command, Commands } from './common';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickStashListCommand extends Command {
	constructor() {
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
