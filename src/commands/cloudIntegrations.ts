import { Commands } from '../constants';
import type { Container } from '../container';
import type { IssueIntegrationId } from '../plus/integrations/providers/models';
import { command } from '../system/command';
import { Command } from './base';

export interface ManageCloudIntegrationsCommandArgs {
	source?: 'settings' | 'account' | 'home';
	integrationId?: IssueIntegrationId.Jira;
}
@command()
export class ManageCloudIntegrationsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PlusManageCloudIntegrations);
	}

	async execute(args?: ManageCloudIntegrationsCommandArgs) {
		await this.container.integrations.manageCloudIntegrations(
			args?.source ?? 'commandPalette',
			args?.integrationId,
		);
	}
}
