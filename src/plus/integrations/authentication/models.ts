import type { AuthenticationSession } from 'vscode';
import type { IntegrationIds, SupportedCloudIntegrationIds } from '../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	supportedOrderedCloudIntegrationIds,
	supportedOrderedCloudIssuesIntegrationIds,
} from '../../../constants.integrations';
import { configuration } from '../../../system/-webview/configuration';

export interface ProviderAuthenticationSession extends AuthenticationSession {
	readonly cloud: boolean;
	readonly expiresAt?: Date;
	readonly domain: string;
	readonly protocol?: string;
}

export interface ConfiguredIntegrationDescriptor {
	readonly cloud: boolean;
	readonly integrationId: IntegrationIds;
	readonly scopes: string;
	readonly domain?: string;
	readonly expiresAt?: string | Date;
}

export interface CloudIntegrationAuthenticationSession {
	type: CloudIntegrationAuthType;
	accessToken: string;
	domain: string;
	expiresIn: number;
	scopes: string;
}

export interface CloudIntegrationAuthorization {
	url: string;
}

export interface CloudIntegrationConnection {
	type: CloudIntegrationAuthType;
	provider: CloudIntegrationType;
	domain: string;
}

export type CloudIntegrationType =
	| 'jira'
	| 'trello'
	| 'gitlab'
	| 'github'
	| 'bitbucket'
	| 'bitbucketServer'
	| 'azure'
	| 'azureDevopsServer'
	| 'githubEnterprise'
	| 'gitlabSelfHosted';

export type CloudIntegrationAuthType = 'oauth' | 'pat';

export const CloudIntegrationAuthenticationUriPathPrefix = 'did-authenticate-cloud-integration';

export function getSupportedCloudIntegrationIds(): SupportedCloudIntegrationIds[] {
	return configuration.get('cloudIntegrations.enabled', undefined, true)
		? supportedOrderedCloudIntegrationIds
		: supportedOrderedCloudIssuesIntegrationIds;
}

export function isSupportedCloudIntegrationId(id: string): id is SupportedCloudIntegrationIds {
	return getSupportedCloudIntegrationIds().includes(id as SupportedCloudIntegrationIds);
}

export const toIntegrationId: { [key in CloudIntegrationType]: IntegrationIds } = {
	jira: IssuesCloudHostIntegrationId.Jira,
	trello: IssuesCloudHostIntegrationId.Trello,
	gitlab: GitCloudHostIntegrationId.GitLab,
	github: GitCloudHostIntegrationId.GitHub,
	githubEnterprise: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	gitlabSelfHosted: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	bitbucket: GitCloudHostIntegrationId.Bitbucket,
	bitbucketServer: GitSelfManagedHostIntegrationId.BitbucketServer,
	azure: GitCloudHostIntegrationId.AzureDevOps,
	azureDevopsServer: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
};

export const toCloudIntegrationType: { [key in IntegrationIds]: CloudIntegrationType | undefined } = {
	[IssuesCloudHostIntegrationId.Jira]: 'jira',
	[IssuesCloudHostIntegrationId.Trello]: 'trello',
	[GitCloudHostIntegrationId.GitLab]: 'gitlab',
	[GitCloudHostIntegrationId.GitHub]: 'github',
	[GitCloudHostIntegrationId.Bitbucket]: 'bitbucket',
	[GitCloudHostIntegrationId.AzureDevOps]: 'azure',
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: 'azureDevopsServer',
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: 'githubEnterprise',
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: 'gitlabSelfHosted',
	[GitSelfManagedHostIntegrationId.BitbucketServer]: 'bitbucketServer',
	[GitSelfManagedHostIntegrationId.GitHubEnterprise]: undefined,
	[GitSelfManagedHostIntegrationId.GitLabSelfHosted]: undefined,
};
