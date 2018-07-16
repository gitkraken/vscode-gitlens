'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class ShowResultsExplorerCommand extends Command {
    constructor() {
        super(Commands.ShowResultsExplorer);
    }

    execute() {
        return Container.resultsExplorer.show();
    }
}
