import {
	GitCloudHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../../constants.js';
import type { Integration } from '../../models/integration.js';
import type { ProviderIssue } from '../models.js';

/**
 * A minimal {@link ProviderIssue} with every required field populated, so a test only has to state the fields it is
 * actually asserting on. Kept here rather than inline so a new required field on the SDK type surfaces in one place.
 */
export function createProviderIssue(overrides: Partial<ProviderIssue> = {}): ProviderIssue {
	return {
		author: null,
		assignees: [],
		commentCount: 0,
		closedDate: null,
		createdDate: new Date(0),
		description: null,
		id: 'issue-id',
		labels: [],
		number: '42',
		repository: null,
		state: null,
		title: 'Issue 42',
		type: null,
		updatedDate: new Date(1),
		upvoteCount: 0,
		url: 'https://example.com/issues/42',
		...overrides,
	};
}

/** The mappers only read an integration's provider identity, so a descriptor stands in for the real instance. */
export const jiraIntegration = {
	id: IssuesCloudHostIntegrationId.Jira,
	name: 'Jira',
	domain: 'example.atlassian.net',
	icon: 'jira',
} as unknown as Integration;

export const jiraServerIntegration = {
	id: IssuesSelfManagedHostIntegrationId.JiraServer,
	name: 'Jira Data Center',
	domain: 'jira.example.com',
	icon: 'jira',
} as unknown as Integration;

export const linearIntegration = {
	id: IssuesCloudHostIntegrationId.Linear,
	name: 'Linear',
	domain: 'linear.app',
	icon: 'linear',
} as unknown as Integration;

export const azureIntegration = {
	id: GitCloudHostIntegrationId.AzureDevOps,
	name: 'Azure DevOps',
	domain: 'dev.azure.com',
	icon: 'azure-devops',
} as unknown as Integration;
