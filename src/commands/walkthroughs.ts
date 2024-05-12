import type { WalkthroughSteps } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { openWalkthrough } from '../system/utils';
import { Command } from './base';

export type GetStartedCommandArgs = WalkthroughSteps | undefined;

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	execute(stepId?: WalkthroughSteps) {
		const extensionId = this.container.context.extension.id;
		// If the walkthroughId param is the same as the extension id, then this was run from the extensions view gear menu
		if (stepId === extensionId) {
			stepId = undefined;
		}

		void openWalkthrough(extensionId, 'welcome', stepId, false);
	}
}
