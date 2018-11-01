'use strict';
import { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class ToggleCodeLensCommand extends Command {
    constructor() {
        super(Commands.ToggleCodeLens);
    }

    execute() {
        return Container.codeLens.toggleCodeLens();
    }
}
