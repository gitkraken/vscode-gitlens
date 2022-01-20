'use strict';
import { executeGitCommand } from '../commands';
import type { Container } from '../container';
import { Command, command, Commands } from './common';

export interface ShowQuickRepoStatusCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickRepoStatusCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ShowQuickRepoStatus);
	}

	async execute(args?: ShowQuickRepoStatusCommandArgs) {
		return executeGitCommand({
			command: 'status',
			state: {
				repo: args?.repoPath,
			},
		});
	}
}
