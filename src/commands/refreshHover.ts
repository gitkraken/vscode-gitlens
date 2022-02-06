import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { executeCoreCommand } from '../system/command';
import { command, Command } from './base';

@command()
export class RefreshHoverCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.RefreshHover);
	}

	async execute() {
		// TODO@eamodio figure out how to really refresh/update a hover
		await executeCoreCommand(CoreCommands.EditorShowHover);
	}
}
