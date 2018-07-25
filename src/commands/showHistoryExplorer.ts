'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class ShowHistoryExplorerCommand extends Command {
    constructor() {
        super(Commands.ShowHistoryExplorer);
    }

    execute() {
        return Container.historyExplorer.show();
    }
}
