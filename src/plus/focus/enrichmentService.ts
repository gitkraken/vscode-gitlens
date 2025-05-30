import type { CancellationToken, Disposable } from 'vscode';
import type { Container } from '../../container';
import { AuthenticationRequiredError, CancellationError } from '../../errors';
import type { RemoteProvider } from '../../git/remotes/remoteProvider';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';
import { ensureAccount, ensurePaidPlan } from '../utils';

export interface EnrichableItem {
	type: EnrichedItemResponse['entityType'];
	id: string;
	provider: EnrichedItemResponse['provider'];
	url: string;
	expiresAt?: string;
}

export type EnrichedItem = {
	id: string;
	userId?: string;
	type: EnrichedItemResponse['type'];

	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;
	entityUrl: string;

	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
};

type EnrichedItemRequest = {
	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;
	entityUrl: string;
	expiresAt?: string;
};

type EnrichedItemResponse = {
	id: string;
	userId?: string;
	type: 'pin' | 'snooze';

	provider: 'azure' | 'bitbucket' | 'github' | 'gitlab' | 'jira' | 'trello' | 'gitkraken';
	entityType: 'issue' | 'pr';
	entityId: string;
	entityUrl: string;

	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
};

export class EnrichmentService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	private async delete(id: string, context: 'unpin' | 'unsnooze'): Promise<void> {
		const scope = getLogScope();

		try {
			const rsp = await this.connection.fetchGkDevApi(`v1/enrich-items/${id}`, { method: 'DELETE' });

			if (!rsp.ok) throw new Error(`Unable to ${context} item '${id}':  (${rsp.status}) ${rsp.statusText}`);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	async get(type?: EnrichedItemResponse['type'], cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse[] };

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items', { method: 'GET' });
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			const result = (await rsp.json()) as Result;
			if (cancellation?.isCancellationRequested) throw new CancellationError();

			return type == null ? result.data : result.data.filter(i => i.type === type);
		} catch (ex) {
			if (ex instanceof AuthenticationRequiredError) return [];

			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	getPins(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('pin', cancellation);
	}

	@log()
	getSnoozed(cancellation?: CancellationToken): Promise<EnrichedItem[]> {
		return this.get('snooze', cancellation);
	}

	@log<EnrichmentService['pinItem']>({ args: { 0: i => `${i.id} (${i.provider} ${i.type})` } })
	async pinItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			if (!(await ensureAccount('Pinning requires a GitKraken account.', this.container))) {
				throw new Error('Unable to pin item: account required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.provider,
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/pin', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to pin item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	unpinItem(id: string): Promise<void> {
		return this.delete(id, 'unpin');
	}

	@log<EnrichmentService['snoozeItem']>({ args: { 0: i => `${i.id} (${i.provider} ${i.type})` } })
	async snoozeItem(item: EnrichableItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			if (!(await ensurePaidPlan('Snoozing requires a trial or paid plan', this.container))) {
				throw new Error('Unable to snooze item: subscription required');
			}

			type Result = { data: EnrichedItemResponse };

			const rq: EnrichedItemRequest = {
				provider: item.provider,
				entityType: item.type,
				entityId: item.id,
				entityUrl: item.url,
			};
			if (item.expiresAt != null) {
				rq.expiresAt = item.expiresAt;
			}

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/snooze', {
				method: 'POST',
				body: JSON.stringify(rq),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to snooze item '${rq.provider}|${rq.entityUrl}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
				);
			}

			const result = (await rsp.json()) as Result;
			return result.data;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	unsnoozeItem(id: string): Promise<void> {
		return this.delete(id, 'unsnooze');
	}
}

export function convertRemoteProviderToEnrichProvider(provider: RemoteProvider): EnrichedItemResponse['provider'] {
	switch (provider.id) {
		case 'azure-devops':
			return 'azure';

		case 'bitbucket':
		case 'bitbucket-server':
			return 'bitbucket';

		case 'github':
			return 'github';

		case 'gitlab':
			return 'gitlab';

		default:
			throw new Error(`Unknown remote provider '${provider.id}'`);
	}
}
