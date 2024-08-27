import { Commands } from '../constants.commands';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { SupportedCloudIntegrationIds } from '../plus/integrations/authentication/models';
import { command } from '../system/command';
import { Command } from './base';

export interface ManageCloudIntegrationsCommandArgs extends Source {}

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
