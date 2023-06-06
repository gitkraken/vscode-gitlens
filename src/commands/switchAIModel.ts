import { Commands } from '../constants';
import type { Container } from '../container';
import { showAIModelPicker } from '../quickpicks/aiModelPicker';
import { command } from '../system/command';
import { configuration } from '../system/configuration';
import { Command } from './base';

@command()
export class SwitchAIModelCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SwitchAIModel);
	}

	async execute() {
		const pick = await showAIModelPicker();
		if (pick == null) return;

		await configuration.updateEffective('ai.experimental.provider', pick.provider);
		await configuration.updateEffective(`ai.experimental.${pick.provider}.model`, pick.model);
	}
}
