import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/vscode/command';
import { Command } from './base';

@command()
export class RefreshHoverCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.RefreshHover);
	}

	async execute() {
		// TODO@eamodio figure out how to really refresh/update a hover
		await executeCoreCommand('editor.action.showHover');
	}
}
