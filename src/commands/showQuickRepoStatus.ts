import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

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
