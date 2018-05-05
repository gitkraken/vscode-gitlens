'use strict';
import { Command, Commands } from './common';
import { Container } from '../container';

export class ShowResultsExplorerCommand extends Command {

    constructor() {
        super(Commands.ShowResultsExplorer);
    }

    execute() {
        return Container.resultsExplorer.show();
    }
}