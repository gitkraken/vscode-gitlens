'use strict';
import { commands } from 'vscode';
import { command, Command, Commands } from './common';

@command()
export class RefreshHoverCommand extends Command {
	constructor() {
		super(Commands.RefreshHover);
	}

	async execute() {
		// TODO@eamodio figure out how to really refresh/update a hover
		await commands.executeCommand('editor.action.showHover');
	}
}
