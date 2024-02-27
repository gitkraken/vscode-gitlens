import type { ProviderReference } from './remoteProvider';

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
