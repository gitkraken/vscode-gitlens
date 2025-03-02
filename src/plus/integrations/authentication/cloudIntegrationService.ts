import type { IntegrationId } from '../../../constants.integrations';
import type { Container } from '../../../container';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ServerConnection } from '../../gk/serverConnection';
import type { CloudIntegrationAuthenticationSession, CloudIntegrationConnection } from './models';
import { toCloudIntegrationType } from './models';

export class CloudIntegrationService {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	async getConnections(): Promise<CloudIntegrationConnection[] | undefined> {
		const scope = getLogScope();

		const providersRsp = await this.connection.fetchGkApi(
			'v1/provider-tokens',
			{ method: 'GET' },
			{ organizationId: false },
		);
		if (!providersRsp.ok) {
			const error = (await providersRsp.json())?.error;
			const errorMessage =
				typeof error === 'string' ? error : (error?.message as string) ?? providersRsp.statusText;
			if (error != null) {
				Logger.error(undefined, scope, `Failed to get connected providers from cloud: ${errorMessage}`);
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
		id: IntegrationId,
		refreshToken?: string,
	): Promise<CloudIntegrationAuthenticationSession | undefined> {
		const scope = getLogScope();

		const refresh = Boolean(refreshToken);
		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			Logger.error(undefined, scope, `Unsupported cloud integration type: ${id}`);
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
			const errorMessage = typeof error === 'string' ? error : (error?.message as string) ?? tokenRsp.statusText;
			if (error != null) {
				Logger.error(
					undefined,
					scope,
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
			return undefined;
		}

		return (await tokenRsp.json())?.data as Promise<CloudIntegrationAuthenticationSession | undefined>;
	}

	async disconnect(id: IntegrationId): Promise<boolean> {
		const scope = getLogScope();

		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			Logger.error(undefined, scope, `Unsupported cloud integration type: ${id}`);
			return false;
		}

		const tokenRsp = await this.connection.fetchGkApi(
			`v1/provider-tokens/${cloudIntegrationType}`,
			{ method: 'DELETE' },
			{ organizationId: false },
		);
		if (!tokenRsp.ok) {
			const error = (await tokenRsp.json())?.error;
			const errorMessage = typeof error === 'string' ? error : (error?.message as string) ?? tokenRsp.statusText;
			if (error != null) {
				Logger.error(undefined, scope, `Failed to disconnect ${id} token from cloud: ${errorMessage}`);
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
