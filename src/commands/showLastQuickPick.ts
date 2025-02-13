import { commands } from 'vscode';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { getLastCommand, GlCommandBase } from './commandBase';

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
