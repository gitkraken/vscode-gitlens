import type { WalkthroughSteps } from '../constants';
import { Commands } from '../constants.commands';
import type { Source, Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { command } from '../system/command';
import { openWalkthrough as openWalkthroughCore } from '../system/utils';
import type { CommandContext } from './base';
import { Command } from './base';

@command()
export class GetStartedCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.GetStarted);
	}

	private isSourceArg(arg: Sources | OpenWalkthroughCommandArgs): arg is OpenWalkthroughCommandArgs['source'] {
		return typeof arg === 'string';
	}

	protected override preExecute(_context: CommandContext, args: Sources | OpenWalkthroughCommandArgs) {
		if (this.isSourceArg(args)) {
			// If the extensionIdOrsource is the same as the current extension, then it came from the extension content menu in the extension view, so don't pass the source
			const source = args !== this.container.context.extension.id ? undefined : args;
			this.execute(source ? { source: source } : undefined);
		} else {
			this.execute(args);
		}

		return Promise.resolve();
	}

	execute(args?: OpenWalkthroughCommandArgs) {
		openWalkthrough(this.container, args);
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
