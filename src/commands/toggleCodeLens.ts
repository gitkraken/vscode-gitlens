import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class ToggleCodeLensCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.ToggleCodeLens);
	}

	execute() {
		this.container.codeLens.toggleCodeLens();
	}
}
