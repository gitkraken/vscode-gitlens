import { HostingIntegrationId, SelfHostedIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class BitbucketAuthenticationProvider extends CloudIntegrationAuthenticationProvider<HostingIntegrationId.Bitbucket> {
	protected override get authProviderId(): HostingIntegrationId.Bitbucket {
		return HostingIntegrationId.Bitbucket;
	}
}

export class BitbucketServerAuthenticationProvider extends CloudIntegrationAuthenticationProvider<SelfHostedIntegrationId.BitbucketServer> {
	protected override get authProviderId(): SelfHostedIntegrationId.BitbucketServer {
		return SelfHostedIntegrationId.BitbucketServer;
	}
}
