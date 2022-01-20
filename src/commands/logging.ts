'use strict';
import { configuration, OutputLevel } from '../configuration';
import type { Container } from '../container';
import { command, Command, Commands } from './common';

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
