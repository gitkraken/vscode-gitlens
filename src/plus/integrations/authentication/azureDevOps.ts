import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class AzureDevOpsAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitCloudHostIntegrationId.AzureDevOps> {
	protected override get authProviderId(): GitCloudHostIntegrationId.AzureDevOps {
		return GitCloudHostIntegrationId.AzureDevOps;
	}
}

export class AzureDevOpsServerAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitSelfManagedHostIntegrationId.AzureDevOpsServer> {
	protected override get authProviderId(): GitSelfManagedHostIntegrationId.AzureDevOpsServer {
		return GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	}
}
