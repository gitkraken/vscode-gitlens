'use strict';
import { Messages } from '../messages';
import { command, Command, Commands } from './common';

@command()
export class SupportGitLensCommand extends Command {
    constructor() {
        super(Commands.SupportGitLens);
    }

    execute() {
        return Messages.showSupportGitLensMessage();
    }
}
