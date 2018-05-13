'use strict';
import { Command, Commands } from './common';
import { GitExplorerView } from '../configuration';
import { Container } from '../container';

export class ShowGitExplorerCommand extends Command {

    constructor() {
        super(Commands.ShowGitExplorer);
    }

    execute() {
        return Container.gitExplorer.show(GitExplorerView.Repository);
    }
}