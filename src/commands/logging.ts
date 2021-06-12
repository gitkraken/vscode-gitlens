'use strict';
import { configuration, TraceLevel } from '../configuration';
import { command, Command, Commands } from './common';

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
