import type { Disposable } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../container';
import type { ServerConnection } from '../gk/serverConnection';

export interface FocusItem {
	provider: string;
	type: 'issue' | 'pr';
	id: string;
	repositoryId: string;
	repositoryName: string;
	repositoryOwner: string;
}

export interface EnrichedItem {
	id: string;
	userId: string;
	type: 'pinned' | 'snoozed';

	provider: string;
	entityType: 'issue' | 'pr';
	entityId: string;
	repositoryId: string;
	repositoryName: string;
	repositoryOwner: string;

	createdAt: number;
	updatedAt: number;
}

export class FocusService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	async pinItem(item: FocusItem): Promise<EnrichedItem> {
		type Result = { data: EnrichedItem };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items/pin').toString(),
			{
				method: 'POST',
				body: JSON.stringify(item),
			},
		);
		const result = (await rsp.json()) as Result;
		return result.data;
	}

	async snoozeItem(item: FocusItem): Promise<EnrichedItem> {
		type Result = { data: EnrichedItem };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items/snooze').toString(),
			{
				method: 'POST',
				body: JSON.stringify(item),
			},
		);
		const result = (await rsp.json()) as Result;
		return result.data;
	}

	async getPins(): Promise<EnrichedItem[]> {
		const data = await this.getAll();
		return data.filter(i => i.type === 'pinned');
	}

	async getSnoozed(): Promise<EnrichedItem[]> {
		const data = await this.getAll();
		return data.filter(i => i.type === 'snoozed');
	}

	async getAll(): Promise<EnrichedItem[]> {
		type Result = { data: EnrichedItem[] };

		const rsp = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/enrich-items').toString(),
			{
				method: 'GET',
			},
		);

		const result = (await rsp.json()) as Result;
		return result.data.map(i => i);
	}
}
