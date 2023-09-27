import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { Command } from './base';

@command()
export class EnableDebugLoggingCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.EnableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', 'debug');
	}
}

@command()
export class DisableDebugLoggingCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.DisableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', 'errors');
	}
}
