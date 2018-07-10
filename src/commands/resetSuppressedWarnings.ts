'use strict';
import { ConfigurationTarget } from 'vscode';
import { Command, Commands } from './common';
import { configuration } from '../configuration';

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
