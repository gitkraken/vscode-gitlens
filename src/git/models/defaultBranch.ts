import type { ProviderReference } from './remoteProvider';

export interface DefaultBranch {
	provider: ProviderReference;
	name: string;
}
