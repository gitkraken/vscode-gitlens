'use strict';
import { commands } from 'vscode';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { command, Command, Commands, getLastCommand } from './common';

@command()
export class ShowLastQuickPickCommand extends Command {
    constructor() {
        super(Commands.ShowLastQuickPick);
    }

    async execute() {
        const command = getLastCommand();
        if (command === undefined) return undefined;

        try {
            return commands.executeCommand(command.command, ...command.args);
        }
        catch (ex) {
            Logger.error(ex, 'ShowLastQuickPickCommand');
            return Messages.showGenericErrorMessage('Unable to show last quick pick');
        }
    }
}
