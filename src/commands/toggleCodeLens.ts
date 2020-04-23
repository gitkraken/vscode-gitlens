'use strict';
import { command, Command, Commands } from './common';
import { Container } from '../container';

@command()
export class ToggleCodeLensCommand extends Command {
	constructor() {
		super(Commands.ToggleCodeLens);
	}

	execute() {
		return Container.codeLens.toggleCodeLens();
	}
}
