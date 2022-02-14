import { configuration, OutputLevel } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { Command } from './base';

@command()
export class EnableDebugLoggingCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.EnableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', OutputLevel.Debug);
	}
}

@command()
export class DisableDebugLoggingCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.DisableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', OutputLevel.Errors);
	}
}
