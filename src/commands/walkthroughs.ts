import type { TelemetrySources, WalkthroughSteps } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { openWalkthrough } from '../system/utils';
import { Command } from './base';

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	execute() {
		void openWalkthrough(this.container.context.extension.id, 'welcome', undefined, false);
	}
}

export type OpenWalkthroughCommandArgs = {
	step?: WalkthroughSteps | undefined;
	source: TelemetrySources;
	detail?: string;
};

@command()
export class OpenWalkthroughCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenWalkthrough);
	}

	execute(args?: OpenWalkthroughCommandArgs) {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('walkthrough', {
				step: args?.step,
				source: args?.source ?? 'commandPalette',
				detail: args?.detail,
			});
		}

		void openWalkthrough(this.container.context.extension.id, 'welcome', args?.step, false);
	}
}
