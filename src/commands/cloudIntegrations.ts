import type { Source } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import type { SupportedCloudIntegrationIds } from '../plus/integrations/authentication/models';
import { command } from '../system/command';
import { Command } from './base';

export interface ManageCloudIntegrationsCommandArgs extends Source {
	integrationId?: SupportedCloudIntegrationIds;
}

export interface ConnectCloudIntegrationsCommandArgs extends Source {
	integrationIds?: SupportedCloudIntegrationIds[];
}

@command()
export class ManageCloudIntegrationsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PlusManageCloudIntegrations);
	}

	async execute(args?: ManageCloudIntegrationsCommandArgs) {
		await this.container.integrations.manageCloudIntegrations(
			args?.integrationId ? { integrationId: args.integrationId } : undefined,
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}
}

@command()
export class ConnectCloudIntegrationsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PlusConnectCloudIntegrations);
	}

	async execute(args?: ConnectCloudIntegrationsCommandArgs) {
		await this.container.integrations.connectCloudIntegrations(
			args?.integrationIds ? { integrationIds: args.integrationIds } : undefined,
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}
}
