import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { executeGitCommand } from '../git/actions';
import { command } from '../system/vscode/command';
import { Command } from './base';

@command()
export class FetchRepositoriesCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.FetchRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'fetch',
			state: { repos: this.container.git.openRepositories },
		});
	}
}

@command()
export class PullRepositoriesCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PullRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'pull',
			state: { repos: this.container.git.openRepositories },
		});
	}
}

@command()
export class PushRepositoriesCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PushRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'push',
			state: { repos: this.container.git.openRepositories },
		});
	}
}
