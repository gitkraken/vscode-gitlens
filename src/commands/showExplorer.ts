'use strict';
import { Container } from '../container';
import { Command, CommandContext, Commands } from './common';

export class ShowExplorerCommand extends Command {
    constructor() {
        super([
            Commands.ShowGitExplorer,
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
            case Commands.ShowGitExplorer:
                return Container.gitExplorer.show();
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
