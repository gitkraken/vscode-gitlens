import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command, Command } from './base';

@command()
export class ResetSuppressedWarningsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetSuppressedWarnings);
	}

	async execute() {
		void (await configuration.update('advanced.messages', undefined, ConfigurationTarget.Global));
	}
}
