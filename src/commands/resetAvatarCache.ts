'use strict';
import { resetAvatarCache } from '../avatars';
import { command, Command, Commands } from './common';

@command()
export class ResetAvatarCacheCommand extends Command {
	constructor() {
		super(Commands.ResetAvatarCache);
	}

	execute() {
		resetAvatarCache('all');
	}
}
