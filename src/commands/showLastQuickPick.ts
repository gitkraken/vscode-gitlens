import { commands } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { Logger } from '../system/logger';
import { command } from '../system/vscode/command';
import { getLastCommand, GlCommandBase } from './base';

@command()
export class ShowLastQuickPickCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ShowLastQuickPick);
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
