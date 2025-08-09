import type {
	Account,
	ActionablePullRequest,
	AnyEntityIdentifierInput,
	AzureDevOps,
	AzureOrganization,
	AzureProject,
	AzureSetPullRequestInput,
	Bitbucket,
	BitbucketServer,
	BitbucketWorkspaceStub,
	EnterpriseOptions,
	GetRepoInput,
	GitHub,
	GitLab,
	GitMergeStrategy,
	GitPullRequest,
	GitRepository,
	Jira,
	JiraProject,
	JiraResource,
	NumberedPageInput,
	Issue as ProviderApiIssue,
	PullRequestWithUniqueID,
	RequestFunction,
	RequestOptions,
	Response,
	SetPullRequestInput,
	Trello,
} from '@gitkraken/provider-apis';
import {
	GitBuildStatusState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
} from '@gitkraken/provider-apis';
import { EntityIdentifierUtils } from '@gitkraken/provider-apis/entity-identifiers';
import { GitProviderUtils } from '@gitkraken/provider-apis/provider-utils';
import type { IntegrationIds } from '../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations';
import type { Account as UserAccount } from '../../../git/models/author';
import type { IssueMember, IssueProject, IssueShape } from '../../../git/models/issue';
import { Issue, RepositoryAccessLevel } from '../../../git/models/issue';
import type {
	PullRequestMember,
	PullRequestRefs,
	PullRequestRepositoryIdentityDescriptor,
	PullRequestReviewer,
	PullRequestState,
} from '../../../git/models/pullRequest';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '../../../git/models/pullRequest';
import type { Provider, ProviderReference } from '../../../git/models/remoteProvider';
import { equalsIgnoreCase } from '../../../system/string';
import type { EnrichableItem } from '../../launchpad/models/enrichedItem';
import type { Integration, IntegrationType } from '../models/integration';
import { getEntityIdentifierInput } from './utils';

export type ProviderAccount = Account;
export type ProviderReposInput = (string | number)[] | GetRepoInput[];
export type ProviderRepoInput = GetRepoInput;
export type ProviderPullRequest = GitPullRequest;
export type ProviderRepository = GitRepository;
export type ProviderIssue = ProviderApiIssue;
export type ProviderEnterpriseOptions = EnterpriseOptions;
export type ProviderJiraProject = JiraProject;
export type ProviderJiraResource = JiraResource;
export type ProviderAzureProject = AzureProject;
export type ProviderAzureResource = AzureOrganization;
export type ProviderBitbucketResource = BitbucketWorkspaceStub;
export const ProviderPullRequestReviewState = GitPullRequestReviewState;
export const ProviderBuildStatusState = GitBuildStatusState;
export type ProviderRequestFunction = RequestFunction;
export type ProviderRequestResponse<T> = Response<T>;
export type ProviderRequestOptions = RequestOptions;

export const enum PullRequestFilter {
	Author = 'author',
	Assignee = 'assignee',
	ReviewRequested = 'review-requested',
	Mention = 'mention',
}

export const enum IssueFilter {
	Author = 'author',
	Assignee = 'assignee',
	Mention = 'mention',
}

export const enum PagingMode {
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
	query?: string;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
}

export interface GetPullRequestsForUserOptions {
	includeFromArchivedRepos?: boolean;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
}

export interface GetPullRequestsForUserInput extends GetPullRequestsForUserOptions {
	userId: string;
}

export interface GetPullRequestsAssociatedWithUserInput extends GetPullRequestsForUserOptions {
	username: string;
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

export type GetRepoFn = (
	input: ProviderRepoInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository }>;
export type GetRepoOfProjectFn = (
	input: ProviderRepoInput & { project: string },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository }>;

export type GetPullRequestsForReposFn = (
	input: (GetPullRequestsForReposInput | GetPullRequestsForRepoIdsInput) & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForRepoFn = (
	input: GetPullRequestsForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForUserFn = (
	input: GetPullRequestsForUserInput | GetPullRequestsAssociatedWithUserInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForAzureProjectsFn = (
	input: { projects: { namespace: string; project: string }[]; authorLogin?: string; assigneeLogins?: string[] },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[] }>;

export type MergePullRequestFn =
	| ((
			input: {
				pullRequest: {
					headRef: {
						oid: string | null;
					} | null;
					version?: number; // Used by BitbucketServer
				} & SetPullRequestInput;
				mergeStrategy?: GitMergeStrategy;
			},
			options?: EnterpriseOptions,
	  ) => Promise<void>)
	| ((
			input: {
				pullRequest: {
					headRef: {
						oid: string | null;
					} | null;
				} & SetPullRequestInput;
				mergeStrategy?: GitMergeStrategy.Squash;
			},
			options?: EnterpriseOptions,
	  ) => Promise<void>)
	| ((
			input: {
				pullRequest: {
					headRef: {
						oid: string;
					};
				} & AzureSetPullRequestInput;
				mergeStrategy?:
					| GitMergeStrategy.MergeCommit
					| GitMergeStrategy.Rebase
					| GitMergeStrategy.RebaseThenMergeCommit
					| GitMergeStrategy.Squash;
			},
			options?: EnterpriseOptions,
	  ) => Promise<void>);

export type GetIssueFn = (
	input:
		| { resourceId: string; number: string } // jira
		| { namespace: string; name: string; number: string }, // gitlab
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue }>;

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

export type GetCurrentUserFn = (
	input: Record<string, never>,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderAccount }>;
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
export type GetAzureResourcesForUserFn = (
	input: { userId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: AzureOrganization[] }>;
export type GetAzureProjectsForResourceFn = (
	input: { namespace: string; cursor?: string },
	options?: EnterpriseOptions,
) => Promise<{ data: AzureProject[]; pageInfo?: PageInfo }>;
export type GetBitbucketResourcesForUserFn = (
	input: { userId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: BitbucketWorkspaceStub[] }>;
export type GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn = (
	input: {
		userId: string;
		workspaceSlug: string;
	} & NumberedPageInput,
	options?: EnterpriseOptions,
) => Promise<{
	pageInfo: {
		hasNextPage: boolean;
		nextPage: number | null;
	};
	data: GitPullRequest[];
}>;
export type GetBitbucketServerPullRequestsForCurrentUserFn = (
	input: NumberedPageInput,
	options?: EnterpriseOptions,
) => Promise<{
	pageInfo: {
		hasNextPage: boolean;
		nextPage: number | null;
	};
	data: GitPullRequest[];
}>;
export type GetIssuesForProjectFn = Jira['getIssuesForProject'];
export type GetIssuesForResourceForCurrentUserFn = (
	input: { resourceId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[] }>;

export interface ProviderInfo extends ProviderMetadata {
	provider: GitHub | GitLab | Bitbucket | BitbucketServer | Jira | Trello | AzureDevOps;
	getRepoFn?: GetRepoFn;
	getRepoOfProjectFn?: GetRepoOfProjectFn;
	getPullRequestsForReposFn?: GetPullRequestsForReposFn;
	getPullRequestsForRepoFn?: GetPullRequestsForRepoFn;
	getPullRequestsForUserFn?: GetPullRequestsForUserFn;
	getPullRequestsForAzureProjectsFn?: GetPullRequestsForAzureProjectsFn;
	getIssueFn?: GetIssueFn;
	getIssuesForReposFn?: GetIssuesForReposFn;
	getIssuesForRepoFn?: GetIssuesForRepoFn;
	getIssuesForAzureProjectFn?: GetIssuesForAzureProjectFn;
	getCurrentUserFn?: GetCurrentUserFn;
	getCurrentUserForInstanceFn?: GetCurrentUserForInstanceFn;
	getCurrentUserForResourceFn?: GetCurrentUserForResourceFn;
	getJiraResourcesForCurrentUserFn?: GetJiraResourcesForCurrentUserFn;
	getAzureResourcesForUserFn?: GetAzureResourcesForUserFn;
	getBitbucketResourcesForUserFn?: GetBitbucketResourcesForUserFn;
	getBitbucketPullRequestsAuthoredByUserForWorkspaceFn?: GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn;
	getBitbucketServerPullRequestsForCurrentUserFn?: GetBitbucketServerPullRequestsForCurrentUserFn;
	getJiraProjectsForResourcesFn?: GetJiraProjectsForResourcesFn;
	getAzureProjectsForResourceFn?: GetAzureProjectsForResourceFn;
	getIssuesForProjectFn?: GetIssuesForProjectFn;
	getReposForAzureProjectFn?: GetReposForAzureProjectFn;
	getIssuesForResourceForCurrentUserFn?: GetIssuesForResourceForCurrentUserFn;
	mergePullRequestFn?: MergePullRequestFn;
}

export interface ProviderMetadata {
	domain: string;
	id: IntegrationIds;
	name: string;
	type: IntegrationType;
	iconKey: string;
	issuesPagingMode?: PagingMode;
	pullRequestsPagingMode?: PagingMode;
	scopes: string[];
	supportedPullRequestFilters?: PullRequestFilter[];
	supportedIssueFilters?: IssueFilter[];
}

export type Providers = Record<IntegrationIds, ProviderInfo>;
export type ProvidersMetadata = Record<IntegrationIds, ProviderMetadata>;

export const providersMetadata: ProvidersMetadata = {
	[GitCloudHostIntegrationId.GitHub]: {
		domain: 'github.com',
		id: GitCloudHostIntegrationId.GitHub,
		name: 'GitHub',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.GitHub,
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
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
		name: 'GitHub Enterprise',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.GitHubEnterprise,
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
	[GitSelfManagedHostIntegrationId.GitHubEnterprise]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.GitHubEnterprise,
		name: 'GitHub Enterprise',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.GitHubEnterprise,
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
	[GitCloudHostIntegrationId.GitLab]: {
		domain: 'gitlab.com',
		id: GitCloudHostIntegrationId.GitLab,
		name: 'GitLab',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.GitLab,
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
		scopes: ['api', 'read_user', 'read_repository'],
	},
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		name: 'GitLab Self-Hosted',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.GitLabSelfHosted,
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
		scopes: ['api', 'read_user', 'read_repository'],
	},
	[GitSelfManagedHostIntegrationId.GitLabSelfHosted]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.GitLabSelfHosted,
		name: 'GitLab Self-Hosted',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.GitLabSelfHosted,
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
		scopes: ['api', 'read_user', 'read_repository'],
	},
	[GitCloudHostIntegrationId.Bitbucket]: {
		domain: 'bitbucket.org',
		id: GitCloudHostIntegrationId.Bitbucket,
		name: 'Bitbucket',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.Bitbucket,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author],
		scopes: ['account:read', 'repository:read', 'pullrequest:read', 'issue:read'],
	},
	[GitSelfManagedHostIntegrationId.BitbucketServer]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.BitbucketServer,
		name: 'Bitbucket Data Center',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.BitbucketServer,
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		scopes: ['Project (Read)', 'Repository (Write)'],
	},
	[GitCloudHostIntegrationId.AzureDevOps]: {
		domain: 'dev.azure.com',
		id: GitCloudHostIntegrationId.AzureDevOps,
		name: 'Azure DevOps',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.AzureDevOps,
		issuesPagingMode: PagingMode.Project,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.Assignee],
		// Use 'name' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		scopes: ['vso.code', 'vso.identity', 'vso.project', 'vso.profile', 'vso.work'],
	},
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		name: 'Azure DevOps Server',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.AzureDevOps,
		issuesPagingMode: PagingMode.Project,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.Assignee],
		// Use 'name' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		scopes: ['vso.code', 'vso.identity', 'vso.project', 'vso.profile', 'vso.work'],
	},
	[IssuesCloudHostIntegrationId.Jira]: {
		domain: 'atlassian.net',
		id: IssuesCloudHostIntegrationId.Jira,
		name: 'Jira',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Jira,
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
	[IssuesCloudHostIntegrationId.Trello]: {
		domain: 'trello.com',
		id: IssuesCloudHostIntegrationId.Trello,
		name: 'Trello',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Trello,
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
	if (issue.assignees?.some(assignee => assignee.username === userLogin || assignee.name === userLogin)) {
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

export function toIssueShape(issue: ProviderIssue, provider: ProviderReference): IssueShape | undefined {
	// TODO: Add some protections/baselines rather than killing the transformation here
	if (issue.updatedDate == null || issue.author == null || issue.url == null) return undefined;

	return {
		type: 'issue',
		provider: provider,
		id: issue.number,
		nodeId: issue.graphQLId ?? issue.id,
		title: issue.title,
		url: issue.url,
		createdDate: issue.createdDate,
		updatedDate: issue.updatedDate,
		closedDate: issue.closedDate ?? undefined,
		closed: issue.closedDate != null,
		state: issue.closedDate != null ? 'closed' : 'opened',
		author: {
			id: issue.author.id ?? '',
			name: issue.author.name ?? '',
			avatarUrl: issue.author.avatarUrl ?? undefined,
			url: issue.author.url ?? undefined,
		},
		assignees:
			issue.assignees?.map(assignee => ({
				id: assignee.id ?? '',
				name: assignee.name ?? '',
				avatarUrl: assignee.avatarUrl ?? undefined,
				url: assignee.url ?? undefined,
			})) ?? [],
		project: {
			id: issue.project?.id ?? '',
			name: issue.project?.name ?? '',
			resourceId: issue.project?.resourceId ?? '',
			resourceName: issue.project?.namespace ?? '',
		},
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
		body: issue.description ?? undefined,
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
		id: account.id,
		name: account.name ?? undefined,
		email: account.email ?? undefined,
		avatarUrl: account.avatarUrl ?? undefined,
		username: account.username ?? undefined,
	};
}

export const toProviderBuildStatusState = {
	[PullRequestStatusCheckRollupState.Success]: GitBuildStatusState.Success,
	[PullRequestStatusCheckRollupState.Failed]: GitBuildStatusState.Failed,
	[PullRequestStatusCheckRollupState.Pending]: GitBuildStatusState.Pending,
};

export const fromProviderBuildStatusState = {
	[GitBuildStatusState.Success]: PullRequestStatusCheckRollupState.Success,
	[GitBuildStatusState.Failed]: PullRequestStatusCheckRollupState.Failed,
	[GitBuildStatusState.Pending]: PullRequestStatusCheckRollupState.Pending,
	[GitBuildStatusState.ActionRequired]: PullRequestStatusCheckRollupState.Failed,
	// TODO: The rest of these are defaulted because we don't have a matching state for them
	[GitBuildStatusState.Error]: undefined,
	[GitBuildStatusState.Cancelled]: undefined,
	[GitBuildStatusState.OptionalActionRequired]: undefined,
	[GitBuildStatusState.Skipped]: undefined,
	[GitBuildStatusState.Running]: undefined,
	[GitBuildStatusState.Warning]: undefined,
};

export const toProviderPullRequestReviewState = {
	[PullRequestReviewState.Approved]: GitPullRequestReviewState.Approved,
	[PullRequestReviewState.ChangesRequested]: GitPullRequestReviewState.ChangesRequested,
	[PullRequestReviewState.Commented]: GitPullRequestReviewState.Commented,
	[PullRequestReviewState.ReviewRequested]: GitPullRequestReviewState.ReviewRequested,
	[PullRequestReviewState.Dismissed]: null,
	[PullRequestReviewState.Pending]: null,
};

export const fromProviderPullRequestReviewState = {
	[GitPullRequestReviewState.Approved]: PullRequestReviewState.Approved,
	[GitPullRequestReviewState.ChangesRequested]: PullRequestReviewState.ChangesRequested,
	[GitPullRequestReviewState.Commented]: PullRequestReviewState.Commented,
	[GitPullRequestReviewState.ReviewRequested]: PullRequestReviewState.ReviewRequested,
};

export const toProviderPullRequestMergeableState = {
	[PullRequestMergeableState.Mergeable]: GitPullRequestMergeableState.Mergeable,
	[PullRequestMergeableState.Conflicting]: GitPullRequestMergeableState.Conflicts,
	[PullRequestMergeableState.Unknown]: GitPullRequestMergeableState.Unknown,
	[PullRequestMergeableState.FailingChecks]: GitPullRequestMergeableState.FailingChecks,
	[PullRequestMergeableState.BlockedByPolicy]: GitPullRequestMergeableState.Blocked,
};

export const fromProviderPullRequestMergeableState = {
	[GitPullRequestMergeableState.Mergeable]: PullRequestMergeableState.Mergeable,
	[GitPullRequestMergeableState.Conflicts]: PullRequestMergeableState.Conflicting,
	[GitPullRequestMergeableState.Blocked]: PullRequestMergeableState.BlockedByPolicy,
	[GitPullRequestMergeableState.FailingChecks]: PullRequestMergeableState.FailingChecks,
	[GitPullRequestMergeableState.Unknown]: PullRequestMergeableState.Unknown,
	[GitPullRequestMergeableState.Behind]: PullRequestMergeableState.Unknown,
	[GitPullRequestMergeableState.UnknownAndBlocked]: PullRequestMergeableState.Unknown,
	[GitPullRequestMergeableState.Unstable]: PullRequestMergeableState.Unknown,
};

export function toProviderReviews(reviewers: PullRequestReviewer[]): ProviderPullRequest['reviews'] {
	return reviewers
		.filter(r => r.state !== PullRequestReviewState.Dismissed && r.state !== PullRequestReviewState.Pending)
		.map(reviewer => ({
			reviewer: toProviderAccount(reviewer.reviewer),
			state: toProviderPullRequestReviewState[reviewer.state] ?? GitPullRequestReviewState.ReviewRequested,
		}));
}

export function toReviewRequests(reviews: ProviderPullRequest['reviews']): PullRequestReviewer[] | undefined {
	return reviews == null
		? undefined
		: reviews
				?.filter(r => r.state === GitPullRequestReviewState.ReviewRequested)
				.map(r => ({
					isCodeOwner: false, // TODO: Find this value, and implement in the shared lib if needed
					reviewer: fromProviderAccount(r.reviewer),
					state: PullRequestReviewState.ReviewRequested,
				}));
}

export function toCompletedReviews(reviews: ProviderPullRequest['reviews']): PullRequestReviewer[] | undefined {
	return reviews == null
		? undefined
		: reviews
				?.filter(r => r.state !== GitPullRequestReviewState.ReviewRequested)
				.map(r => ({
					isCodeOwner: false, // TODO: Find this value, and implement in the shared lib if needed
					reviewer: fromProviderAccount(r.reviewer),
					state: fromProviderPullRequestReviewState[r.state],
				}));
}

export function toProviderReviewDecision(
	reviewDecision?: PullRequestReviewDecision,
	reviewers?: PullRequestReviewer[],
): GitPullRequestReviewState | null {
	switch (reviewDecision) {
		case PullRequestReviewDecision.Approved:
			return GitPullRequestReviewState.Approved;
		case PullRequestReviewDecision.ChangesRequested:
			return GitPullRequestReviewState.ChangesRequested;
		case PullRequestReviewDecision.ReviewRequired:
			return GitPullRequestReviewState.ReviewRequested;
		default: {
			if (reviewers?.some(r => r.state === PullRequestReviewState.ReviewRequested)) {
				return GitPullRequestReviewState.ReviewRequested;
			} else if (reviewers?.some(r => r.state === PullRequestReviewState.Commented)) {
				return GitPullRequestReviewState.Commented;
			}
			return null;
		}
	}
}

export const fromPullRequestReviewDecision = {
	[GitPullRequestReviewState.Approved]: PullRequestReviewDecision.Approved,
	[GitPullRequestReviewState.ChangesRequested]: PullRequestReviewDecision.ChangesRequested,
	[GitPullRequestReviewState.Commented]: undefined,
	[GitPullRequestReviewState.ReviewRequested]: PullRequestReviewDecision.ReviewRequired,
};

export function toProviderPullRequestState(state: PullRequestState): GitPullRequestState {
	return state === 'opened'
		? GitPullRequestState.Open
		: state === 'closed'
			? GitPullRequestState.Closed
			: GitPullRequestState.Merged;
}

export function fromProviderPullRequestState(state: GitPullRequestState): PullRequestState {
	return state === GitPullRequestState.Open ? 'opened' : state === GitPullRequestState.Closed ? 'closed' : 'merged';
}

export function toProviderPullRequest(pr: PullRequest): ProviderPullRequest {
	const prReviews = [...(pr.reviewRequests ?? []), ...(pr.latestReviews ?? [])];
	return {
		id: pr.id,
		graphQLId: pr.nodeId,
		number: Number.parseInt(pr.id, 10),
		title: pr.title,
		url: pr.url,
		state: toProviderPullRequestState(pr.state),
		isDraft: pr.isDraft ?? false,
		createdDate: pr.createdDate,
		updatedDate: pr.updatedDate,
		closedDate: pr.closedDate ?? null,
		mergedDate: pr.mergedDate ?? null,
		commentCount: pr.commentsCount ?? null,
		upvoteCount: pr.thumbsUpCount ?? null,
		commitCount: null,
		fileCount: null,
		additions: pr.additions ?? null,
		deletions: pr.deletions ?? null,
		author: toProviderAccount(pr.author),
		assignees: pr.assignees?.map(toProviderAccount) ?? null,
		baseRef:
			pr.refs?.base == null
				? null
				: {
						name: pr.refs.base.branch,
						oid: pr.refs.base.sha,
					},
		headRef:
			pr.refs?.head == null
				? null
				: {
						name: pr.refs.head.branch,
						oid: pr.refs.head.sha,
					},
		reviews: toProviderReviews(prReviews),
		reviewDecision: toProviderReviewDecision(pr.reviewDecision, prReviews),
		repository:
			pr.repository != null
				? {
						id: pr.repository.repo,
						name: pr.repository.repo,
						owner: {
							login: pr.repository.owner,
						},
						remoteInfo: null, // TODO: Add the urls to our model
					}
				: {
						id: '',
						name: '',
						owner: {
							login: '',
						},
						remoteInfo: null,
					},
		headRepository:
			pr.refs?.head != null
				? {
						id: pr.refs.head.repo,
						name: pr.refs.head.repo,
						owner: {
							login: pr.refs.head.owner,
						},
						remoteInfo: null,
					}
				: null,
		headCommit:
			pr.statusCheckRollupState != null
				? {
						buildStatuses: [
							{
								completedAt: null,
								description: '',
								name: '',
								state: toProviderBuildStatusState[pr.statusCheckRollupState],
								startedAt: null,
								stage: null,
								url: '',
							},
						],
					}
				: null,
		permissions:
			pr.viewerCanUpdate == null
				? null
				: {
						canMerge:
							pr.viewerCanUpdate === true &&
							pr.repository.accessLevel != null &&
							pr.repository.accessLevel >= RepositoryAccessLevel.Write,
						canMergeAndBypassProtections:
							pr.viewerCanUpdate === true &&
							pr.repository.accessLevel != null &&
							pr.repository.accessLevel >= RepositoryAccessLevel.Admin,
					},
		mergeableState: pr.mergeableState
			? toProviderPullRequestMergeableState[pr.mergeableState]
			: GitPullRequestMergeableState.Unknown,
	};
}

export function fromProviderPullRequest(
	pr: ProviderPullRequest,
	provider: Provider,
	options?: { project?: IssueProject },
): PullRequest {
	return new PullRequest(
		provider,
		fromProviderAccount(pr.author),
		pr.id,
		pr.graphQLId || pr.id,
		pr.title,
		pr.url ?? '',
		{
			owner: pr.repository.owner.login,
			repo: pr.repository.name,
			// This has to be here until we can take this information from ProviderPullRequest:
			accessLevel: RepositoryAccessLevel.Write,
			id: pr.repository.id,
		},
		fromProviderPullRequestState(pr.state),
		pr.createdDate,
		pr.updatedDate,
		pr.closedDate ?? undefined,
		pr.mergedDate ?? undefined,
		pr.mergeableState ? fromProviderPullRequestMergeableState[pr.mergeableState] : undefined,
		pr.permissions?.canMerge || pr.permissions?.canMergeAndBypassProtections ? true : undefined,
		{
			base: {
				branch: pr.baseRef?.name ?? '',
				sha: pr.baseRef?.oid ?? '',
				repo: pr.repository.name,
				owner: pr.repository.owner.login,
				exists: pr.baseRef != null,
				url: pr.repository.remoteInfo?.cloneUrlHTTPS
					? pr.repository.remoteInfo.cloneUrlHTTPS.replace(/\.git$/, '')
					: '',
			},
			head: {
				branch: pr.headRef?.name ?? '',
				sha: pr.headRef?.oid ?? '',
				repo: pr.headRepository?.name ?? '',
				owner: pr.headRepository?.owner.login ?? '',
				exists: pr.headRef != null,
				url: pr.headRepository?.remoteInfo?.cloneUrlHTTPS
					? pr.headRepository.remoteInfo.cloneUrlHTTPS.replace(/\.git$/, '')
					: '',
			},
			isCrossRepository: pr.headRepository?.id !== pr.repository.id,
		},
		pr.isDraft,
		pr.additions ?? undefined,
		pr.deletions ?? undefined,
		pr.commentCount ?? undefined,
		pr.upvoteCount ?? undefined,
		pr.reviewDecision ? fromPullRequestReviewDecision[pr.reviewDecision] : undefined,
		toReviewRequests(pr.reviews),
		toCompletedReviews(pr.reviews),
		pr.assignees?.map(fromProviderAccount) ?? undefined,
		pr.headCommit?.buildStatuses?.[0]?.state
			? fromProviderBuildStatusState[pr.headCommit.buildStatuses[0].state]
			: undefined,
		options?.project,
		pr.version,
	);
}

export function fromProviderIssue(
	issue: ProviderIssue,
	integration: Integration,
	options?: { project?: IssueProject },
): Issue {
	return new Issue(
		integration,
		issue.id,
		issue.graphQLId,
		issue.title,
		issue.url ?? '',
		issue.createdDate,
		issue.updatedDate ?? issue.closedDate ?? issue.createdDate,
		issue.closedDate != null,
		issue.closedDate != null ? 'closed' : 'opened',
		fromProviderAccount(issue.author),
		issue.assignees?.map(fromProviderAccount) ?? undefined,
		undefined, // TODO: issue repo
		issue.closedDate ?? undefined,
		undefined,
		issue.commentCount ?? undefined,
		issue.upvoteCount ?? undefined,
		issue.description ?? undefined,
		options?.project != null
			? {
					id: options.project.id,
					name: options.project.name,
					resourceId: options.project.resourceId,
					resourceName: options.project.resourceName,
				}
			: issue.project?.id && issue.project?.resourceId && issue.project?.namespace
				? {
						id: issue.project.id,
						name: issue.project.name,
						resourceId: issue.project.resourceId,
						resourceName: issue.project.namespace,
					}
				: undefined,
	);
}

export function toProviderPullRequestWithUniqueId(pr: PullRequest): PullRequestWithUniqueID {
	return {
		...toProviderPullRequest(pr),
		uuid: EntityIdentifierUtils.encode(getEntityIdentifierInput(pr)),
	};
}

export function toProviderAccount(account: PullRequestMember | IssueMember): ProviderAccount {
	return {
		id: account.id ?? null,
		avatarUrl: account.avatarUrl ?? null,
		name: account.name ?? null,
		url: account.url ?? null,
		// TODO: Implement these in our own model
		email: '',
		username: account.name ?? null,
	};
}

export function fromProviderAccount(account: ProviderAccount | null): PullRequestMember | IssueMember {
	return {
		id: account?.id ?? '',
		name: account?.name ?? 'unknown',
		avatarUrl: account?.avatarUrl ?? undefined,
		url: account?.url ?? '',
	};
}

export type ProviderActionablePullRequest = ActionablePullRequest;

export type EnrichablePullRequest = ProviderPullRequest & {
	uuid: string;
	type: 'pullrequest';
	provider: ProviderReference;
	enrichable: EnrichableItem;
	repoIdentity: PullRequestRepositoryIdentityDescriptor;
	refs?: PullRequestRefs;
	underlyingPullRequest: PullRequest;
};

export const getActionablePullRequests = GitProviderUtils.getActionablePullRequests;

export type GitConfigEntityIdentifier = AnyEntityIdentifierInput & {
	metadata: {
		id: string;
		owner: { key: string; name: string; id: string | undefined; owner: string | undefined };
		createdDate: string;
		isCloudEnterprise?: boolean;
	};
};

export function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export function isGitLabDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'gitlab.com');
}

export function supportsCodeSuggest(provider: ProviderReference): boolean {
	return isGitHubDotCom(provider.domain);
}
