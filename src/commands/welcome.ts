import type { GlCommands } from '../constants.commands.js';
import { urls } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { SubscriptionUpgradeCommandArgs } from '../plus/gk/models/subscription.js';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad.js';
import { command, executeCommand, executeCoreCommand } from '../system/-webview/command.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import type { ComposerWebviewShowingArgs } from '../webviews/plus/composer/registration.js';
import type { WebviewPanelShowCommandArgs } from '../webviews/webviewsController.js';
import { GlCommandBase } from './commandBase.js';

// Welcome page commands - these send 'welcome/action' telemetry events
// instead of 'walkthrough/action' events used by the VS Code walkthrough

@command()
export class WelcomePlusUpgradeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.plus.upgrade');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.upgrade';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'plus/upgrade',
			command: command,
		});
		executeCommand<SubscriptionUpgradeCommandArgs>(command, { source: 'welcome' });
	}
}

@command()
export class WelcomeOpenHelpCenterCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.openHelpCenter');
	}

	execute(): void {
		const url = urls.helpCenter;
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'url',
			name: 'open/help-center',
			url: url,
		});
		void openUrl(url);
	}
}

@command()
export class WelcomePlusSignUpCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.plus.signUp');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.signUp';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'plus/sign-up',
			command: command,
		});
		executeCommand<Source>(command, { source: 'welcome' });
	}
}

@command()
export class WelcomePlusLoginCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.plus.login');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.login';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'plus/login',
			command: command,
		});
		executeCommand<Source>(command, { source: 'welcome' });
	}
}

@command()
export class WelcomePlusReactivateCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.plus.reactivate');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.plus.reactivateProTrial';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'plus/reactivate',
			command: command,
		});
		executeCommand<Source>(command, { source: 'welcome' });
	}
}

@command()
export class WelcomeOpenCommunityVsProCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.openCommunityVsPro');
	}

	execute(): void {
		const url = urls.communityVsPro;
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'url',
			name: 'open/help-center/community-vs-pro',
			url: url,
		});
		void openUrl(url);
	}
}

@command()
export class WelcomeCloseCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.views.welcome.close');
	}

	execute(): void {
		void executeCoreCommand('gitlens.views.welcome.toggleVisibility');
		void this.container.views.home.show();
	}
}

@command()
export class WelcomeShowHomeViewCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.showHomeView');
	}

	async execute(): Promise<void> {
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'open/home-view',
			command: 'gitlens.welcome.showHomeView',
		});
		await this.container.views.home.show();
		void executeCommand('gitlens.views.home.enablePreview');
	}
}

@command()
export class WelcomeShowGraphCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.showGraph');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showGraph';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'open/graph',
			command: command,
		});
		executeCommand(command);
	}
}

@command()
export class WelcomeShowComposerCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.showComposer');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showComposerPage';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'open/composer',
			command: command,
		});
		executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(command, undefined, {
			source: 'welcome',
		});
	}
}

@command()
export class WelcomeShowLaunchpadCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.welcome.showLaunchpad');
	}

	execute(): void {
		const command: GlCommands = 'gitlens.showLaunchpad';
		this.container.telemetry.sendEvent('welcome/action', {
			type: 'command',
			name: 'open/launchpad',
			command: command,
		});
		executeCommand<Partial<LaunchpadCommandArgs>>(command, {
			source: 'welcome',
		});
	}
}
