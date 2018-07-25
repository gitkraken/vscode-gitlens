'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class ShowGitExplorerCommand extends Command {
    constructor() {
        super(Commands.ShowGitExplorer);
    }

    execute() {
        return Container.gitExplorer.show();
    }
}
