import { IssueIntegrationId } from '../../../constants.integrations';
import { CloudIntegrationAuthenticationProvider } from './integrationAuthentication';

export class JiraAuthenticationProvider extends CloudIntegrationAuthenticationProvider<IssueIntegrationId.Jira> {
	protected override get authProviderId(): IssueIntegrationId.Jira {
		return IssueIntegrationId.Jira;
	}

	protected override getCompletionInputTitle(): string {
		return 'Connect to Jira';
	}
}
