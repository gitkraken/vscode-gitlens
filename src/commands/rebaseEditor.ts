import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class DisableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.DisableRebaseEditor);
	}

	execute(): Promise<void> {
		return this.container.rebaseEditor.setEnabled(false);
	}
}

@command()
export class EnableRebaseEditorCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.EnableRebaseEditor);
	}

	execute(): Promise<void> {
		return this.container.rebaseEditor.setEnabled(true);
	}
}
