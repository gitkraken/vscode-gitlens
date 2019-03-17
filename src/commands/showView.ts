'use strict';
import { Container } from '../container';
import { command, Command, CommandContext, Commands } from './common';

@command()
export class ShowViewCommand extends Command {
    constructor() {
        super([
            Commands.ShowCompareView,
            Commands.ShowFileHistoryView,
            Commands.ShowLineHistoryView,
            Commands.ShowRepositoriesView,
            Commands.ShowSearchView
        ]);
    }

    protected preExecute(context: CommandContext) {
        return this.execute(context.command as Commands);
    }

    execute(command: Commands) {
        switch (command) {
            case Commands.ShowCompareView:
                return Container.compareView.show();
            case Commands.ShowFileHistoryView:
                return Container.fileHistoryView.show();
            case Commands.ShowLineHistoryView:
                return Container.lineHistoryView.show();
            case Commands.ShowRepositoriesView:
                return Container.repositoriesView.show();
            case Commands.ShowSearchView:
                return Container.searchView.show();
        }

        return Promise.resolve(undefined);
    }
}
