import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface ShowQuickStashListCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickStashListCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.showQuickStashList');
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
