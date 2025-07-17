export enum GitCloudHostIntegrationId {
	GitHub = 'github',
	GitLab = 'gitlab',
	Bitbucket = 'bitbucket',
	AzureDevOps = 'azureDevOps',
}

export enum GitSelfManagedHostIntegrationId {
	BitbucketServer = 'bitbucket-server',
	GitHubEnterprise = 'github-enterprise',
	CloudGitHubEnterprise = 'cloud-github-enterprise',
	GitLabSelfHosted = 'gitlab-self-hosted',
	CloudGitLabSelfHosted = 'cloud-gitlab-self-hosted',
	AzureDevOpsServer = 'azure-devops-server',
}

export enum IssuesCloudHostIntegrationId {
	Jira = 'jira',
	Trello = 'trello',
}

export type CloudGitSelfManagedHostIntegrationIds =
	| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
	| GitSelfManagedHostIntegrationId.BitbucketServer
	| GitSelfManagedHostIntegrationId.AzureDevOpsServer
	| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;

export type GitHostIntegrationIds = GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId;
export type IssuesHostIntegrationIds = IssuesCloudHostIntegrationId;

export type IntegrationIds = GitHostIntegrationIds | IssuesHostIntegrationIds;

export const supportedOrderedCloudIssuesIntegrationIds = [IssuesCloudHostIntegrationId.Jira];
export const supportedOrderedCloudIntegrationIds = [
	GitCloudHostIntegrationId.GitHub,
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitCloudHostIntegrationId.GitLab,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	GitCloudHostIntegrationId.Bitbucket,
	GitSelfManagedHostIntegrationId.BitbucketServer,
	IssuesCloudHostIntegrationId.Jira,
];

export type SupportedCloudIntegrationIds = (typeof supportedOrderedCloudIntegrationIds)[number];

export function isSupportedCloudIntegrationId(id: IntegrationIds): id is SupportedCloudIntegrationIds {
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
		id: GitCloudHostIntegrationId.GitHub,
		name: 'GitHub',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
		requiresPro: false,
	},
	{
		id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
		name: 'GitHub Enterprise',
		icon: 'gl-provider-github',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: GitCloudHostIntegrationId.GitLab,
		name: 'GitLab',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
		requiresPro: false,
	},
	{
		id: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		name: 'GitLab Self-Hosted',
		icon: 'gl-provider-gitlab',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: GitCloudHostIntegrationId.AzureDevOps,
		name: 'Azure DevOps',
		icon: 'gl-provider-azdo',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		name: 'Azure DevOps Server',
		icon: 'gl-provider-azdo',
		supports: ['prs', 'issues'],
		requiresPro: true,
	},
	{
		id: GitCloudHostIntegrationId.Bitbucket,
		name: 'Bitbucket',
		icon: 'gl-provider-bitbucket',
		supports: ['prs', 'issues'],
		requiresPro: false,
	},
	{
		id: GitSelfManagedHostIntegrationId.BitbucketServer,
		name: 'Bitbucket Data Center',
		icon: 'gl-provider-bitbucket',
		supports: ['prs'],
		requiresPro: true,
	},
	{
		id: IssuesCloudHostIntegrationId.Jira,
		name: 'Jira',
		icon: 'gl-provider-jira',
		supports: ['issues'],
		requiresPro: true,
	},
];
