import { ConfigurationTarget } from 'vscode';
import { resetAvatarCache } from '../avatars';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { Command } from './base';

@command()
export class ResetAIKeyCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetAIKey);
	}

	execute() {
		this.container.ai.reset();
	}
}

@command()
export class ResetAvatarCacheCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetAvatarCache);
	}

	execute() {
		resetAvatarCache('all');
	}
}

@command()
export class ResetSuppressedWarningsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetSuppressedWarnings);
	}

	async execute() {
		await configuration.update('advanced.messages', undefined, ConfigurationTarget.Global);
	}
}

@command()
export class ResetTrackedUsageCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.ResetTrackedUsage);
	}

	async execute() {
		await this.container.usage.reset();
	}
}
