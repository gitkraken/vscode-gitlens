import { IssuesCloudHostIntegrationId } from '../../../constants.integrations.js';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';

export class LinearAuthenticationProvider extends CloudIntegrationAuthenticationProvider<IssuesCloudHostIntegrationId.Linear> {
	protected override get authProviderId(): IssuesCloudHostIntegrationId.Linear {
		return IssuesCloudHostIntegrationId.Linear;
	}
}
