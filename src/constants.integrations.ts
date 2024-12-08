export enum HostingIntegrationId {
	GitHub = 'github',
	GitLab = 'gitlab',
	Bitbucket = 'bitbucket',
	AzureDevOps = 'azureDevOps',
}

export enum SelfHostedIntegrationId {
	GitHubEnterprise = 'github-enterprise',
	GitLabSelfHosted = 'gitlab-self-hosted',
}

export enum IssueIntegrationId {
	Jira = 'jira',
	Trello = 'trello',
}

export type IntegrationId = HostingIntegrationId | IssueIntegrationId | SelfHostedIntegrationId;

export const supportedCloudIntegrationIds = [IssueIntegrationId.Jira];
export const supportedCloudIntegrationIdsExperimental = [
	IssueIntegrationId.Jira,
	HostingIntegrationId.GitHub,
	HostingIntegrationId.GitLab,
];

export type SupportedCloudIntegrationIds = (typeof supportedCloudIntegrationIdsExperimental)[number];
