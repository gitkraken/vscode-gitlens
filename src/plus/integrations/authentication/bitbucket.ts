import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

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
