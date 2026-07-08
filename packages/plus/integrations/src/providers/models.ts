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
	CollectionMetadata,
	CursorPageInput,
	EnterpriseOptions,
	GetRepoInput,
	GitHub,
	GitLab,
	GitLabGroup,
	GitMergeStrategy,
	GitPullRequest,
	GitRepository,
	GitRepositoryRemoteInfo,
	Jira,
	JiraProject,
	JiraResource,
	Linear,
	LinearOrganization,
	LinearTeam,
	NumberedPageInput,
	Organization,
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
	GitIssueState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
} from '@gitkraken/provider-apis';
import { EntityIdentifierUtils } from '@gitkraken/provider-apis/entity-identifiers';
import { GitProviderUtils } from '@gitkraken/provider-apis/provider-utils';
import type { Account as UserAccount } from '@gitlens/git/models/author.js';
import type { IssueMember, IssueProject, IssueShape, IssueStateFilter } from '@gitlens/git/models/issue.js';
import { Issue, RepositoryAccessLevel } from '@gitlens/git/models/issue.js';
import type {
	PullRequestMember,
	PullRequestRef,
	PullRequestRefs,
	PullRequestRepositoryIdentityDescriptor,
	PullRequestReviewer,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { Provider, ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import type { ProviderScope } from '@gitlens/git/models/resourceDescriptor.js';
import { gitSuffixRegex } from '@gitlens/git/utils/remote.utils.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import type { Integration, IntegrationType } from '../models/integration.js';
import { getEntityIdentifierInput } from './utils.js';

/**
 * Forward-only host type — the package only sets `EnrichablePullRequest.enrichable`
 * for the host to consume. Typed as `any` to avoid duplicating the host's
 * `EnrichableItem` shape.
 */
type EnrichableItem = any;

export type ProviderAccount = Account;
export type ProviderReposInput = (string | number)[] | GetRepoInput[];
export type ProviderRepoInput = GetRepoInput;
export type ProviderPullRequest = GitPullRequest;
export type ProviderRepository = GitRepository;
export type ProviderIssue = ProviderApiIssue;
export type ProviderEnterpriseOptions = EnterpriseOptions;
export type ProviderJiraProject = JiraProject;
export type ProviderJiraResource = JiraResource;
export type ProviderLinearTeam = LinearTeam;
export type ProviderLinearOrganization = LinearOrganization;
export type ProviderAzureProject = AzureProject;
export type ProviderAzureResource = AzureOrganization;
export type ProviderBitbucketResource = BitbucketWorkspaceStub;
export type ProviderGitHubOrganization = Organization;
export type ProviderGitLabGroup = GitLabGroup;
export type ProviderHierarchyResult<T> = PagedResult<T> & {
	readonly truncated?: boolean;
	/**
	 * SDK collection metadata merged across the drained pages. Independent from the local `truncated` backstop:
	 * a page-drain backstop stays visible even if every fetched page reported `complete`, and SDK
	 * incompleteness is preserved even when the drain finished within its page budget.
	 */
	readonly metadata?: CollectionMetadata;
};

/**
 * A normalized {@link PagedResult} that additionally carries the SDK's collection {@link CollectionMetadata}
 * (completeness + per-scope failures). Named to avoid colliding with the public ProviderBackend
 * `ProviderPagedResult` in `results.ts`: this is the integration-local carrier between the `ProvidersApi`
 * boundary and the code that maps metadata into warnings/truncation. `metadata` is optional so providers and
 * test doubles that predate the SDK metadata contract keep behaving exactly as before.
 */
export type ProviderApiPagedResult<T> = PagedResult<T> & {
	readonly metadata?: CollectionMetadata;
};

/**
 * A non-paged collection result carrying SDK {@link CollectionMetadata}. Used for fan-out reads that return a
 * flat set of values with completeness/failure metadata but no provider-native pagination (e.g. Jira project
 * discovery across resources, Trello board search).
 */
export type ProviderApiCollectionResult<T> = {
	readonly values: NonNullable<T>[];
	readonly metadata?: CollectionMetadata;
};

/**
 * Normalized org/workspace/group shape returned by `GitHostIntegration.getOrganizationsForUser`.
 * `name` is the identifier to pass back into `getRepositoriesForOrg` (GitHub login, Bitbucket
 * workspace slug, Azure DevOps org name, GitLab full namespace path) — not a display name; hosts
 * where those differ (Bitbucket, GitLab) must map to the identifier, not the human-readable label.
 */
export interface ProviderOrganization {
	id: string;
	name: string;
	url: string;
}
export const ProviderPullRequestReviewState = GitPullRequestReviewState;
export const ProviderBuildStatusState = GitBuildStatusState;
export type ProviderRequestFunction = RequestFunction;
export type ProviderRequestResponse<T> = Response<T>;
export type ProviderRequestOptions = RequestOptions;

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
	// Reviewer filters keyed differently per provider: GitHub/GitLab use reviewRequestedLogin (login),
	// Bitbucket/Azure DevOps use reviewerId (account id), Bitbucket Server uses reviewerLogin (login).
	reviewerId?: string;
	reviewerLogin?: string;
	mentionLogin?: string;
	// PR states to include; when omitted the provider returns its default (open only).
	states?: GitPullRequestState[];
	query?: string;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
	// 1-based page to request from numbered-page providers; takes precedence over a page-typed cursor.
	page?: number;
	// Items to request per page (numbered-page providers, plus GitHub's maxPageSize).
	pageSize?: number;
	// Opt in to repository remote metadata (clone URLs) when the PR payload lacks it. Only Azure DevOps
	// acts on this today (extra API call); it is a no-op for the other providers.
	includeRemoteInfo?: boolean;
}

export interface GetPullRequestsForUserOptions {
	includeFromArchivedRepos?: boolean;
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
	// PR states to include; when omitted the provider returns its default (open only).
	states?: GitPullRequestState[];
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
	// Issue states to include; when omitted the provider returns its default (open only).
	states?: GitIssueState[];
	cursor?: string; // stringified JSON object of type { type: 'cursor' | 'page'; value: string | number } | {}
	baseUrl?: string;
	// 1-based page to request from numbered-page providers; takes precedence over a page-typed cursor.
	page?: number;
	// Items to request per page (numbered-page providers, plus GitHub's maxPageSize).
	pageSize?: number;
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
	// Numbered-page providers (Bitbucket, Bitbucket Server, Azure DevOps) additionally report these.
	currentPage?: number | null;
	totalPages?: number | null;
	totalCount?: number | null;
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
	// `metadata` carries SDK collection completeness/failures for multi-repo fan-outs (Bitbucket, Azure DevOps,
	// Bitbucket Server); `pageInfo` is present for the cursor-based aggregate (GitHub). Both are optional so
	// each provider only sets what it actually reports.
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo; metadata?: CollectionMetadata }>;

export type GetPullRequestsForRepoFn = (
	input: GetPullRequestsForRepoInput & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForUserFn = (
	input: GetPullRequestsForUserInput | GetPullRequestsAssociatedWithUserInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo?: PageInfo }>;

export type GetPullRequestsForAzureProjectsFn = (
	input: {
		projects: { namespace: string; project: string }[];
		authorLogin?: string;
		assigneeLogins?: string[];
		reviewerId?: string;
		states?: GitPullRequestState[];
	},
	options?: EnterpriseOptions,
	// Aggregate multi-project fan-out: no `pageInfo` (call getPullRequestsForAzureProject for that), but SDK
	// collection metadata reports per-project completeness/failures.
) => Promise<{ data: ProviderPullRequest[]; metadata?: CollectionMetadata }>;

/** Single Azure project PR read, paginated by number (unlike the aggregate {@link GetPullRequestsForAzureProjectsFn}). */
export type GetPullRequestsForAzureProjectFn = (
	input: {
		namespace: string;
		project: string;
		authorLogin?: string;
		assigneeLogins?: string[];
		reviewerId?: string;
		states?: GitPullRequestState[];
		repo?: ProviderRepoInput;
	} & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderPullRequest[]; pageInfo: { hasNextPage: boolean; nextPage: number | null } }>;

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

export type GetIssuesForCurrentUserFn = (
	input: PagingInput,
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

export type GetOrgsForCurrentUserFn = (
	input?: CursorPageInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderGitHubOrganization[]; pageInfo?: PageInfo }>;
export type GetReposForOrgFn = (
	input: { orgName: string } & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository[]; pageInfo?: PageInfo }>;
export type GetReposForWorkspaceFn = (
	input: { workspace: string } & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository[]; pageInfo?: PageInfo }>;
export type GetReposForCurrentUserFn = (
	input: PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderRepository[]; pageInfo?: PageInfo }>;
export type GetGroupsForCurrentUserFn = (
	input?: { topLevelOnly?: boolean } & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderGitLabGroup[]; pageInfo?: PageInfo }>;

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
export type GetLinearOrganizationFn = (options?: EnterpriseOptions) => Promise<{ data: LinearOrganization }>;
export type GetLinearTeamsForCurrentUserFn = (options?: EnterpriseOptions) => Promise<{ data: LinearTeam[] }>;
export type GetLinearIssuesFn = (
	input: { teams?: string[]; projects?: string[]; labels?: string[] } & PagingInput,
	options?: EnterpriseOptions,
) => Promise<{ data: ProviderIssue[]; pageInfo?: PageInfo }>;
/**
 * Linear's current-user (viewer) query. Its raw `@linear/sdk` User isn't a `ProviderAccount` (no
 * username/avatar/url), so it's typed with the minimal fields the viewer query actually returns rather than
 * importing `@linear/sdk` (which is bundled in the SDK dist and not a resolvable top-level dependency).
 */
export type GetLinearCurrentUserFn = (
	options?: EnterpriseOptions,
) => Promise<{ data: { id: string; name?: string | null; email?: string | null; displayName?: string | null } }>;
export type GetJiraProjectsForResourcesFn = (
	input: { resourceIds: string[] },
	options?: EnterpriseOptions,
	// Fan-out across resources: preserves successful resources' projects and reports per-resource failures in
	// SDK collection metadata instead of throwing when a single resource fails.
) => Promise<{ data: JiraProject[]; metadata?: CollectionMetadata }>;
export type GetAzureResourcesForUserFn = (
	input: { userId: string },
	options?: EnterpriseOptions,
) => Promise<{ data: AzureOrganization[] }>;
export type GetAzureProjectsForResourceFn = (
	input: { namespace: string; cursor?: string },
	options?: EnterpriseOptions,
) => Promise<{ data: AzureProject[]; pageInfo?: PageInfo }>;
export type GetBitbucketResourcesForCurrentUserFn = (
	input: { page?: number },
	options?: EnterpriseOptions,
) => Promise<{ data: BitbucketWorkspaceStub[]; pageInfo?: PageInfo }>;
export type GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn = (
	input: {
		userId: string;
		workspaceSlug: string;
		states?: GitPullRequestState[];
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
	input: { states?: GitPullRequestState[] } & NumberedPageInput,
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

// Trello reads (issues-capable provider). The Trello client is keyed by an `appKey` (the Trello app key from
// the cloud token exchange) alongside the OAuth token, so these mirror the client method shapes directly.
export type GetTrelloCurrentUserFn = Trello['getCurrentUser'];
export type GetTrelloBoardsForCurrentUserFn = Trello['getBoardsForCurrentUser'];
export type GetTrelloListsForBoardFn = Trello['getListsForTrelloBoard'];
export type GetTrelloAccountForIdFn = Trello['getAccountForId'];
export type GetTrelloIssuesForBoardFn = Trello['getIssuesForBoard'];
export type GetTrelloLabelsForBoardFn = Trello['getLabelsForBoard'];

export interface ProviderInfo extends ProviderMetadata {
	provider: GitHub | GitLab | Bitbucket | BitbucketServer | Jira | Linear | Trello | AzureDevOps;
	getRepoFn?: GetRepoFn;
	getRepoOfProjectFn?: GetRepoOfProjectFn;
	getPullRequestsForReposFn?: GetPullRequestsForReposFn;
	getPullRequestsForRepoFn?: GetPullRequestsForRepoFn;
	getPullRequestsForUserFn?: GetPullRequestsForUserFn;
	getPullRequestsForAzureProjectsFn?: GetPullRequestsForAzureProjectsFn;
	getPullRequestsForAzureProjectFn?: GetPullRequestsForAzureProjectFn;
	getIssueFn?: GetIssueFn;
	getIssuesForReposFn?: GetIssuesForReposFn;
	getIssuesForCurrentUserFn?: GetIssuesForCurrentUserFn;
	getIssuesForRepoFn?: GetIssuesForRepoFn;
	getIssuesForAzureProjectFn?: GetIssuesForAzureProjectFn;
	getCurrentUserFn?: GetCurrentUserFn;
	getCurrentUserForInstanceFn?: GetCurrentUserForInstanceFn;
	getCurrentUserForResourceFn?: GetCurrentUserForResourceFn;
	getJiraResourcesForCurrentUserFn?: GetJiraResourcesForCurrentUserFn;
	getLinearOrganizationFn?: GetLinearOrganizationFn;
	getLinearTeamsForCurrentUserFn?: GetLinearTeamsForCurrentUserFn;
	getLinearIssuesFn?: GetLinearIssuesFn;
	getLinearCurrentUserFn?: GetLinearCurrentUserFn;
	getAzureResourcesForUserFn?: GetAzureResourcesForUserFn;
	getBitbucketResourcesForCurrentUserFn?: GetBitbucketResourcesForCurrentUserFn;
	getBitbucketPullRequestsAuthoredByUserForWorkspaceFn?: GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn;
	getBitbucketServerPullRequestsForCurrentUserFn?: GetBitbucketServerPullRequestsForCurrentUserFn;
	getJiraProjectsForResourcesFn?: GetJiraProjectsForResourcesFn;
	getAzureProjectsForResourceFn?: GetAzureProjectsForResourceFn;
	getIssuesForProjectFn?: GetIssuesForProjectFn;
	getReposForAzureProjectFn?: GetReposForAzureProjectFn;
	getIssuesForResourceForCurrentUserFn?: GetIssuesForResourceForCurrentUserFn;
	mergePullRequestFn?: MergePullRequestFn;
	getOrgsForCurrentUserFn?: GetOrgsForCurrentUserFn;
	getReposForOrgFn?: GetReposForOrgFn;
	getReposForWorkspaceFn?: GetReposForWorkspaceFn;
	getReposForCurrentUserFn?: GetReposForCurrentUserFn;
	getGroupsForCurrentUserFn?: GetGroupsForCurrentUserFn;
	getTrelloCurrentUserFn?: GetTrelloCurrentUserFn;
	getTrelloBoardsForCurrentUserFn?: GetTrelloBoardsForCurrentUserFn;
	getTrelloListsForBoardFn?: GetTrelloListsForBoardFn;
	getTrelloAccountForIdFn?: GetTrelloAccountForIdFn;
	getTrelloIssuesForBoardFn?: GetTrelloIssuesForBoardFn;
	getTrelloLabelsForBoardFn?: GetTrelloLabelsForBoardFn;
}

export interface ProviderMetadata {
	domain: string;
	id: IntegrationIds;
	name: string;
	type: IntegrationType;
	/** Key for the `gl-provider-<iconKey>` glicon. Cloud self-managed variants reuse the base
	 * `'github-enterprise'`/`'gitlab-self-hosted'` icon (no enum member exists for those anymore). */
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
		iconKey: 'github-enterprise',
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
		iconKey: 'gitlab-self-hosted',
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
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
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
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
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
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
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
	[IssuesCloudHostIntegrationId.Linear]: {
		domain: 'linear.app',
		id: IssuesCloudHostIntegrationId.Linear,
		name: 'Linear',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Linear,
		scopes: [],
		// Linear scopes "my issues" client-side by the viewer's assignee id; author/mention aren't supported.
		supportedIssueFilters: [IssueFilter.Assignee],
	},
	[IssuesCloudHostIntegrationId.Trello]: {
		domain: 'trello.com',
		id: IssuesCloudHostIntegrationId.Trello,
		name: 'Trello',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Trello,
		scopes: [],
		// Trello cards are filtered by the assignee (member) only; author/mention have no Trello equivalent.
		supportedIssueFilters: [IssueFilter.Assignee],
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
	// `author` is intentionally not required: some providers have no per-item creator (e.g. Trello cards,
	// which the SDK maps with `author: null`), and dropping every such item would discard the whole board.
	// Fall back to an empty author instead so these issues still surface.
	if (issue.updatedDate == null || issue.url == null) return undefined;

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
			id: issue.author?.id ?? '',
			name: issue.author?.name ?? '',
			avatarUrl: issue.author?.avatarUrl ?? undefined,
			url: issue.author?.url ?? undefined,
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

export function providerPullRequestMatchesSearch(pr: ProviderPullRequest, search: string): boolean {
	const term = search.trim().toLowerCase();
	if (term.length === 0) return true;

	return pr.title.toLowerCase().includes(term) || (pr.description?.toLowerCase().includes(term) ?? false);
}

/** Maps a PR state filter to the SDK's `states` input. `undefined`/omitted preserves the open-only default. */
export function toProviderPullRequestStates(
	state: PullRequestStateFilter | PullRequestStateFilter[] | undefined,
): GitPullRequestState[] | undefined {
	// Accept an array so callers can request a union the single-value filter can't express (e.g. the
	// closed + merged "done" sweep); each element maps through the single-value logic and the result is deduped.
	if (Array.isArray(state)) {
		const states = state.flatMap(s => toProviderPullRequestStates(s) ?? []);
		return states.length > 0 ? [...new Set(states)] : undefined;
	}

	switch (state) {
		case 'open':
			return [GitPullRequestState.Open];
		case 'closed':
			return [GitPullRequestState.Closed];
		case 'merged':
			return [GitPullRequestState.Merged];
		case 'all':
			return [GitPullRequestState.Open, GitPullRequestState.Closed, GitPullRequestState.Merged];
		default:
			return undefined;
	}
}

/** Maps an issue state filter to the SDK's `states` input. `undefined`/omitted preserves the open-only default. */
export function toProviderIssueStates(state: IssueStateFilter | undefined): GitIssueState[] | undefined {
	switch (state) {
		case 'open':
			return [GitIssueState.Open];
		case 'closed':
			return [GitIssueState.Closed];
		case 'all':
			return [GitIssueState.Open, GitIssueState.Closed];
		default:
			return undefined;
	}
}

/**
 * Resolves a normalized {@link ProviderScope} to the provider-appropriate read inputs, dispatching on the
 * provider's {@link PagingMode} (the authoritative per-provider scoping selector). Project-mode providers
 * (Azure issues, Jira) produce `projectInputs` from `org` + `project`; repo/repos-mode providers produce a
 * repo `GetRepoInput[]` from `scope.repos` (carrying `project` where relevant, e.g. Azure). This is the
 * single public entry point consumers can use instead of hand-building the three underlying representations.
 */
export function resolveProviderScope(
	scope: ProviderScope,
	pagingMode: PagingMode | undefined,
): { reposInput?: GetRepoInput[]; projectInputs?: { namespace: string; project: string }[] } {
	if (pagingMode === PagingMode.Project) {
		if (scope.org != null && scope.project != null) {
			return { projectInputs: [{ namespace: scope.org, project: scope.project }] };
		}
		return {};
	}

	const reposInput = scope.repos?.map(r => ({ namespace: r.owner, name: r.name, project: scope.project }));
	return { reposInput: reposInput };
}

function toProviderRemoteInfo(ref: PullRequestRef | undefined): GitRepositoryRemoteInfo | null {
	// Match the SDK convention: only populate remoteInfo when both clone URLs are known.
	return ref?.cloneHttps && ref?.cloneSsh ? { cloneUrlHTTPS: ref.cloneHttps, cloneUrlSSH: ref.cloneSsh } : null;
}

export function toProviderPullRequest(pr: PullRequest): ProviderPullRequest {
	const prReviews = [...(pr.reviewRequests ?? []), ...(pr.latestReviews ?? [])];
	return {
		id: pr.id,
		graphQLId: pr.nodeId,
		number: Number.parseInt(pr.id, 10),
		title: pr.title,
		description: null,
		url: pr.url,
		state: toProviderPullRequestState(pr.state),
		isCrossRepository: pr.refs?.isCrossRepository ?? false,
		isDraft: pr.isDraft ?? false,
		isCrossRepository: pr.refs?.isCrossRepository ?? false,
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
						remoteInfo: toProviderRemoteInfo(pr.refs?.base),
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
						remoteInfo: toProviderRemoteInfo(pr.refs.head),
						isFork: pr.refs.head.isFork,
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
					? pr.repository.remoteInfo.cloneUrlHTTPS.replace(gitSuffixRegex, '')
					: '',
				cloneHttps: pr.repository.remoteInfo?.cloneUrlHTTPS || undefined,
				cloneSsh: pr.repository.remoteInfo?.cloneUrlSSH || undefined,
			},
			head: {
				branch: pr.headRef?.name ?? '',
				sha: pr.headRef?.oid ?? '',
				repo: pr.headRepository?.name ?? '',
				owner: pr.headRepository?.owner.login ?? '',
				exists: pr.headRef != null,
				url: pr.headRepository?.remoteInfo?.cloneUrlHTTPS
					? pr.headRepository.remoteInfo.cloneUrlHTTPS.replace(gitSuffixRegex, '')
					: '',
				cloneHttps: pr.headRepository?.remoteInfo?.cloneUrlHTTPS || undefined,
				cloneSsh: pr.headRepository?.remoteInfo?.cloneUrlSSH || undefined,
				isFork: pr.headRepository?.isFork,
			},
			isCrossRepository: pr.isCrossRepository,
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
		issue.number,
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

export function isGitHubDotCom(domain: string | null | undefined): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export function isGitLabDotCom(domain: string | null | undefined): boolean {
	return equalsIgnoreCase(domain, 'gitlab.com');
}

const azureCloudDomainRegex = /^dev\.azure\.com$|\bvisualstudio\.com$/i;
export function isAzureCloudDomain(domain: string | undefined): boolean {
	return domain != null && azureCloudDomainRegex.test(domain);
}

const bitbucketCloudDomainRegex = /^bitbucket\.org$/i;
export function isBitbucketCloudDomain(domain: string | undefined): boolean {
	return domain != null && bitbucketCloudDomainRegex.test(domain);
}

export function supportsCodeSuggest(provider: ProviderReference): boolean {
	return isGitHubDotCom(provider.domain);
}
