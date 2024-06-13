import type { Container } from '../../../container';
import { IssueIntegrationId } from '../providers/models';
import { IntegrationAuthenticationProvider } from './integrationAuthentication';

export class JiraAuthenticationProvider extends IntegrationAuthenticationProvider {
	constructor(container: Container) {
		super(container, IssueIntegrationId.Jira);
	}

	protected override getCompletionInputTitle(): string {
		return 'Connect to Jira';
	}
}
