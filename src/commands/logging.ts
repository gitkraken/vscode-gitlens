import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { GlCommandBase } from './commandBase';

@command()
export class EnableDebugLoggingCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.EnableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', 'debug');
	}
}

@command()
export class DisableDebugLoggingCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.DisableDebugLogging);
	}

	async execute() {
		await configuration.updateEffective('outputLevel', 'error');
	}
}
