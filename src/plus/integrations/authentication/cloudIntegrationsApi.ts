import { env, Uri } from 'vscode';
import type { Container } from '../../../container';
import { Logger } from '../../../system/logger';
import type { ServerConnection } from '../../gk/serverConnection';
import type { IntegrationId } from '../providers/models';
import type { CloudIntegrationAuthorization, CloudIntegrationConnection, ConnectedCloudIntegration } from './models';
import { CloudIntegrationAuthenticationUriPathPrefix } from './models';

export class CloudIntegrationsApi {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	async getConnectedProvidersData(): Promise<ConnectedCloudIntegration[] | undefined> {
		const providersRsp = await this.connection.fetchGkDevApi(
			'v1/provider-tokens',
			{ method: 'GET' },
			{ organizationId: false },
		);
		if (!providersRsp.ok) {
			const error = (await providersRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to get connected providers from cloud: ${error}`);
			}
			return undefined;
		}

		return (await providersRsp.json())?.data as Promise<ConnectedCloudIntegration[] | undefined>;
	}

	async getTokenData(id: IntegrationId, refresh: boolean = false): Promise<CloudIntegrationConnection | undefined> {
		const tokenRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${id}${refresh ? '/refresh' : ''}`,
			{ method: refresh ? 'POST' : 'GET' },
			{ organizationId: false },
		);
		if (!tokenRsp.ok) {
			const error = (await tokenRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to ${refresh ? 'refresh' : 'get'} ${id} token from cloud: ${error}`);
			}
			return undefined;
		}

		return (await tokenRsp.json())?.data as Promise<CloudIntegrationConnection | undefined>;
	}

	async authorize(id: IntegrationId): Promise<CloudIntegrationAuthorization | undefined> {
		// attach the callback to the url
		const callbackUri = await env.asExternalUri(
			Uri.parse(
				`${env.uriScheme}://${this.container.context.extension.id}/${CloudIntegrationAuthenticationUriPathPrefix}?provider=${id}`,
			),
		);

		const authorizeRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${id}/authorize`,
			{
				method: 'GET',
			},
			{
				query: `source=gitlens&targetURL=${encodeURIComponent(callbackUri.toString(true))}`,
				organizationId: false,
			},
		);
		if (!authorizeRsp.ok) {
			const error = (await authorizeRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to authorize with ${id}: ${error}`);
			}
			return undefined;
		}

		return (await authorizeRsp.json())?.data as Promise<CloudIntegrationAuthorization | undefined>;
	}
}
