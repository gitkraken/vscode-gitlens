import { resetAvatarCache } from '../avatars';
import type { Container } from '../container';
import { command, Command, Commands } from './common';

@command()
export class ResetAvatarCacheCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetAvatarCache);
	}

	execute() {
		resetAvatarCache('all');
	}
}
