'use strict';
import { RemoteProviderReference } from './remoteProvider';

export interface Account {
	provider: RemoteProviderReference;
	name: string | undefined;
	email: string | undefined;
	avatarUrl: string;
}
