import ProviderApis from '@gitkraken/provider-apis';
import { version as codeVersion, env } from 'vscode';
import { base64 } from '@env/base64.js';
import type { Response as FetchResponse } from '@env/fetch.js';
import { fetch as _fetch, getProxyAgent } from '@env/fetch.js';
import { getPlatform } from '@env/platform.js';
import type { IntegrationIds } from '../../../constants.integrations.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations.js';
import type { Container } from '../../../container.js';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '../../../errors.js';
import type { PagedResult } from '../../../git/gitProvider.js';
import type { PullRequest, PullRequestMergeMethod } from '../../../git/models/pullRequest.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { TokenOptInfo, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type {
	GetAzureProjectsForResourceFn,
	GetAzureResourcesForUserFn,
	GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn,
	GetBitbucketResourcesForCurrentUserFn,
	GetCurrentUserFn,
	GetCurrentUserForInstanceFn,
	GetIssueFn,
	GetIssuesForAzureProjectFn,
	GetIssuesForRepoFn,
	GetIssuesForReposFn,
	GetIssuesOptions,
	GetPullRequestsForAzureProjectsFn,
	GetPullRequestsForRepoFn,
	GetPullRequestsForReposFn,
	GetPullRequestsForUserFn,
	GetPullRequestsForUserOptions,
	GetPullRequestsOptions,
	GetReposForAzureProjectFn,
	GetReposOptions,
	IssueFilter,
	MergePullRequestFn,
	PageInfo,
	PagingInput,
	PagingMode,
	ProviderAccount,
	ProviderAzureProject,
	ProviderAzureResource,
	ProviderBitbucketResource,
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

export class ProvidersApi {
	private readonly providers: Providers;

	constructor(
		private readonly container: Container,
		private readonly authenticationService: IntegrationAuthenticationService,
	) {
		const proxyAgent = getProxyAgent();
		const userAgent = `${
			container.debugging ? 'GitLens-Debug' : container.prerelease ? 'GitLens-Pre' : 'GitLens'
		}/${container.version} (${env.appName}/${codeVersion}; ${getPlatform()})`;
		const customFetch: ProviderRequestFunction = async <T>({
			url,
			...options
		}: ProviderRequestOptions): Promise<ProviderRequestResponse<T>> => {
			const response = await _fetch(url, {
				agent: proxyAgent,
				...options,
				headers: {
					'User-Agent': userAgent,
					...options.headers,
				},
			});

			return parseFetchResponseForApi<T>(response);
		};
		const providerApis = ProviderApis({ request: customFetch });
		this.providers = {
			[GitCloudHostIntegrationId.GitHub]: {
				...providersMetadata[GitCloudHostIntegrationId.GitHub],
				provider: providerApis.github,
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github) as GetCurrentUserFn,
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.github.getPullRequestsAssociatedWithUser.bind(
					providerApis.github,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
			},
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.GitHubEnterprise],
				provider: providerApis.github,
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github) as GetCurrentUserFn,
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.github.getPullRequestsAssociatedWithUser.bind(
					providerApis.github,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
			},
			[GitSelfManagedHostIntegrationId.GitHubEnterprise]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.GitHubEnterprise],
				provider: providerApis.github,
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github) as GetCurrentUserFn,
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.github.getPullRequestsAssociatedWithUser.bind(
					providerApis.github,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
			},
			[GitCloudHostIntegrationId.GitLab]: {
				...providersMetadata[GitCloudHostIntegrationId.GitLab],
				provider: providerApis.gitlab,
				getRepoFn: providerApis.gitlab.getRepo.bind(providerApis.gitlab),
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab) as GetCurrentUserFn,
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
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(
					providerApis.gitlab,
				) as GetIssuesForRepoFn,
				mergePullRequestFn: providerApis.gitlab.mergePullRequest.bind(providerApis.gitlab),
			},
			[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: {
				...providersMetadata[GitCloudHostIntegrationId.GitLab],
				provider: providerApis.gitlab,
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab) as GetCurrentUserFn,
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
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(
					providerApis.gitlab,
				) as GetIssuesForRepoFn,
				mergePullRequestFn: providerApis.gitlab.mergePullRequest.bind(providerApis.gitlab),
			},
			[GitSelfManagedHostIntegrationId.GitLabSelfHosted]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.GitLabSelfHosted],
				provider: providerApis.gitlab,
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab) as GetCurrentUserFn,
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(
					providerApis.gitlab,
				) as GetPullRequestsForRepoFn,
				getPullRequestsForUserFn: providerApis.gitlab.getPullRequestsAssociatedWithUser.bind(
					providerApis.gitlab,
				) as GetPullRequestsForUserFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(
					providerApis.gitlab,
				) as GetIssuesForRepoFn,
			},
			[GitCloudHostIntegrationId.Bitbucket]: {
				...providersMetadata[GitCloudHostIntegrationId.Bitbucket],
				provider: providerApis.bitbucket,
				getCurrentUserFn: providerApis.bitbucket.getCurrentUser.bind(
					providerApis.bitbucket,
				) as GetCurrentUserFn,
				getBitbucketResourcesForCurrentUserFn: providerApis.bitbucket.getWorkspacesForCurrentUser.bind(
					providerApis.bitbucket,
				) as GetBitbucketResourcesForCurrentUserFn,
				getBitbucketPullRequestsAuthoredByUserForWorkspaceFn:
					providerApis.bitbucket.getPullRequestsForUserAndWorkspace.bind(
						providerApis.bitbucket,
					) as GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn,
				getPullRequestsForReposFn: providerApis.bitbucket.getPullRequestsForRepos.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.bitbucket.getPullRequestsForRepo.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForRepoFn,
				mergePullRequestFn: providerApis.bitbucket.mergePullRequest.bind(
					providerApis.bitbucket,
				) as MergePullRequestFn,
			},
			[GitSelfManagedHostIntegrationId.BitbucketServer]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.BitbucketServer],
				provider: providerApis.bitbucketServer,
				getRepoFn: providerApis.bitbucketServer.getRepo.bind(providerApis.bitbucketServer),
				getCurrentUserFn: providerApis.bitbucketServer.getCurrentUser.bind(
					providerApis.bitbucketServer,
				) as GetCurrentUserFn,
				getBitbucketServerPullRequestsForCurrentUserFn:
					providerApis.bitbucketServer.getPullRequestsForCurrentUser.bind(providerApis.bitbucketServer),
				getPullRequestsForReposFn: providerApis.bitbucketServer.getPullRequestsForRepos.bind(
					providerApis.bitbucketServer,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.bitbucketServer.getPullRequestsForRepo.bind(
					providerApis.bitbucketServer,
				) as GetPullRequestsForRepoFn,
				mergePullRequestFn: providerApis.bitbucketServer.mergePullRequest.bind(
					providerApis.bitbucketServer,
				) as MergePullRequestFn,
			},
			[GitCloudHostIntegrationId.AzureDevOps]: {
				...providersMetadata[GitCloudHostIntegrationId.AzureDevOps],
				provider: providerApis.azureDevOps,
				getRepoOfProjectFn: providerApis.azureDevOps.getRepo.bind(providerApis.azureDevOps),
				getCurrentUserFn: providerApis.azureDevOps.getCurrentUser.bind(
					providerApis.azureDevOps,
				) as GetCurrentUserFn,
				getCurrentUserForInstanceFn: providerApis.azureDevOps.getCurrentUserForInstance.bind(
					providerApis.azureDevOps,
				) as GetCurrentUserForInstanceFn,
				getAzureResourcesForUserFn: providerApis.azureDevOps.getOrgsForUser.bind(
					providerApis.azureDevOps,
				) as GetAzureResourcesForUserFn,
				getAzureProjectsForResourceFn: providerApis.azureDevOps.getAzureProjects.bind(
					providerApis.azureDevOps,
				) as GetAzureProjectsForResourceFn,
				getPullRequestsForReposFn: providerApis.azureDevOps.getPullRequestsForRepos.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.azureDevOps.getPullRequestsForRepo.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForRepoFn,
				getPullRequestsForAzureProjectsFn: providerApis.azureDevOps.getPullRequestsForProjects.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForAzureProjectsFn,
				getIssuesForAzureProjectFn: providerApis.azureDevOps.getIssuesForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetIssuesForAzureProjectFn,
				getReposForAzureProjectFn: providerApis.azureDevOps.getReposForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetReposForAzureProjectFn,
				mergePullRequestFn: providerApis.azureDevOps.mergePullRequest.bind(providerApis.azureDevOps),
			},
			[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: {
				...providersMetadata[GitSelfManagedHostIntegrationId.AzureDevOpsServer],
				provider: providerApis.azureDevOps,
				getRepoOfProjectFn: providerApis.azureDevOps.getRepo.bind(providerApis.azureDevOps),
				getCurrentUserFn: providerApis.azureDevOps.getCurrentUser.bind(
					providerApis.azureDevOps,
				) as GetCurrentUserFn,
				getCurrentUserForInstanceFn: providerApis.azureDevOps.getCurrentUserForInstance.bind(
					providerApis.azureDevOps,
				) as GetCurrentUserForInstanceFn,
				getAzureResourcesForUserFn: providerApis.azureDevOps.getCollectionsForUser.bind(
					providerApis.azureDevOps,
				) as GetAzureResourcesForUserFn,
				getAzureProjectsForResourceFn: providerApis.azureDevOps.getAzureProjects.bind(
					providerApis.azureDevOps,
				) as GetAzureProjectsForResourceFn,
				getPullRequestsForReposFn: providerApis.azureDevOps.getPullRequestsForRepos.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.azureDevOps.getPullRequestsForRepo.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForRepoFn,
				getPullRequestsForAzureProjectsFn: providerApis.azureDevOps.getPullRequestsForProjects.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForAzureProjectsFn,
				getIssuesForAzureProjectFn: providerApis.azureDevOps.getIssuesForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetIssuesForAzureProjectFn,
				getReposForAzureProjectFn: providerApis.azureDevOps.getReposForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetReposForAzureProjectFn,
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
				getIssueFn: providerApis.linear.getIssue.bind(providerApis.linear) as GetIssueFn,
				getIssuesForCurrentUserFn: providerApis.linear.getIssuesForCurrentUser.bind(providerApis.linear),
				getLinearOrganizationFn: providerApis.linear.getLinearOrganization.bind(providerApis.linear),
				getLinearTeamsForCurrentUserFn: providerApis.linear.getTeamsForCurrentUser.bind(providerApis.linear),
			},
			[IssuesCloudHostIntegrationId.Trello]: {
				...providersMetadata[IssuesCloudHostIntegrationId.Trello],
				provider: providerApis.trello,
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
		options?: { createSessionIfNeeded?: boolean },
	): Promise<TokenWithInfo<T> | undefined> {
		const providerDescriptor = { domain: provider.domain, scopes: provider.scopes };
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

		const tokenWithInfo = tokenOptInfo?.accessToken
			? tokenOptInfo
			: await this.getProviderToken<T>(provider as ProviderInfo & { id: T });
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
			  ) => Promise<{ data: NonNullable<T>[]; pageInfo?: PageInfo }>)
			| undefined,
		tokenWithInfo: TokenWithInfo,
		cursor: string = '{}',
		isPAT: boolean = false,
		baseUrl?: string,
	): Promise<PagedResult<T>> {
		let cursorInfo;
		try {
			cursorInfo = JSON.parse(cursor);
		} catch {
			cursorInfo = {};
		}
		const cursorValue = cursorInfo.value;
		const cursorType = cursorInfo.type;
		let cursorOrPage = {};
		if (cursorType === 'page') {
			cursorOrPage = { page: cursorValue };
		} else if (cursorType === 'cursor') {
			cursorOrPage = { cursor: cursorValue };
		}

		const input = {
			...args,
			...cursorOrPage,
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

			const hasMore = result.pageInfo?.hasNextPage ?? false;

			let nextCursor = '{}';
			if (result.pageInfo?.endCursor != null) {
				nextCursor = JSON.stringify({ value: result.pageInfo?.endCursor, type: 'cursor' });
			} else if (result.pageInfo?.nextPage != null) {
				nextCursor = JSON.stringify({ value: result.pageInfo?.nextPage, type: 'page' });
			}

			return {
				values: result.data,
				paging: {
					cursor: nextCursor,
					more: hasMore,
				},
			};
		} catch (e) {
			return this.handleProviderError<PagedResult<T>>(tokenWithInfo, e);
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
	): Promise<ProviderBitbucketResource[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketResourcesForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (await provider.getBitbucketResourcesForCurrentUserFn?.({}, { token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderBitbucketResource[] | undefined>(tokenWithInfo, e);
		}
	}

	async getBitbucketPullRequestsAuthoredByUserForWorkspace(
		tokenOptInfo: TokenWithInfo<GitCloudHostIntegrationId.Bitbucket>,
		userId: string,
		workspaceSlug: string,
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketPullRequestsAuthoredByUserForWorkspaceFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (
				await provider.getBitbucketPullRequestsAuthoredByUserForWorkspaceFn?.(
					{ userId: userId, workspaceSlug: workspaceSlug },
					{ token: token },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getBitbucketServerPullRequestsForCurrentUser(
		tokenOptInfo: TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>,
		baseUrl: string,
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getBitbucketServerPullRequestsForCurrentUserFn',
		);
		const token = tokenWithInfo.accessToken;
		try {
			return (
				await provider.getBitbucketServerPullRequestsForCurrentUserFn?.({}, { token: token, baseUrl: baseUrl })
			)?.data;
		} catch (e) {
			return this.handleProviderError(tokenWithInfo, e);
		}
	}

	async getJiraProjectsForResources(
		tokenOptInfo: TokenWithInfo<IssuesCloudHostIntegrationId.Jira>,
		resourceIds: string[],
	): Promise<ProviderJiraProject[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getJiraProjectsForResourcesFn',
		);
		const token = tokenWithInfo.accessToken;

		try {
			return (await provider.getJiraProjectsForResourcesFn?.({ resourceIds: resourceIds }, { token: token }))
				?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraProject[] | undefined>(tokenWithInfo, e);
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

	async getPullRequestsForRepos(
		tokenOptInfo: TokenOptInfo,
		reposOrIds: ProviderReposInput,
		options?: GetPullRequestsOptions & { isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderPullRequest>> {
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
	): Promise<PagedResult<ProviderPullRequest>> {
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
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		tokenWithInfo: TokenWithInfo<Exclude<IntegrationIds, GitCloudHostIntegrationId.Bitbucket>>,
		username: string,
		options?: { isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		tokenOptInfo: TokenWithInfo,
		usernameOrId: string,
		options?: { isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>> {
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
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, tokenWithInfo } = await this.ensureProviderTokenAndFunction(
			tokenOptInfo,
			'getPullRequestsForAzureProjectsFn',
		);
		const token = tokenWithInfo.accessToken;

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

		try {
			return (
				await provider.getPullRequestsForAzureProjectsFn?.(
					{ projects: projects, ...options },
					{ token: azureToken, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderPullRequest[]>(tokenWithInfo, e);
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
async function parseFetchResponseForApi<T>(response: FetchResponse): Promise<ProviderRequestResponse<T>> {
	const contentType = response.headers.get('content-type') || '';
	let body = null;

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
