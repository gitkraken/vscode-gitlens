import { IssuesCloudHostIntegrationId } from '../../../constants.integrations.js';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider.js';

export class JiraAuthenticationProvider extends CloudIntegrationAuthenticationProvider<IssuesCloudHostIntegrationId.Jira> {
	protected override get authProviderId(): IssuesCloudHostIntegrationId.Jira {
		return IssuesCloudHostIntegrationId.Jira;
	}
}
