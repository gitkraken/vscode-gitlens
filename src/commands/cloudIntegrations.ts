import { GlCommand } from '../constants.commands';
import type { SupportedCloudIntegrationIds } from '../constants.integrations';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { command } from '../system/-webview/command';
import { createMarkdownCommandLink } from '../system/commands';
import { GlCommandBase } from './commandBase';

export interface ManageCloudIntegrationsCommandArgs extends Source {}

export interface ConnectCloudIntegrationsCommandArgs extends Source {
	integrationIds?: SupportedCloudIntegrationIds[];
}

@command()
export class ManageCloudIntegrationsCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(GlCommand.PlusManageCloudIntegrations);
	}

	async execute(args?: ManageCloudIntegrationsCommandArgs): Promise<void> {
		await this.container.integrations.manageCloudIntegrations(
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}
}

@command()
export class ConnectCloudIntegrationsCommand extends GlCommandBase {
	static createMarkdownCommandLink(args: ConnectCloudIntegrationsCommandArgs): string {
		return createMarkdownCommandLink<ConnectCloudIntegrationsCommandArgs>(
			GlCommand.PlusConnectCloudIntegrations,
			args,
		);
	}

	constructor(private readonly container: Container) {
		super(GlCommand.PlusConnectCloudIntegrations);
	}

	async execute(args?: ConnectCloudIntegrationsCommandArgs): Promise<void> {
		await this.container.integrations.connectCloudIntegrations(
			args?.integrationIds ? { integrationIds: args.integrationIds } : undefined,
			args?.source ? { source: args.source, detail: args?.detail } : undefined,
		);
	}
}
