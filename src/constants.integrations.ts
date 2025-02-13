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

export type CloudSelfHostedIntegrationId =
	| SelfHostedIntegrationId.CloudGitHubEnterprise
	| SelfHostedIntegrationId.CloudGitLabSelfHosted;

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
	HostingIntegrationId.AzureDevOps,
	HostingIntegrationId.Bitbucket,
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
	requiresPro: boolean;
}
export const supportedCloudIntegrationDescriptors: IntegrationDescriptor[] = [
	{
		id: HostingIntegrationId.GitHub,
		name: 'GitHub',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
		requiresPro: false,
	},
	{
		id: SelfHostedIntegrationId.CloudGitHubEnterprise,
		name: 'GitHub Enterprise',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: HostingIntegrationId.GitLab,
		name: 'GitLab',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
		requiresPro: false,
	},
	{
		id: SelfHostedIntegrationId.CloudGitLabSelfHosted,
		name: 'GitLab Self-Hosted',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: HostingIntegrationId.AzureDevOps,
		name: 'Azure DevOps',
		icon: 'gl-provider-azdo',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: HostingIntegrationId.Bitbucket,
		name: 'Bitbucket',
		icon: 'gl-provider-bitbucket',
		supports: ['prs'],
		requiresPro: false,
	},
	{
		id: IssueIntegrationId.Jira,
		name: 'Jira',
		icon: 'gl-provider-jira',
		supports: ['issues'],
		requiresPro: true,
	},
];
