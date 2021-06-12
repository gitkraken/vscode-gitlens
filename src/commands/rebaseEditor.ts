'use strict';
import { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class DisableRebaseEditorCommand extends Command {
	constructor() {
		super(Commands.DisableRebaseEditor);
	}

	execute() {
		return Container.rebaseEditor.setEnabled(false);
	}
}

@command()
export class EnableRebaseEditorCommand extends Command {
	constructor() {
		super(Commands.EnableRebaseEditor);
	}

	execute() {
		return Container.rebaseEditor.setEnabled(true);
	}
}
