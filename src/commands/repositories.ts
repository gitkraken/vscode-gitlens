import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class FetchRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.FetchRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'fetch',
			state: { repos: this.container.git.openRepositories },
		});
	}
}

@command()
export class PullRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.PullRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'pull',
			state: { repos: this.container.git.openRepositories },
		});
	}
}

@command()
export class PushRepositoriesCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.PushRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'push',
			state: { repos: this.container.git.openRepositories },
		});
	}
}
