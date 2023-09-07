import type { Disposable } from 'vscode';
import type { Container } from '../../container';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { ServerConnection } from '../gk/serverConnection';

export interface FocusItem {
	provider: EnrichedItemResponse['provider'];
	type: EnrichedItemResponse['entityType'];
	id: string;
	repositoryName: string;
	repositoryOwner: string;
}

export type EnrichedItem = {
	id: string;
	userId: string;
	type: EnrichedItemResponse['type'];

	provider: EnrichedItemResponse['provider'];
	entityType: EnrichedItemResponse['entityType'];
	entityId: string;

	createdAt: number;
	updatedAt: number;
} & (
	| { repositoryId: string }
	| {
			repositoryName: string;
			repositoryOwner: string;
	  }
);

type EnrichedItemRequest = {
	provider: EnrichedItemResponse['provider'];
	type: EnrichedItemResponse['entityType'];
	id: string;
} & (
	| { repositoryId: string }
	| {
			repositoryName: string;
			repositoryOwner: string;
	  }
);

type EnrichedItemResponse = {
	id: string;
	userId: string;
	type: 'pin' | 'snooze';

	provider: 'azure' | 'bitbucket' | 'github' | 'gitlab' | 'gitkraken';
	entityType: 'issue' | 'pr';
	entityId: string;

	createdAt: number;
	updatedAt: number;
} & (
	| { repositoryId: string }
	| {
			repositoryName: string;
			repositoryOwner: string;
	  }
);

export class FocusService implements Disposable {
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
	async get(type?: EnrichedItemResponse['type']): Promise<EnrichedItem[]> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse[] };

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items', { method: 'GET' });

			const result = (await rsp.json()) as Result;
			return type == null ? result.data : result.data.filter(i => i.type === type);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			throw ex;
		}
	}

	@log()
	getPins(): Promise<EnrichedItem[]> {
		return this.get('pin');
	}

	@log()
	getSnoozed(): Promise<EnrichedItem[]> {
		return this.get('snooze');
	}

	@log()
	async pinItem(item: FocusItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse };

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/pin', {
				method: 'POST',
				body: JSON.stringify(item satisfies EnrichedItemRequest),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to pin item '${item.provider}|${item.repositoryOwner}/${item.repositoryName}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
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

	@log()
	async snoozeItem(item: FocusItem): Promise<EnrichedItem> {
		const scope = getLogScope();

		try {
			type Result = { data: EnrichedItemResponse };

			const rsp = await this.connection.fetchGkDevApi('v1/enrich-items/snooze', {
				method: 'POST',
				body: JSON.stringify(item satisfies EnrichedItemRequest),
			});

			if (!rsp.ok) {
				throw new Error(
					`Unable to snooze item '${item.provider}|${item.repositoryOwner}/${item.repositoryName}#${item.id}':  (${rsp.status}) ${rsp.statusText}`,
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
