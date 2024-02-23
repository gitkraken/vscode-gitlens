import type {
	Account,
	AzureDevOps,
	Bitbucket,
	EnterpriseOptions,
	GetRepoInput,
	GitHub,
	GitLab,
	GitPullRequest,
	GitRepository,
	Issue,
	Jira,
	Trello,
} from '@gitkraken/provider-apis';

export type ProviderAccount = Account;
export type ProviderReposInput = (string | number)[] | GetRepoInput[];
export type ProviderRepoInput = GetRepoInput;
export type ProviderPullRequest = GitPullRequest;
export type ProviderRepository = GitRepository;
export type ProviderIssue = Issue;

export type IntegrationId = HostingIntegrationId | IssueIntegrationId | SelfHostedIntegrationId;

export enum HostingIntegrationId {
	GitHub = 'github',
	GitLab = 'gitlab',
	Bitbucket = 'bitbucket',
	AzureDevOps = 'azureDevOps',
}

export enum IssueIntegrationId {
	Jira = 'jira',
	Trello = 'trello',
}

export enum SelfHostedIntegrationId {
	GitHubEnterprise = 'github-enterprise',
	GitLabSelfHosted = 'gitlab-self-hosted',
}

const selfHostedIntegrationIds: SelfHostedIntegrationId[] = [
	SelfHostedIntegrationId.GitHubEnterprise,
	SelfHostedIntegrationId.GitLabSelfHosted,
] as const;

export function isSelfHostedIntegrationId(id: IntegrationId): id is SelfHostedIntegrationId {
	return selfHostedIntegrationIds.includes(id as SelfHostedIntegrationId);
}

export enum PullRequestFilter {
	Author = 'author',
	Assignee = 'assignee',
	ReviewRequested = 'review-requested',
	Mention = 'mention',
}

export enum IssueFilter {
	Author = 'author',
	Assignee = 'assignee',
	Mention = 'mention',
}

export enum PagingMode {
	Project = 'project',
	Repo = 'repo',
	Repos = 'repos',
}

export interface PagingInput {
	cursor?: string | null;
	page?: number;
}

export interface PagedRepoInput {
	repo: GetRepoInput;
	cursor?: string;
}

export interface PagedProjectInput {
	namespace: string;
	project: string;
	cursor?: string;
}

export interface GetPullRequestsOptions {
	authorLogin?: string;
	assigneeLogins?: string[];
	reviewRequestedLogin?: string;
	mentionLogin?: string;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
}

export interface GetPullRequestsForRepoInput extends GetPullRequestsOptions {
	repo: GetRepoInput;
}

export interface GetPullRequestsForReposInput extends GetPullRequestsOptions {
	repos: GetRepoInput[];
}

export interface GetPullRequestsForRepoIdsInput extends GetPullRequestsOptions {
	repoIds: (string | number)[];
}

export interface GetIssuesOptions {
	authorLogin?: string;
	assigneeLogins?: string[];
	mentionLogin?: string;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
}

export interface GetIssuesForRepoInput extends GetIssuesOptions {
	repo: GetRepoInput;
}

export interface GetIssuesForReposInput extends GetIssuesOptions {
	repos: GetRepoInput[];
}

export interface GetIssuesForRepoIdsInput extends GetIssuesOptions {
	repoIds: (string | number)[];
}

export interface GetIssuesForAzureProjectInput extends GetIssuesOptions {
	namespace: string;
	project: string;
}

export interface GetReposOptions {
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
}

export interface GetReposForAzureProjectInput {
	namespace: string;
	project: string;
}

export interface PageInfo {
	hasNextPage: boolean;
	endCursor?: string | null;
	nextPage?: number | null;
}

export type GetPullRequestsForReposFn = (
	input: (GetPullRequestsForReposInput | GetPullRequestsForRepoIdsInput) & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: GitPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForRepoFn = (
	input: GetPullRequestsForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: GitPullRequest[]; pageInfo?: PageInfo }>;

export type GetIssuesForReposFn = (
	input: (GetIssuesForReposInput | GetIssuesForRepoIdsInput) & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: Issue[]; pageInfo?: PageInfo }>;

export type GetIssuesForRepoFn = (
	input: GetIssuesForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: Issue[]; pageInfo?: PageInfo }>;

export type GetIssuesForAzureProjectFn = (
	input: GetIssuesForAzureProjectInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: Issue[]; pageInfo?: PageInfo }>;

export type GetReposForAzureProjectFn = (
	input: GetReposForAzureProjectInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: GitRepository[]; pageInfo?: PageInfo }>;

export type getCurrentUserFn = (options?: EnterpriseOptions) => Promise<{ data: Account }>;
export type getCurrentUserForInstanceFn = (
	input: { namespace: string },
	options?: EnterpriseOptions,
) => Promise<{ data: Account }>;

export interface ProviderInfo extends ProviderMetadata {
	provider: GitHub | GitLab | Bitbucket | Jira | Trello | AzureDevOps;
	getPullRequestsForReposFn?: GetPullRequestsForReposFn;
	getPullRequestsForRepoFn?: GetPullRequestsForRepoFn;
	getIssuesForReposFn?: GetIssuesForReposFn;
	getIssuesForRepoFn?: GetIssuesForRepoFn;
	getIssuesForAzureProjectFn?: GetIssuesForAzureProjectFn;
	getCurrentUserFn?: getCurrentUserFn;
	getCurrentUserForInstanceFn?: getCurrentUserForInstanceFn;
	getReposForAzureProjectFn?: GetReposForAzureProjectFn;
}

export interface ProviderMetadata {
	domain: string;
	id: IntegrationId;
	issuesPagingMode?: PagingMode;
	pullRequestsPagingMode?: PagingMode;
	scopes: string[];
	supportedPullRequestFilters?: PullRequestFilter[];
	supportedIssueFilters?: IssueFilter[];
}

export type Providers = Record<IntegrationId, ProviderInfo>;
export type ProvidersMetadata = Record<IntegrationId, ProviderMetadata>;

export const providersMetadata: ProvidersMetadata = {
	[HostingIntegrationId.GitHub]: {
		domain: 'github.com',
		id: HostingIntegrationId.GitHub,
		issuesPagingMode: PagingMode.Repos,
		pullRequestsPagingMode: PagingMode.Repos,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Mention,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		scopes: ['repo', 'read:user', 'user:email'],
	},
	[SelfHostedIntegrationId.GitHubEnterprise]: {
		domain: '',
		id: SelfHostedIntegrationId.GitHubEnterprise,
		issuesPagingMode: PagingMode.Repos,
		pullRequestsPagingMode: PagingMode.Repos,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Mention,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		scopes: ['repo', 'read:user', 'user:email'],
	},
	[HostingIntegrationId.GitLab]: {
		domain: 'gitlab.com',
		id: HostingIntegrationId.GitLab,
		issuesPagingMode: PagingMode.Repo,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		scopes: ['read_api', 'read_user', 'read_repository'],
	},
	[SelfHostedIntegrationId.GitLabSelfHosted]: {
		domain: '',
		id: SelfHostedIntegrationId.GitLabSelfHosted,
		issuesPagingMode: PagingMode.Repo,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		scopes: ['read_api', 'read_user', 'read_repository'],
	},
	[HostingIntegrationId.Bitbucket]: {
		domain: 'bitbucket.org',
		id: HostingIntegrationId.Bitbucket,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author],
		scopes: ['account:read', 'repository:read', 'pullrequest:read', 'issue:read'],
	},
	[HostingIntegrationId.AzureDevOps]: {
		domain: 'dev.azure.com',
		id: HostingIntegrationId.AzureDevOps,
		issuesPagingMode: PagingMode.Project,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.Assignee],
		// Use 'name' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		scopes: ['vso.code', 'vso.identity', 'vso.project', 'vso.profile', 'vso.work'],
	},
	[IssueIntegrationId.Jira]: {
		domain: 'atlassian.net',
		id: IssueIntegrationId.Jira,
		scopes: [],
	},
	[IssueIntegrationId.Trello]: {
		domain: 'trello.com',
		id: IssueIntegrationId.Trello,
		scopes: [],
	},
};
