import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { IntegrationIds } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type {
	CloudIntegrationAuthenticationSession,
	CloudIntegrationConnection,
	CloudIntegrationType,
} from './models.js';
import { toCloudIntegrationType } from './models.js';

/**
 * Wire shape of a `v1/provider-tokens` connection descriptor. The list endpoint returns one such
 * entry per provider as the primary, with additional accounts nested under `secondaries`. Field casing
 * is the backend's (camelCase, `tokenId`).
 */
interface GKProviderTokenData {
	tokenId: string;
	provider: CloudIntegrationType;
	type: CloudIntegrationAuthenticationSession['type'];
	domain: string;
	/** Human-readable account handle; the backend includes it on the connection when available. */
	accountName?: string;
}

/** Wire shape of a single `v1/provider-tokens/...` token response (`data`). */
interface GKProviderToken {
	tokenId?: string;
	isPrimary?: boolean;
	accessToken: string;
	appKey?: string;
	expiresIn: number;
	scopes: string;
	type: CloudIntegrationAuthenticationSession['type'];
	domain?: string;
}

function toSession(data: GKProviderToken): CloudIntegrationAuthenticationSession {
	// Normalize the backend's `tokenId` onto our `id` so callers get a stable per-connection identity.
	return {
		type: data.type,
		accessToken: data.accessToken,
		domain: data.domain ?? '',
		expiresIn: data.expiresIn,
		scopes: data.scopes,
		id: data.tokenId,
	};
}

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

		const data = ((await providersRsp.json()) as { data?: unknown })?.data as
			| (GKProviderTokenData & { secondaries?: GKProviderTokenData[] })[]
			| undefined;
		// A non-array `data` (unexpected backend shape) would throw on iteration below and abort the
		// whole cloud-sync path, so bail gracefully instead.
		if (!Array.isArray(data)) return undefined;

		// Flatten the primary + `secondaries[]` grouping into one connection per account. Primacy is
		// positional on the wire (top-level entry = primary), so we set the `primary` flag here.
		const connections: CloudIntegrationConnection[] = [];
		for (const item of data) {
			connections.push({
				id: item.tokenId,
				type: item.type,
				provider: item.provider,
				domain: item.domain,
				primary: true,
				accountName: item.accountName,
			});
			// `secondaries` comes from the same unknown payload as `data`; guard against a non-array shape so
			// an unexpected value doesn't throw here and abort the whole cloud-sync path.
			for (const secondary of Array.isArray(item.secondaries) ? item.secondaries : []) {
				connections.push({
					id: secondary.tokenId,
					type: secondary.type,
					provider: secondary.provider ?? item.provider,
					domain: secondary.domain || item.domain,
					primary: false,
					accountName: secondary.accountName,
				});
			}
		}

		return connections;
	}

	async getConnectionSession(
		id: IntegrationIds,
		refreshToken?: string,
		connectionId?: string,
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

		// A specific connection (multi-account) is addressed by its token id under `/tokens/{tokenId}`,
		// including refresh (`/tokens/{tokenId}/refresh`). The provider-scoped endpoints only ever operate
		// on the provider's PRIMARY connection, so they must NOT be used to refresh a secondary.
		const path = connectionId
			? `v1/provider-tokens/tokens/${encodeURIComponent(connectionId)}${refresh ? '/refresh' : ''}`
			: `v1/provider-tokens/${cloudIntegrationType}${refresh ? '/refresh' : ''}`;
		const tokenRsp = await this.ctx.account.fetchGkApi(path, reqInitOptions);
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
				// try once to just get the latest token if the refresh fails, and give up if that fails too;
				// stay scoped to the same connection (by token id) so we don't fall back to the primary.
				const latestPath = connectionId
					? `v1/provider-tokens/tokens/${encodeURIComponent(connectionId)}`
					: `v1/provider-tokens/${cloudIntegrationType}`;
				const newTokenRsp = await this.ctx.account.fetchGkApi(latestPath, { method: 'GET' });
				if (newTokenRsp.ok) {
					const data = ((await newTokenRsp.json()) as { data?: GKProviderToken })?.data;
					return data != null ? toSession(data) : undefined;
				}
			}

			return undefined;
		}

		const data = ((await tokenRsp.json()) as { data?: GKProviderToken })?.data;
		return data != null ? toSession(data) : undefined;
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

	/**
	 * Disconnects a single connection by its token id (multi-account). The backend promotes a secondary
	 * to primary when the removed connection was the primary, so the provider stays connected if others
	 * remain. Returns whether the delete succeeded.
	 */
	async disconnectConnection(id: IntegrationIds, connectionId: string): Promise<boolean> {
		const scope = getScopedLogger();

		const tokenRsp = await this.ctx.account.fetchGkApi(
			`v1/provider-tokens/tokens/${encodeURIComponent(connectionId)}`,
			{ method: 'DELETE' },
		);
		if (!tokenRsp.ok) {
			const error = ((await tokenRsp.json()) as { error?: unknown })?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error as { message?: string })?.message ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(undefined, `Failed to disconnect connection '${connectionId}' for ${id}: ${errorMessage}`);
			}
			this.ctx.hooks?.connection?.onDisconnectFailed?.({ id: id, code: tokenRsp.status });
			return false;
		}

		return true;
	}

	/**
	 * Promotes a connection to primary by its token id (multi-account), clearing primacy on the provider's
	 * other connections server-side. Returns whether the switch succeeded.
	 */
	async setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<boolean> {
		const scope = getScopedLogger();

		const tokenRsp = await this.ctx.account.fetchGkApi(
			`v1/provider-tokens/tokens/${encodeURIComponent(connectionId)}/primary`,
			{ method: 'POST' },
		);
		if (!tokenRsp.ok) {
			const error = ((await tokenRsp.json()) as { error?: unknown })?.error;
			const errorMessage =
				typeof error === 'string' ? error : ((error as { message?: string })?.message ?? tokenRsp.statusText);
			if (error != null) {
				scope?.error(
					undefined,
					`Failed to set primary connection '${connectionId}' for ${id}: ${errorMessage}`,
				);
			}
			return false;
		}

		return true;
	}
}
