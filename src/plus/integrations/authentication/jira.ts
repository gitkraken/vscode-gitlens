import { IssueIntegrationId } from '../providers/models';
import { IntegrationAuthenticationProvider } from './integrationAuthentication';

export class JiraAuthenticationProvider extends IntegrationAuthenticationProvider<IssueIntegrationId.Jira> {
	protected override get authProviderId(): IssueIntegrationId.Jira {
		return IssueIntegrationId.Jira;
	}

	protected override getCompletionInputTitle(): string {
		return 'Connect to Jira';
	}
}
