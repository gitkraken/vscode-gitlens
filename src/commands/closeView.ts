'use strict';
import { configuration } from '../configuration';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class CloseViewCommand extends Command {
	constructor() {
		super([Commands.CloseWelcomeView, Commands.CloseUpdatesView]);
	}

	protected preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.CloseWelcomeView:
				void (await configuration.updateEffective('views', 'welcome', 'enabled', false));
				break;
			case Commands.CloseUpdatesView:
				void (await configuration.updateEffective('views', 'updates', 'enabled', false));
				break;
		}
	}
}
