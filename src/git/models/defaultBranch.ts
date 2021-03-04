'use strict';
import { RemoteProviderReference } from './remoteProvider';

export interface DefaultBranch {
	provider: RemoteProviderReference;
	name: string;
}
