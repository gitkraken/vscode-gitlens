import type { ProviderReference } from './remoteProvider.js';

export interface RepositoryMetadata {
	provider: ProviderReference;
	owner: string;
	name: string;
	isFork: boolean;
	parent?: {
		owner: string;
		name: string;
	};
}
