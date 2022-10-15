import { commands } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { Command, getLastCommand } from './base';

const localize = nls.loadMessageBundle();

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
			return showGenericErrorMessage(localize('unableToShowLastQuickPick', 'Unable to show last quick pick'));
		}
	}
}
