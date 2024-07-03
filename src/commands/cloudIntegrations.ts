import type { Source } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
import type { SupportedCloudIntegrationIds } from '../plus/integrations/authentication/models';
import { command } from '../system/command';
import { Command } from './base';

export interface ManageCloudIntegrationsCommandArgs extends Source {
	integrationId?: SupportedCloudIntegrationIds;
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
