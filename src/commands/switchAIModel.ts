import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class SwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.switchAIModel');
	}

	async execute(): Promise<void> {
		await (await this.container.ai)?.switchModel();
	}
}
