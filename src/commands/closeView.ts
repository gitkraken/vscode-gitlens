import { ContextKeys, setContext } from '../constants';
import type { Container } from '../container';
import { SyncedState } from '../storage';
import { command, Command, CommandContext, Commands } from './common';

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
