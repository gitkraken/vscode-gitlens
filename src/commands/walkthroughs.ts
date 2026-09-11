import type { GlCommands } from '../constants.commands.js';
import type { WalkthroughSteps } from '../constants.js';
import { urls } from '../constants.js';
import type { Source, TelemetryEvents } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { isWalkthroughSupported } from '../onboarding/walkthroughStateProvider.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { openWalkthrough as openWalkthroughCore } from '../system/-webview/vscode.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { GlCommandBase } from './commandBase.js';

@command()
export class GetStartedCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.getStarted');
	}

	execute(): void {
		// Onboarding is consolidated into the Welcome view; the native walkthrough is only a signpost to it
		void executeCommand('gitlens.showWelcomeView');
	}
}

export interface OpenWalkthroughCommandArgs {
	step?: WalkthroughSteps | undefined;
	source?: Source;
	detail?: string | undefined;
}

@command()
export class OpenWalkthroughCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.openWalkthrough');
	}

	execute(args?: OpenWalkthroughCommandArgs): void {
		openWalkthrough(this.container, args);
	}
}

const helpCenterWalkthroughUrls = new Map<WalkthroughSteps | 'default', string>([
	['default', urls.getStarted],
	['get-started', urls.getStarted],
]);

function openWalkthrough(container: Container, args?: OpenWalkthroughCommandArgs) {
	const walkthroughSupported = isWalkthroughSupported();
	if (container.telemetry.enabled) {
		const walkthroughEvent: TelemetryEvents['walkthrough'] = { step: args?.step };
		if (!walkthroughSupported) {
			walkthroughEvent.usingFallbackUrl = true;
		}
		container.telemetry.sendEvent('walkthrough', walkthroughEvent, args?.source);
	}

	if (!walkthroughSupported) {
		const url = helpCenterWalkthroughUrls.get(args?.step ?? 'default')!;
		void openUrl(url);
		return;
	}

	void openWalkthroughCore(container.context.extension.id, 'welcome', args?.step, false);
}

// gitlens.showWelcomeView
@command()
export class WalkthroughOpenWelcomeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openWelcome');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showWelcomeView';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/welcome',
			command: command,
		});
		executeCommand(command);
	}
}
