'use strict';
import { command, Command, Commands } from './common';
import { Messages } from '../messages';

@command()
export class SupportGitLensCommand extends Command {
	constructor() {
		super(Commands.SupportGitLens);
	}

	execute() {
		return Messages.showSupportGitLensMessage();
	}
}
