import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { Command } from './base';

@command()
export class ToggleCodeLensCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ToggleCodeLens);
	}

	execute() {
		this.container.codeLens.toggleCodeLens();
	}
}
