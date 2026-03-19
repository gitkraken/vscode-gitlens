import type { RemoteProviderSupportedFeatures } from '@gitlens/git/models/remoteProvider.js';
import type { SupportedCloudIntegrationIds } from '../../constants.integrations.js';

export interface RepositoryShape {
	id: string;
	name: string;
	path: string;
	uri: string;
	virtual: boolean;

	provider?: {
		name: string;
		icon?: string;
		integration?: { id: SupportedCloudIntegrationIds; connected: boolean };
		supportedFeatures: RemoteProviderSupportedFeatures;
		url?: string;
		bestRemoteName: string;
	};
}
