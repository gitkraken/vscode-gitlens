import type { ProviderReference } from './remoteProvider';

export interface CommitAuthor {
	provider: ProviderReference;
	readonly id: string | undefined;
	readonly username: string | undefined;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string | undefined;
}

export interface UnidentifiedAuthor extends CommitAuthor {
	readonly id: undefined;
	readonly username: undefined;
}

export interface Account extends CommitAuthor {
	readonly id: string;
}
