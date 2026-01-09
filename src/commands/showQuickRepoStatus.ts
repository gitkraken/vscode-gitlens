import type { Container } from '../container.js';
import { executeGitCommand } from '../git/actions.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface ShowQuickRepoStatusCommandArgs {
	repoPath?: string;
}

@command()
export class ShowQuickRepoStatusCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.showQuickRepoStatus');
	}

	async execute(args?: ShowQuickRepoStatusCommandArgs): Promise<void> {
		return executeGitCommand({
			command: 'status',
			state: {
				repo: args?.repoPath,
			},
		});
	}
}
