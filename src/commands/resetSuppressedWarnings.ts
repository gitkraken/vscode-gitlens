'use strict';
import { ConfigurationTarget } from 'vscode';
import { configuration } from '../configuration';
import { Command, Commands } from './common';

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
