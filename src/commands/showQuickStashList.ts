import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickStashListCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ShowQuickStashList);
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
