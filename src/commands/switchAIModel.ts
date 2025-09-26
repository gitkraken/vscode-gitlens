import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { GlCommandBase } from './commandBase';
import type { CommandContext } from './commandContext';

@command()
export class SwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.switchProvider', 'gitlens.ai.switchProvider:scm'], ['gitlens.switchAIModel']);
	}

	protected override preExecute(context: CommandContext, source?: Source): Promise<void> {
		if (context.command === 'gitlens.ai.switchProvider:scm') {
			source ??= { source: 'scm' };
		}

		return this.execute(source);
	}

	async execute(source?: Source): Promise<void> {
		await this.container.ai.switchModel(source);
	}
}
