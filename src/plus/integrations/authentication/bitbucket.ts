import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations.js';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';

export class BitbucketAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitCloudHostIntegrationId.Bitbucket> {
	protected override get authProviderId(): GitCloudHostIntegrationId.Bitbucket {
		return GitCloudHostIntegrationId.Bitbucket;
	}
}

export class BitbucketServerAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitSelfManagedHostIntegrationId.BitbucketServer> {
	protected override get authProviderId(): GitSelfManagedHostIntegrationId.BitbucketServer {
		return GitSelfManagedHostIntegrationId.BitbucketServer;
	}
}
