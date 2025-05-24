import { GitCloudHostIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class AzureDevOpsAuthenticationProvider extends CloudIntegrationAuthenticationProvider<GitCloudHostIntegrationId.AzureDevOps> {
	protected override get authProviderId(): GitCloudHostIntegrationId.AzureDevOps {
		return GitCloudHostIntegrationId.AzureDevOps;
	}
}
