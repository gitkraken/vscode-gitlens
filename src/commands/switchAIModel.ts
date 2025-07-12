import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';

@command()
export class SwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.switchProvider', ['gitlens.switchAIModel']);
	}

	async execute(source?: Source): Promise<void> {
		await this.container.ai.switchModel(source);
	}
}
