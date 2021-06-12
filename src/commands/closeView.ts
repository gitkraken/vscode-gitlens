'use strict';
import { ContextKeys, setContext, SyncedState } from '../constants';
import { Container } from '../container';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class CloseViewCommand extends Command {
	constructor() {
		super([Commands.CloseWelcomeView, Commands.CloseUpdatesView]);
	}

	protected override preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.CloseWelcomeView:
				await Container.context.globalState.update(SyncedState.WelcomeViewVisible, false);
				await setContext(ContextKeys.ViewsWelcomeVisible, false);
				break;
			case Commands.CloseUpdatesView:
				await Container.context.globalState.update(SyncedState.UpdatesViewVisible, false);
				await setContext(ContextKeys.ViewsUpdatesVisible, false);
				break;
		}
	}
}
