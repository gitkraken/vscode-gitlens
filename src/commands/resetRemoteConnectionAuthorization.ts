'use strict';
import { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class ResetRemoteConnectionAuthorizationCommand extends Command {
	constructor() {
		super(Commands.ResetRemoteConnectionAuthorization);
	}

	async execute() {
		for (const repo of await Container.git.getRepositories()) {
			const remote = await Container.git.getRichRemoteProvider(repo.path, { includeDisconnected: true });
			await remote?.provider?.resetRemoteConnectionAuthorization();
		}
	}
}
