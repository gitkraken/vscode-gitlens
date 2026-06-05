import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { IntegrationIds } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { CloudIntegrationAuthenticationSession, CloudIntegrationConnection } from './models.js';
import { toCloudIntegrationType } from './models.js';

export class CloudIntegrationService {
	constructor(private readonly ctx: IntegrationServiceContext) {}

	async getConnections(): Promise<CloudIntegrationConnection[] | undefined> {
		const scope = getScopedLogger();

		const providersRsp = await this.ctx.account.fetchGkApi('v1/provider-tokens', { method: 'GET' });
		if (!providersRsp.ok) {
			const error = ((await providersRsp.json()) as { error?: unknown })?.error;
			const errorMessage =
				typeof error === 'string'
					? error
					: ((error as { message?: string })?.message ?? providersRsp.statusText);
			if (error != null) {
				scope?.error(undefined, `Failed to get connected providers from cloud: ${errorMessage}`);
			}
			this.ctx.hooks?.connection?.onConnectionsFetchFailed?.({ code: providersRsp.status });
			return undefined;
		}

		return ((await providersRsp.json()) as { data?: unknown })?.data as CloudIntegrationConnection[] | undefined;
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

		const tokenRsp = await this.ctx.account.fetchGkApi(
			`v1/provider-tokens/${cloudIntegrationType}${refresh ? '/refresh' : ''}`,
			reqInitOptions,
		);
		if (!tokenRsp.ok) {
			const error = ((await tokenRsp.json()) as { error?: unknown })?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error as { message?: string })?.message ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(
					undefined,
					`Failed to ${refresh ? 'refresh' : 'get'} ${id} token from cloud: ${errorMessage}`,
				);
			}
			this.ctx.hooks?.connection?.onConnectionFetchFailed?.({
				id: id,
				code: tokenRsp.status,
				refreshing: refresh,
			});

			if (refresh) {
				// try once to just get the latest token if the refresh fails, and give up if that fails too
				const newTokenRsp = await this.ctx.account.fetchGkApi(`v1/provider-tokens/${cloudIntegrationType}`, {
					method: 'GET',
				});
				if (newTokenRsp.ok) {
					return ((await newTokenRsp.json()) as { data?: unknown })?.data as
						| CloudIntegrationAuthenticationSession
						| undefined;
				}
			}

			return undefined;
		}

		return ((await tokenRsp.json()) as { data?: unknown })?.data as
			| CloudIntegrationAuthenticationSession
			| undefined;
	}

	async disconnect(id: IntegrationIds): Promise<boolean> {
		const scope = getScopedLogger();

		const cloudIntegrationType = toCloudIntegrationType[id];
		if (cloudIntegrationType == null) {
			scope?.error(undefined, `Unsupported cloud integration type: ${id}`);
			return false;
		}

		const tokenRsp = await this.ctx.account.fetchGkApi(`v1/provider-tokens/${cloudIntegrationType}`, {
			method: 'DELETE',
		});
		if (!tokenRsp.ok) {
			const error = ((await tokenRsp.json()) as { error?: unknown })?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error as { message?: string })?.message ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(undefined, `Failed to disconnect ${id} token from cloud: ${errorMessage}`);
			}
			this.ctx.hooks?.connection?.onDisconnectFailed?.({
				id: id,
				code: tokenRsp.status,
			});
			return false;
		}

		return true;
	}
}
