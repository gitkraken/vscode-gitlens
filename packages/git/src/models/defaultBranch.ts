import type { ProviderReference } from './remoteProvider.js';

export interface DefaultBranch {
	provider: ProviderReference;
	name: string;
}
