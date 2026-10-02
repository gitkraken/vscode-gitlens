import ProviderApis from '@gitkraken/provider-apis';
import type {
	CollectionMetadata,
	GitIssueState,
	GitPullRequestState,
	GraphQLError,
	GraphQLErrors,
	TrelloBoard,
	TrelloList,
} from '@gitkraken/provider-apis';
import type { PullRequest, PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import { base64 } from '@gitlens/utils/base64.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { TokenOptInfo, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { isIncompleteCollection } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { RequestNotFoundError, toError } from '../errors.js';
import type { ProviderPullRequestCount, ProviderPullRequestSearchPage } from '../models/pullRequestReads.js';
import type { AzurePullRequest, AzureWorkItemResponse } from './azure/models.js';
import {
	azureWorkItemEtagFieldNames,
	encodeAzurePathSegment,
	fromAzureWorkItemToProviderIssue,
} from './azure/models.js';
import { requestBitbucketServerProjects, requestBitbucketServerRepositories } from './bitbucket-server/discovery.js';
import {
	countBitbucketServerPullRequests,
	searchBitbucketServerPullRequestsPage,
} from './bitbucket-server/pullRequestSearch.js';
import type { JiraIssueEtagResponse } from './jiraIssueByKey.js';
import { requestJiraIssueByKey, requestJiraIssuesEtagFields } from './jiraIssueByKey.js';
import type { LinearIssueEtagNode } from './linearIssuesEtag.js';
import { requestLinearIssuesEtagFields } from './linearIssuesEtag.js';
import type {
	GetIssueFn,
	GetIssuesForReposFn,
	GetIssuesOptions,
	GetPullRequestsForReposFn,
	GetPullRequestsForUserFn,
	GetPullRequestsForUserOptions,
	GetPullRequestsOptions,
	GetReposOptions,
	IssueFilter,
	IssueSorting,
	PageInfo,
	PagingInput,
	PagingMode,
	ProviderAccount,
	ProviderApiCollectionResult,
	ProviderApiPagedResult,
	ProviderAzureProject,
	ProviderAzureResource,
	ProviderBitbucketResource,
	ProviderGitHubOrganization,
	ProviderGitLabGroup,
	ProviderHierarchyResult,
	ProviderInfo,
	ProviderIssue,
	ProviderJiraProject,
	ProviderJiraResource,
	ProviderJiraServerProject,
	ProviderLinearOrganization,
	ProviderLinearTeam,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
	ProviderRequestFunction,
	ProviderRequestOptions,
	ProviderRequestResponse,
	Providers,
	PullRequestFilter,
} from './models.js';
import { isRepoIdsInput, providersMetadata } from './models.js';
import {
	getProviderResponseBodyMessage,
	isAzureProviderId,
	isProviderIssueNotFoundError,
	throwProviderError,
	UnexpectedHtmlResponseError,
} from './providerErrors.js';
import {
	collectProviderPagedResult,
	mergeCollectionMetadata,
	parsePageCursor,
	toPageCursor,
} from './utils/providerPaging.js';

// `@gitkraken/provider-apis` is published as CommonJS with its factory on the `default` export.
// How that surfaces depends on the consuming bundler's CJS->ESM interop: esbuild yields the
// callable factory directly, while webpack and Node surface the module namespace (with the
// factory under `.default`). Normalize to the callable factory so every consumer resolves it.
type ProviderApisFactory = typeof ProviderApis;
const createProviderApis: ProviderApisFactory =
	(ProviderApis as ProviderApisFactory & { default?: ProviderApisFactory }).default ?? ProviderApis;

// Both GitHub and GitLab `getRepo` throw a missing-repo error whose message is exactly
// `Repository <x> not found`. Anchoring to that shape (rather than a loose `not found` substring) keeps
// the message fallbacks from misclassifying unrelated GraphQL/transport failures as a confident negative.
const repoNotFoundMessage = /^Repository .+ not found$/i;
// Duck-typed rather than `ex instanceof GraphQLErrors`, because importing the class as a value makes this
// module unloadable from plain Node ESM consumers: `@gitkraken/provider-apis` is CommonJS and declares its
// exports through getters, which Node's `cjs-module-lexer` cannot see, so the only named exports it can
// synthesize are `default` and `module.exports`. Bundled hosts (webpack/esbuild) bind the named export
// fine, but the published package keeps third-party deps external, so the named import survives into
// consumers and breaks linking there. The SDK's constructor always assigns `graphQLErrors` (defaulting to
// `[]`) and it is the only SDK error carrying that field, so the shape check is unambiguous.
function isGraphQLErrors(ex: unknown): ex is GraphQLErrors {
	return ex instanceof Error && Array.isArray((ex as Partial<GraphQLErrors>).graphQLErrors);
}

// `handleProviderError` classifies not-found by HTTP status (404/410/422), which only works for the
// REST `getRepo` clients (Bitbucket, Bitbucket Server, Azure DevOps). GitHub and GitLab `getRepo` are
// GraphQL: a missing repo comes back as HTTP 200 with a null node, and the SDK throws an unclassified
// error with no `response.status`, so it would otherwise fall through to the generic error bucket. This
// detects the SDK's not-found shapes so `getRepo` can rethrow them as `RequestNotFoundError`, keeping the
// facade's by-type mapping intact.
function isGraphQLRepoNotFoundError(ex: unknown): boolean {
	// GitHub throws `GraphQLErrors`. The SDK reports the null repository node with the same
	// `Repository <x> not found` message regardless of the underlying cause, so a `FORBIDDEN` or
	// `RATE_LIMITED` GraphQL error would also surface with that message. Trust the structured error type
	// when entries are present (only `NOT_FOUND` is a real not-found), and fall back to the repo-specific
	// message only when there are no entries to disambiguate (a bare null node).
	if (isGraphQLErrors(ex)) {
		const errors = ex.graphQLErrors;
		// Scope NOT_FOUND to the `repository` field: `getRepo`'s query only selects that node today, but
		// were it to grow other selections that can emit NOT_FOUND, an unscoped check would misclassify
		// them. Tolerate a missing `path` so we degrade to the current behavior if the SDK stops populating
		// it, rather than silently regressing to `error`.
		if (errors?.length) {
			return errors.some(
				(e: GraphQLError) => e.type === 'NOT_FOUND' && (e.path == null || e.path.includes('repository')),
			);
		}
		return repoNotFoundMessage.test(ex.message);
	}

	// GitLab's `getRepo` throws a plain Error; match its not-found message specifically so unrelated
	// bare Errors (network/parse failures) still reach the generic error bucket.
	return ex instanceof Error && repoNotFoundMessage.test(ex.message);
}

// provider-apis' GitLab `getIssue` throws a plain Error with exactly this message for a null issue (and
// `repoNotFoundMessage`'s for a null project). Its GraphQL helper ignores `errors`, so a reply carrying only errors
// throws the same messages; neither proves a miss on its own.
const gitLabIssueNotFoundMessage = /^Issue .+ not found$/i;

// The `typeKey`s Azure DevOps itself uses for "this pull request/repository/project does not exist". A 404 can
// also come from a wrong path (e.g. an Azure DevOps Server virtual directory or collection misconfigured), which
// answers with an HTML error page instead of this shape, so the body must be checked, not just the status.
const azurePullRequestNotFoundTypeKeys = new Set([
	'GitPullRequestNotFoundException',
	'GitRepositoryNotFoundException',
	'ProjectDoesNotExistWithNameException',
]);

// The same for a work item. Azure answers a missing work item with TF401232, "Work item N does not exist, or you
// do not have permissions to read it" — one type for both, so absent here means "not visible to this connection",
// as it does for every other batch read.
const azureWorkItemNotFoundTypeKeys = new Set([
	'WorkItemUnauthorizedAccessException',
	'ProjectDoesNotExistWithNameException',
]);

function isAzureNotFoundResponse(ex: unknown, typeKeys: ReadonlySet<string>): boolean {
	const response = (ex as { response?: { status?: unknown; body?: unknown } } | undefined)?.response;
	if (response?.status !== 404 || response.body == null || typeof response.body !== 'object') return false;

	const typeKey = (response.body as { typeKey?: unknown }).typeKey;
	return typeof typeKey === 'string' && typeKeys.has(typeKey);
}

/** The credential provider-apis sends Azure DevOps: a PAT as Basic (encoded here, as it does), anything else as a bearer. */
function azureAuthorization(token: string, isPAT: boolean | undefined): string {
	return isPAT ? `Basic ${base64(`:${token}`)}` : `Bearer ${token}`;
}

const azureDevOpsBaseUrl = 'https://dev.azure.com';
/** The most group descriptors one identity batch read resolves. */
const azureIdentityBatchSize = 100;
/** Azure DevOps Services serves the identity APIs from its own host, below the organization like the main one. */
const azureDevOpsIdentityBaseUrl = 'https://vssps.dev.azure.com';
const trelloBaseUrl = 'https://api.trello.com';

/**
 * Jira computes an issue's available transitions per issue, from the workflow and the reader's permissions, so a
 * list read at a page size of 100 pays for 100 of those in both server work and response payload. Nothing in this
 * package reads `statusTransitions` off a list — only the singular `getIssue` path exposes them, and it always
 * expands them — so every list read opts out. Revisit the day a list row offers a status change straight off it.
 */
const jiraListIncludeTransitions = false;

type TrelloMemberResponse = {
	id: string;
	username?: string | null;
	fullName?: string | null;
	avatarHash?: string | null;
	avatarUrl?: string | null;
};

type TrelloCardResponse = {
	id: string;
	idShort: number;
	name: string;
	url: string;
	dateLastActivity: string;
	idList?: string | null;
	badges?: {
		comments?: number | null;
		votes?: number | null;
	};
	members?: TrelloMemberResponse[];
	labels?: Array<{ color: string | null; id: string; name: string }>;
};

function getTrelloAuthHeaders(appKey: string, token: string): Record<string, string> {
	return {
		Authorization: `OAuth oauth_consumer_key="${appKey}", oauth_token="${token}"`,
	};
}

function getTrelloMemberAvatarUrl(member: TrelloMemberResponse): string | null {
	if (member.avatarUrl != null) return member.avatarUrl;
	if (member.avatarHash == null) return null;

	return `https://trello-members.s3.amazonaws.com/${member.id}/${member.avatarHash}/50.png`;
}

function fromTrelloCard(
	card: TrelloCardResponse,
	trelloBoardListsById: Record<string, { name: string }>,
): ProviderIssue {
	const createdDate = new Date(1000 * parseInt(card.id.substring(0, 8), 16));
	const list = card.idList != null ? trelloBoardListsById[card.idList] : undefined;

	return {
		id: card.id,
		commentCount: card.badges?.comments ?? null,
		number: String(card.idShort),
		title: card.name,
		url: card.url,
		closedDate: null,
		createdDate: new Date(createdDate.toISOString()),
		author: null,
		updatedDate: new Date(card.dateLastActivity),
		assignees: (card.members ?? []).map(member => ({
			id: member.id,
			username: member.username ?? null,
			name: member.fullName ?? null,
			email: null,
			avatarUrl: getTrelloMemberAvatarUrl(member),
			url: null,
		})),
		description: null,
		state: list != null ? { id: card.idList!, name: list.name, color: null } : null,
		type: null,
		repository: null,
		upvoteCount: card.badges?.votes ?? null,
		labels: (card.labels ?? []).map(label => ({
			color: label.color,
			description: null,
			id: label.id,
			name: label.name,
		})),
	};
}

export class ProvidersApi {
	private readonly providers: Providers;
	private readonly request: ProviderRequestFunction;

	constructor(private readonly authenticationService: IntegrationAuthenticationService) {
		const http = authenticationService.ctx.http;
		const userAgent = http.userAgent;
		const customFetch: ProviderRequestFunction = async <T>({
			url,
			...options
		}: ProviderRequestOptions): Promise<ProviderRequestResponse<T>> => {
			const response = await http.fetch(url, {
				...options,
				headers: {
					'User-Agent': userAgent,
					...options.headers,
				},
			});

			return parseFetchResponseForApi<T>(response);
		};
		this.request = customFetch;
		const providerApis = createProviderApis({ request: customFetch });
		this.providers = {
			[GitCloudHostIntegrationId.GitHub]: {
				...providersMetadata[GitCloudHostIntegrationId.GitHub],
				provider: providerApis.github,
				getRepoFn: providerApis.github.getRepo.bind(providerApis.github),
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github),
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.github.getPullRequestsAssociatedWithUser.bind(
					providerApis.github,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
				getOrgsForCurrentUserFn: providerApis.github.getOrgsForCurrentUser.bind(providerApis.github),
				getReposForOrgFn: providerApis.github.getReposForOrg.bind(providerApis.github),
				getReposForCurrentUserFn: providerApis.github.getReposForCurrentUser.bind(providerApis.github),
			},
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise],
				provider: providerApis.github,
				getRepoFn: providerApis.github.getRepo.bind(providerApis.github),
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github),
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.github.getPullRequestsAssociatedWithUser.bind(
					providerApis.github,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
				getOrgsForCurrentUserFn: providerApis.github.getOrgsForCurrentUser.bind(providerApis.github),
				getReposForOrgFn: providerApis.github.getReposForOrg.bind(providerApis.github),
				getReposForCurrentUserFn: providerApis.github.getReposForCurrentUser.bind(providerApis.github),
			},
			[GitCloudHostIntegrationId.GitLab]: {
				...providersMetadata[GitCloudHostIntegrationId.GitLab],
				provider: providerApis.gitlab,
				getRepoFn: providerApis.gitlab.getRepo.bind(providerApis.gitlab),
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab),
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(providerApis.gitlab),
				getPullRequestForRepoFn: providerApis.gitlab.getPullRequestForRepo.bind(providerApis.gitlab),
				getPullRequestsForUserFn: providerApis.gitlab.getPullRequestsAssociatedWithUser.bind(
					providerApis.gitlab,
				) as GetPullRequestsForUserFn,
				getGitLabPullRequestsForUserAssociationFn: providerApis.gitlab.getPullRequestsForUser.bind(
					providerApis.gitlab,
				),
				getIssueFn: providerApis.gitlab.getIssue.bind(providerApis.gitlab) as GetIssueFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(providerApis.gitlab),
				getIssuesForCurrentUserFn: providerApis.gitlab.getIssuesForCurrentUser.bind(providerApis.gitlab),
				mergePullRequestFn: providerApis.gitlab.mergePullRequest.bind(providerApis.gitlab),
				getGroupsForCurrentUserFn: providerApis.gitlab.getGroupsForCurrentUser.bind(providerApis.gitlab),
				getReposForCurrentUserFn: providerApis.gitlab.getReposForCurrentUser.bind(providerApis.gitlab),
			},
			[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted],
				provider: providerApis.gitlab,
				getRepoFn: providerApis.gitlab.getRepo.bind(providerApis.gitlab),
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab),
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(providerApis.gitlab),
				getPullRequestForRepoFn: providerApis.gitlab.getPullRequestForRepo.bind(providerApis.gitlab),
				getPullRequestsForUserFn: providerApis.gitlab.getPullRequestsAssociatedWithUser.bind(
					providerApis.gitlab,
				) as GetPullRequestsForUserFn,
				getGitLabPullRequestsForUserAssociationFn: providerApis.gitlab.getPullRequestsForUser.bind(
					providerApis.gitlab,
				),
				getIssueFn: providerApis.gitlab.getIssue.bind(providerApis.gitlab) as GetIssueFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(providerApis.gitlab),
				getIssuesForCurrentUserFn: providerApis.gitlab.getIssuesForCurrentUser.bind(providerApis.gitlab),
				mergePullRequestFn: providerApis.gitlab.mergePullRequest.bind(providerApis.gitlab),
				getGroupsForCurrentUserFn: providerApis.gitlab.getGroupsForCurrentUser.bind(providerApis.gitlab),
				getReposForCurrentUserFn: providerApis.gitlab.getReposForCurrentUser.bind(providerApis.gitlab),
			},
			[GitCloudHostIntegrationId.Bitbucket]: {
				...providersMetadata[GitCloudHostIntegrationId.Bitbucket],
				provider: providerApis.bitbucket,
				getRepoFn: providerApis.bitbucket.getRepo.bind(providerApis.bitbucket),
				getCurrentUserFn: providerApis.bitbucket.getCurrentUser.bind(providerApis.bitbucket),
				getBitbucketResourcesForCurrentUserFn: providerApis.bitbucket.getWorkspacesForCurrentUser.bind(
					providerApis.bitbucket,
				),
				getBitbucketPullRequestsAuthoredByUserForWorkspaceFn:
					providerApis.bitbucket.getPullRequestsForUserAndWorkspace.bind(providerApis.bitbucket),
				getPullRequestsForReposFn: providerApis.bitbucket.getPullRequestsForRepos.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.bitbucket.getPullRequestsForRepo.bind(providerApis.bitbucket),
				mergePullRequestFn: providerApis.bitbucket.mergePullRequest.bind(providerApis.bitbucket),
				getReposForWorkspaceFn: providerApis.bitbucket.getReposForWorkspace.bind(providerApis.bitbucket),
			},
			[GitSelfManagedHostIntegrationId.BitbucketServer]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.BitbucketServer],
				provider: providerApis.bitbucketServer,
				getRepoFn: providerApis.bitbucketServer.getRepo.bind(providerApis.bitbucketServer),
				getCurrentUserFn: providerApis.bitbucketServer.getCurrentUser.bind(providerApis.bitbucketServer),
				getBitbucketServerPullRequestsForCurrentUserFn:
					providerApis.bitbucketServer.getPullRequestsForCurrentUser.bind(providerApis.bitbucketServer),
				getPullRequestsForReposFn: providerApis.bitbucketServer.getPullRequestsForRepos.bind(
					providerApis.bitbucketServer,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.bitbucketServer.getPullRequestsForRepo.bind(
					providerApis.bitbucketServer,
				),
				mergePullRequestFn: providerApis.bitbucketServer.mergePullRequest.bind(providerApis.bitbucketServer),
			},
			[GitCloudHostIntegrationId.AzureDevOps]: {
				...providersMetadata[GitCloudHostIntegrationId.AzureDevOps],
				provider: providerApis.azureDevOps,
				getRepoOfProjectFn: providerApis.azureDevOps.getRepo.bind(providerApis.azureDevOps),
				getCurrentUserFn: providerApis.azureDevOps.getCurrentUser.bind(providerApis.azureDevOps),
				getCurrentUserForInstanceFn: providerApis.azureDevOps.getCurrentUserForInstance.bind(
					providerApis.azureDevOps,
				),
				getAzureResourcesForUserFn: providerApis.azureDevOps.getOrgsForUser.bind(providerApis.azureDevOps),
				getAzureProjectsForResourceFn: providerApis.azureDevOps.getAzureProjects.bind(providerApis.azureDevOps),
				getPullRequestsForReposFn: providerApis.azureDevOps.getPullRequestsForRepos.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.azureDevOps.getPullRequestsForRepo.bind(
					providerApis.azureDevOps,
				),
				getPullRequestForRepoFn: providerApis.azureDevOps.getPullRequestForRepo.bind(providerApis.azureDevOps),
				getPullRequestsForAzureProjectsFn: providerApis.azureDevOps.getPullRequestsForProjects.bind(
					providerApis.azureDevOps,
				),
				getPullRequestsForAzureProjectFn: providerApis.azureDevOps.getPullRequestsForProject.bind(
					providerApis.azureDevOps,
				),
				getIssuesForAzureProjectFn: providerApis.azureDevOps.getIssuesForAzureProject.bind(
					providerApis.azureDevOps,
				),
				getReposForAzureProjectFn: providerApis.azureDevOps.getReposForAzureProject.bind(
					providerApis.azureDevOps,
				),
				mergePullRequestFn: providerApis.azureDevOps.mergePullRequest.bind(providerApis.azureDevOps),
			},
			[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer],
				provider: providerApis.azureDevOps,
				getRepoOfProjectFn: providerApis.azureDevOps.getRepo.bind(providerApis.azureDevOps),
				getCurrentUserFn: providerApis.azureDevOps.getCurrentUser.bind(providerApis.azureDevOps),
				getCurrentUserForInstanceFn: providerApis.azureDevOps.getCurrentUserForInstance.bind(
					providerApis.azureDevOps,
				),
				getAzureResourcesForUserFn: providerApis.azureDevOps.getCollectionsForUser.bind(
					providerApis.azureDevOps,
				),
				getAzureProjectsForResourceFn: providerApis.azureDevOps.getAzureProjects.bind(providerApis.azureDevOps),
				getPullRequestsForReposFn: providerApis.azureDevOps.getPullRequestsForRepos.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.azureDevOps.getPullRequestsForRepo.bind(
					providerApis.azureDevOps,
				),
				getPullRequestForRepoFn: providerApis.azureDevOps.getPullRequestForRepo.bind(providerApis.azureDevOps),
				getPullRequestsForAzureProjectsFn: providerApis.azureDevOps.getPullRequestsForProjects.bind(
					providerApis.azureDevOps,
				),
				getPullRequestsForAzureProjectFn: providerApis.azureDevOps.getPullRequestsForProject.bind(
					providerApis.azureDevOps,
				),
				getIssuesForAzureProjectFn: providerApis.azureDevOps.getIssuesForAzureProject.bind(
					providerApis.azureDevOps,
				),
				getReposForAzureProjectFn: providerApis.azureDevOps.getReposForAzureProject.bind(
					providerApis.azureDevOps,
				),
				mergePullRequestFn: providerApis.azureDevOps.mergePullRequest.bind(providerApis.azureDevOps),
			},
			[IssuesCloudHostIntegrationId.Jira]: {
				...providersMetadata[IssuesCloudHostIntegrationId.Jira],
				provider: providerApis.jira,
				getCurrentUserForResourceFn: providerApis.jira.getCurrentUserForResource.bind(providerApis.jira),
				getJiraResourcesForCurrentUserFn: providerApis.jira.getJiraResourcesForCurrentUser.bind(
					providerApis.jira,
				),
				getJiraProjectsForResourcesFn: providerApis.jira.getJiraProjectsForResources.bind(providerApis.jira),
				getJiraProjectsForResourceFn: providerApis.jira.getJiraProjectsForResource.bind(providerApis.jira),
				getIssueFn: providerApis.jira.getIssue.bind(providerApis.jira) as GetIssueFn,
				getIssuesForProjectFn: providerApis.jira.getIssuesForProject.bind(providerApis.jira),
				getIssuesForProjectsFn: providerApis.jira.getIssuesForProjects.bind(providerApis.jira),
				getIssuesForResourceForCurrentUserFn: providerApis.jira.getIssuesForResourceForCurrentUser.bind(
					providerApis.jira,
				),
			},
			[IssuesSelfManagedHostIntegrationId.JiraServer]: {
				...providersMetadata[IssuesSelfManagedHostIntegrationId.JiraServer],
				provider: providerApis.jiraServer,
				getJiraServerCurrentUserFn: providerApis.jiraServer.getCurrentUser.bind(providerApis.jiraServer),
				getJiraServerProjectsFn: providerApis.jiraServer.getJiraProjects.bind(providerApis.jiraServer),
				getJiraServerIssuesForProjectFn: providerApis.jiraServer.getIssuesForProject.bind(
					providerApis.jiraServer,
				),
				getJiraServerIssuesForProjectsFn: providerApis.jiraServer.getIssuesForProjects.bind(
					providerApis.jiraServer,
				),
				getJiraServerIssueFn: providerApis.jiraServer.getIssue.bind(providerApis.jiraServer),
				getJiraServerIssuesForCurrentUserFn: providerApis.jiraServer.getIssuesForResourceForCurrentUser.bind(
					providerApis.jiraServer,
				),
			},
			[IssuesCloudHostIntegrationId.Linear]: {
				...providersMetadata[IssuesCloudHostIntegrationId.Linear],
				provider: providerApis.linear,
				getIssueFn: providerApis.linear.getIssue.bind(providerApis.linear),
				getIssuesForCurrentUserFn: providerApis.linear.getIssuesForCurrentUser.bind(providerApis.linear),
				getLinearOrganizationFn: providerApis.linear.getLinearOrganization.bind(providerApis.linear),
				getLinearTeamsForCurrentUserFn: providerApis.linear.getTeamsForCurrentUser.bind(providerApis.linear),
				getLinearIssuesFn: providerApis.linear.getIssues.bind(providerApis.linear),
				getLinearCurrentUserFn: providerApis.linear.getCurrentUser.bind(providerApis.linear),
			},
			[IssuesCloudHostIntegrationId.Trello]: {
				...providersMetadata[IssuesCloudHostIntegrationId.Trello],
				provider: providerApis.trello,
				getTrelloCurrentUserFn: providerApis.trello.getCurrentUser.bind(providerApis.trello),
				getTrelloBoardsForCurrentUserFn: providerApis.trello.getBoardsForCurrentUser.bind(providerApis.trello),
				getTrelloListsForBoardFn: providerApis.trello.getListsForTrelloBoard.bind(providerApis.trello),
				getTrelloAccountForIdFn: providerApis.trello.getAccountForId.bind(providerApis.trello),
				getTrelloIssuesForBoardFn: providerApis.trello.getIssuesForBoard.bind(providerApis.trello),
				getTrelloLabelsForBoardFn: providerApis.trello.getLabelsForBoard.bind(providerApis.trello),
			},
		};
	}

	getScopesForProvider(providerId: IntegrationIds): string[] | undefined {
		return this.providers[providerId]?.scopes;
	}

	getProviderDomain(providerId: IntegrationIds): string | undefined {
		return this.providers[providerId]?.domain;
	}

	getProviderPullRequestsPagingMode(providerId: IntegrationIds): PagingMode | undefined {
		return this.providers[providerId]?.pullRequestsPagingMode;
	}

	getProviderIssuesPagingMode(providerId: IntegrationIds): PagingMode | undefined {
		return this.providers[providerId]?.issuesPagingMode;
	}

	providerSupportsPullRequestFilters(providerId: IntegrationIds, filters: PullRequestFilter[]): boolean {
		return (
			this.providers[providerId]?.supportedPullRequestFilters != null &&
			filters.every(filter => this.providers[providerId]?.supportedPullRequestFilters?.includes(filter))
		);
	}

	providerSupportsIssueFilters(providerId: IntegrationIds, filters: IssueFilter[]): boolean {
		return (
			this.providers[providerId]?.supportedIssueFilters != null &&
			filters.every(filter => this.providers[providerId]?.supportedIssueFilters?.includes(filter))
		);
	}

	/** See {@link isRepoIdsInput}, which owns the rule; kept as a method because callers reach it through the api. */
	isRepoIdsInput(input: unknown): input is (string | number)[] {
		return isRepoIdsInput(input);
	}

	private async getProviderToken<T extends IntegrationIds>(
		provider: ProviderInfo & { id: T },
		options?: { createSessionIfNeeded?: boolean; connectionId?: string },
	): Promise<TokenWithInfo<T> | undefined> {
		// When a specific connection is requested, resolve that connection's cloud session (mirroring
		// `Integration.resolveReadSession`); otherwise keep the plain descriptor so the primary is resolved.
		// An empty string is not a real target, so it must also fall through to the primary path.
		const providerDescriptor = options?.connectionId
			? { domain: provider.domain, scopes: provider.scopes, connectionId: options.connectionId, cloud: true }
			: { domain: provider.domain, scopes: provider.scopes };
		try {
			const authProvider = await this.authenticationService.get(provider.id);
			const session = await authProvider.getSession(providerDescriptor, {
				createIfNeeded: options?.createSessionIfNeeded,
			});
			if (session == null) {
				return undefined;
			}
			return toTokenWithInfo(provider.id, session);
		} catch {
			return undefined;
		}
	}

	private async ensureProviderToken<T extends IntegrationIds>(
		tokenOptInfo: TokenOptInfo<T>,
	): Promise<{ provider: ProviderInfo; tokenWithInfo: TokenWithInfo<T> }> {
		const providerId = tokenOptInfo.providerId;
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		if (providerId !== provider.id) {
			throw new Error(`Provider id mismatch: expected ${providerId} but got ${provider.id}`);
		}

		const connectionId = 'connectionId' in tokenOptInfo ? tokenOptInfo.connectionId : undefined;
		const tokenWithInfo = tokenOptInfo?.accessToken
			? tokenOptInfo
			: await this.getProviderToken<T>(provider as ProviderInfo & { id: T }, {
					connectionId: connectionId,
				});
		if (tokenWithInfo == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		return { provider: provider, tokenWithInfo: tokenWithInfo };
	}

	private async ensureProviderTokenAndFunction<T extends IntegrationIds>(
		tokenOptInfo: TokenOptInfo<T>,
		providerFn: keyof ProviderInfo,
	): Promise<{ provider: ProviderInfo; tokenWithInfo: TokenWithInfo<T> }> {
		const { provider, tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const providerId = tokenOptInfo.providerId;

		if (provider[providerFn] == null) {
			throw new Error(`Provider with id ${providerId} does not support function: ${providerFn}`);
		}

		return { provider: provider, tokenWithInfo: tokenWithInfo };
	}

	private handleProviderError<T>(tokenWithInfo: TokenWithInfo, error: any): T {
		const providerId = tokenWithInfo.providerId;
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		return throwProviderError(tokenWithInfo, error);
	}

	async getPagedResult<T>(
		args: any,
		providerFn:
			| ((
					input: any,
					options?: { token?: string; isPAT?: boolean; baseUrl?: string },
			  ) => Promise<{ data: NonNullable<T>[]; pageInfo?: PageInfo; metadata?: CollectionMetadata }>)
			| undefined,
		tokenWithInfo: TokenWithInfo,
		cursor: string = '{}',
		isPAT: boolean = false,
		baseUrl?: string,
	): Promise<ProviderApiPagedResult<T>> {
		let cursorInfo;
		try {
			cursorInfo = JSON.parse(cursor);
		} catch {
			cursorInfo = {};
		}
		const cursorValue = cursorInfo.value;
		const cursorType = cursorInfo.type;
		// An explicit numbered `page` request wins over a page-typed cursor; otherwise follow the cursor. A
		// live cursor-typed cursor still takes precedence so an in-flight continuation is never clobbered.
		const requestedPage: number | undefined = typeof args?.page === 'number' ? args.page : undefined;
		const requestedPageSize: number | undefined = typeof args?.pageSize === 'number' ? args.pageSize : undefined;
		let cursorOrPage = {};
		if (requestedPage != null && cursorType !== 'cursor') {
			cursorOrPage = { page: requestedPage };
		} else if (cursorType === 'page') {
			cursorOrPage = { page: cursorValue };
		} else if (cursorType === 'cursor') {
			cursorOrPage = { cursor: cursorValue };
		}

		// Strip the caller's paging keys so `getPagedResult` fully controls them; otherwise `args.page` could
		// survive alongside a resolved `cursor` (or the raw serialized wrapper `args.cursor` could leak in when
		// following a page), letting the provider clobber the continuation we intended.
		const { page: _page, pageSize: _pageSize, cursor: _cursor, ...restArgs } = args ?? {};
		const input = {
			...restArgs,
			...cursorOrPage,
			// `pageSize` is honored by numbered providers; GitHub reads `maxPageSize`. Set both so whichever
			// the resolved provider understands takes effect; the other is ignored.
			...(requestedPageSize != null ? { pageSize: requestedPageSize, maxPageSize: requestedPageSize } : {}),
		};

		try {
			const result = await providerFn?.(input, {
				token: tokenWithInfo.accessToken,
				isPAT: isPAT,
				baseUrl: baseUrl,
			});
			if (result == null) {
				const continuationWasRequested =
					(cursor != null && cursor !== '{}') || (requestedPage != null && requestedPage > 1);
				return continuationWasRequested
					? {
							values: [],
							paging: { cursor: '{}', more: false, truncated: true },
							metadata: { completeness: 'partial' },
						}
					: { values: [] };
			}

			const pageInfo = result.pageInfo;
			const hasMore = pageInfo?.hasNextPage ?? false;

			let nextCursor = '{}';
			if (pageInfo?.endCursor != null) {
				nextCursor = JSON.stringify({ value: pageInfo.endCursor, type: 'cursor' });
			} else if (pageInfo?.nextPage != null) {
				nextCursor = JSON.stringify({ value: pageInfo.nextPage, type: 'page' });
			}
			const continuationBroken = hasMore && (nextCursor === '{}' || nextCursor === cursor);
			const normalizedMetadata = mergeCollectionMetadata(
				result.metadata,
				continuationBroken ? { completeness: 'partial' } : undefined,
			);

			// SDK collection completeness is independent from provider-native pagination: a result can expose a
			// real next page (`more`) and still have a failed sibling scope (`partial`/`unknown`). Surface the
			// latter as `truncated` so consumers treat the page as incomplete. Absent metadata (old providers,
			// test doubles) leaves `truncated` unset for backward compatibility. Shares the incompleteness
			// predicate with the facade assessment so one metadata object can't be truncated there and whole here.
			const truncated = isIncompleteCollection(normalizedMetadata) ? true : undefined;

			return {
				values: result.data,
				paging: {
					cursor: nextCursor,
					more: hasMore && !continuationBroken,
					truncated: truncated,
					// Numbered-page metadata; left undefined by cursor-based providers (which don't report a
					// currentPage), so we never echo the requested page for a provider that ignored it.
					page: pageInfo?.currentPage ?? undefined,
					pageSize: requestedPageSize,
					nextPage: pageInfo?.nextPage ?? undefined,
					totalPages: pageInfo?.totalPages ?? undefined,
					totalCount: pageInfo?.totalCount ?? undefined,
				},
				metadata: normalizedMetadata,
			};
		} catch (e) {
			return this.handleProviderError<ProviderApiPagedResult<T>>(tokenWithInfo, e);
		}
	}

	async getRepo(
		tokenOptInfo: TokenOptInfo,
		owner: string,
		name: string,
		project?: string,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderRepository | undefined> {
		const providerId = tokenOptInfo.providerId;
		const isAzureDevOps =
			providerId === GitCloudHostIntegrationId.AzureDevOps ||
			providerId === GitSelfManagedHostIntegrationId.AzureDevOpsServer;
		if (isAzureDevOps) {
			if (project == null) return undefined;

			const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
				tokenOptInfo,
				'getRepoOfProjectFn',
			);
			const token = tokenWithInfo.accessToken;

			try {
				const result = await provider['getRepoOfProjectFn']?.(
					{ namespace: owner, name: name, project: project },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				);
				return result?.data;
			} catch (e) {
				if (isGraphQLRepoNotFoundError(e)) throw new RequestNotFoundError(toError(e));
				return this.handleProviderError<ProviderRepository>(tokenWithInfo, e);
			}
		} else {
			const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(tokenOptInfo, 'getRepoFn');
			const token = tokenWithInfo.accessToken;

			try {
				const result = await provider['getRepoFn']?.(
					{ namespace: owner, name: name, project: project },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				);
				return result?.data;
			} catch (e) {
				if (isGraphQLRepoNotFoundError(e)) throw new RequestNotFoundError(toError(e));
				return this.handleProviderError<ProviderRepository>(tokenWithInfo, e);
			}
		}
	}

	/**
	 * One pull request by repository and number, in any state. `undefined` when the provider reports it absent:
	 * a `null` from GitLab (which alone is NOT proof — see the GitLab batch hook), or, from Azure DevOps, a 404
	 * whose body names the pull request, repository or project as not found (see
	 * {@link azurePullRequestNotFoundTypeKeys}). Any other Azure error, including a 410 or a 404 that isn't that
	 * shape (e.g. a wrong path answering with an HTML page), goes through `handleProviderError` and fails instead.
	 */
	async getPullRequestForRepo(
		tokenOptInfo: TokenOptInfo,
		repo: ProviderRepoInput,
		number: number,
		options?: { isPAT?: boolean; baseUrl?: string; includeRemoteInfo?: boolean },
	): Promise<ProviderPullRequest | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestForRepoFn',
		);
		const providerId = tokenWithInfo.providerId;

		try {
			const result = await provider.getPullRequestForRepoFn?.(
				{ repo: repo, number: number, includeRemoteInfo: options?.includeRemoteInfo },
				{ token: tokenWithInfo.accessToken, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
			);
			return result?.data ?? undefined;
		} catch (e) {
			// Azure DevOps throws on a missing pull request instead of answering `{ data: null }`.
			if (isAzureProviderId(providerId) && isAzureNotFoundResponse(e, azurePullRequestNotFoundTypeKeys)) {
				return undefined;
			}

			return this.handleProviderError<ProviderPullRequest | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * Azure DevOps pull requests into a repository whose source is `refs/heads/{branch}`, in every status, as Azure
	 * returns them, at most `top`. provider-apis' pull request list has no source-branch filter, so this asks Azure
	 * directly, with the credential provider-apis would send.
	 *
	 * `undefined` only when Azure itself says the repository or project doesn't exist, by the same rule as
	 * {@link getPullRequestForRepo}; every other failure, including a 404 that isn't that shape, throws.
	 */
	async getAzurePullRequestsForBranch(
		tokenOptInfo: TokenOptInfo,
		repo: { namespace: string; project: string; name: string },
		branch: string,
		top: number,
		options: { isPAT?: boolean; baseUrl?: string },
	): Promise<AzurePullRequest[] | undefined> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const token = tokenWithInfo.accessToken;

		const baseUrl = (options.baseUrl ?? azureDevOpsBaseUrl).replace(/\/$/, '');
		const params = new URLSearchParams({
			'searchCriteria.sourceRefName': `refs/heads/${branch}`,
			'searchCriteria.status': 'all',
			$top: String(top),
		});
		const url = `${baseUrl}/${encodeAzurePathSegment(repo.namespace)}/${encodeAzurePathSegment(repo.project)}/_apis/git/repositories/${encodeAzurePathSegment(repo.name)}/pullrequests?${params.toString()}`;

		try {
			const result = await this.request<{ value?: AzurePullRequest[] }>({
				url: url,
				headers: { Authorization: azureAuthorization(token, options.isPAT) },
			});
			const pullRequests = result.body?.value;
			if (pullRequests == null) throw new Error('Azure DevOps returned no pull requests');

			return pullRequests;
		} catch (e) {
			if (isAzureNotFoundResponse(e, azurePullRequestNotFoundTypeKeys)) return undefined;

			return this.handleProviderError<AzurePullRequest[] | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * The ids of every group `userId` is a member of in one Azure DevOps organization (Azure DevOps Server: one
	 * collection), directly or through other groups: its teams and security groups, in every project and at the
	 * organization level. A group is an identity like a person, so these are the ids a pull request lists a group under
	 * as a reviewer. provider-apis has no identity read, so this asks Azure directly, with the credential provider-apis
	 * would send.
	 *
	 * Two requests, however many groups: the user's expanded membership, which names its groups only by descriptor,
	 * then one batch read resolving those descriptors to ids. Azure DevOps Services serves identities from its
	 * `vssps` host; Azure DevOps Server from the collection itself.
	 */
	async getAzureGroupIdsForUser(
		tokenOptInfo: TokenOptInfo,
		namespace: string,
		userId: string,
		options: { isPAT?: boolean; baseUrl?: string },
	): Promise<string[]> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const token = tokenWithInfo.accessToken;

		const base =
			options.baseUrl != null
				? `${options.baseUrl.replace(/\/$/, '')}/${encodeAzurePathSegment(namespace)}`
				: `${azureDevOpsIdentityBaseUrl}/${encodeAzurePathSegment(namespace)}`;
		const headers = {
			Authorization: azureAuthorization(token, options.isPAT),
			'Content-Type': 'application/json',
		};

		let memberOf: unknown;
		try {
			const params = new URLSearchParams({
				identityIds: userId,
				queryMembership: 'Expanded',
				'api-version': '5.0',
			});
			const user = await this.request<{ value?: { memberOf?: unknown }[] }>({
				url: `${base}/_apis/identities?${params.toString()}`,
				headers: headers,
			});
			memberOf = user.body?.value?.[0]?.memberOf;
		} catch (e) {
			return this.handleProviderError<string[]>(tokenWithInfo, e);
		}

		// Checked before the batch read, so a malformed answer fails instead of reading as no groups.
		if (!Array.isArray(memberOf) || memberOf.some(d => typeof d !== 'string')) {
			throw new Error('Azure DevOps returned no group membership for the current user');
		}
		if (memberOf.length === 0) return [];

		// Resolved one batch at a time, so a member of very many groups never sends Azure more than a batch at once.
		const chunks: string[][] = [];
		for (let i = 0; i < memberOf.length; i += azureIdentityBatchSize) {
			chunks.push(memberOf.slice(i, i + azureIdentityBatchSize));
		}
		const batches: unknown[] = [];
		try {
			for (const descriptors of chunks) {
				const batch = await this.request<{ value?: unknown }>({
					url: `${base}/_apis/identitybatch?api-version=5.0-preview.1`,
					method: 'POST',
					headers: headers,
					body: JSON.stringify({ descriptors: descriptors, queryMembership: 'None' }),
				});
				batches.push(batch.body?.value);
			}
		} catch (e) {
			return this.handleProviderError<string[]>(tokenWithInfo, e);
		}

		// A group left unresolved could never be matched to a reviewer, and dropping it would narrow the read silently.
		if (batches.some((batch, i) => !Array.isArray(batch) || batch.length !== chunks[i].length)) {
			throw new Error('Azure DevOps did not resolve every group of the current user');
		}

		const groups = (batches as ({ id?: unknown } | null)[][]).flat();
		// A descriptor Azure no longer resolves (a deleted group) answers `null`: it can't be anyone's reviewer.
		return groups.flatMap((g: { id?: unknown } | null) => {
			if (g == null) return [];
			if (typeof g.id !== 'string') throw new Error('Azure DevOps returned a group without its id');

			return [g.id];
		});
	}

	/**
	 * One issue by repository and number through provider-apis' GitLab `getIssue`, in the shape its list reads
	 * return. Strict, unlike {@link getIssue}: `undefined` only when provider-apis reports the project or issue
	 * missing, which alone is NOT proof (see the GitLab batch hook), and never for an HTTP status — a 404 there
	 * means a wrong endpoint, so it fails instead of reading as absent.
	 */
	async getIssueForRepo(
		tokenOptInfo: TokenOptInfo,
		repo: { namespace: string; name: string },
		number: number,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderIssue | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(tokenOptInfo, 'getIssueFn');

		try {
			const result = await provider.getIssueFn?.(
				{ namespace: repo.namespace, name: repo.name, number: String(number) },
				{ token: tokenWithInfo.accessToken, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
			);
			if (result?.data == null) throw new Error(`No data returned for issue ${number}`);

			return result.data;
		} catch (e) {
			if (
				e instanceof Error &&
				(repoNotFoundMessage.test(e.message) || gitLabIssueNotFoundMessage.test(e.message))
			) {
				return undefined;
			}

			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * One Azure DevOps work item by id, converted as provider-apis converts its list rows (see
	 * {@link fromAzureWorkItemToProviderIssue}). provider-apis has no single work item read, so this asks Azure
	 * directly, with the credential provider-apis would send, and expands links as its list read does: the HTML
	 * link is the issue's `url`.
	 *
	 * `undefined` only when Azure itself says the work item or the project doesn't exist (see
	 * {@link azureWorkItemNotFoundTypeKeys}). Every other failure throws, including a 410, a 404 that isn't that
	 * shape, an empty response, a work item the SDK's conversion would skip, and one in another project.
	 */
	async getAzureWorkItem(
		tokenOptInfo: TokenOptInfo,
		scope: { namespace: string; project: string },
		id: number,
		options: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderIssue | undefined> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const token = tokenWithInfo.accessToken;

		const baseUrl = (options.baseUrl ?? azureDevOpsBaseUrl).replace(/\/$/, '');
		const params = new URLSearchParams({ $expand: 'Links', 'api-version': '6.0' });
		const url = `${baseUrl}/${encodeAzurePathSegment(scope.namespace)}/${encodeAzurePathSegment(scope.project)}/_apis/wit/workitems/${id}?${params.toString()}`;

		let workItem: AzureWorkItemResponse | null | undefined;
		try {
			const result = await this.request<AzureWorkItemResponse | null>({
				url: url,
				headers: { Authorization: azureAuthorization(token, options.isPAT) },
			});
			workItem = result.body;
		} catch (e) {
			if (isAzureNotFoundResponse(e, azureWorkItemNotFoundTypeKeys)) return undefined;

			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}

		const issue =
			workItem != null ? fromAzureWorkItemToProviderIssue(workItem, scope.namespace, scope.project) : undefined;
		if (issue == null) throw new Error(`Azure DevOps returned no readable work item ${id}`);

		// The route's project is not trusted to scope the read: work item ids are unique across the organization, and
		// one from another project must not answer for this coordinate. Azure compares project names
		// case-insensitively.
		const project = workItem?.fields?.['System.TeamProject'];
		if (typeof project === 'string' && project.toLowerCase() !== scope.project.toLowerCase()) {
			throw new Error(`Azure DevOps work item ${id} is in project '${project}', not '${scope.project}'`);
		}

		return issue;
	}

	/**
	 * The cheap check behind the batch issue read's etags: `ids` (at most `azureWorkItemsEtagFieldsMaxIds`) in ONE
	 * request, where {@link getAzureWorkItem} reads one work item per request, selecting only
	 * `azureWorkItemEtagFieldNames`. Asked with `errorPolicy=omit`, without which one missing id fails the whole
	 * request; Azure then leaves out every id it can't return, for whatever reason, so a caller matches the work items
	 * to its ids by `id`, never by position, and reads an omission as unknown rather than absent. Every failure throws,
	 * classified as {@link getAzureWorkItem} classifies it.
	 */
	async getAzureWorkItemsEtagFields(
		tokenOptInfo: TokenOptInfo,
		scope: { namespace: string; project: string },
		ids: readonly number[],
		options: { isPAT?: boolean; baseUrl?: string },
	): Promise<AzureWorkItemResponse[]> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const token = tokenWithInfo.accessToken;

		const baseUrl = (options.baseUrl ?? azureDevOpsBaseUrl).replace(/\/$/, '');
		// Commas left unencoded, as Azure documents these lists. The same `api-version` as `getAzureWorkItem`, so a
		// server that serves the full read also serves this check.
		const query = `ids=${ids.join(',')}&fields=${azureWorkItemEtagFieldNames.join(',')}&errorPolicy=omit&api-version=6.0`;
		const url = `${baseUrl}/${encodeAzurePathSegment(scope.namespace)}/${encodeAzurePathSegment(scope.project)}/_apis/wit/workitems?${query}`;

		try {
			const result = await this.request<{ value?: (AzureWorkItemResponse | null)[] } | null>({
				url: url,
				headers: { Authorization: options.isPAT ? `Basic ${base64(`:${token}`)}` : `Bearer ${token}` },
			});
			const workItems = result.body?.value;
			if (!Array.isArray(workItems)) throw new Error('Azure DevOps returned no work items');

			// Documented to answer an omitted id with `null` in its place; it has been seen to drop it instead.
			return workItems.filter(w => w != null);
		} catch (e) {
			return this.handleProviderError<AzureWorkItemResponse[]>(tokenWithInfo, e);
		}
	}

	/**
	 * The cheap check behind the batch pull request read's etags: one pull request as Azure DevOps returns it, by the
	 * same request {@link getPullRequestForRepo} has provider-apis send, but without the repository read it adds for
	 * clone URLs. `undefined` only by the same not-found rule as {@link getPullRequestForRepo}; every other failure
	 * throws.
	 */
	async getAzurePullRequest(
		tokenOptInfo: TokenOptInfo,
		repo: { namespace: string; project: string; name: string },
		id: number,
		options: { isPAT?: boolean; baseUrl?: string },
	): Promise<AzurePullRequest | undefined> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);
		const token = tokenWithInfo.accessToken;

		const baseUrl = (options.baseUrl ?? azureDevOpsBaseUrl).replace(/\/$/, '');
		const url = `${baseUrl}/${encodeAzurePathSegment(repo.namespace)}/${encodeAzurePathSegment(repo.project)}/_apis/git/repositories/${encodeAzurePathSegment(repo.name)}/pullrequests/${id}?api-version=6.0`;

		try {
			const result = await this.request<AzurePullRequest | null>({
				url: url,
				headers: { Authorization: options.isPAT ? `Basic ${base64(`:${token}`)}` : `Bearer ${token}` },
			});
			if (result.body == null) throw new Error(`Azure DevOps returned no pull request ${id}`);

			return result.body;
		} catch (e) {
			if (isAzureNotFoundResponse(e, azurePullRequestNotFoundTypeKeys)) return undefined;

			return this.handleProviderError<AzurePullRequest | undefined>(tokenWithInfo, e);
		}
	}

	async getCurrentUser(
		tokenOptInfo: TokenOptInfo,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(tokenOptInfo, 'getCurrentUserFn');
		const token = tokenWithInfo.accessToken;

		try {
			return (
				await provider.getCurrentUserFn?.(
					{},
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(tokenWithInfo, e);
		}
	}

	async getCurrentUserForInstance(
		tokenOptInfo: TokenOptInfo,
		namespace: string,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getCurrentUserForInstanceFn',
		);
		const token = tokenWithInfo.accessToken;

		return (
			await provider.getCurrentUserForInstanceFn?.(
				{ namespace: namespace },
				{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
			)
		)?.data;
	}

	async getCurrentUserForResource(
		tokenOptInfo: TokenWithInfo,
		resourceId: string,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getCurrentUserForResourceFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (
				await provider.getCurrentUserForResourceFn?.(
					{ resourceId: resourceId },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(tokenWithInfo, e);
		}
	}

	async getJiraResourcesForCurrentUser(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
	): Promise<ProviderJiraResource[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraResourcesForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (await provider.getJiraResourcesForCurrentUserFn?.({ token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraResource[] | undefined>(tokenWithInfo, e);
		}
	}

	async getLinearOrganization(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
	): Promise<ProviderLinearOrganization | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getLinearOrganizationFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const x = await provider.getLinearOrganizationFn?.({ token: token });
			const y = x?.data;
			return y;
		} catch (e) {
			return this.handleProviderError<ProviderLinearOrganization | undefined>(tokenWithInfo, e);
		}
	}

	async getLinearTeamsForCurrentUser(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
	): Promise<ProviderLinearTeam[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getLinearTeamsForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (await provider.getLinearTeamsForCurrentUserFn?.({ token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderLinearTeam[] | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * Reads issues scoped to Linear teams/projects/labels/assignees (Linear's issue-list filter). One page per
	 * call — follow `paging.cursor`. `assignees` takes Linear user ids (the viewer's `id`), not names.
	 */
	async getLinearIssues(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
		input: {
			teams?: string[];
			projects?: string[];
			labels?: string[];
			/** Linear user ids (the viewer's `id`), not names. */
			assignees?: string[];
			/** Omitted reads open issues (workflow state type other than `completed`/`canceled`). */
			states?: GitIssueState[];
		},
		options?: PagingInput & {
			/** See {@link GetIssuesOptions.sort}. Linear expresses `created`/`updated`, descending only. */
			sort?: IssueSorting;
		},
	): Promise<ProviderApiPagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getLinearIssuesFn',
		);
		return this.getPagedResult<ProviderIssue>(
			{ ...input, ...options },
			provider.getLinearIssuesFn,
			tokenWithInfo,
			options?.cursor ?? undefined,
		);
	}

	/**
	 * The change state of up to `linearIssuesEtagMaxNumbers` issues of one Linear team, by number, in one GraphQL
	 * request. Its failures are classified as {@link getIssue}'s are, so a throttled or refused check reads the same.
	 */
	async getLinearIssuesEtagFields(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
		teamKey: string,
		numbers: readonly number[],
	): Promise<LinearIssueEtagNode[]> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);

		try {
			return await requestLinearIssuesEtagFields(this.request, tokenWithInfo.accessToken, teamKey, numbers);
		} catch (e) {
			return this.handleProviderError<LinearIssueEtagNode[]>(tokenWithInfo, e);
		}
	}

	/** Resolves Linear's current user (viewer). The viewer query returns only id/name/email/displayName. */
	async getLinearCurrentUser(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
	): Promise<{ id: string; name?: string | null; email?: string | null; displayName?: string | null } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getLinearCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (await provider.getLinearCurrentUserFn?.({ token: token }))?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getAzureResourcesForUser(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		userId: string,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAzureResource[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getAzureResourcesForUserFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (
				await provider.getAzureResourcesForUserFn?.(
					{ userId: userId },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAzureResource[] | undefined>(tokenWithInfo, e);
		}
	}

	async getBitbucketResourcesForCurrentUser(
		tokenOptInfo: TokenWithInfo<GitCloudHostIntegrationId.Bitbucket>,
	): Promise<ProviderApiPagedResult<ProviderBitbucketResource> | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketResourcesForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;

		// Drain every workspace page (numbered): the SDK returns 50 per page, and a user in more than one page
		// of workspaces would otherwise silently lose the rest (with them, their orgs/PRs). A scoped drain keeps
		// a successful prefix plus structured failure metadata when a later page fails.
		const result = await collectProviderPagedResult(
			async cursor => {
				try {
					const page = parsePageCursor(cursor);
					const response = await provider.getBitbucketResourcesForCurrentUserFn?.(
						{ page: page },
						{ token: token },
					);
					if (response == null) return undefined;

					const hasMore = response.pageInfo?.hasNextPage === true;
					const nextPage = response.pageInfo?.nextPage;
					return {
						values: response.data,
						paging: {
							more: hasMore,
							cursor: hasMore && nextPage != null ? toPageCursor(nextPage) : '{}',
						},
					};
				} catch (ex) {
					return this.handleProviderError<ProviderApiPagedResult<ProviderBitbucketResource>>(
						tokenWithInfo,
						ex,
					);
				}
			},
			20,
			{ providerId: tokenWithInfo.providerId },
		);
		return {
			values: result.values,
			paging: { cursor: '{}', more: false, ...(result.truncated ? { truncated: true } : {}) },
			...(result.metadata != null ? { metadata: result.metadata } : {}),
		};
	}

	async getBitbucketPullRequestsAuthoredByUserForWorkspace(
		tokenOptInfo: TokenWithInfo<GitCloudHostIntegrationId.Bitbucket>,
		userId: string,
		workspaceSlug: string,
		options?: { states?: GitPullRequestState[]; page?: number },
	): Promise<{ data: ProviderPullRequest[]; hasMore: boolean; nextPage: number | null } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketPullRequestsAuthoredByUserForWorkspaceFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getBitbucketPullRequestsAuthoredByUserForWorkspaceFn?.(
				{ userId: userId, workspaceSlug: workspaceSlug, states: options?.states, page: options?.page },
				{ token: token },
			);
			if (result == null) return undefined;
			return { data: result.data, hasMore: result.pageInfo.hasNextPage, nextPage: result.pageInfo.nextPage };
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getBitbucketServerPullRequestsForCurrentUser(
		tokenOptInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		baseUrl: string,
		options?: { states?: GitPullRequestState[]; page?: number },
	): Promise<{ data: ProviderPullRequest[]; hasMore: boolean; nextPage: number | null } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketServerPullRequestsForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;
		try {
			const result = await provider.getBitbucketServerPullRequestsForCurrentUserFn?.(
				{ states: options?.states, page: options?.page },
				{ token: token, baseUrl: baseUrl },
			);
			if (result == null) return undefined;
			return { data: result.data, hasMore: result.pageInfo.hasNextPage, nextPage: result.pageInfo.nextPage };
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getJiraProjectsForResources(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
		resourceIds: string[],
	): Promise<ProviderApiCollectionResult<ProviderJiraProject>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraProjectsForResourcesFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getJiraProjectsForResourcesFn?.(
				{ resourceIds: resourceIds },
				{ token: token },
			);
			// Preserve the SDK's per-resource completeness/failures instead of collapsing to a bare array, so the
			// Jira integration can cache only proven-successful resources and warn on the failed ones.
			return { values: result?.data ?? [], metadata: result?.metadata };
		} catch (e) {
			return this.handleProviderError<ProviderApiCollectionResult<ProviderJiraProject>>(tokenWithInfo, e);
		}
	}

	async getJiraProjectsForResource(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
		resourceId: string,
		options?: { cursor?: string },
	): Promise<ProviderApiPagedResult<ProviderJiraProject>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraProjectsForResourceFn',
		);

		return this.getPagedResult(
			{ resourceId: resourceId },
			provider.getJiraProjectsForResourceFn,
			tokenWithInfo,
			options?.cursor,
		);
	}

	async getAzureProjectsForResource(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		namespace: string,
		options?: { cursor?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderAzureProject>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getAzureProjectsForResourceFn',
		);
		try {
			return await this.getPagedResult<ProviderAzureProject>(
				{ namespace: namespace, ...options },
				provider.getAzureProjectsForResourceFn,
				tokenWithInfo,
				options?.cursor,
				options?.isPAT,
				options?.baseUrl,
			);
		} catch (e) {
			return this.handleProviderError<PagedResult<ProviderAzureProject>>(tokenWithInfo, e);
		}
	}

	async getReposForAzureProject(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		namespace: string,
		project: string,
		options?: GetReposOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getReposForAzureProjectFn',
		);

		return this.getPagedResult<ProviderRepository>(
			{ namespace: namespace, project: project, ...options },
			provider.getReposForAzureProjectFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getGitHubOrgsForCurrentUser(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.GitHub | GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
		>,
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderHierarchyResult<ProviderGitHubOrganization>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getOrgsForCurrentUserFn',
		);

		// Drain all pages so a user in many orgs doesn't lose everything past the first page, while
		// surfacing `truncated` when the defensive backstop stops before the listing is exhausted.
		const result = await collectProviderPagedResult(
			cursor =>
				this.getPagedResult<ProviderGitHubOrganization>(
					{},
					provider.getOrgsForCurrentUserFn,
					tokenWithInfo,
					cursor,
					options?.isPAT,
					options?.baseUrl,
				),
			20,
			{ providerId: tokenWithInfo.providerId },
		);
		// This method drains internally and takes no cursor, so a backstop cursor isn't resumable by
		// callers — keep only the truncation signal rather than exposing a misleading `paging`.
		return {
			values: result.values,
			...(result.truncated ? { truncated: true } : {}),
			...(result.metadata != null ? { metadata: result.metadata } : {}),
		};
	}

	async getReposForOrg(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.GitHub | GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
		>,
		orgName: string,
		options?: GetReposOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(tokenOptInfo, 'getReposForOrgFn');

		return this.getPagedResult<ProviderRepository>(
			{ orgName: orgName },
			provider.getReposForOrgFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getReposForBitbucketWorkspace(
		tokenOptInfo: TokenWithInfo<GitCloudHostIntegrationId.Bitbucket>,
		workspace: string,
		options?: GetReposOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getReposForWorkspaceFn',
		);

		return this.getPagedResult<ProviderRepository>(
			{ workspace: workspace },
			provider.getReposForWorkspaceFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getBitbucketServerProjects(
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		baseUrl: string,
		connectionId: string,
	): Promise<ProviderHierarchyResult<ProviderOrganization>> {
		const { paging: _paging, ...result } = await collectProviderPagedResult(
			cursor => requestBitbucketServerProjects(this.request, tokenWithInfo, baseUrl, connectionId, cursor),
			20,
			{ providerId: tokenWithInfo.providerId },
		);
		return result;
	}

	getBitbucketServerRepositories(
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		baseUrl: string,
		connectionId: string,
		options?: { project?: string; cursor?: string },
	): Promise<ProviderApiPagedResult<ProviderRepository>> {
		return requestBitbucketServerRepositories(this.request, tokenWithInfo, baseUrl, connectionId, options);
	}

	searchBitbucketServerPullRequestsPage(
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		options: Parameters<typeof searchBitbucketServerPullRequestsPage>[2],
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestSearchPage> {
		return searchBitbucketServerPullRequestsPage(this.request, tokenWithInfo, options, cancellation);
	}

	countBitbucketServerPullRequests(
		tokenWithInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		options: Parameters<typeof countBitbucketServerPullRequests>[2],
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestCount> {
		return countBitbucketServerPullRequests(this.request, tokenWithInfo, options, cancellation);
	}

	async getReposForCurrentUser(
		tokenOptInfo: TokenWithInfo<
			| GitCloudHostIntegrationId.GitHub
			| GitSelfManagedHostIntegrationId.CloudGitHubEnterprise
			| GitCloudHostIntegrationId.GitLab
			| GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
		>,
		options?: GetReposOptions & {
			/** GitHub `/user/repos` affiliation filter; ignored by GitLab's membership read. */
			affiliations?: ('owner' | 'collaborator' | 'organization_member')[];
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getReposForCurrentUserFn',
		);

		return this.getPagedResult<ProviderRepository>(
			options?.affiliations != null ? { affiliations: options.affiliations } : {},
			provider.getReposForCurrentUserFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getGitlabGroupsForCurrentUser(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.GitLab | GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
		>,
		options?: { topLevelOnly?: boolean; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderHierarchyResult<ProviderGitLabGroup>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getGroupsForCurrentUserFn',
		);

		// Drain all pages so a user in many groups doesn't lose everything past the first page, while
		// surfacing `truncated` when the defensive backstop stops before the listing is exhausted.
		const result = await collectProviderPagedResult(
			cursor =>
				this.getPagedResult<ProviderGitLabGroup>(
					{ topLevelOnly: options?.topLevelOnly },
					provider.getGroupsForCurrentUserFn,
					tokenWithInfo,
					cursor,
					options?.isPAT,
					options?.baseUrl,
				),
			20,
			{ providerId: tokenWithInfo.providerId },
		);
		// This method drains internally and takes no cursor, so a backstop cursor isn't resumable by
		// callers — keep only the truncation signal rather than exposing a misleading `paging`.
		return {
			values: result.values,
			...(result.truncated ? { truncated: true } : {}),
			...(result.metadata != null ? { metadata: result.metadata } : {}),
		};
	}

	async getPullRequestsForRepos(
		tokenOptInfo: TokenOptInfo,
		reposOrIds: ProviderReposInput,
		options?: GetPullRequestsOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderApiPagedResult<ProviderPullRequest>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForReposFn',
		);

		return this.getPagedResult<ProviderPullRequest>(
			{
				...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
				...options,
			},
			provider.getPullRequestsForReposFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForRepo(
		tokenOptInfo: TokenOptInfo,
		repo: ProviderRepoInput,
		options?: GetPullRequestsOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderApiPagedResult<ProviderPullRequest>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForRepoFn',
		);

		return this.getPagedResult<ProviderPullRequest>(
			{ repo: repo, ...options },
			provider.getPullRequestsForRepoFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForUser(
		tokenWithInfo: TokenWithInfo<GitCloudHostIntegrationId.Bitbucket>,
		userId: string,
		options?: { isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<ProviderApiPagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		tokenWithInfo: TokenWithInfo<Exclude<IntegrationIds, GitCloudHostIntegrationId.Bitbucket>>,
		username: string,
		options?: { isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<ProviderApiPagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		tokenOptInfo: TokenWithInfo,
		usernameOrId: string,
		options?: { isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<ProviderApiPagedResult<ProviderPullRequest>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForUserFn',
		);

		return this.getPagedResult<ProviderPullRequest>(
			{
				...(tokenWithInfo.providerId === GitCloudHostIntegrationId.Bitbucket
					? { userId: usernameOrId }
					: { username: usernameOrId }),
				...options,
			},
			provider.getPullRequestsForUserFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getGitLabPullRequestsForUserAssociation(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.GitLab | GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
		>,
		username: string,
		association: 'assigned' | 'authored' | 'reviewRequested',
		options?: {
			isPAT?: boolean;
			baseUrl?: string;
			states?: GitPullRequestState[];
			cursor?: string;
			pageSize?: number;
		},
	): Promise<ProviderApiPagedResult<ProviderPullRequest>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getGitLabPullRequestsForUserAssociationFn',
		);

		return this.getPagedResult(
			{
				username: username,
				association: association,
				states: options?.states,
				pageSize: options?.pageSize,
			},
			provider.getGitLabPullRequestsForUserAssociationFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForAzureProjects(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		projects: { namespace: string; project: string }[],
		options?: {
			authorLogin?: string;
			assigneeLogins?: string[];
			reviewerId?: string;
			states?: GitPullRequestState[];
			repo?: ProviderRepoInput;
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<ProviderApiCollectionResult<ProviderPullRequest>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForAzureProjectsFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getPullRequestsForAzureProjectsFn?.(
				{
					projects: projects,
					authorLogin: options?.authorLogin,
					assigneeLogins: options?.assigneeLogins,
					reviewerId: options?.reviewerId,
					states: options?.states,
					repo: options?.repo,
				},
				// Azure only supports a Basic credential for this call, so it is sent as one regardless of the
				// incoming `options?.isPAT`. The secret goes over raw — provider-apis encodes it itself.
				{ token: token, isPAT: true, baseUrl: options?.baseUrl },
			);
			// The SDK's multi-project aggregate preserves successful projects and reports failed/incomplete ones
			// through `metadata` (it has no `pageInfo`); keep it so the account-wide drain can warn on the failed
			// projects and set `fetchFailed` instead of publishing a partial Azure read as complete.
			return { values: result?.data ?? [], metadata: result?.metadata };
		} catch (e) {
			return this.handleProviderError<ProviderApiCollectionResult<ProviderPullRequest>>(tokenWithInfo, e);
		}
	}

	/**
	 * Single Azure project PR read, paginated by number. Unlike {@link getPullRequestsForAzureProjects} (which
	 * aggregates across projects and exposes no paging), this returns one page plus whether more remain, so a
	 * caller can drain a project fully.
	 */
	async getPullRequestsForAzureProject(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		project: { namespace: string; project: string },
		options?: {
			authorLogin?: string;
			assigneeLogins?: string[];
			reviewerId?: string;
			states?: GitPullRequestState[];
			repo?: ProviderRepoInput;
			page?: number;
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<{ data: ProviderPullRequest[]; hasMore: boolean; nextPage: number | null } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForAzureProjectFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getPullRequestsForAzureProjectFn?.(
				{
					namespace: project.namespace,
					project: project.project,
					authorLogin: options?.authorLogin,
					assigneeLogins: options?.assigneeLogins,
					reviewerId: options?.reviewerId,
					states: options?.states,
					repo: options?.repo,
					page: options?.page,
				},
				// Azure only supports a Basic credential for this call, so it is sent as one regardless of the
				// incoming `options?.isPAT`. The secret goes over raw — provider-apis encodes it itself.
				{ token: token, isPAT: true, baseUrl: options?.baseUrl },
			);
			if (result == null) return undefined;
			return { data: result.data, hasMore: result.pageInfo.hasNextPage, nextPage: result.pageInfo.nextPage };
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async mergePullRequest(
		tokenOptInfo: TokenWithInfo,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<boolean> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'mergePullRequestFn',
		);
		const token = tokenWithInfo.accessToken;
		const headRef = pr.refs?.head;
		if (headRef == null) return false;

		if (provider.id === GitCloudHostIntegrationId.AzureDevOps && pr.project == null) {
			return false;
		}

		try {
			await provider.mergePullRequestFn?.(
				{
					pullRequest: {
						headRef: { oid: headRef.sha },
						id: pr.id,
						number: Number.parseInt(pr.id, 10),
						repository: {
							id: pr.repository.repo,
							name: pr.repository.repo,
							project: pr.project?.name ?? '',
							owner: {
								login: pr.repository.owner,
							},
						},
						version: pr.version,
					},
					...options,
				},
				{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
			);
			return true;
		} catch (e) {
			return this.handleProviderError<boolean>(tokenWithInfo, e);
		}
	}

	async getIssuesForRepos(
		tokenOptInfo: TokenOptInfo,
		reposOrIds: ProviderReposInput,
		options?: GetIssuesOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderApiPagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForReposFn',
		);

		return this.getPagedResult<ProviderIssue>(
			{
				...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
				...options,
			},
			provider.getIssuesForReposFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForRepo(
		tokenOptInfo: TokenOptInfo,
		repo: ProviderRepoInput,
		options?: GetIssuesOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForRepoFn',
		);

		return this.getPagedResult<ProviderIssue>(
			{ repo: repo, ...options },
			provider.getIssuesForRepoFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForCurrentUser(
		tokenOptInfo: TokenWithInfo,
		options?: PagingInput & {
			// Forwarded to the provider fn (GitLab's account-wide REST read); Linear ignores them.
			scope?: 'assigned_to_me' | 'all';
			assigneeUsername?: string;
			/**
			 * Narrows to issues authored by this user. Honored as of `@gitkraken/provider-apis` 0.54.0
			 * (`author_username`); it composes with `assigneeUsername` as AND, so a caller wanting the UNION of the
			 * two relationships must read each separately (see GitLab's account-wide issue read).
			 */
			authorUsername?: string;
			pageSize?: number;
			/** Linear only; GitLab's REST read ignores it. Omitted reads open issues. */
			states?: GitIssueState[];
			/** See {@link GetIssuesOptions.sort}. Forwarded to the provider fn; ordering is translated in the SDK. */
			sort?: IssueSorting;
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForCurrentUserFn',
		);
		return this.getPagedResult<ProviderIssue>(
			{
				scope: options?.scope,
				assigneeUsername: options?.assigneeUsername,
				authorUsername: options?.authorUsername,
				page: options?.page,
				pageSize: options?.pageSize,
				states: options?.states,
				sort: options?.sort,
			},
			provider.getIssuesForCurrentUserFn,
			tokenWithInfo,
			options?.cursor ?? undefined,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForAzureProject(
		tokenOptInfo: TokenOptInfo<
			GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer
		>,
		namespace: string,
		project: string,
		options?: GetIssuesOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForAzureProjectFn',
		);

		return this.getPagedResult<ProviderIssue>(
			{ namespace: namespace, project: project, ...options },
			provider.getIssuesForAzureProjectFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForProject(
		tokenOptInfo: TokenWithInfo,
		project: string,
		resourceId: string,
		options?: GetIssuesOptions,
	): Promise<ProviderIssue[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForProjectFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getIssuesForProjectFn?.(
				{
					projectKey: project,
					resourceId: resourceId,
					...options,
					includeTransitions: jiraListIncludeTransitions,
				},
				{ token: token },
			);

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue[] | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * Single page of {@link getIssuesForProject} that preserves the SDK's `pageInfo` so a caller can drain
	 * every page (the plain {@link getIssuesForProject} discards it, silently capping at the first page).
	 * `nextCursor` is the raw provider cursor (Jira offset / nextPageToken) fed back verbatim as `options.cursor`.
	 */
	async getIssuesForProjectPaged(
		tokenOptInfo: TokenWithInfo,
		project: string,
		resourceId: string,
		options?: GetIssuesOptions,
	): Promise<{ data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForProjectFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getIssuesForProjectFn?.(
				{
					projectKey: project,
					resourceId: resourceId,
					...options,
					includeTransitions: jiraListIncludeTransitions,
				},
				{ token: token },
			);
			if (result == null) return undefined;
			return {
				data: result.data,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				nextCursor: result.pageInfo?.endCursor ?? undefined,
			};
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	// Jira Server reads. Every one of them is addressed by `baseUrl` — the connection's own host — rather than
	// by a resource id: a self-hosted instance IS the resource, and routing by anything else would send one
	// host's token to another. `baseUrl` is therefore required, not optional, on all of them.
	async getJiraServerCurrentUser(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
	): Promise<ProviderAccount | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerCurrentUserFn',
		);

		try {
			const result = await provider.getJiraServerCurrentUserFn?.({
				token: tokenWithInfo.accessToken,
				baseUrl: baseUrl,
			});
			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * Jira Server's project list, which is a single unpaged `/rest/api/2/project` read rather than Cloud's
	 * paged `project/search`, so there is no cursor to thread and the result is always the complete set.
	 */
	async getJiraServerProjects(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
	): Promise<ProviderJiraServerProject[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerProjectsFn',
		);

		try {
			const result = await provider.getJiraServerProjectsFn?.({
				token: tokenWithInfo.accessToken,
				baseUrl: baseUrl,
			});
			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraServerProject[] | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * One page of a Jira Server project's issues, preserving the SDK's `pageInfo` so the integration can drain
	 * every page — the same contract as {@link getIssuesForProjectPaged} on Cloud.
	 */
	async getJiraServerIssuesForProjectPaged(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
		projectKey: string,
		options?: GetIssuesOptions,
	): Promise<{ data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerIssuesForProjectFn',
		);

		try {
			const result = await provider.getJiraServerIssuesForProjectFn?.(
				{ projectKey: projectKey, ...options, includeTransitions: jiraListIncludeTransitions },
				{ token: tokenWithInfo.accessToken, baseUrl: baseUrl },
			);
			if (result == null) return undefined;

			return {
				data: result.data,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				nextCursor: result.pageInfo?.endCursor ?? undefined,
			};
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	/**
	 * Single page of one issue search across several projects of a Jira Server instance — the contract of
	 * {@link getIssuesForProjectsPaged} on Cloud: the page and its cursor are global to the project set, and at
	 * most `JIRA_MAX_PROJECT_KEYS_PER_REQUEST` keys are accepted per call.
	 */
	async getJiraServerIssuesForProjectsPaged(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
		projectKeys: string[],
		options?: GetIssuesOptions,
	): Promise<{ data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerIssuesForProjectsFn',
		);

		try {
			const result = await provider.getJiraServerIssuesForProjectsFn?.(
				{ projectKeys: projectKeys, ...options, includeTransitions: jiraListIncludeTransitions },
				{ token: tokenWithInfo.accessToken, baseUrl: baseUrl },
			);
			if (result == null) return undefined;

			return {
				data: result.data,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				nextCursor: result.pageInfo?.endCursor ?? undefined,
			};
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getJiraServerIssue(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
		number: string,
	): Promise<ProviderIssue | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerIssueFn',
		);

		try {
			const result = await provider.getJiraServerIssueFn?.(
				{ number: number },
				{ token: tokenWithInfo.accessToken, baseUrl: baseUrl },
			);
			return result?.data;
		} catch (e) {
			// A key that names no issue is a lookup MISS, not a failure: both callers
			// (`getProviderLinkedIssueOrPullRequest`, `getProviderIssue`) read an autolink or a stored
			// reference that may simply be gone, and translating it would surface a `RequestNotFoundError`
			// where Jira Cloud's `getJiraIssueByKey` and the generic `getIssue` both return undefined.
			if (isProviderIssueNotFoundError(tokenWithInfo.providerId, e)) return undefined;

			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}
	}

	/** The account-wide read: every issue related to the current user on this instance, no project needed. */
	async getJiraServerIssuesForCurrentUser(
		tokenOptInfo: TokenWithInfo<IssuesSelfManagedHostIntegrationId.JiraServer>,
		baseUrl: string,
		options?: { cursor?: string; states?: GitIssueState[]; sort?: IssueSorting },
	): Promise<{ data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraServerIssuesForCurrentUserFn',
		);

		try {
			const result = await provider.getJiraServerIssuesForCurrentUserFn?.(
				{
					cursor: options?.cursor,
					states: options?.states,
					sort: options?.sort,
					includeTransitions: jiraListIncludeTransitions,
				},
				{ token: tokenWithInfo.accessToken, baseUrl: baseUrl },
			);
			if (result == null) return undefined;

			return {
				data: result.data,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				nextCursor: result.pageInfo?.endCursor ?? undefined,
			};
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	/**
	 * Single page of one issue search across several projects of the same Jira site. The page, its cursor and
	 * `hasMore` are global to the whole project set, not per project; at most `JIRA_MAX_PROJECT_KEYS_PER_REQUEST`
	 * keys are accepted per call (the SDK throws past it), so the caller chunks.
	 */
	async getIssuesForProjectsPaged(
		tokenOptInfo: TokenWithInfo,
		projectKeys: string[],
		resourceId: string,
		options?: GetIssuesOptions,
	): Promise<{ data: ProviderIssue[]; hasMore: boolean; nextCursor: string | undefined } | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForProjectsFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getIssuesForProjectsFn?.(
				{
					projectKeys: projectKeys,
					resourceId: resourceId,
					...options,
					includeTransitions: jiraListIncludeTransitions,
				},
				{ token: token },
			);
			if (result == null) return undefined;
			return {
				data: result.data,
				hasMore: result.pageInfo?.hasNextPage ?? false,
				nextCursor: result.pageInfo?.endCursor ?? undefined,
			};
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getTrelloCard(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Trello>,
		appKey: string,
		cardId: string,
		options?: { trelloBoardListsById?: Record<string, { name: string }> },
	): Promise<ProviderIssue | undefined> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);

		try {
			const result = await this.request<TrelloCardResponse>({
				url: `${trelloBaseUrl}/1/cards/${encodeURIComponent(cardId)}?members=true`,
				headers: getTrelloAuthHeaders(appKey, tokenWithInfo.accessToken),
			});

			return fromTrelloCard(result.body, options?.trelloBoardListsById ?? {});
		} catch (e) {
			try {
				return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
			} catch (ex) {
				if (RequestNotFoundError.is(ex)) return undefined;
				throw ex;
			}
		}
	}

	// Trello reads. The Trello client is keyed by an `appKey` (the Trello app key from the cloud token exchange)
	// paired with the OAuth token, so each wrapper threads `appKey` through alongside `tokenWithInfo`.
	async getTrelloCurrentUser(
		tokenOptInfo: TokenWithInfo,
		appKey: string,
	): Promise<
		{ id: string; name: string; email: string; username: string; url: string; avatarUrl: string | null } | undefined
	> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getTrelloCurrentUserFn',
		);
		try {
			const result = await provider.getTrelloCurrentUserFn?.(
				{ appKey: appKey },
				{ token: tokenWithInfo.accessToken },
			);
			return result?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getTrelloBoardsForCurrentUser(
		tokenOptInfo: TokenWithInfo,
		appKey: string,
	): Promise<TrelloBoard[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getTrelloBoardsForCurrentUserFn',
		);
		try {
			const result = await provider.getTrelloBoardsForCurrentUserFn?.(
				{ appKey: appKey },
				{ token: tokenWithInfo.accessToken },
			);
			return result?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getTrelloListsForBoard(
		tokenOptInfo: TokenWithInfo,
		appKey: string,
		boardId: string,
	): Promise<TrelloList[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getTrelloListsForBoardFn',
		);
		try {
			const result = await provider.getTrelloListsForBoardFn?.(
				{ appKey: appKey, boardId: boardId },
				{ token: tokenWithInfo.accessToken },
			);
			return result?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getTrelloIssuesForBoard(
		tokenOptInfo: TokenWithInfo,
		appKey: string,
		boardId: string,
		options?: {
			assigneeLogins?: string[];
			trelloBoardListsById?: Record<string, { name: string }>;
			/** See {@link GetIssuesOptions.sort}. Trello expresses only `updated`, in either direction. */
			sort?: IssueSorting;
		},
	): Promise<ProviderApiCollectionResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getTrelloIssuesForBoardFn',
		);
		try {
			const result = await provider.getTrelloIssuesForBoardFn?.(
				{ appKey: appKey, boardId: boardId, ...options },
				{ token: tokenWithInfo.accessToken },
			);
			// Trello's search caps results and reports the cap through `metadata.completeness` (never a cursor).
			// Preserve it so the integration can signal a terminal truncation rather than a fake next page.
			return { values: result?.data ?? [], metadata: result?.metadata };
		} catch (e) {
			return this.handleProviderError<ProviderApiCollectionResult<ProviderIssue>>(tokenWithInfo, e);
		}
	}

	async getIssuesForResourceForCurrentUser(
		tokenOptInfo: TokenWithInfo,
		resourceId: string,
		options?: {
			cursor?: string;
			/**
			 * See {@link GetIssuesOptions.sort}. Forwarded for the same reason as every sibling issue read, even
			 * though nothing reaches this one with a sort today: `IssuesIntegration.searchProviderMyIssues` is the
			 * only caller and takes no options. A wrapper that accepted the SDK's input and silently dropped one
			 * field of it would give whoever adds that option no ordering and no error.
			 */
			sort?: IssueSorting;
			/** Omitted reads open issues (`statusCategory != Done`). */
			states?: GitIssueState[];
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForResourceForCurrentUserFn',
		);

		return this.getPagedResult<ProviderIssue>(
			{
				resourceId: resourceId,
				states: options?.states,
				sort: options?.sort,
				includeTransitions: jiraListIncludeTransitions,
			},
			provider.getIssuesForResourceForCurrentUserFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getJiraIssueByKey(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
		resourceId: string,
		resourceUrl: string,
		key: string,
	): Promise<ProviderIssue | undefined> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);

		try {
			return await requestJiraIssueByKey(this.request, tokenWithInfo.accessToken, resourceId, resourceUrl, key);
		} catch (e) {
			const status = (e as { response?: { status?: unknown } }).response?.status;
			if (status === 404) return undefined;

			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}
	}

	/**
	 * The change state of up to `jiraBulkFetchMaxKeys` issues of one Jira Cloud site, in one bulk fetch. Unlike
	 * {@link getJiraIssueByKey}, a 404 is a failure: it names a wrong site or endpoint, never an absent issue.
	 */
	async getJiraIssuesEtagFields(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
		resourceId: string,
		keys: readonly string[],
	): Promise<{ issues: JiraIssueEtagResponse[]; errorCount: number }> {
		const { tokenWithInfo } = await this.ensureProviderToken(tokenOptInfo);

		try {
			return await requestJiraIssuesEtagFields(this.request, tokenWithInfo.accessToken, resourceId, keys);
		} catch (e) {
			return this.handleProviderError<{ issues: JiraIssueEtagResponse[]; errorCount: number }>(tokenWithInfo, e);
		}
	}

	async getIssue(
		tokenOptInfo: TokenWithInfo,
		input: { resourceId: string; number: string } | { namespace: string; name: string; number: string },
		options?: { isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderIssue | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(tokenOptInfo, 'getIssueFn');
		const token = tokenWithInfo.accessToken;

		try {
			const result = await provider.getIssueFn?.(input, {
				token: token,
				isPAT: options?.isPAT,
				baseUrl: options?.baseUrl,
			});

			return result?.data;
		} catch (e) {
			if (isProviderIssueNotFoundError(tokenWithInfo.providerId, e)) return undefined;

			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}
	}
}

// This is copied over from the shared provider library because the current version is not respecting the "forceIsFetch: true"
// option in the config and our custom fetch function isn't being wrapped by the necessary fetch wrapper. Remove this once the library
// properly wraps our custom fetch and use `forceIsFetch: true` in the config.
export async function parseFetchResponseForApi<T>(response: Response): Promise<ProviderRequestResponse<T>> {
	// Media types are case-insensitive (RFC 9110 §8.3.1) and `fetch` hands the header back exactly as the server
	// wrote it, so match on a lowercased copy rather than the raw value.
	const contentType = (response.headers.get('content-type') || '').toLowerCase();
	let body;
	let servedHtml = false;

	// parse the response body
	if (contentType.startsWith('application/json')) {
		const text = await response.text();
		// A sign-in page a server mislabels as JSON is the same page under another header, and `<` can never open
		// valid JSON — so recognize it rather than letting JSON.parse throw a SyntaxError carrying no status.
		if (text.trimStart().startsWith('<')) {
			servedHtml = true;
			body = text;
		} else {
			body = text.trim().length > 0 ? JSON.parse(text) : null;
		}
	} else if (contentType.startsWith('text/') || contentType === '') {
		body = await response.text();
		// An empty body is never a sign-in page, and a write answering `204` can carry a stale `text/html` from
		// whatever its endpoint usually returns — so require actual markup, not just the header.
		servedHtml = contentType.startsWith('text/html') && body.trim().length > 0;
	} else if (contentType.startsWith('application/vnd.github.raw+json')) {
		body = await response.arrayBuffer();
	} else {
		throw new Error(`Unsupported content-type: ${contentType}`);
	}

	const result = {
		body: body,
		headers: Object.fromEntries(response.headers.entries()),
		status: response.status,
		statusText: response.statusText,
	};

	// A 2xx carrying a page rather than data is a rejected credential wearing a success status (GKDEV-3617); a
	// non-2xx keeps its own status error below, which is the better diagnostic.
	if (response.ok && servedHtml) {
		throw new UnexpectedHtmlResponseError(response.status, contentType, result);
	}

	// throw an error if the response is not ok
	if (!response.ok) {
		const status = `(${response.status})${response.statusText ? ` ${response.statusText}` : ''}.`;
		const detail = getProviderResponseBodyMessage(body);
		const error = new Error(detail != null ? `${status} ${detail}` : status);
		Object.assign(error, { response: result });
		throw error;
	}

	return result;
}
