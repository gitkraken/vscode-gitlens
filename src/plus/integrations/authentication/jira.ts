import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthenticationProvider';

export class JiraAuthenticationProvider extends CloudIntegrationAuthenticationProvider<IssuesCloudHostIntegrationId.Jira> {
	protected override get authProviderId(): IssuesCloudHostIntegrationId.Jira {
		return IssuesCloudHostIntegrationId.Jira;
	}
}
