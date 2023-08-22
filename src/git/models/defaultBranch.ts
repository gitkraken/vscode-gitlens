import type { RemoteProviderReference } from './remoteProvider';

export interface DefaultBranch {
	provider: RemoteProviderReference;
	name: string;
}
