import type { WalkthroughSteps } from '../constants';
import { urls } from '../constants';
import { Commands } from '../constants.commands';
import type { Source, Sources } from '../constants.telemetry';
import type { Container } from '../container';
import { command, executeCommand } from '../system/vscode/command';
import { openUrl, openWalkthrough as openWalkthroughCore } from '../system/vscode/utils';
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

// gitlens.openWalkthrough
@command()
export class WalkthroughOpenWalkthroughCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenWalkthrough);
	}

	execute() {
		const command = Commands.OpenWalkthrough;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/walkthrough',
			command: command,
		});
		executeCommand(command);
	}
}

// gitlens.plus.upgrade
@command()
export class WalkthroughPlusUpgradeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughPlusUpgrade);
	}

	execute() {
		const command = Commands.PlusUpgrade;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/upgrade',
			command: command,
		});
		executeCommand(command);
	}
}

// https://help.gitkraken.com/gitlens/gitlens-home/
@command()
export class WalkthroughOpenHelpCenterCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenHelpCenter);
	}

	execute() {
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
export class WalkthroughPlusSignUpCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughPlusSignUp);
	}

	execute() {
		const command = Commands.PlusSignUp;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/sign-up',
			command: command,
		});
		executeCommand(command);
	}
}

@command()
export class WalkthroughPlusReactivateCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughPlusReactivate);
	}

	execute() {
		const command = Commands.PlusReactivateProTrial;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'plus/reactivate',
			command: command,
		});
		executeCommand(command);
	}
}

// https://help.gitkraken.com/gitlens/gitlens-community-vs-gitlens-pro/
@command()
export class WalkthroughOpenCommunityVsProCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenCommunityVsPro);
	}

	execute() {
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
export class WalkthroughShowGraphCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughShowGraph);
	}

	execute() {
		const command = Commands.ShowGraph;
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
export class WalkthroughGitLensInspectCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughGitLensInspect);
	}

	execute() {
		const command = Commands.ShowCommitDetailsView;
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
export class WalkthroughOpenInteractiveCodeHistoryCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenInteractiveCodeHistory);
	}

	execute() {
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
export class WalkthroughShowLaunchpadCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughShowLaunchpad);
	}

	execute() {
		const command = Commands.ShowLaunchpad;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'open/launchpad',
			command: command,
		});
		executeCommand(command);
	}
}

// gitlens.gitCommands.worktree.create
@command()
export class WalkthroughWorktreeCreateCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughWorktreeCreate);
	}

	execute() {
		const command = Commands.GitCommandsWorktreeCreate;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'create/worktree',
			command: command,
		});
		executeCommand(command);
	}
}

@command()
export class WalkthroughOpenDevExPlatformCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthoughOpenDevExPlatform);
	}

	execute() {
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
export class WalkthroughOpenAccelereatePrReviewsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenAcceleratePrReviews);
	}

	execute() {
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
export class WalkthroughShowDraftsViewCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughShowDraftsView);
	}

	execute() {
		const command = Commands.ShowDraftsView;
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
export class WalkthroughOpenStreamlineCollaboration extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenStreamlineCollaboration);
	}

	execute() {
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
export class WalkthroughConnectIntegrationsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughConnectIntegrations);
	}

	execute() {
		const command = Commands.PlusConnectCloudIntegrations;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'command',
			name: 'connect/integrations',
			command: command,
		});
		executeCommand(command);
	}
}

// gitlens.showSettingsPage!autolinks
@command()
export class WalkthroughShowAutolinksCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughShowAutolinks);
	}

	execute() {
		const command = Commands.ShowSettingsPageAndJumpToAutolinks;
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
export class WalkthroughOpenStartIntegrations extends Command {
	constructor(private readonly container: Container) {
		super(Commands.WalkthroughOpenStartIntegrations);
	}

	execute() {
		const url = urls.startIntegrations;
		this.container.telemetry.sendEvent('walkthrough/action', {
			type: 'url',
			name: 'open/help-center/start-integrations',
			url: url,
		});
		void openUrl(url);
	}
}
