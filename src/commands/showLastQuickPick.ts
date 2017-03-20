'use strict';
import { commands, window } from 'vscode';
import { Command, Commands, getLastCommand } from './commands';
import { Logger } from '../logger';

export class ShowLastQuickPickCommand extends Command {

    constructor() {
        super(Commands.ShowLastQuickPick);
    }

    async execute() {
        const command = getLastCommand();
        if (!command) return undefined;

        try {
            return commands.executeCommand(command.command, ...command.args);
        }
        catch (ex) {
            Logger.error('[GitLens.ShowLastQuickPickCommand]', ex);
            return window.showErrorMessage(`Unable to show last quick pick. See output channel for more details`);
        }
    }
}