import type { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class ToggleCodeLensCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ToggleCodeLens);
	}

	execute() {
		return this.container.codeLens.toggleCodeLens();
	}
}
