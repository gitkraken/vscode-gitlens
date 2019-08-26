'use strict';
import { commands } from 'vscode';
import { Container } from '../container';
import { command, Command, Commands } from './common';
import { GitCommandsCommandArgs } from '../commands';

@command()
export class FetchRepositoriesCommand extends Command {
	constructor() {
		super(Commands.FetchRepositories);
	}

	async execute() {
		const repositories = await Container.git.getOrderedRepositories();

		const args: GitCommandsCommandArgs = { command: 'fetch', state: { repos: repositories } };
		return commands.executeCommand(Commands.GitCommands, args);
	}
}

@command()
export class PullRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PullRepositories);
	}

	async execute() {
		const repositories = await Container.git.getOrderedRepositories();

		const args: GitCommandsCommandArgs = { command: 'pull', state: { repos: repositories } };
		return commands.executeCommand(Commands.GitCommands, args);
	}
}

@command()
export class PushRepositoriesCommand extends Command {
	constructor() {
		super(Commands.PushRepositories);
	}

	async execute() {
		const repositories = await Container.git.getOrderedRepositories();

		const args: GitCommandsCommandArgs = { command: 'push', state: { repos: repositories } };
		return commands.executeCommand(Commands.GitCommands, args);
	}
}
