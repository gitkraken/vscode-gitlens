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
