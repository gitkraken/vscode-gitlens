import type { Disposable } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../container';
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

	private async delete(id: string): Promise<void> {
		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, `v1/enrich-items/${id}`).toString(),
			{
				method: 'DELETE',
			},
		);
		if (!rsp.ok) {
			debugger;
			throw new Error(`Unable to delete enrichment: ${rsp.statusText}`);
		}
	}

	async get(type?: EnrichedItemResponse['type']): Promise<EnrichedItem[]> {
		type Result = { data: EnrichedItemResponse[] };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items').toString(),
			{
				method: 'GET',
			},
		);

		const result = (await rsp.json()) as Result;
		return type == null ? result.data : result.data.filter(i => i.type === type);
	}

	getPins(): Promise<EnrichedItem[]> {
		return this.get('pin');
	}

	getSnoozed(): Promise<EnrichedItem[]> {
		return this.get('snooze');
	}

	async pinItem(item: FocusItem): Promise<EnrichedItem> {
		type Result = { data: EnrichedItemResponse };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items/pin').toString(),
			{
				method: 'POST',
				body: JSON.stringify(item satisfies EnrichedItemRequest),
			},
		);
		const result = (await rsp.json()) as Result;
		return result.data;
	}

	unpinItem(id: string): Promise<void> {
		return this.delete(id);
	}

	async snoozeItem(item: FocusItem): Promise<EnrichedItem> {
		type Result = { data: EnrichedItemResponse };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items/snooze').toString(),
			{
				method: 'POST',
				body: JSON.stringify(item satisfies EnrichedItemRequest),
			},
		);
		const result = (await rsp.json()) as Result;
		return result.data;
	}

	unsnoozeItem(id: string): Promise<void> {
		return this.delete(id);
	}
}
