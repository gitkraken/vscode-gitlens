import type { RemoteProviderSupportedFeatures } from '@gitlens/git/models/remoteProvider.js';
import type { SupportedCloudIntegrationIds } from '../../constants.integrations.js';

export interface RepositoryShape {
	id: string;
	name: string;
	path: string;
	/** Common path of the repo family — present when `path` is a worktree (then `commonPath`
	 *  is the parent's path); absent for non-worktree repos (where `path` itself is the
	 *  family path). Compare on `commonPath ?? path` to test "same repo family". */
	commonPath?: string;
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
