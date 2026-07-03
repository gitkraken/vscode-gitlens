import type { CloudIntegrationAuthType } from './authentication/models.js';

export enum GitCloudHostIntegrationId {
	GitHub = 'github',
	GitLab = 'gitlab',
	Bitbucket = 'bitbucket',
	AzureDevOps = 'azureDevOps',
}

export enum GitSelfManagedHostIntegrationId {
	BitbucketServer = 'bitbucket-server',
	CloudGitHubEnterprise = 'cloud-github-enterprise',
	CloudGitLabSelfHosted = 'cloud-gitlab-self-hosted',
	AzureDevOpsServer = 'azure-devops-server',
}

export enum IssuesCloudHostIntegrationId {
	Jira = 'jira',
	Linear = 'linear',
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

export const supportedOrderedCloudIssuesIntegrationIds = [
	IssuesCloudHostIntegrationId.Jira,
	IssuesCloudHostIntegrationId.Linear,
];
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
	IssuesCloudHostIntegrationId.Linear,
];

export const integrationIds = [
	GitCloudHostIntegrationId.GitHub,
	GitCloudHostIntegrationId.GitLab,
	GitCloudHostIntegrationId.Bitbucket,
	GitCloudHostIntegrationId.AzureDevOps,
	GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	GitSelfManagedHostIntegrationId.BitbucketServer,
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
	IssuesCloudHostIntegrationId.Jira,
	IssuesCloudHostIntegrationId.Linear,
	IssuesCloudHostIntegrationId.Trello,
];

export type SupportedCloudIntegrationIds = (typeof supportedOrderedCloudIntegrationIds)[number];

export function isSupportedCloudIntegrationId(id: IntegrationIds): id is SupportedCloudIntegrationIds {
	return supportedOrderedCloudIntegrationIds.includes(id);
}

export function isIntegrationId(id: string): id is IntegrationIds {
	return integrationIds.includes(id as IntegrationIds);
}

export type IntegrationFeatures = 'prs' | 'issues';

export interface IntegrationDescriptor {
	id: SupportedCloudIntegrationIds;
	name: string;
	icon: string;
	supports: IntegrationFeatures[];
	requiresPro: boolean;
}

/** Stored shape of a configured-integration descriptor in workspace state. */
export interface StoredConfiguredIntegrationDescriptor {
	/** Stable per-connection identifier. Backfilled from the domain for pre-multi-account stored data. */
	id?: string;
	/** Whether this is the primary/default connection for the provider. */
	primary?: boolean;
	/** The connection's auth type (`oauth`/`pat`), when known. */
	type?: CloudIntegrationAuthType;
	/** Human-readable account handle for this connection (e.g. the GitHub login), when resolved. */
	accountName?: string;
	cloud: boolean;
	integrationId: IntegrationIds;
	domain?: string;
	expiresAt?: string;
	scopes: string;
}

/** Stored shape of the `integrations:configured` storage key. */
export type StoredIntegrationConfigurations = Record<
	IntegrationIds,
	StoredConfiguredIntegrationDescriptor[] | undefined
>;

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
	{
		id: IssuesCloudHostIntegrationId.Linear,
		name: 'Linear',
		icon: 'gl-provider-linear',
		supports: ['issues'],
		requiresPro: true,
	},
];
