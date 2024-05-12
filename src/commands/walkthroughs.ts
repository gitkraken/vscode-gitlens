import type { TelemetrySources, WalkthroughSteps } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { openWalkthrough as openWalkthroughCore } from '../system/utils';
import { Command } from './base';

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	execute(extensionIdOrsource?: TelemetrySources) {
		// If the extensionIdOrsource is the same as the current extension, then it came from the extension content menu in the extension view, so don't pass the source
		const source = extensionIdOrsource !== this.container.context.extension.id ? undefined : extensionIdOrsource;
		openWalkthrough(this.container, source ? { source: source } : undefined);
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
		openWalkthrough(this.container, args);
	}
}

function openWalkthrough(container: Container, args?: OpenWalkthroughCommandArgs) {
	if (container.telemetry.enabled) {
		container.telemetry.sendEvent('walkthrough', {
			step: args?.step,
			source: args?.source ?? 'commandPalette',
			detail: args?.detail,
		});
	}

	void openWalkthroughCore(container.context.extension.id, 'welcome', args?.step, false);
}
