export interface EnrichableItem {
	type: EnrichedItemResponse['entityType'];
	id: string;
	provider: EnrichedItemResponse['provider'];
	url: string;
	expiresAt?: string;
}

export interface EnrichedItem {
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
}

export interface EnrichedItemResponse {
	id: string;
	userId?: string;
	type: 'pin' | 'snooze';

	provider: 'azure' | 'bitbucket' | 'github' | 'gitlab' | 'jira' | 'linear' | 'trello' | 'gitkraken';
	entityType: 'issue' | 'pr';
	entityId: string;
	entityUrl: string;

	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
}
