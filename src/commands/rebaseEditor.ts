import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { Command } from './base';

@command()
export class DisableRebaseEditorCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.DisableRebaseEditor);
	}

	execute() {
		return this.container.rebaseEditor.setEnabled(false);
	}
}

@command()
export class EnableRebaseEditorCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.EnableRebaseEditor);
	}

	execute() {
		return this.container.rebaseEditor.setEnabled(true);
	}
}
