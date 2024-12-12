import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

export interface ShowQuickRepoStatusCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickRepoStatusCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ShowQuickRepoStatus);
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
