import { commands } from 'vscode';
import type { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { command, Command, Commands, getLastCommand } from './common';

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
			return Messages.showGenericErrorMessage('Unable to show last quick pick');
		}
	}
}
