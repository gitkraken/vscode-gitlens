import ProviderApis from '@gitkraken/provider-apis';
import type { Container } from '../../../container';
import type { PagedResult } from '../../../git/gitProvider';
import type {
	getCurrentUserFn,
	getCurrentUserForInstanceFn,
	GetIssuesForAzureProjectFn,
	GetIssuesForRepoFn,
	GetIssuesForReposFn,
	GetIssuesOptions,
	GetPullRequestsForRepoFn,
	GetPullRequestsForReposFn,
	GetPullRequestsOptions,
	GetReposForAzureProjectFn,
	GetReposOptions,
	IssueFilter,
	PagingMode,
	ProviderAccount,
	ProviderInfo,
	ProviderIssue,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
	Providers,
	PullRequestFilter,
} from './models';
import { ProviderId, providersMetadata } from './models';

export class ProvidersApi {
	private readonly providers: Providers;
	constructor(private readonly container: Container) {
		const providerApis = ProviderApis();
		this.providers = {
			[ProviderId.GitHub]: {
				...providersMetadata[ProviderId.GitHub],
				provider: providerApis.github,
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github) as getCurrentUserFn,
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
			},
			[ProviderId.GitHubEnterprise]: {
				...providersMetadata[ProviderId.GitHubEnterprise],
				provider: providerApis.github,
				getCurrentUserFn: providerApis.github.getCurrentUser.bind(providerApis.github) as getCurrentUserFn,
				getPullRequestsForReposFn: providerApis.github.getPullRequestsForRepos.bind(
					providerApis.github,
				) as GetPullRequestsForReposFn,
				getIssuesForReposFn: providerApis.github.getIssuesForRepos.bind(
					providerApis.github,
				) as GetIssuesForReposFn,
			},
			[ProviderId.GitLab]: {
				...providersMetadata[ProviderId.GitLab],
				provider: providerApis.gitlab,
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab) as getCurrentUserFn,
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(
					providerApis.gitlab,
				) as GetPullRequestsForRepoFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(
					providerApis.gitlab,
				) as GetIssuesForRepoFn,
			},
			[ProviderId.GitLabSelfHosted]: {
				...providersMetadata[ProviderId.GitLabSelfHosted],
				provider: providerApis.gitlab,
				getCurrentUserFn: providerApis.gitlab.getCurrentUser.bind(providerApis.gitlab) as getCurrentUserFn,
				getPullRequestsForReposFn: providerApis.gitlab.getPullRequestsForRepos.bind(
					providerApis.gitlab,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.gitlab.getPullRequestsForRepo.bind(
					providerApis.gitlab,
				) as GetPullRequestsForRepoFn,
				getIssuesForReposFn: providerApis.gitlab.getIssuesForRepos.bind(
					providerApis.gitlab,
				) as GetIssuesForReposFn,
				getIssuesForRepoFn: providerApis.gitlab.getIssuesForRepo.bind(
					providerApis.gitlab,
				) as GetIssuesForRepoFn,
			},
			[ProviderId.Bitbucket]: {
				...providersMetadata[ProviderId.Bitbucket],
				provider: providerApis.bitbucket,
				getCurrentUserFn: providerApis.bitbucket.getCurrentUser.bind(
					providerApis.bitbucket,
				) as getCurrentUserFn,
				getPullRequestsForReposFn: providerApis.bitbucket.getPullRequestsForRepos.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.bitbucket.getPullRequestsForRepo.bind(
					providerApis.bitbucket,
				) as GetPullRequestsForRepoFn,
			},
			[ProviderId.AzureDevOps]: {
				...providersMetadata[ProviderId.AzureDevOps],
				provider: providerApis.azureDevOps,
				getCurrentUserForInstanceFn: providerApis.azureDevOps.getCurrentUserForInstance.bind(
					providerApis.azureDevOps,
				) as getCurrentUserForInstanceFn,
				getPullRequestsForReposFn: providerApis.azureDevOps.getPullRequestsForRepos.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForReposFn,
				getPullRequestsForRepoFn: providerApis.azureDevOps.getPullRequestsForRepo.bind(
					providerApis.azureDevOps,
				) as GetPullRequestsForRepoFn,
				getIssuesForAzureProjectFn: providerApis.azureDevOps.getIssuesForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetIssuesForAzureProjectFn,
				getReposForAzureProjectFn: providerApis.azureDevOps.getReposForAzureProject.bind(
					providerApis.azureDevOps,
				) as GetReposForAzureProjectFn,
			},
			[ProviderId.Jira]: {
				...providersMetadata[ProviderId.Jira],
				provider: providerApis.jira,
			},
			[ProviderId.Trello]: {
				...providersMetadata[ProviderId.Trello],
				provider: providerApis.trello,
			},
		};
	}

	getScopesForProvider(providerId: ProviderId): string[] | undefined {
		return this.providers[providerId]?.scopes;
	}

	getProviderDomain(providerId: ProviderId): string | undefined {
		return this.providers[providerId]?.domain;
	}

	getProviderPullRequestsPagingMode(providerId: ProviderId): PagingMode | undefined {
		return this.providers[providerId]?.pullRequestsPagingMode;
	}

	getProviderIssuesPagingMode(providerId: ProviderId): PagingMode | undefined {
		return this.providers[providerId]?.issuesPagingMode;
	}

	providerSupportsPullRequestFilters(providerId: ProviderId, filters: PullRequestFilter[]): boolean {
		return (
			this.providers[providerId]?.supportedPullRequestFilters != null &&
			filters.every(filter => this.providers[providerId]?.supportedPullRequestFilters?.includes(filter))
		);
	}

	providerSupportsIssueFilters(providerId: ProviderId, filters: IssueFilter[]): boolean {
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

	async getProviderToken(
		provider: ProviderInfo,
		options?: { createSessionIfNeeded?: boolean },
	): Promise<string | undefined> {
		const providerDescriptor =
			provider.domain == null || provider.scopes == null
				? undefined
				: { domain: provider.domain, scopes: provider.scopes };
		try {
			return (
				await this.container.integrationAuthentication.getSession(provider.id, providerDescriptor, {
					createIfNeeded: options?.createSessionIfNeeded,
				})
			)?.accessToken;
		} catch {
			return undefined;
		}
	}

	async getPullRequestsForRepos(
		providerId: ProviderId,
		reposOrIds: ProviderReposInput,
		options?: GetPullRequestsOptions,
	): Promise<PagedResult<ProviderPullRequest>> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getPullRequestsForReposFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting pull requests for repositories`);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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
			...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
			...options,
			...cursorOrPage,
		};

		const result = await provider.getPullRequestsForReposFn(input, { token: token, isPAT: true });
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

	async getPullRequestsForRepo(
		providerId: ProviderId,
		repo: ProviderRepoInput,
		options?: GetPullRequestsOptions,
	): Promise<PagedResult<ProviderPullRequest>> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getPullRequestsForRepoFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting pull requests for a repository`);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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

		const result = await provider.getPullRequestsForRepoFn(
			{
				repo: repo,
				...options,
				...cursorOrPage,
			},
			{ token: token, isPAT: true },
		);
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

	async getIssuesForRepos(
		providerId: ProviderId,
		reposOrIds: ProviderReposInput,
		options?: GetIssuesOptions,
	): Promise<PagedResult<ProviderIssue>> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getIssuesForReposFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting issues for repositories`);
		}

		if (provider.id === ProviderId.AzureDevOps) {
			throw new Error(
				`Provider with id ${providerId} does not support getting issues for repositories; use getIssuesForAzureProject instead`,
			);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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
			...(this.isRepoIdsInput(reposOrIds) ? { repoIds: reposOrIds } : { repos: reposOrIds }),
			...options,
			...cursorOrPage,
		};

		const result = await provider.getIssuesForReposFn(input, { token: token, isPAT: true });
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

	async getIssuesForRepo(
		providerId: ProviderId,
		repo: ProviderRepoInput,
		options?: GetIssuesOptions,
	): Promise<PagedResult<ProviderIssue>> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getIssuesForRepoFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting issues for a repository`);
		}

		if (provider.id === ProviderId.AzureDevOps) {
			throw new Error(
				`Provider with id ${providerId} does not support getting issues for a repository; use getIssuesForAzureProject instead`,
			);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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

		const result = await provider.getIssuesForRepoFn(
			{
				repo: repo,
				...options,
				...cursorOrPage,
			},
			{ token: token, isPAT: true },
		);

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

	async getIssuesForAzureProject(
		namespace: string,
		project: string,
		options?: GetIssuesOptions,
	): Promise<PagedResult<ProviderIssue>> {
		const provider = this.providers[ProviderId.AzureDevOps];
		if (provider == null) {
			throw new Error(`Provider with id ${ProviderId.AzureDevOps} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${ProviderId.AzureDevOps}`);
		}

		if (provider.getIssuesForAzureProjectFn == null) {
			throw new Error(
				`Provider with id ${ProviderId.AzureDevOps} does not support getting issues for an Azure project`,
			);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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

		const result = await provider.getIssuesForAzureProjectFn(
			{
				namespace: namespace,
				project: project,
				...options,
				...cursorOrPage,
			},
			{ token: token, isPAT: true },
		);

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

	async getReposForAzureProject(
		namespace: string,
		project: string,
		options?: GetReposOptions,
	): Promise<PagedResult<ProviderRepository>> {
		const provider = this.providers[ProviderId.AzureDevOps];
		if (provider == null) {
			throw new Error(`Provider with id ${ProviderId.AzureDevOps} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${ProviderId.AzureDevOps}`);
		}

		if (provider.getReposForAzureProjectFn == null) {
			throw new Error(
				`Provider with id ${ProviderId.AzureDevOps} does not support getting repositories for Azure projects`,
			);
		}

		let cursorInfo;
		try {
			cursorInfo = JSON.parse(options?.cursor ?? '{}');
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

		const result = await provider.getReposForAzureProjectFn(
			{
				namespace: namespace,
				project: project,
				...cursorOrPage,
			},
			{ token: token, isPAT: true },
		);

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

	async getCurrentUser(providerId: ProviderId): Promise<ProviderAccount> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getCurrentUserFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting current user`);
		}

		const { data: account } = await provider.getCurrentUserFn({ token: token, isPAT: true });
		return account;
	}

	async getCurrentUserForInstance(providerId: ProviderId, namespace: string): Promise<ProviderAccount> {
		const provider = this.providers[providerId];
		if (provider == null) {
			throw new Error(`Provider with id ${providerId} not registered`);
		}

		const token = await this.getProviderToken(provider);
		if (token == null) {
			throw new Error(`Not connected to provider ${providerId}`);
		}

		if (provider.getCurrentUserForInstanceFn == null) {
			throw new Error(`Provider with id ${providerId} does not support getting current user for an instance`);
		}

		const { data: account } = await provider.getCurrentUserForInstanceFn(
			{ namespace: namespace },
			{ token: token, isPAT: true },
		);
		return account;
	}
}
