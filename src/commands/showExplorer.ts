'use strict';
import { Container } from '../container';
import { Command, CommandContext, Commands } from './common';

export class ShowExplorerCommand extends Command {
    constructor() {
        super([
            Commands.ShowRepositoriesExplorer,
            Commands.ShowFileHistoryExplorer,
            Commands.ShowLineHistoryExplorer,
            Commands.ShowResultsExplorer
        ]);
    }

    protected async preExecute(context: CommandContext): Promise<any> {
        return this.execute(context.command as Commands);
    }

    execute(command: Commands) {
        switch (command) {
            case Commands.ShowRepositoriesExplorer:
                return Container.repositoriesExplorer.show();
            case Commands.ShowFileHistoryExplorer:
                return Container.fileHistoryExplorer.show();
            case Commands.ShowLineHistoryExplorer:
                return Container.lineHistoryExplorer.show();
            case Commands.ShowResultsExplorer:
                return Container.resultsExplorer.show();
        }

        return undefined;
    }
}
