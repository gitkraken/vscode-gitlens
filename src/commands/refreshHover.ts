import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command, executeCoreCommand } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class RefreshHoverCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.RefreshHover);
	}

	async execute() {
		// TODO@eamodio figure out how to really refresh/update a hover
		await executeCoreCommand('editor.action.showHover');
	}
}
