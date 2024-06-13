import ProviderApis from '@gitkraken/provider-apis';
import type { Container } from '../../../container';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	ProviderRequestClientError,
	ProviderRequestRateLimitError,
} from '../../../errors';
import type { PagedResult } from '../../../git/gitProvider';
import { base64 } from '../../../system/string';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthentication';
import type {
	GetAzureProjectsForResourceFn,
	GetAzureResourcesForUserFn,
	GetCurrentUserFn,
	GetCurrentUserForInstanceFn,
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
	IntegrationId,
	IssueFilter,
	PageInfo,
	PagingMode,
	ProviderAccount,
	ProviderAzureProject,
	ProviderAzureResource,
	ProviderInfo,
	ProviderIssue,
	ProviderJiraProject,
	ProviderJiraResource,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
	Providers,
	PullRequestFilter,
} from './models';
import { HostingIntegrationId, IssueIntegrationId, providersMetadata, SelfHostedIntegrationId } from './models';

export class ProvidersApi {
	private readonly providers: Providers;

	constructor(
		private readonly container: Container,
		private readonly authenticationService: IntegrationAuthenticationService,
	) {
		const providerApis = ProviderApis();
		this.providers = {
			[HostingIntegrationId.GitHub]: {
				...providersMetadata[HostingIntegrationId.GitHub],
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
			[SelfHostedIntegrationId.GitHubEnterprise]: {
				...providersMetadata[SelfHostedIntegrationId.GitHubEnterprise],
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
			[HostingIntegrationId.GitLab]: {
				...providersMetadata[HostingIntegrationId.GitLab],
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
			[SelfHostedIntegrationId.GitLabSelfHosted]: {
				...providersMetadata[SelfHostedIntegrationId.GitLabSelfHosted],
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
			[HostingIntegrationId.Bitbucket]: {
				...providersMetadata[HostingIntegrationId.Bitbucket],
				provider: providerApis.bitbucket,
				getCurrentUserFn: providerApis.bitbucket.getCurrentUser.bind(
					providerApis.bitbucket,
				) as GetCurrentUserFn,
				getPullRequestsForReposFn: providerApis.bitbucket.getPullRequestsForRepos.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForReposFn,
				getPullRequestsForUserFn: providerApis.bitbucket.getPullRequestsForUser.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForUserFn,
				getPullRequestsForRepoFn: providerApis.bitbucket.getPullRequestsForRepo.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForRepoFn,
			},
			[HostingIntegrationId.AzureDevOps]: {
				...providersMetadata[HostingIntegrationId.AzureDevOps],
				provider: providerApis.azureDevOps,
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
			},
			[IssueIntegrationId.Jira]: {
				...providersMetadata[IssueIntegrationId.Jira],
				provider: providerApis.jira,
				getCurrentUserForResourceFn: providerApis.jira.getCurrentUserForResource.bind(providerApis.jira),
				getJiraResourcesForCurrentUserFn: providerApis.jira.getJiraResourcesForCurrentUser.bind(
					providerApis.jira,
				),
				getJiraProjectsForResourcesFn: providerApis.jira.getJiraProjectsForResources.bind(providerApis.jira),
				getIssueFn: providerApis.jira.getIssue.bind(providerApis.jira),
				getIssuesForProjectFn: providerApis.jira.getIssuesForProject.bind(providerApis.jira),
				getIssuesForResourceForCurrentUserFn: providerApis.jira.getIssuesForResourceForCurrentUser.bind(
					providerApis.jira,
				),
			},
			[IssueIntegrationId.Trello]: {
				...providersMetadata[IssueIntegrationId.Trello],
				provider: providerApis.trello,
			},
		};
	}

	getScopesForProvider(providerId: IntegrationId): string[] | undefined {
		return this.providers[providerId]?.scopes;
	}

	getProviderDomain(providerId: IntegrationId): string | undefined {
		return this.providers[providerId]?.domain;
	}

	getProviderPullRequestsPagingMode(providerId: IntegrationId): PagingMode | undefined {
		return this.providers[providerId]?.pullRequestsPagingMode;
	}

	getProviderIssuesPagingMode(providerId: IntegrationId): PagingMode | undefined {
		return this.providers[providerId]?.issuesPagingMode;
	}

	providerSupportsPullRequestFilters(providerId: IntegrationId, filters: PullRequestFilter[]): boolean {
		return (
			this.providers[providerId]?.supportedPullRequestFilters != null &&
			filters.every(filter => this.providers[providerId]?.supportedPullRequestFilters?.includes(filter))
		);
	}

	providerSupportsIssueFilters(providerId: IntegrationId, filters: IssueFilter[]): boolean {
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
		const providerDescriptor =
			provider.domain == null || provider.scopes == null
				? undefined
				: { domain: provider.domain, scopes: provider.scopes };
		try {
			return (
				await this.authenticationService.getSession(provider.id, providerDescriptor, {
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
		providerId: IntegrationId,
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

	private handleProviderError<T>(providerId: IntegrationId, token: string, error: any): T {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		switch (providerId) {
			case IssueIntegrationId.Jira: {
				if (error?.response?.status != null) {
					if (error.response.status === 401) {
						throw new AuthenticationError(providerId, AuthenticationErrorReason.Forbidden, error);
					} else if (error.response.status === 429) {
						let resetAt: number | undefined;

						const reset = error.response.headers?.['x-ratelimit-reset'];
						if (reset != null) {
							resetAt = parseInt(reset, 10);
							if (Number.isNaN(resetAt)) {
								resetAt = undefined;
							}
						}

						throw new ProviderRequestRateLimitError(error, token, resetAt);
					} else if (error.response.status >= 400 && error.response.status < 500) {
						throw new ProviderRequestClientError(error);
					}
				}
				throw error;
			}
			default: {
				throw error;
			}
		}
	}

	async getPagedResult<T>(
		provider: ProviderInfo,
		args: any,
		providerFn:
			| ((
					input: any,
					options?: { token?: string; isPAT?: boolean },
			  ) => Promise<{ data: NonNullable<T>[]; pageInfo?: PageInfo }>)
			| undefined,
		token: string,
		cursor: string = '{}',
		usePAT: boolean = false,
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

		const result = await providerFn?.(input, { token: token, isPAT: usePAT });
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
	}

	async getCurrentUser(
		providerId: IntegrationId,
		options?: { accessToken?: string; isPAT?: boolean },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserFn',
			options?.accessToken,
		);

		try {
			return (await provider.getCurrentUserFn?.({}, { token: token, isPAT: options?.isPAT }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(providerId, token, e);
		}
	}

	async getCurrentUserForInstance(
		providerId: IntegrationId,
		namespace: string,
		options?: { accessToken?: string; isPAT?: boolean },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserForInstanceFn',
			options?.accessToken,
		);

		return (
			await provider.getCurrentUserForInstanceFn?.(
				{ namespace: namespace },
				{ token: token, isPAT: options?.isPAT },
			)
		)?.data;
	}

	async getCurrentUserForResource(
		providerId: IntegrationId,
		resourceId: string,
		options?: { accessToken?: string },
	): Promise<ProviderAccount | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getCurrentUserForResourceFn',
			options?.accessToken,
		);

		try {
			return (await provider.getCurrentUserForResourceFn?.({ resourceId: resourceId }, { token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAccount>(providerId, token, e);
		}
	}

	async getJiraResourcesForCurrentUser(options?: {
		accessToken?: string;
	}): Promise<ProviderJiraResource[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			IssueIntegrationId.Jira,
			'getJiraResourcesForCurrentUserFn',
			options?.accessToken,
		);

		try {
			return (await provider.getJiraResourcesForCurrentUserFn?.({ token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraResource[] | undefined>(IssueIntegrationId.Jira, token, e);
		}
	}

	async getAzureResourcesForUser(
		userId: string,
		options?: { accessToken?: string },
	): Promise<ProviderAzureResource[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			HostingIntegrationId.AzureDevOps,
			'getAzureResourcesForUserFn',
			options?.accessToken,
		);

		try {
			return (await provider.getAzureResourcesForUserFn?.({ userId: userId }, { token: token }))?.data;
		} catch (e) {
			return this.handleProviderError<ProviderAzureResource[] | undefined>(
				HostingIntegrationId.AzureDevOps,
				token,
				e,
			);
		}
	}

	async getJiraProjectsForResources(
		resourceIds: string[],
		options?: { accessToken?: string },
	): Promise<ProviderJiraProject[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			IssueIntegrationId.Jira,
			'getJiraProjectsForResourcesFn',
			options?.accessToken,
		);

		try {
			return (await provider.getJiraProjectsForResourcesFn?.({ resourceIds: resourceIds }, { token: token }))
				?.data;
		} catch (e) {
			return this.handleProviderError<ProviderJiraProject[] | undefined>(IssueIntegrationId.Jira, token, e);
		}
	}

	async getAzureProjectsForResource(
		namespace: string,
		options?: { accessToken?: string; cursor?: string; isPAT?: boolean },
	): Promise<PagedResult<ProviderAzureProject>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			HostingIntegrationId.AzureDevOps,
			'getAzureProjectsForResourceFn',
			options?.accessToken,
		);

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

		try {
			return this.getPagedResult<ProviderAzureProject>(
				provider,
				{ namespace: namespace, ...options },
				provider.getAzureProjectsForResourceFn,
				azureToken,
				options?.cursor,
				true,
			);
		} catch (e) {
			return this.handleProviderError<PagedResult<ProviderAzureProject>>(
				HostingIntegrationId.AzureDevOps,
				token,
				e,
			);
		}
	}

	async getReposForAzureProject(
		namespace: string,
		project: string,
		options?: GetReposOptions & { accessToken?: string },
	): Promise<PagedResult<ProviderRepository>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			HostingIntegrationId.AzureDevOps,
			'getReposForAzureProjectFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderRepository>(
			provider,
			{ namespace: namespace, project: project, ...options },
			provider.getReposForAzureProjectFn,
			token,
			options?.cursor,
		);
	}

	async getPullRequestsForRepos(
		providerId: IntegrationId,
		reposOrIds: ProviderReposInput,
		options?: GetPullRequestsOptions & { accessToken?: string },
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
		);
	}

	async getPullRequestsForRepo(
		providerId: IntegrationId,
		repo: ProviderRepoInput,
		options?: GetPullRequestsOptions & { accessToken?: string },
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
		);
	}

	async getPullRequestsForUser(
		providerId: HostingIntegrationId.Bitbucket,
		userId: string,
		options?: { accessToken?: string } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		providerId: Exclude<IntegrationId, HostingIntegrationId.Bitbucket>,
		username: string,
		options?: { accessToken?: string } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>>;
	async getPullRequestsForUser(
		providerId: IntegrationId,
		usernameOrId: string,
		options?: { accessToken?: string } & GetPullRequestsForUserOptions,
	): Promise<PagedResult<ProviderPullRequest>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getPullRequestsForUserFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderPullRequest>(
			provider,
			{
				...(providerId === HostingIntegrationId.Bitbucket
					? { userId: usernameOrId }
					: { username: usernameOrId }),
				...options,
			},
			provider.getPullRequestsForUserFn,
			token,
			options?.cursor,
		);
	}

	async getPullRequestsForAzureProjects(
		projects: { namespace: string; project: string }[],
		options?: { accessToken?: string; authorLogin?: string; assigneeLogins?: string[]; isPAT?: boolean },
	): Promise<ProviderPullRequest[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			HostingIntegrationId.AzureDevOps,
			'getPullRequestsForAzureProjectsFn',
			options?.accessToken,
		);

		// Azure only supports PAT for this call
		const azureToken = options?.isPAT ? token : this.getAzurePATForOAuthToken(token);

		try {
			return (
				await provider.getPullRequestsForAzureProjectsFn?.(
					{ projects: projects, ...options },
					{ token: azureToken, isPAT: true },
				)
			)?.data;
		} catch (e) {
			return this.handleProviderError<ProviderPullRequest[]>(HostingIntegrationId.AzureDevOps, token, e);
		}
	}

	async getIssuesForRepos(
		providerId: IntegrationId,
		reposOrIds: ProviderReposInput,
		options?: GetIssuesOptions & { accessToken?: string },
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
		);
	}

	async getIssuesForRepo(
		providerId: IntegrationId,
		repo: ProviderRepoInput,
		options?: GetIssuesOptions & { accessToken?: string },
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
		);
	}

	async getIssuesForAzureProject(
		namespace: string,
		project: string,
		options?: GetIssuesOptions & { accessToken?: string },
	): Promise<PagedResult<ProviderIssue>> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			HostingIntegrationId.AzureDevOps,
			'getIssuesForAzureProjectFn',
			options?.accessToken,
		);

		return this.getPagedResult<ProviderIssue>(
			provider,
			{ namespace: namespace, project: project, ...options },
			provider.getIssuesForAzureProjectFn,
			token,
			options?.cursor,
		);
	}

	async getIssuesForProject(
		providerId: IntegrationId,
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
				{ project: project, resourceId: resourceId, ...options },
				{ token: token },
			);

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue[] | undefined>(providerId, token, e);
		}
	}

	async getIssuesForResourceForCurrentUser(
		providerId: IntegrationId,
		resourceId: string,
		options?: { accessToken?: string },
	): Promise<ProviderIssue[] | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssuesForResourceForCurrentUserFn',
			options?.accessToken,
		);

		try {
			const result = await provider.getIssuesForResourceForCurrentUserFn?.(
				{ resourceId: resourceId },
				{ token: token },
			);

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue[] | undefined>(providerId, token, e);
		}
	}

	async getIssue(
		providerId: IntegrationId,
		resourceId: string,
		issueId: string,
		options?: { accessToken?: string },
	): Promise<ProviderIssue | undefined> {
		const { provider, token } = await this.ensureProviderTokenAndFunction(
			providerId,
			'getIssueFn',
			options?.accessToken,
		);

		try {
			const result = await provider.getIssueFn?.({ resourceId: resourceId, number: issueId }, { token: token });

			return result?.data;
		} catch (e) {
			return this.handleProviderError<ProviderIssue | undefined>(providerId, token, e);
		}
	}
}
