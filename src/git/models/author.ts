import type { ProviderReference } from './remoteProvider';

export interface Account {
	provider: ProviderReference;
	id: string;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
	username: string | undefined;
}
