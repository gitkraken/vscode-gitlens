import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { GlCommandBase } from './base';

@command()
export class DisableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.DisableRebaseEditor);
	}

	execute() {
		return this.container.rebaseEditor.setEnabled(false);
	}
}

@command()
export class EnableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.EnableRebaseEditor);
	}

	execute() {
		return this.container.rebaseEditor.setEnabled(true);
	}
}
