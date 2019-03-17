'use strict';
import { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class FetchRepositoriesCommand extends Command {
    constructor() {
        super(Commands.FetchRepositories);
    }

    execute() {
        return Container.git.fetchAll();
    }
}

@command()
export class PullRepositoriesCommand extends Command {
    constructor() {
        super(Commands.PullRepositories);
    }

    execute() {
        return Container.git.pullAll();
    }
}

@command()
export class PushRepositoriesCommand extends Command {
    constructor() {
        super(Commands.PushRepositories);
    }

    execute() {
        return Container.git.pushAll();
    }
}
