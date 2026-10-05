import { l10n, ThemeIcon } from 'vscode';
import type { SupportedCloudIntegrationIds } from '@gitlens/integrations/constants.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import { ensureAccountQuickPick } from '../plus/gk/utils/-webview/acount.utils.js';
import { createDirectiveQuickPickItem, Directive } from '../quickpicks/items/directive.js';
import { command } from '../system/-webview/command.js';
import { GlCommandBase } from './commandBase.js';

export interface ManageCloudIntegrationsCommandArgs {
	source?: Source;
}

export interface ConnectCloudIntegrationsCommandArgs {
	integrationIds?: SupportedCloudIntegrationIds[];
	source?: Source;
}

@command()
export class ManageCloudIntegrationsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.plus.cloudIntegrations.manage');
	}

	async execute(args?: ManageCloudIntegrationsCommandArgs): Promise<void> {
		await this.container.integrations.manageCloudIntegrations(args?.source);
	}
}

@command()
export class ConnectCloudIntegrationsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.plus.cloudIntegrations.connect');
	}

	async execute(args?: ConnectCloudIntegrationsCommandArgs): Promise<void> {
		// Signed out, connecting implicitly signs the user in (the OAuth callback lands in
		// `loginWithCode`) — gate with the account quick-pick first so the account is an explicit
		// up-front choice, matching the wizards' pre-connect gate. Direct entries (e.g. the graph's
		// Launchpad popover link) reach the connect flow only through this command.
		if ((await this.container.subscription.getSubscription()).account == null) {
			const allowed = await ensureAccountQuickPick(
				this.container,
				createDirectiveQuickPickItem(Directive.Noop, undefined, {
					label: l10n.t('Connect integrations like GitHub, GitLab, Azure DevOps, Jira, and more'),
					iconPath: new ThemeIcon('plug'),
				}),
				args?.source ?? { source: 'commandPalette' },
				false,
			);
			if (!allowed) return;
		}

		await this.container.integrations.connectCloudIntegrations(
			args?.integrationIds ? { integrationIds: args.integrationIds } : undefined,
			args?.source,
		);
	}
}
