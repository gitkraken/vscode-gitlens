import { executeGitCommand } from '../commands/gitCommands.actions';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { Command } from './base';

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
