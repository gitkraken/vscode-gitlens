import { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { SyncedState } from '../storage';
import { command } from '../system/command';
import { Command, CommandContext } from './base';

@command()
export class CloseViewCommand extends Command {
	constructor(private readonly container: Container) {
		super([Commands.CloseWelcomeView]);
	}

	protected override preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	async execute(command: Commands) {
		switch (command) {
			case Commands.CloseWelcomeView:
				await this.container.storage.store(SyncedState.WelcomeViewVisible, false);
				await setContext(ContextKeys.ViewsWelcomeVisible, false);
				break;
		}
	}
}
