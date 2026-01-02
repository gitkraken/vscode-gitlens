import { commands } from 'vscode';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { getLastCommand, GlCommandBase } from './commandBase.js';

@command()
export class ShowLastQuickPickCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.showLastQuickPick');
	}

	execute(): Thenable<unknown> {
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
