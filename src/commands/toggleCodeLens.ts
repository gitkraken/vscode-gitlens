'use strict';
import { Container } from '../container';
import { Command, Commands } from './common';

export class ToggleCodeLensCommand extends Command {
    constructor() {
        super(Commands.ToggleCodeLens);
    }

    execute() {
        return Container.codeLens.toggleCodeLens();
    }
}
