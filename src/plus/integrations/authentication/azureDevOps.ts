import { HostingIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class AzureDevOpsAuthenticationProvider extends CloudIntegrationAuthenticationProvider<HostingIntegrationId.AzureDevOps> {
	protected override get authProviderId(): HostingIntegrationId.AzureDevOps {
		return HostingIntegrationId.AzureDevOps;
	}
}
