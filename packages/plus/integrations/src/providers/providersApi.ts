import ProviderApis from '@gitkraken/provider-apis';
import type { CollectionMetadata, GitPullRequestState, TrelloBoard, TrelloList } from '@gitkraken/provider-apis';
import type { PullRequest, PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import { base64 } from '@gitlens/utils/base64.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { TokenOptInfo, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../constants.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '../errors.js';
import type {
	GetIssueFn,
	GetIssuesForReposFn,
	GetIssuesOptions,
	GetPullRequestsForRepoFn,
	GetPullRequestsForReposFn,
	GetPullRequestsForUserFn,
	GetPullRequestsForUserOptions,
	GetPullRequestsOptions,
	GetReposOptions,
	IssueFilter,
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
	ProviderLinearOrganization,
	ProviderLinearTeam,
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
import { providersMetadata } from './models.js';
import { collectProviderPagedResult } from './utils/providerPaging.js';

// `@gitkraken/provider-apis` is published as CommonJS with its factory on the `default` export.
// How that surfaces depends on the consuming bundler's CJS->ESM interop: esbuild yields the
// callable factory directly, while webpack and Node surface the module namespace (with the
// factory under `.default`). Normalize to the callable factory so every consumer resolves it.
type ProviderApisFactory = typeof ProviderApis;
const createProviderApis: ProviderApisFactory =
	(ProviderApis as ProviderApisFactory & { default?: ProviderApisFactory }).default ?? ProviderApis;

export class ProvidersApi {
	private readonly providers: Providers;

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
			},
			[GitCloudHostIntegrationId.GitLab]: {
				...providersMetadata[GitCloudHostIntegrationId.GitLab],
				provider: providerApis.gitlab,
				getRepoFn: providerApis.gitlab.getRepo.bind(providerApis.gitlab),
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab),
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(
					providerApis.gitlab,
				) as GetPullRequestsForRepoFn,
				getPullRequestsForUserFn: providerApis.gitlab.getPullRequestsAssociatedWithUser.bind(
					providerApis.gitlab,
				) as GetPullRequestsForUserFn,
				getIssueFn: providerApis.gitlab.getIssue.bind(providerApis.gitlab) as GetIssueFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(providerApis.gitlab),
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
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(
					providerApis.gitlab,
				) as GetPullRequestsForRepoFn,
				getPullRequestsForUserFn: providerApis.gitlab.getPullRequestsAssociatedWithUser.bind(
					providerApis.gitlab,
				) as GetPullRequestsForUserFn,
				getIssueFn: providerApis.gitlab.getIssue.bind(providerApis.gitlab) as GetIssueFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(providerApis.gitlab),
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
				getIssueFn: providerApis.jira.getIssue.bind(providerApis.jira) as GetIssueFn,
				getIssuesForProjectFn: providerApis.jira.getIssuesForProject.bind(providerApis.jira),
				getIssuesForResourceForCurrentUserFn: providerApis.jira.getIssuesForResourceForCurrentUser.bind(
					providerApis.jira,
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

	isRepoIdsInput(input: any): input is (string | number)[] {
		return (
			input != null &&
			Array.isArray(input) &&
			input.every((id: any) => typeof id === 'string' || typeof id === 'number')
		);
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

	private getAzurePATForOAuthToken(oauthToken: string) {
		return base64(`PAT:${oauthToken}`);
	}

	private async ensureProviderTokenAndFunction<T extends IntegrationIds>(
		tokenOptInfo: TokenOptInfo<T>,
		providerFn: keyof ProviderInfo,
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

		if (provider[providerFn] == null) {
			throw new Error(`Provider with id ${providerId} does not support function: ${providerFn}`);
		}

		return { provider: provider, tokenWithInfo: tokenWithInfo };
	}

	private handleProviderError<T>(tokenWithInfo: TokenWithInfo, error: any): T {
		const { accessToken: token, ...tokenInfo } = tokenWithInfo;
		const providerId = tokenWithInfo.providerId;
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		if (error?.response?.status != null) {
			switch (error.response.status) {
				case 404: // Not found
				case 410: // Gone
				case 422: // Unprocessable Entity
					throw new RequestNotFoundError(error);
				case 401: // Unauthorized
					if (error.message?.includes('rate limit')) {
						let resetAt: number | undefined;

						const reset = error.response?.headers?.['x-ratelimit-reset'];
						if (reset != null) {
							resetAt = parseInt(reset, 10);
							if (Number.isNaN(resetAt)) {
								resetAt = undefined;
							}
						}

						throw new RequestRateLimitError(error, token, resetAt);
					}
					throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Unauthorized, error);
				case 403: // Forbidden
					throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Forbidden, error);
				case 429: {
					// Too Many Requests
					let resetAt: number | undefined;

					const reset = error.response.headers?.['x-ratelimit-reset'];
					if (reset != null) {
						resetAt = parseInt(reset, 10);
						if (Number.isNaN(resetAt)) {
							resetAt = undefined;
						}
					}

					throw new RequestRateLimitError(error, token, resetAt);
				}
				default:
					if (error.response.status >= 400 && error.response.status < 500) {
						throw new RequestClientError(error);
					}
			}
		}

		throw error;
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
				return { values: [] };
			}

			const pageInfo = result.pageInfo;
			const hasMore = pageInfo?.hasNextPage ?? false;

			let nextCursor = '{}';
			if (pageInfo?.endCursor != null) {
				nextCursor = JSON.stringify({ value: pageInfo.endCursor, type: 'cursor' });
			} else if (pageInfo?.nextPage != null) {
				nextCursor = JSON.stringify({ value: pageInfo.nextPage, type: 'page' });
			}

			// SDK collection completeness is independent from provider-native pagination: a result can expose a
			// real next page (`more`) and still have a failed sibling scope (`partial`/`unknown`). Surface the
			// latter as `truncated` so consumers treat the page as incomplete. Absent metadata (old providers,
			// test doubles) leaves `truncated` unset for backward compatibility.
			const truncated = result.metadata != null && result.metadata.completeness !== 'complete' ? true : undefined;

			return {
				values: result.data,
				paging: {
					cursor: nextCursor,
					more: hasMore,
					truncated: truncated,
					// Numbered-page metadata; left undefined by cursor-based providers (which don't report a
					// currentPage), so we never echo the requested page for a provider that ignored it.
					page: pageInfo?.currentPage ?? undefined,
					pageSize: requestedPageSize,
					nextPage: pageInfo?.nextPage ?? undefined,
					totalPages: pageInfo?.totalPages ?? undefined,
					totalCount: pageInfo?.totalCount ?? undefined,
				},
				metadata: result.metadata,
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
		if (providerId === GitCloudHostIntegrationId.AzureDevOps && project != null) {
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
				return this.handleProviderError<ProviderRepository>(tokenWithInfo, e);
			}
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
	 * Reads issues scoped to Linear teams/projects/labels (Linear's issue-list filter). One page per call —
	 * follow `paging.cursor`. Linear's `getIssues` has no author/assignee filter, so per-user scoping is
	 * applied client-side by the caller.
	 */
	async getLinearIssues(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Linear>,
		input: { teams?: string[]; projects?: string[]; labels?: string[] },
		options?: PagingInput,
	): Promise<PagedResult<ProviderIssue>> {
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

		try {
			// Drain every workspace page (numbered): the SDK returns 50 per page, and a user in more than one
			// page of workspaces would otherwise silently lose the rest (with them, their orgs/PRs). Bounded by
			// a defensive backstop.
			const maxPages = 20;
			const workspaces: ProviderBitbucketResource[] = [];
			let page: number | undefined;
			let truncated = false;
			for (let i = 0; i < maxPages; i++) {
				const result = await provider.getBitbucketResourcesForCurrentUserFn?.({ page: page }, { token: token });
				if (result == null) {
					return i === 0
						? undefined
						: {
								values: workspaces,
								paging: { cursor: '{}', more: false, ...(truncated ? { truncated: true } : {}) },
							};
				}

				workspaces.push(...result.data);
				if (!result.pageInfo?.hasNextPage || result.pageInfo.nextPage == null) break;

				page = result.pageInfo.nextPage;
				if (i === maxPages - 1) {
					truncated = true;
				}
			}
			return {
				values: workspaces,
				paging: { cursor: '{}', more: false, ...(truncated ? { truncated: true } : {}) },
			};
		} catch (e) {
			return this.handleProviderError<ProviderApiPagedResult<ProviderBitbucketResource> | undefined>(
				tokenWithInfo,
				e,
			);
		}
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
		const token = tokenWithInfo.accessToken;

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

		try {
			return await this.getPagedResult<ProviderAzureProject>(
				{ namespace: namespace, ...options },
				provider.getAzureProjectsForResourceFn,
				{ ...tokenWithInfo, accessToken: azureToken },
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
		const result = await collectProviderPagedResult(cursor =>
			this.getPagedResult<ProviderGitHubOrganization>(
				{},
				provider.getOrgsForCurrentUserFn,
				tokenWithInfo,
				cursor,
				options?.isPAT,
				options?.baseUrl,
			),
		);
		// This method drains internally and takes no cursor, so a backstop cursor isn't resumable by
		// callers — keep only the truncation signal rather than exposing a misleading `paging`.
		return { values: result.values, ...(result.truncated ? { truncated: true } : {}) };
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

	async getReposForCurrentUser(
		tokenOptInfo: TokenWithInfo<
			GitCloudHostIntegrationId.GitLab | GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted
		>,
		options?: GetReposOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getReposForCurrentUserFn',
		);

		return this.getPagedResult<ProviderRepository>(
			{},
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
		const result = await collectProviderPagedResult(cursor =>
			this.getPagedResult<ProviderGitLabGroup>(
				{ topLevelOnly: options?.topLevelOnly },
				provider.getGroupsForCurrentUserFn,
				tokenWithInfo,
				cursor,
				options?.isPAT,
				options?.baseUrl,
			),
		);
		// This method drains internally and takes no cursor, so a backstop cursor isn't resumable by
		// callers — keep only the truncation signal rather than exposing a misleading `paging`.
		return { values: result.values, ...(result.truncated ? { truncated: true } : {}) };
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

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

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
				// `azureToken` is always a PAT here (the raw token when `isPAT`, otherwise a PAT derived from
				// the OAuth token), so it must be sent as a PAT regardless of the incoming `options?.isPAT`.
				{ token: azureToken, isPAT: true, baseUrl: options?.baseUrl },
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
		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

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
				// `azureToken` is always a PAT here (already PAT-formatted when `isPAT`, otherwise derived from
				// the OAuth token), so it must be sent as a PAT regardless of the incoming `options?.isPAT`.
				{ token: azureToken, isPAT: true, baseUrl: options?.baseUrl },
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
	): Promise<PagedResult<ProviderIssue>> {
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
		options?: PagingInput & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForCurrentUserFn',
		);
		return this.getPagedResult<ProviderIssue>(
			options,
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
				{ projectKey: project, resourceId: resourceId, ...options },
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
				{ projectKey: project, resourceId: resourceId, ...options },
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
		options?: { assigneeLogins?: string[]; trelloBoardListsById?: Record<string, { name: string }> },
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
		options?: { cursor?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getIssuesForResourceForCurrentUserFn',
		);

		return this.getPagedResult<ProviderIssue>(
			{ resourceId: resourceId },
			provider.getIssuesForResourceForCurrentUserFn,
			tokenWithInfo,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
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
			return this.handleProviderError<ProviderIssue | undefined>(tokenWithInfo, e);
		}
	}
}

// This is copied over from the shared provider library because the current version is not respecting the "forceIsFetch: true"
// option in the config and our custom fetch function isn't being wrapped by the necessary fetch wrapper. Remove this once the library
// properly wraps our custom fetch and use `forceIsFetch: true` in the config.
async function parseFetchResponseForApi<T>(response: Response): Promise<ProviderRequestResponse<T>> {
	const contentType = response.headers.get('content-type') || '';
	let body;

	// parse the response body
	if (contentType.startsWith('application/json')) {
		const text = await response.text();
		body = text.trim().length > 0 ? JSON.parse(text) : null;
	} else if (contentType.startsWith('text/') || contentType === '') {
		body = await response.text();
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

	// throw an error if the response is not ok
	if (!response.ok) {
		const error = new Error(response.statusText);
		Object.assign(error, { response: result });
		throw error;
	}

	return result;
}
