import type { Source, SupportedCloudIntegrationIds } from '../constants';
import { Commands } from '../constants';
import type { Container } from '../container';
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
			args?.integrationId,
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}
}
