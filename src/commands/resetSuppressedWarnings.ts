import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { Command } from './base';

@command()
export class ResetSuppressedWarningsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetSuppressedWarnings);
	}

	async execute() {
		(await configuration.update('advanced.messages', undefined, ConfigurationTarget.Global));
	}
}
