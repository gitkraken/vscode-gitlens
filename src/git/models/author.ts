import type { ProviderReference } from './remoteProvider';

export interface Account {
	provider: ProviderReference;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
	username: string | undefined;
}
