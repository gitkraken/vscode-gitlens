import { commands } from 'vscode';
import type { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class RefreshHoverCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.RefreshHover);
	}

	async execute() {
		// TODO@eamodio figure out how to really refresh/update a hover
		await commands.executeCommand('editor.action.showHover');
	}
}
