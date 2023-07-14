import type { RemoteProviderReference } from './remoteProvider';

export interface RepositoryMetadata {
	provider: RemoteProviderReference;
	owner: string;
	name: string;
	isFork: boolean;
	parent?: {
		owner: string;
		name: string;
	};
}
