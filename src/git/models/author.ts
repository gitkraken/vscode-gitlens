import type { RemoteProviderReference } from './remoteProvider';

export interface Account {
	provider: RemoteProviderReference;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}
