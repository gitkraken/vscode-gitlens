'use strict';
import { configuration } from '../configuration';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class CloseViewCommand extends Command {
	constructor() {
		super(Commands.CloseWelcomeView);
	}

	protected preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.CloseWelcomeView:
				void (await configuration.updateEffective('views', 'welcome', 'enabled', false));
				break;
		}
	}
}
