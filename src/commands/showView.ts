'use strict';
import { Container } from '../container';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class ShowViewCommand extends Command {
    constructor() {
        super([
            Commands.ShowRepositoriesView,
            Commands.ShowFileHistoryView,
            Commands.ShowLineHistoryView,
            Commands.ShowResultsView,
            Commands.ShowSearchView
        ]);
    }

    protected async preExecute(context: CommandContext): Promise<any> {
        return this.execute(context.command as Commands);
    }

    execute(command: Commands) {
        switch (command) {
            case Commands.ShowRepositoriesView:
                return Container.repositoriesView.show();
            case Commands.ShowFileHistoryView:
                return Container.fileHistoryView.show();
            case Commands.ShowLineHistoryView:
                return Container.lineHistoryView.show();
            case Commands.ShowResultsView:
                return Container.resultsView.show();
            case Commands.ShowSearchView:
                return Container.searchView.show();
        }

        return undefined;
    }
}
