export enum HostingIntegrationId {
	GitHub = 'github',
	GitLab = 'gitlab',
	Bitbucket = 'bitbucket',
	AzureDevOps = 'azureDevOps',
}

export enum SelfHostedIntegrationId {
	GitHubEnterprise = 'github-enterprise',
	CloudGitHubEnterprise = 'cloud-github-enterprise',
	CloudGitLabSelfHosted = 'cloud-gitlab-self-hosted',
	GitLabSelfHosted = 'gitlab-self-hosted',
}

export enum IssueIntegrationId {
	Jira = 'jira',
	Trello = 'trello',
}

export type IntegrationId = HostingIntegrationId | IssueIntegrationId | SelfHostedIntegrationId;

export const supportedOrderedCloudIssueIntegrationIds = [IssueIntegrationId.Jira];
export const supportedOrderedCloudIntegrationIds = [
	HostingIntegrationId.GitHub,
	SelfHostedIntegrationId.CloudGitHubEnterprise,
	HostingIntegrationId.GitLab,
	SelfHostedIntegrationId.CloudGitLabSelfHosted,
	IssueIntegrationId.Jira,
];

export type SupportedCloudIntegrationIds = (typeof supportedOrderedCloudIntegrationIds)[number];

export function isSupportedCloudIntegrationId(id: IntegrationId): id is SupportedCloudIntegrationIds {
	return supportedOrderedCloudIntegrationIds.includes(id as SupportedCloudIntegrationIds);
}

export type IntegrationFeatures = 'prs' | 'issues';

export interface IntegrationDescriptor {
	id: SupportedCloudIntegrationIds;
	name: string;
	icon: string;
	supports: IntegrationFeatures[];
}
export const supportedCloudIntegrationDescriptors: IntegrationDescriptor[] = [
	{
		id: HostingIntegrationId.GitHub,
		name: 'GitHub',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
	},
	{
		id: SelfHostedIntegrationId.CloudGitHubEnterprise,
		name: 'GitHub Enterprise',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
	},
	{
		id: HostingIntegrationId.GitLab,
		name: 'GitLab',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
	},
	{
		id: SelfHostedIntegrationId.CloudGitLabSelfHosted,
		name: 'GitLab Self-Managed',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
	},
	{
		id: IssueIntegrationId.Jira,
		name: 'Jira',
		icon: 'gl-provider-jira',
		supports: ['issues'],
	},
];
