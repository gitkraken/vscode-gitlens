'use strict';
import { Container } from '../container';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class ShowViewCommand extends Command {
	constructor() {
		super([
			Commands.ShowFileHistoryView,
			Commands.ShowLineHistoryView,
			Commands.ShowRepositoriesView,
			Commands.ShowSearchAndCompareView,
		]);
	}

	protected preExecute(context: CommandContext) {
		return this.execute(context.command as Commands);
	}

	execute(command: Commands) {
		switch (command) {
			case Commands.ShowFileHistoryView:
				return Container.fileHistoryView.show();
			case Commands.ShowLineHistoryView:
				return Container.lineHistoryView.show();
			case Commands.ShowRepositoriesView:
				return Container.repositoriesView.show();
			case Commands.ShowSearchAndCompareView:
				return Container.searchAndCompareView.show();
		}

		return Promise.resolve(undefined);
	}
}
