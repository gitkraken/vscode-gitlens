import { commands } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { Command, getLastCommand } from './base';

@command()
export class ShowLastQuickPickCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ShowLastQuickPick);
	}

	execute() {
		const command = getLastCommand();
		if (command === undefined) return Promise.resolve(undefined);

		try {
			return commands.executeCommand(command.command, ...command.args);
		} catch (ex) {
			Logger.error(ex, 'ShowLastQuickPickCommand');
			return showGenericErrorMessage('Unable to show last quick pick');
		}
	}
}
