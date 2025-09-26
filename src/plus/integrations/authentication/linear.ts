import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class LinearAuthenticationProvider extends CloudIntegrationAuthenticationProvider<IssuesCloudHostIntegrationId.Linear> {
	protected override get authProviderId(): IssuesCloudHostIntegrationId.Linear {
		return IssuesCloudHostIntegrationId.Linear;
	}
}
