import type { WalkthroughSteps } from '../constants';
import { urls } from '../constants';
import type { GlCommands } from '../constants.commands';
import type { Source, Sources } from '../constants.telemetry';
import type { Container } from '../container';
import type { SubscriptionUpgradeCommandArgs } from '../plus/gk/models/subscription';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import { command, executeCommand } from '../system/-webview/command';
import { openWalkthrough as openWalkthroughCore } from '../system/-webview/vscode';
import { openUrl } from '../system/-webview/vscode/uris';
import type { ConnectCloudIntegrationsCommandArgs } from './cloudIntegrations';
import { GlCommandBase } from './commandBase';
import type { WorktreeGitCommandArgs } from './git/worktree';

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

function openWalkthrough(container: Container, args?: OpenWalkthroughCommandArgs) {
	if (container.telemetry.enabled) {
		container.telemetry.sendEvent('walkthrough', { step: args?.step }, args?.source);
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

// gitlens.gitCommands.worktree.create
@command()
export class WalkthroughWorktreeCreateCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.worktree.create');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.gitCommands.worktree.create';
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

// https://help.gitkraken.com/gitlens/gitlens-home/#streamline-collaboration
@command()
export class WalkthroughOpenStreamlineCollaboration extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openStreamlineCollaboration');
	}

	execute(): void {
		const url = urls.streamlineCollaboration;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/streamline-collaboration',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.plus.cloudIntegrations.connect
@command()
export class WalkthroughConnectIntegrationsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.connectIntegrations');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.cloudIntegrations.connect';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'connect/integrations',
			command: command,
		});
		executeCommand<ConnectCloudIntegrationsCommandArgs>(command, {
			source: { source: 'walkthrough' },
		});
	}
}

// gitlens.showSettingsPage!autolinks
@command()
export class WalkthroughShowAutolinksCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showAutolinks');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showSettingsPage!autolinks';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/autolinks',
			command: command,
		});
		executeCommand(command);
	}
}

// https://help.gitkraken.com/gitlens/gitlens-start-here/#integrations
@command()
export class WalkthroughOpenStartIntegrations extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openStartIntegrations');
	}

	execute(): void {
		const url = urls.startIntegrations;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/start-integrations',
			url: url,
		});
		void openUrl(url);
	}
}

// https://help.gitkraken.com/gitlens/home-view
@command()
export class WalkthroughOpenHomeViewVideo extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.openHomeViewVideo');
	}

	execute(): void {
		const url = urls.homeView;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/home-view',
			url: url,
		});
		void openUrl(url);
	}
}

// gitlens.showHomeView
@command()
export class WalkthroughShowHomeViewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.walkthrough.showHomeView');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showHomeView';
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/home',
			command: command,
		});
		executeCommand(command);
	}
}
