'use strict';
import { command, Command, Commands } from './common';
import { configuration, TraceLevel } from '../configuration';

@command()
export class EnableDebugLoggingCommand extends Command {
	constructor() {
		super(Commands.EnableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', TraceLevel.Debug);
	}
}

@command()
export class DisableDebugLoggingCommand extends Command {
	constructor() {
		super(Commands.DisableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', TraceLevel.Errors);
	}
}
