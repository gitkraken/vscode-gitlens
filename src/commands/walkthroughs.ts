import type { GlCommands } from '../constants.commands.js';
import type { WalkthroughSteps } from '../constants.js';
import { urls } from '../constants.js';
import type { Source, Sources, TelemetryEvents } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { SubscriptionUpgradeCommandArgs } from '../plus/gk/models/subscription.js';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad.js';
import { command, executeCommand, executeCoreCommand } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import { openWalkthrough as openWalkthroughCore } from '../system/-webview/vscode.js';
import { isWalkthroughSupported } from '../telemetry/walkthroughStateProvider.js';
import type { ComposerWebviewShowingArgs } from '../webviews/plus/composer/registration.js';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController.js';
import { GlCommandBase } from './commandBase.js';
import type { WorktreeGitCommandArgs } from './git/worktree.js';

@command()
export class GetStartedCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.getStarted');
	}

	execute(extensionIdOrsource?: Sources): void {
		// If the extensionIdOrsource is the same as the current extension, then it came from the extension content menu in the extension view, so don't pass the source
		const source = extensionIdOrsource !== this.container.context.extension.id ? undefined : extensionIdOrsource;
		openWalkthrough(this.container, source ? { source: { source: source } } : undefined);
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
	['welcome-in-trial', urls.welcomeInTrial],
	['welcome-paid', urls.welcomePaid],
	['welcome-in-trial-expired-eligible', urls.welcomeTrialReactivationEligible],
	['welcome-in-trial-expired', urls.welcomeTrialExpired],
	['get-started-community', urls.getStarted],
	['visualize-code-history', urls.interactiveCodeHistory],
	['accelerate-pr-reviews', urls.acceleratePrReviews],
	['improve-workflows-with-integrations', urls.startIntegrations],
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

// gitlens.openWalkthrough
@command()
export class WalkthroughOpenWalkthroughCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openWalkthrough');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.openWalkthrough';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/walkthrough',
			command: command,
		});
		executeCommand<OpenWalkthroughCommandArgs>(command, { source: { source: 'walkthrough' } });
	}
}

// gitlens.plus.upgrade
@command()
export class WalkthroughPlusUpgradeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.plus.upgrade');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.upgrade';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/upgrade',
			command: command,
		});
		executeCommand<SubscriptionUpgradeCommandArgs>(command, { source: 'walkthrough' });
	}
}

// https://help.gitkraken.com/gitlens/gitlens-home/
@command()
export class WalkthroughOpenHelpCenterCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openHelpCenter');
	}

	execute(): void {
		const url = urls.helpCenter;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.plus.signUp
@command()
export class WalkthroughPlusSignUpCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.plus.signUp');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.signUp';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/sign-up',
			command: command,
		});
		executeCommand<Source>(command, { source: 'walkthrough' });
	}
}

// gitlens.plus.login
@command()
export class WalkthroughPlusLoginCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.plus.login');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.login';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/login',
			command: command,
		});
		executeCommand<Source>(command, { source: 'walkthrough' });
	}
}

@command()
export class WalkthroughPlusReactivateCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.plus.reactivate');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.reactivateProTrial';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/reactivate',
			command: command,
		});
		executeCommand<Source>(command, { source: 'walkthrough' });
	}
}

// https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/
@command()
export class WalkthroughOpenCommunityVsProCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openCommunityVsPro');
	}

	execute(): void {
		const url = urls.communityVsPro;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/community-vs-pro',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.showGraph
@command()
export class WalkthroughShowGraphCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showGraph');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showGraph';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/graph',
			command: command,
		});
		executeCommand(command);
	}
}

@command()
export class WalkthroughShowComposerCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showComposer');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showComposerPage';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/composer',
			command: command,
		});
		executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(command, undefined, {
			source: 'walkthrough',
		});
	}
}

// workbench.view.extension.gitlensInspect
@command()
export class WalkthroughGitLensInspectCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.gitlensInspect');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showCommitDetailsView';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/inspect',
			command: command,
		});
		executeCommand(command);
	}
}

// https://help.gitkraken.com/gitlens/gitlens-home/#interactive-code-history
@command()
export class WalkthroughOpenInteractiveCodeHistoryCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openInteractiveCodeHistory');
	}

	execute(): void {
		const url = urls.interactiveCodeHistory;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/interactive-code-history',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.showLaunchpad
@command()
export class WalkthroughShowLaunchpadCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showLaunchpad');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showLaunchpad';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/launchpad',
			command: command,
		});
		executeCommand<Partial<LaunchpadCommandArgs>>(command, {
			source: 'walkthrough',
		});
	}
}

// gitlens.git.worktree.create
@command()
export class WalkthroughWorktreeCreateCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.worktree.create');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.git.worktree.create';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'create/worktree',
			command: command,
		});
		executeCommand<Partial<WorktreeGitCommandArgs>>(command);
	}
}

@command()
export class WalkthroughOpenDevExPlatformCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openDevExPlatform');
	}

	execute(): void {
		const url = urls.platform;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/devex-platform',
			url: url,
		});
		void openUrl(url);
	}
}

// https://help.gitkraken.com/gitlens/gitlens-home/#accelerate-pr-reviews
@command()
export class WalkthroughOpenAccelereatePrReviewsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openAcceleratePrReviews');
	}

	execute(): void {
		const url = urls.acceleratePrReviews;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/accelerate-pr-reviews',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.views.drafts.focus
@command()
export class WalkthroughShowDraftsViewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showDraftsView');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showDraftsView';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/drafts',
			command: command,
		});
		executeCommand(command);
	}
}

// gitlens.ai.switchProvider
@command()
export class WalkthroughSwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.switchAIProvider');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.ai.switchProvider';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'switch/ai-model',
			command: command,
		});
		executeCommand(command);
	}
}

// command:workbench.action.openSettings?%22gitlens.ai%22
@command()
export class WalkthroughEnableAiSetting extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.enableAiSetting');
	}

	execute(): void {
		// should open to the VS Code settings page to the GitLens AI settings

		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/ai-enable-setting',
			command: 'workbench.action.openSettings',
			detail: '@id:gitlens.ai.enabled',
		});
		executeCoreCommand('workbench.action.openSettings', '@id:gitlens.ai.enabled');
	}
}

// command:workbench.action.openSettings?%22gitlens.ai%22
@command()
export class WalkthroughOpenAiCustomInstructionsSettings extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openAiCustomInstructionsSettings');
	}

	execute(): void {
		// should open to the VS Code settings page to the GitLens AI settings

		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/ai-custom-instructions-settings',
			command: 'workbench.action.openSettings',
			detail: '@ext:eamodio.gitlens gitlens.ai custom instructions',
		});
		executeCoreCommand('workbench.action.openSettings', '@ext:eamodio.gitlens gitlens.ai custom instructions');
	}
}

// command:workbench.action.openSettings?%22gitlens.ai%22
@command()
export class WalkthroughOpenAiSettings extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openAiSettings');
	}

	execute(): void {
		// should open to the VS Code settings page to the GitLens AI settings

		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/ai-settings',
			command: 'workbench.action.openSettings',
			detail: 'gitlens.ai',
		});
		executeCoreCommand('workbench.action.openSettings', 'gitlens.ai');
	}
}

// https://help.gitkraken.com/gitlens/gitlens-ai
@command()
export class WalkthroughOpenLearnAboutAiFeatures extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openLearnAboutAiFeatures');
	}

	execute(): void {
		const url = urls.aiFeatures;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/ai-features',
			url: url,
		});
		void openUrl(url);
	}
}
