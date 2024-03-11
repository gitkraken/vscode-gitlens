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
	JiraProject,
	JiraResource,
	Trello,
} from '@gitkraken/provider-apis';
import type { Account as UserAccount } from '../../../git/models/author';
import type { SearchedIssue } from '../../../git/models/issue';
import type { ProviderReference } from '../../../git/models/remoteProvider';

export type ProviderAccount = Account;
export type ProviderReposInput = (string | number)[] | GetRepoInput[];
export type ProviderRepoInput = GetRepoInput;
export type ProviderPullRequest = GitPullRequest;
export type ProviderRepository = GitRepository;
export type ProviderIssue = Issue;
export type ProviderEnterpriseOptions = EnterpriseOptions;
export type ProviderJiraProject = JiraProject;
export type ProviderJiraResource = JiraResource;

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

export interface GetIssuesForProjectInput extends GetIssuesOptions {
	project: string;
	resourceId: string;
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
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForRepoFn = (
	input: GetPullRequestsForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetIssuesForReposFn = (
	input: (GetIssuesForReposInput | GetIssuesForRepoIdsInput) & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[]; pageInfo?: PageInfo }>;

export type GetIssuesForRepoFn = (
	input: GetIssuesForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[]; pageInfo?: PageInfo }>;

export type GetIssuesForAzureProjectFn = (
	input: GetIssuesForAzureProjectInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[]; pageInfo?: PageInfo }>;

export type GetReposForAzureProjectFn = (
	input: GetReposForAzureProjectInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository[]; pageInfo?: PageInfo }>;

export type GetCurrentUserFn = (options?: EnterpriseOptions) => Promise<{ data: ProviderAccount }>;
export type GetCurrentUserForInstanceFn = (
	input: { namespace: string },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderAccount }>;
export type GetCurrentUserForResourceFn = (
	input: { resourceId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderAccount }>;

export type GetJiraResourcesForCurrentUserFn = (options?: EnterpriseOptions) => Promise<{ data: JiraResource[] }>;
export type GetJiraProjectsForResourcesFn = (
	input: { resourceIds: string[] },
	options?: EnterpriseOptions,
) => Promise<{ data: JiraProject[] }>;
export type GetIssuesForProjectFn = (
	input: GetIssuesForProjectInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[] }>;
export type GetIssuesForResourceForCurrentUserFn = (
	input: { resourceId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[] }>;

export interface ProviderInfo extends ProviderMetadata {
	provider: GitHub | GitLab | Bitbucket | Jira | Trello | AzureDevOps;
	getPullRequestsForReposFn?: GetPullRequestsForReposFn;
	getPullRequestsForRepoFn?: GetPullRequestsForRepoFn;
	getIssuesForReposFn?: GetIssuesForReposFn;
	getIssuesForRepoFn?: GetIssuesForRepoFn;
	getIssuesForAzureProjectFn?: GetIssuesForAzureProjectFn;
	getCurrentUserFn?: GetCurrentUserFn;
	getCurrentUserForInstanceFn?: GetCurrentUserForInstanceFn;
	getCurrentUserForResourceFn?: GetCurrentUserForResourceFn;
	getJiraResourcesForCurrentUserFn?: GetJiraResourcesForCurrentUserFn;
	getJiraProjectsForResourcesFn?: GetJiraProjectsForResourcesFn;
	getIssuesForProjectFn?: GetIssuesForProjectFn;
	getReposForAzureProjectFn?: GetReposForAzureProjectFn;
	getIssuesForResourceForCurrentUserFn?: GetIssuesForResourceForCurrentUserFn;
}

export interface ProviderMetadata {
	domain: string;
	id: IntegrationId;
	issuesPagingMode?: PagingMode;
	pullRequestsPagingMode?: PagingMode;
	scopes: string[];
	supportedPullRequestFilters?: PullRequestFilter[];
	supportedIssueFilters?: IssueFilter[];
	usesPAT?: boolean;
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
		usesPAT: true,
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
		usesPAT: true,
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
		usesPAT: true,
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
		usesPAT: true,
	},
	[HostingIntegrationId.Bitbucket]: {
		domain: 'bitbucket.org',
		id: HostingIntegrationId.Bitbucket,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author],
		scopes: ['account:read', 'repository:read', 'pullrequest:read', 'issue:read'],
		usesPAT: true,
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
		usesPAT: true,
	},
	[IssueIntegrationId.Jira]: {
		domain: 'atlassian.net',
		id: IssueIntegrationId.Jira,
		scopes: [
			'read:status:jira',
			'read:application-role:jira',
			'write:attachment:jira',
			'read:comment:jira',
			'read:project-category:jira',
			'read:project:jira',
			'read:issue.vote:jira',
			'read:field-configuration:jira',
			'write:issue:jira',
			'read:issue-security-level:jira',
			'write:issue.property:jira',
			'read:issue.changelog:jira',
			'read:avatar:jira',
			'read:issue-meta:jira',
			'read:permission:jira',
			'offline_access',
			'read:issue:jira',
			'read:me',
			'read:audit-log:jira',
			'read:project.component:jira',
			'read:group:jira',
			'read:project-role:jira',
			'write:comment:jira',
			'read:label:jira',
			'write:comment.property:jira',
			'read:issue-details:jira',
			'read:issue-type-hierarchy:jira',
			'read:issue.transition:jira',
			'read:user:jira',
			'read:field:jira',
			'read:issue-type:jira',
			'read:project.property:jira',
			'read:comment.property:jira',
			'read:project-version:jira',
		],
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
	},
	[IssueIntegrationId.Trello]: {
		domain: 'trello.com',
		id: IssueIntegrationId.Trello,
		scopes: [],
	},
};

export function getReasonsForUserIssue(issue: ProviderIssue, userLogin: string): string[] {
	const reasons: string[] = [];
	let isAuthor = false;
	let isAssignee = false;
	if (issue.author?.username === userLogin || issue.author?.name === userLogin) {
		reasons.push('authored');
		isAuthor = true;
	}
	if (
		issue.assignees != null &&
		issue.assignees.some(assignee => assignee.username === userLogin || assignee.name === userLogin)
	) {
		reasons.push('assigned');
		isAssignee = true;
	}

	// TODO: Impossible to denote all issues we are mentioned on given their properties. for now just
	// assume we are mentioned on any of our issues we are not the author or assignee on
	if (!isAuthor && !isAssignee) {
		reasons.push('mentioned');
	}

	return reasons;
}

export function toSearchedIssue(
	issue: ProviderIssue,
	provider: ProviderReference,
	filterUsed?: IssueFilter,
	userLogin?: string,
): SearchedIssue | undefined {
	// TODO: Add some protections/baselines rather than killing the transformation here
	if (issue.updatedDate == null || issue.author == null || issue.url == null) return undefined;

	return {
		reasons:
			filterUsed != null
				? [issueFilterToReason(filterUsed)]
				: userLogin != null
				  ? getReasonsForUserIssue(issue, userLogin)
				  : [],
		issue: {
			type: 'issue',
			provider: provider,
			id: issue.id,
			nodeId: undefined,
			title: issue.title,
			url: issue.url,
			date: issue.createdDate,
			closedDate: issue.closedDate ?? undefined,
			closed: issue.closedDate != null,
			state: issue.closedDate != null ? 'closed' : 'opened',
			updatedDate: issue.updatedDate,
			author: {
				name: issue.author.name ?? '',
				avatarUrl: issue.author.avatarUrl ?? undefined,
				url: issue.author.url ?? undefined,
			},
			assignees:
				issue.assignees?.map(assignee => ({
					name: assignee.name ?? '',
					avatarUrl: assignee.avatarUrl ?? undefined,
					url: assignee.url ?? undefined,
				})) ?? [],
			repository:
				issue.repository?.owner?.login != null
					? {
							owner: issue.repository.owner.login,
							repo: issue.repository.name,
					  }
					: undefined,
			labels: issue.labels.map(label => ({ color: label.color ?? undefined, name: label.name })),
			commentsCount: issue.commentCount ?? undefined,
			thumbsUpCount: issue.upvoteCount ?? undefined,
		},
	};
}

export function issueFilterToReason(filter: IssueFilter): 'authored' | 'assigned' | 'mentioned' {
	switch (filter) {
		case IssueFilter.Author:
			return 'authored';
		case IssueFilter.Assignee:
			return 'assigned';
		case IssueFilter.Mention:
			return 'mentioned';
	}
}

export function toAccount(account: ProviderAccount, provider: ProviderReference): UserAccount {
	return {
		provider: provider,
		name: account.name ?? undefined,
		email: account.email ?? undefined,
		avatarUrl: account.avatarUrl ?? undefined,
		username: account.username ?? undefined,
	};
}
