'use strict';
import { Container } from '../container';
import { command, Command, Commands } from './common';
import { executeGitCommand } from '../commands';

@command()
export class FetchRepositoriesCommand extends Command {
	constructor() {
		super(Commands.FetchRepositories);
	}

	async execute() {
		return executeGitCommand({ command: 'fetch', state: { repos: await Container.git.getOrderedRepositories() } });
	}
}

@command()
export class PullRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PullRepositories);
	}

	async execute() {
		return executeGitCommand({ command: 'pull', state: { repos: await Container.git.getOrderedRepositories() } });
	}
}

@command()
export class PushRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PushRepositories);
	}

	async execute() {
		return executeGitCommand({ command: 'push', state: { repos: await Container.git.getOrderedRepositories() } });
	}
}
