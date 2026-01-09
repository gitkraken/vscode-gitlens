import type { SupportedCloudIntegrationIds } from '../constants.integrations.js';
import type { Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
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
		await this.container.integrations.connectCloudIntegrations(
			args?.integrationIds ? { integrationIds: args.integrationIds } : undefined,
			args?.source,
		);
	}
}
