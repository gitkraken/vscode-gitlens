'use strict';
import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { command, Command, Commands } from './common';

@command()
export class ResetSuppressedWarningsCommand extends Command {
    constructor() {
        super(Commands.ResetSuppressedWarnings);
    }

    async execute() {
        await configuration.update(
            configuration.name('advanced')('messages').value,
            undefined,
            ConfigurationTarget.Global
        );
    }
}
