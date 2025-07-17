import ProviderApis from '@gitkraken/provider-apis';
import { version as codeVersion, env } from 'vscode';
import type { Response as FetchResponse } from '@env/fetch';
import { fetch as _fetch, getProxyAgent } from '@env/fetch';
import { getPlatform } from '@env/platform';
import type { IntegrationIds } from '../../../constants.integrations';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
} from '../../../constants.integrations';
import type { Container } from '../../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '../../../errors';
import type { PagedResult } from '../../../git/gitProvider';
import type { PullRequest, PullRequestMergeMethod } from '../../../git/models/pullRequest';
import { base64 } from '../../../system/string';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService';
import type {
	GetAzureProjectsForResourceFn,
	GetAzureResourcesForUserFn,
	GetBitbucketPullRequestsAuthoredByUserForWorkspaceFn,
	GetBitbucketResourcesForUserFn,
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
	PagingMode,
	ProviderAccount,
	ProviderAzureProject,
	ProviderAzureResource,
	ProviderBitbucketResource,
	ProviderInfo,
	ProviderIssue,
	ProviderJiraProject,
	ProviderJiraResource,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
	ProviderRequestFunction,
	ProviderRequestOptions,
	ProviderRequestResponse,
	Providers,
	PullRequestFilter,
} from './models';
import { providersMetadata } from './models';

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
				getBitbucketResourcesForUserFn: providerApis.bitbucket.getWorkspacesForUser.bind(
					providerApis.bitbucket,
				) as GetBitbucketResourcesForUserFn,
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

	private async getProviderToken(
		provider: ProviderInfo,
		options?: { createSessionIfNeeded?: boolean },
	): Promise<string | undefined> {
		const providerDescriptor = { domain: provider.domain, scopes: provider.scopes };
		try {
			const authProvider = await this.authenticationService.get(provider.id);
			return (
				await authProvider.getSession(providerDescriptor, {
					createIfNeeded: options?.createSessionIfNeeded,
				})
			)?.accessToken;
		} catch {
			return undefined;
		}
	}

	private getAzurePATForOAuthToken(oauthToken: string) {
		return base64(`PAT:${oauthToken}`);
	}

	private async ensureProviderTokenAndFunction(
		providerId: IntegrationIds,
		providerFn: keyof ProviderInfo,
		accessToken?: string,
	): Promise<{ provider: ProviderInfo; token: string }> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = accessToken ?? (await this.getProviderToken(provider));
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider[providerFn] == null) {
			throw new Error(`Provider with id ${providerId} does not support function: ${providerFn}`);
		}

		return { provider: provider, token: token };
	}

	private handleProviderError<T>(providerId: IntegrationIds, token: string, error: any): T {
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
					throw new AuthenticationError(providerId, AuthenticationErrorReason.Unauthorized, error);
				case 403: // Forbidden
					throw new AuthenticationError(providerId, AuthenticationErrorReason.Forbidden, error);
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
		provider: ProviderInfo,
		args: any,
		providerFn:
			| ((
					input: any,
					options?: { token?: string; isPAT?: boolean; baseUrl?: string },
			  ) => Promise<{ data: NonNullable<T>[]; pageInfo?: PageInfo }>)
			| undefined,
		token: string,
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
			const result = await providerFn?.(input, { token: token, isPAT: isPAT, baseUrl: baseUrl });
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
			return this.handleProviderError<PagedResult<T>>(provider.id, token, e);
		}
	}

	async getRepo(
		providerId: IntegrationIds,
		owner: string,
		name: string,
		project?: string,
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderRepository | undefined> {
		if (providerId === GitCloudHostIntegrationId.AzureDevOps && project != null) {
			const { provider, token } = await this.ensureProviderTokenAndFunction(
				providerId,
				'getRepoOfProjectFn',
				options?.accessToken,
			);

			try {
				const result = await provider['getRepoOfProjectFn']?.(
					{ namespace: owner, name: name, project: project },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				);
				return result?.data;
			} catch (e) {
				return this.handleProviderError<ProviderRepository>(providerId, token, e);
			}
		} else {
			const { provider, token } = await this.ensureProviderTokenAndFunction(
				providerId,
				'getRepoFn',
				options?.accessToken,
			);

			try {
				const result = await provider['getRepoFn']?.(
					{ namespace: owner, name: name, project: project },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				);
				return result?.data;
			} catch (e) {
				return this.handleProviderError<ProviderRepository>(providerId, token, e);
			}
		}
	}

	async getCurrentUser(
		providerId: IntegrationIds,
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserFn',
			options?.accessToken,
		);

		try {
			return (
				await provider.getCurrentUserFn?.(
					{},
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(providerId, token, e);
		}
	}

	async getCurrentUserForInstance(
		providerId: IntegrationIds,
		namespace: string,
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserForInstanceFn',
			options?.accessToken,
		);

		return (
			await provider.getCurrentUserForInstanceFn?.(
				{ namespace: namespace },
				{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
			)
		)?.data;
	}

	async getCurrentUserForResource(
		providerId: IntegrationIds,
		resourceId: string,
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserForResourceFn',
			options?.accessToken,
		);

		try {
			return (
				await provider.getCurrentUserForResourceFn?.(
					{ resourceId: resourceId },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(providerId, token, e);
		}
	}

	async getJiraResourcesForCurrentUser(options?: {
		accessToken?: string;
	}): Promise<ProviderJiraResource[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			IssuesCloudHostIntegrationId.Jira,
			'getJiraResourcesForCurrentUserFn',
			options?.accessToken,
		);

		try {
			return (await provider.getJiraResourcesForCurrentUserFn?.({ token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraResource[] | undefined>(
				IssuesCloudHostIntegrationId.Jira,
				token,
				e,
			);
		}
	}

	async getAzureResourcesForUser(
		userId: string,
		integrationId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderAzureResource[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			integrationId,
			'getAzureResourcesForUserFn',
			options?.accessToken,
		);

		try {
			return (
				await provider.getAzureResourcesForUserFn?.(
					{ userId: userId },
					{ token: token, isPAT: options?.isPAT, baseUrl: options?.baseUrl },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAzureResource[] | undefined>(
				GitCloudHostIntegrationId.AzureDevOps,
				token,
				e,
			);
		}
	}

	async getBitbucketResourcesForUser(
		userId: string,
		options?: { accessToken?: string },
	): Promise<ProviderBitbucketResource[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			GitCloudHostIntegrationId.Bitbucket,
			'getBitbucketResourcesForUserFn',
			options?.accessToken,
		);

		try {
			return (await provider.getBitbucketResourcesForUserFn?.({ userId: userId }, { token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderBitbucketResource[] | undefined>(
				GitCloudHostIntegrationId.Bitbucket,
				token,
				e,
			);
		}
	}

	async getBitbucketPullRequestsAuthoredByUserForWorkspace(
		userId: string,
		workspaceSlug: string,
		options?: { accessToken?: string },
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			GitCloudHostIntegrationId.Bitbucket,
			'getBitbucketPullRequestsAuthoredByUserForWorkspaceFn',
			options?.accessToken,
		);

		try {
			return (
				await provider.getBitbucketPullRequestsAuthoredByUserForWorkspaceFn?.(
					{ userId: userId, workspaceSlug: workspaceSlug },
					{ token: token },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError(GitCloudHostIntegrationId.Bitbucket, token, e);
		}
	}

	async getBitbucketServerPullRequestsForCurrentUser(
		baseUrl: string,
		options?: {
			accessToken?: string;
		},
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			GitSelfManagedHostIntegrationId.BitbucketServer,
			'getBitbucketServerPullRequestsForCurrentUserFn',
			options?.accessToken,
		);
		try {
			return (
				await provider.getBitbucketServerPullRequestsForCurrentUserFn?.({}, { token: token, baseUrl: baseUrl })
			)?.data;
		} catch (e) {
			return this.handleProviderError(GitSelfManagedHostIntegrationId.BitbucketServer, token, e);
		}
	}

	async getJiraProjectsForResources(
		resourceIds: string[],
		options?: { accessToken?: string },
	): Promise<ProviderJiraProject[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			IssuesCloudHostIntegrationId.Jira,
			'getJiraProjectsForResourcesFn',
			options?.accessToken,
		);

		try {
			return (await provider.getJiraProjectsForResourcesFn?.({ resourceIds: resourceIds }, { token: token }))
				?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraProject[] | undefined>(
				IssuesCloudHostIntegrationId.Jira,
				token,
				e,
			);
		}
	}

	async getAzureProjectsForResource(
		namespace: string,
		integrationId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		options?: { accessToken?: string; cursor?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderAzureProject>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			integrationId,
			'getAzureProjectsForResourceFn',
			options?.accessToken,
		);

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

		try {
			return await this.getPagedResult<ProviderAzureProject>(
				provider,
				{ namespace: namespace, ...options },
				provider.getAzureProjectsForResourceFn,
				azureToken,
				options?.cursor,
				options?.isPAT,
				options?.baseUrl,
			);
		} catch (e) {
			return this.handleProviderError<PagedResult<ProviderAzureProject>>(
				GitCloudHostIntegrationId.AzureDevOps,
				token,
				e,
			);
		}
	}

	async getReposForAzureProject(
		namespace: string,
		project: string,
		integrationId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		options?: GetReposOptions & { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			integrationId,
			'getReposForAzureProjectFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderRepository>(
			provider,
			{ namespace: namespace, project: project, ...options },
			provider.getReposForAzureProjectFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForRepos(
		providerId: IntegrationIds,
		reposOrIds: ProviderReposInput,
		options?: GetPullRequestsOptions & { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderPullRequest>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getPullRequestsForReposFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderPullRequest>(
			provider,
			{
				...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
				...options,
			},
			provider.getPullRequestsForReposFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForRepo(
		providerId: IntegrationIds,
		repo: ProviderRepoInput,
		options?: GetPullRequestsOptions & { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderPullRequest>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getPullRequestsForRepoFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderPullRequest>(
			provider,
			{ repo: repo, ...options },
			provider.getPullRequestsForRepoFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForUser(
		providerId: GitCloudHostIntegrationId.Bitbucket,
		userId: string,
		options?: { accessToken?: string; isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		providerId: Exclude<IntegrationIds, GitCloudHostIntegrationId.Bitbucket>,
		username: string,
		options?: { accessToken?: string; isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		providerId: IntegrationIds,
		usernameOrId: string,
		options?: { accessToken?: string; isPAT?: boolean } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getPullRequestsForUserFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderPullRequest>(
			provider,
			{
				...(providerId === GitCloudHostIntegrationId.Bitbucket
					? { userId: usernameOrId }
					: { username: usernameOrId }),
				...options,
			},
			provider.getPullRequestsForUserFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getPullRequestsForAzureProjects(
		projects: { namespace: string; project: string }[],
		integrationId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		options?: {
			accessToken?: string;
			authorLogin?: string;
			assigneeLogins?: string[];
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			integrationId,
			'getPullRequestsForAzureProjectsFn',
			options?.accessToken,
		);

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
			return this.handleProviderError<ProviderPullRequest[]>(GitCloudHostIntegrationId.AzureDevOps, token, e);
		}
	}

	async mergePullRequest(
		providerId: IntegrationIds,
		pr: PullRequest,
		options?: {
			accessToken?: string;
			mergeMethod?: PullRequestMergeMethod;
			isPAT?: boolean;
			baseUrl?: string;
		},
	): Promise<boolean> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'mergePullRequestFn',
			options?.accessToken,
		);
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
			return this.handleProviderError<boolean>(providerId, token, e);
		}
	}

	async getIssuesForRepos(
		providerId: IntegrationIds,
		reposOrIds: ProviderReposInput,
		options?: GetIssuesOptions & { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForReposFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderIssue>(
			provider,
			{
				...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
				...options,
			},
			provider.getIssuesForReposFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForRepo(
		providerId: IntegrationIds,
		repo: ProviderRepoInput,
		options?: GetIssuesOptions & { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForRepoFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderIssue>(
			provider,
			{ repo: repo, ...options },
			provider.getIssuesForRepoFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssuesForAzureProject(
		providerId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		namespace: string,
		project: string,
		options?: GetIssuesOptions & { accessToken?: string; isPAT?: boolean },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForAzureProjectFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderIssue>(
			provider,
			{ namespace: namespace, project: project, ...options },
			provider.getIssuesForAzureProjectFn,
			token,
			options?.cursor,
			options?.isPAT,
		);
	}

	async getIssuesForProject(
		providerId: IntegrationIds,
		project: string,
		resourceId: string,
		options?: GetIssuesOptions & { accessToken?: string },
	): Promise<ProviderIssue[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForProjectFn',
			options?.accessToken,
		);

		try {
			const result = await provider.getIssuesForProjectFn?.(
				{ projectKey: project, resourceId: resourceId, ...options },
				{ token: token },
			);

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue[] | undefined>(providerId, token, e);
		}
	}

	async getIssuesForResourceForCurrentUser(
		providerId: IntegrationIds,
		resourceId: string,
		options?: { accessToken?: string; cursor?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForResourceForCurrentUserFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderIssue>(
			provider,
			{ resourceId: resourceId },
			provider.getIssuesForResourceForCurrentUserFn,
			token,
			options?.cursor,
			options?.isPAT,
			options?.baseUrl,
		);
	}

	async getIssue(
		providerId: IntegrationIds,
		input: { resourceId: string; number: string } | { namespace: string; name: string; number: string },
		options?: { accessToken?: string; isPAT?: boolean; baseUrl?: string },
	): Promise<ProviderIssue | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssueFn',
			options?.accessToken,
		);

		try {
			const result = await provider.getIssueFn?.(input, {
				token: token,
				isPAT: options?.isPAT,
				baseUrl: options?.baseUrl,
			});

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue | undefined>(providerId, token, e);
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
