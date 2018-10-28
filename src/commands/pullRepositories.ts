'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class PullRepositoriesCommand extends Command {
    constructor() {
        super(Commands.PullRepositories);
    }

    async execute() {
        return Container.git.pullAll();
    }
}
