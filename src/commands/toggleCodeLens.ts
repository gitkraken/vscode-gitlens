'use strict';
import { Command, Commands } from './common';
import { Container } from '../container';

export class ToggleCodeLensCommand extends Command {

    constructor() {
        super(Commands.ToggleCodeLens);
    }

    execute() {
        return Container.codeLens.toggleCodeLens();
    }
}
