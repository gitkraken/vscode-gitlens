import type { IntegrationIds } from '../../../constants.integrations.js';
import type { Container } from '../../../container.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import type { ServerConnection } from '../../gk/serverConnection.js';
import type { CloudIntegrationAuthenticationSession, CloudIntegrationConnection } from './models.js';
import { toCloudIntegrationType } from './models.js';

export class CloudIntegrationService {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	async getConnections(): Promise<CloudIntegrationConnection[] | undefined> {
		const scope = getScopedLogger();

		const providersRsp = await this.connection.fetchGkApi(
			'v1/provider-tokens',
			{ method: 'GET' },
			{ organizationId: false },
		);
		if (!providersRsp.ok) {
			const error = (await providersRsp.json())?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error?.message as string) ?? providersRsp.statusText);
			if (error != null) {
				scope?.error(undefined, `Failed to get connected providers from cloud: ${errorMessage}`);
			}
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cloudIntegrations/getConnections/failed', {
					code: providersRsp.status,
				});
			}
			return undefined;
		}

		return (await providersRsp.json())?.data as Promise<CloudIntegrationConnection[] | undefined>;
	}

	async getConnectionSession(
		id: IntegrationIds,
		refreshToken?: string,
	): Promise<CloudIntegrationAuthenticationSession | undefined> {
		const scope = getScopedLogger();

		const refresh = Boolean(refreshToken);
		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			scope?.error(undefined, `Unsupported cloud integration type: ${id}`);
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

		const tokenRsp = await this.connection.fetchGkApi(
			`v1/provider-tokens/${cloudIntegrationType}${refresh ? '/refresh' : ''}`,
			reqInitOptions,
			{ organizationId: false },
		);
		if (!tokenRsp.ok) {
			const error = (await tokenRsp.json())?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error?.message as string) ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(
					undefined,
					`Failed to ${refresh ? 'refresh' : 'get'} ${id} token from cloud: ${errorMessage}`,
				);
			}
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent(
					refreshToken
						? 'cloudIntegrations/refreshConnection/failed'
						: 'cloudIntegrations/getConnection/failed',
					{
						code: tokenRsp.status,
						'integration.id': id,
					},
				);
			}

			if (refresh) {
				// try once to just get the latest token if the refresh fails, and give up if that fails too
				const newTokenRsp = await this.connection.fetchGkApi(
					`v1/provider-tokens/${cloudIntegrationType}`,
					{ method: 'GET' },
					{ organizationId: false },
				);
				if (newTokenRsp.ok) {
					return (await newTokenRsp.json())?.data as Promise<
						CloudIntegrationAuthenticationSession | undefined
					>;
				}
			}

			return undefined;
		}

		return (await tokenRsp.json())?.data as Promise<CloudIntegrationAuthenticationSession | undefined>;
	}

	async disconnect(id: IntegrationIds): Promise<boolean> {
		const scope = getScopedLogger();

		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			scope?.error(undefined, `Unsupported cloud integration type: ${id}`);
			return false;
		}

		const tokenRsp = await this.connection.fetchGkApi(
			`v1/provider-tokens/${cloudIntegrationType}`,
			{ method: 'DELETE' },
			{ organizationId: false },
		);
		if (!tokenRsp.ok) {
			const error = (await tokenRsp.json())?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error?.message as string) ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(undefined, `Failed to disconnect ${id} token from cloud: ${errorMessage}`);
			}
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('cloudIntegrations/disconnect/failed', {
					code: tokenRsp.status,
					'integration.id': id,
				});
			}
			return false;
		}

		return true;
	}
}
