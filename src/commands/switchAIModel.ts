import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';
import type { CommandContext } from './commandContext.js';

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
