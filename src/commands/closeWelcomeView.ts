'use strict';
import { configuration } from '../configuration';
import { command, Command, Commands } from './common';

@command()
export class CloseWelcomeViewCommand extends Command {
	constructor() {
		super(Commands.CloseWelcomeView);
	}

	async execute() {
		void (await configuration.updateEffective('views', 'welcome', 'enabled', false));
	}
}
