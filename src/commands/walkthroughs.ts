import type { WalkthroughSteps } from '../constants';
import { Commands } from '../constants.commands';
import type { Source, Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { command } from '../system/vscode/command';
import { openWalkthrough as openWalkthroughCore } from '../system/vscode/utils';
import { Command } from './base';

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	execute(extensionIdOrsource?: Sources) {
		// If the extensionIdOrsource is the same as the current extension, then it came from the extension content menu in the extension view, so don't pass the source
		const source = extensionIdOrsource !== this.container.context.extension.id ? undefined : extensionIdOrsource;
		openWalkthrough(this.container, source ? { source: source } : undefined);
	}
}

export interface OpenWalkthroughCommandArgs extends Source {
	step?: WalkthroughSteps | undefined;
}

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
		container.telemetry.sendEvent(
			'walkthrough',
			{ step: args?.step },
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}

	void openWalkthroughCore(container.context.extension.id, 'welcome', args?.step, false);
}
