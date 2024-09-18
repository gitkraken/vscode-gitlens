import { Commands } from '../constants.commands';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { Command } from './base';

@command()
export class SwitchAIModelCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.SwitchAIModel);
	}

	async execute() {
		await (await this.container.ai)?.switchModel();
	}
}
