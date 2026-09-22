import type { CloudIntegrationAuthType } from './authentication/models.js';

export const providerFanOutConcurrency = 6;

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

/**
 * Issue trackers that live on a customer-run host rather than a single cloud endpoint, so every read must be
 * routed by the connection's own domain. Separate from {@link GitSelfManagedHostIntegrationId} because a
 * tracker has no repositories or pull requests: the two enums differ in what the id can be ASKED for, while
 * what they share — being keyed by host — is expressed by {@link SelfManagedHostIntegrationIds} and the
 * `isSelfManagedHostIntegrationId` predicate.
 */
export enum IssuesSelfManagedHostIntegrationId {
	JiraServer = 'jira-server',
}

export type CloudGitSelfManagedHostIntegrationIds =
	| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
	| GitSelfManagedHostIntegrationId.BitbucketServer
	| GitSelfManagedHostIntegrationId.AzureDevOpsServer
	| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;

/** The self-managed ids whose tokens are issued by the GK cloud backend, whatever they host. */
export type CloudSelfManagedHostIntegrationIds =
	| CloudGitSelfManagedHostIntegrationIds
	| IssuesSelfManagedHostIntegrationId.JiraServer;

export type GitHostIntegrationIds = GitCloudHostIntegrationId | GitSelfManagedHostIntegrationId;
export type IssuesHostIntegrationIds = IssuesCloudHostIntegrationId | IssuesSelfManagedHostIntegrationId;

/** Every id addressed by host, across both families — what the domain-keyed machinery keys off. */
export type SelfManagedHostIntegrationIds = GitSelfManagedHostIntegrationId | IssuesSelfManagedHostIntegrationId;

export type IntegrationIds = GitHostIntegrationIds | IssuesHostIntegrationIds;

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
	IssuesSelfManagedHostIntegrationId.JiraServer,
	IssuesCloudHostIntegrationId.Linear,
	IssuesCloudHostIntegrationId.Trello,
];

/**
 * The issue trackers of {@link supportedOrderedCloudIntegrationIds}, in the same order. Derived rather than
 * listed again: the two were parallel literals, and an id added to one and forgotten in the other drops that
 * tracker out of default project discovery and the Graph's issue-integration check with no other symptom.
 */
export const supportedOrderedCloudIssuesIntegrationIds = supportedOrderedCloudIntegrationIds.filter(
	(id): id is IssuesHostIntegrationIds =>
		// `Object.values`, not `in`: these are string enums, so the object is keyed by member name and `in`
		// would test the id against `Jira`/`Linear` rather than against `jira`/`linear`.
		(Object.values(IssuesCloudHostIntegrationId) as IntegrationIds[]).includes(id) ||
		(Object.values(IssuesSelfManagedHostIntegrationId) as IntegrationIds[]).includes(id),
);

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
	IssuesSelfManagedHostIntegrationId.JiraServer,
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
	/**
	 * The address a self-managed connection was configured with, path included, when it differs from the
	 * host-normalized {@link domain} — see `ProviderAuthenticationSession.baseUrl`.
	 */
	baseUrl?: string;
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
		id: IssuesSelfManagedHostIntegrationId.JiraServer,
		name: 'Jira Data Center',
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
	{
		id: IssuesCloudHostIntegrationId.Trello,
		name: 'Trello',
		icon: 'gl-provider-trello',
		supports: ['issues'],
		requiresPro: true,
	},
];
