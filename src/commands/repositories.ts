'use strict';
import { executeGitCommand } from '../commands';
import { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class FetchRepositoriesCommand extends Command {
	constructor() {
		super(Commands.FetchRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'fetch',
			state: { repos: Container.instance.git.openRepositories },
		});
	}
}

@command()
export class PullRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PullRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'pull',
			state: { repos: Container.instance.git.openRepositories },
		});
	}
}

@command()
export class PushRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PushRepositories);
	}

	async execute() {
		return executeGitCommand({
			command: 'push',
			state: { repos: Container.instance.git.openRepositories },
		});
	}
}
