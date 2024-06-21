import { env, Uri } from 'vscode';
import type { Container } from '../../../container';
import { Logger } from '../../../system/logger';
import type { ServerConnection } from '../../gk/serverConnection';
import type { IntegrationId } from '../providers/models';
import type {
	CloudIntegrationAuthenticationSession,
	CloudIntegrationAuthorization,
	CloudIntegrationConnection,
} from './models';
import { CloudIntegrationAuthenticationUriPathPrefix, toCloudIntegrationType } from './models';

export class CloudIntegrationService {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	async getConnections(): Promise<CloudIntegrationConnection[] | undefined> {
		const providersRsp = await this.connection.fetchGkDevApi(
			'v1/provider-tokens',
			{ method: 'GET' },
			{ organizationId: false },
		);
		if (!providersRsp.ok) {
			const error = (await providersRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to get connected providers from cloud: ${error.message}`);
			}
			return undefined;
		}

		return (await providersRsp.json())?.data as Promise<CloudIntegrationConnection[] | undefined>;
	}

	async getConnectionSession(
		id: IntegrationId,
		refreshToken?: string,
	): Promise<CloudIntegrationAuthenticationSession | undefined> {
		const refresh = Boolean(refreshToken);
		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			Logger.error(`Unsupported cloud integration type: ${id}`);
			return undefined;
		}
		const reqInitOptions = refreshToken
			? {
					method: 'POST',
					body: JSON.stringify({
						access_token: refreshToken,
					}),
			  }
			: { method: 'GET' };

		const tokenRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${cloudIntegrationType}${refresh ? '/refresh' : ''}`,
			reqInitOptions,
			{ organizationId: false },
		);
		if (!tokenRsp.ok) {
			const error = (await tokenRsp.json())?.error;
			if (error != null) {
				Logger.error(`Failed to ${refresh ? 'refresh' : 'get'} ${id} token from cloud: ${error.message}`);
			}
			return undefined;
		}

		return (await tokenRsp.json())?.data as Promise<CloudIntegrationAuthenticationSession | undefined>;
	}

	async authorize(id: IntegrationId): Promise<CloudIntegrationAuthorization | undefined> {
		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			Logger.error(`Unsupported cloud integration type: ${id}`);
			return undefined;
		}

		// attach the callback to the url
		const callbackUri = await env.asExternalUri(
			Uri.parse(
				`${env.uriScheme}://${this.container.context.extension.id}/${CloudIntegrationAuthenticationUriPathPrefix}?provider=${id}`,
			),
		);

		const authorizeRsp = await this.connection.fetchGkDevApi(
			`v1/provider-tokens/${cloudIntegrationType}/authorize`,
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
				Logger.error(`Failed to authorize with ${id}: ${error.message}`);
			}
			return undefined;
		}

		return (await authorizeRsp.json())?.data as Promise<CloudIntegrationAuthorization | undefined>;
	}
}
