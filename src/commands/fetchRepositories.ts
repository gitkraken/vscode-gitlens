'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class FetchRepositoriesCommand extends Command {
    constructor() {
        super(Commands.FetchRepositories);
    }

    async execute() {
        return Container.git.fetchAll();
    }
}
