import { Commands } from '../constants';
import type { Container } from '../container';
import { command } from '../system/command';
import { Command } from './base';

@command()
export class ManageCloudIntegrationsCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.PlusManageCloudIntegrations);
	}

	async execute() {
		await this.container.integrations.manageCloudIntegrations();
	}
}
