import { resetAvatarCache } from '../avatars';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { Command } from './base';

@command()
export class ResetAvatarCacheCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetAvatarCache);
	}

	execute() {
		resetAvatarCache('all');
	}
}
