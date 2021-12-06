'use strict';
import { configuration, OutputLevel } from '../configuration';
import { command, Command, Commands } from './common';

@command()
export class EnableDebugLoggingCommand extends Command {
	constructor() {
		super(Commands.EnableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', OutputLevel.Debug);
	}
}

@command()
export class DisableDebugLoggingCommand extends Command {
	constructor() {
		super(Commands.DisableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', OutputLevel.Errors);
	}
}
