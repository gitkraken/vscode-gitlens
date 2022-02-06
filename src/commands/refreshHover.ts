import { CoreCommands } from '../constants';
import type { Container } from '../container';
import { command, Command, Commands, executeCoreCommand } from './common';

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
