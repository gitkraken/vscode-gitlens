/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { CancellationToken } from 'vscode';
import type { IntegrationIds } from '../../../constants.integrations';
import { GitCloudHostIntegrationId } from '../../../constants.integrations';
import type { PagedResult } from '../../../git/gitProvider';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { IssueOrPullRequestState as PullRequestState } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { ResourceDescriptor } from '../../../git/models/resourceDescriptor';
import type { PullRequestUrlIdentity } from '../../../git/utils/pullRequest.utils';
import { gate } from '../../../system/decorators/-webview/gate';
import { debug } from '../../../system/decorators/log';
import { first } from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ProviderAuthenticationSession } from '../authentication/models';
import type {
	GetIssuesOptions,
	GetPullRequestsOptions,
	PagedProjectInput,
	PagedRepoInput,
	ProviderAccount,
	ProviderIssue,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	ProviderRepository,
} from '../providers/models';
import { IssueFilter, PagingMode, PullRequestFilter } from '../providers/models';
import type { Integration, IntegrationResult, IntegrationType } from './integration';
import { IntegrationBase } from './integration';

export function isGitHostIntegration(integration: Integration): integration is GitHostIntegration {
	return integration.type === 'git';
}

export abstract class GitHostIntegration<
	ID extends IntegrationIds = IntegrationIds,
	T extends ResourceDescriptor = ResourceDescriptor,
> extends IntegrationBase<ID> {
	readonly type: IntegrationType = 'git';

	@gate()
	@debug()
	async getAccountForEmail(repo: T, email: string, options?: { avatarSize?: number }): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const author = await this.getProviderAccountForEmail(this._session!, repo, email, options);
			this.resetRequestExceptionCount('getAccountForEmail');
			return author;
		} catch (ex) {
			this.handleProviderException('getAccountForEmail', ex, { scope: scope });
			return undefined;
		}
	}

	protected abstract getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: T,
		email: string,
		options?: { avatarSize?: number },
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getAccountForCommit(
		repo: T,
		rev: string,
		options?: { avatarSize?: number },
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const author = await this.getProviderAccountForCommit(this._session!, repo, rev, options);
			this.resetRequestExceptionCount('getAccountForCommit');
			return author;
		} catch (ex) {
			this.handleProviderException('getAccountForCommit', ex, { scope: scope });
			return undefined;
		}
	}

	protected abstract getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		rev: string,
		options?: { avatarSize?: number },
	): Promise<Account | UnidentifiedAuthor | undefined>;

	@debug()
	async getDefaultBranch(
		repo: T,
		options?: { cancellation?: CancellationToken; expiryOverride?: boolean | number },
	): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const defaultBranch = this.container.cache.getRepositoryDefaultBranch(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderDefaultBranch(this._session!, repo, options?.cancellation);
						this.resetRequestExceptionCount('getDefaultBranch');
						return result;
					} catch (ex) {
						this.handleProviderException('getDefaultBranch', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return defaultBranch;
	}

	getRepoInfo?(repo: { owner: string; name: string; project?: string }): Promise<ProviderRepository | undefined>;

	protected abstract getProviderDefaultBranch(
		{ accessToken }: ProviderAuthenticationSession,
		repo: T,
		cancellation?: CancellationToken,
	): Promise<DefaultBranch | undefined>;

	@debug()
	async getRepositoryMetadata(
		repo: T,
		options?: { cancellation?: CancellationToken; expiryOverride?: boolean | number },
	): Promise<RepositoryMetadata | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const metadata = this.container.cache.getRepositoryMetadata(
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderRepositoryMetadata(
							this._session!,
							repo,
							options?.cancellation,
						);
						this.resetRequestExceptionCount('getRepositoryMetadata');
						return result;
					} catch (ex) {
						this.handleProviderException('getRepositoryMetadata', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: options?.expiryOverride },
		);
		return metadata;
	}

	protected abstract getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: T,
		cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined>;

	async mergePullRequest(pr: PullRequest, options?: { mergeMethod?: PullRequestMergeMethod }): Promise<boolean> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return false;

		await this.refreshSessionIfExpired(scope);

		try {
			const result = await this.mergeProviderPullRequest(this._session!, pr, options);
			this.resetRequestExceptionCount('mergePullRequest');
			return result;
		} catch (ex) {
			this.handleProviderException('mergePullRequest', ex, { scope: scope });
			return false;
		}
	}

	protected abstract mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: { mergeMethod?: PullRequestMergeMethod },
	): Promise<boolean>;

	@debug()
	async getPullRequestForBranch(
		repo: T,
		branch: string,
		options?: { avatarSize?: number; expiryOverride?: boolean | number; include?: PullRequestState[] },
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const { expiryOverride, ...opts } = options ?? {};

		const pr = this.container.cache.getPullRequestForBranch(
			branch,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForBranch(this._session!, repo, branch, opts);
						this.resetRequestExceptionCount('getPullRequestForBranch');
						return result;
					} catch (ex) {
						this.handleProviderException('getPullRequestForBranch', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			{ expiryOverride: expiryOverride },
		);
		return pr;
	}

	protected abstract getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: T,
		branch: string,
		options?: { avatarSize?: number; include?: PullRequestState[] },
	): Promise<PullRequest | undefined>;

	@debug()
	async getPullRequestForCommit(
		repo: T,
		rev: string,
		options?: { expiryOverride?: boolean | number },
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const pr = this.container.cache.getPullRequestForSha(
			rev,
			repo,
			this,
			() => ({
				value: (async () => {
					try {
						const result = await this.getProviderPullRequestForCommit(this._session!, repo, rev);
						this.resetRequestExceptionCount('getPullRequestForCommit');
						return result;
					} catch (ex) {
						this.handleProviderException('getPullRequestForCommit', ex, { scope: scope });
						return undefined;
					}
				})(),
			}),
			options,
		);
		return pr;
	}

	protected abstract getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: T,
		rev: string,
	): Promise<PullRequest | undefined>;

	async getMyIssuesForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: { filters?: IssueFilter[]; cursor?: string; customUrl?: string },
	): Promise<PagedResult<ProviderIssue> | undefined> {
		const scope = getLogScope();
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const api = await this.getProvidersApi();
		if (
			providerId !== GitCloudHostIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === GitCloudHostIntegrationId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`, 'getIssuesForRepos');
			return undefined;
		}

		let getIssuesOptions: GetIssuesOptions | undefined;
		if (providerId === GitCloudHostIntegrationId.AzureDevOps) {
			const organizations = new Set<string>();
			const projects = new Set<string>();
			for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
				organizations.add(repo.namespace);
				projects.add(repo.project!);
			}

			if (organizations.size > 1) {
				Logger.warn(`Multiple organizations not supported for provider ${providerId}`, 'getIssuesForRepos');
				return undefined;
			} else if (organizations.size === 0) {
				Logger.warn(`No organizations found for provider ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			const organization: string = first(organizations.values())!;

			if (options?.filters != null) {
				if (!api.providerSupportsIssueFilters(providerId, options.filters)) {
					Logger.warn(`Unsupported filters for provider ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				let userAccount: ProviderAccount | undefined;
				try {
					userAccount = await api.getCurrentUserForInstance(providerId, organization);
				} catch (ex) {
					Logger.error(ex, 'getIssuesForRepos');
					return undefined;
				}

				if (userAccount == null) {
					Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				const userFilterProperty = userAccount.name;

				if (userFilterProperty == null) {
					Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				getIssuesOptions = {
					authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
					assigneeLogins: options.filters.includes(IssueFilter.Assignee) ? [userFilterProperty] : undefined,
					mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
				};
			}

			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedProjectInput[] = cursorInfo.cursors ?? [];
			let projectInputs: PagedProjectInput[] = Array.from(projects.values()).map(project => ({
				namespace: organization,
				project: project,
				cursor: undefined,
			}));
			if (cursors.length > 0) {
				projectInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedProjectInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderIssue[] = [];
				await Promise.all(
					projectInputs.map(async projectInput => {
						const results = await api.getIssuesForAzureProject(
							providerId,
							projectInput.namespace,
							projectInput.project,
							{
								...getIssuesOptions,
								cursor: projectInput.cursor,
							},
						);
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({
								namespace: projectInput.namespace,
								project: projectInput.project,
								cursor: results.paging.cursor,
							});
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}
		}
		if (options?.filters != null) {
			let userAccount: ProviderAccount | undefined;
			try {
				userAccount = await api.getCurrentUser(providerId);
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			const userFilterProperty = userAccount.username;
			if (userFilterProperty == null) {
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getIssuesForRepos');
				return undefined;
			}

			getIssuesOptions = {
				authorLogin: options.filters.includes(IssueFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins: options.filters.includes(IssueFilter.Assignee) ? [userFilterProperty] : undefined,
				mentionLogin: options.filters.includes(IssueFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (api.getProviderIssuesPagingMode(providerId) === PagingMode.Repo && !api.isRepoIdsInput(reposOrRepoIds)) {
			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderIssue[] = [];
				await Promise.all(
					repoInputs.map(async repoInput => {
						const results = await api.getIssuesForRepo(providerId, repoInput.repo, {
							...getIssuesOptions,
							cursor: repoInput.cursor,
							baseUrl: options?.customUrl,
						});
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getIssuesForRepos');
				return undefined;
			}
		}

		try {
			return await api.getIssuesForRepos(providerId, reposOrRepoIds, {
				...getIssuesOptions,
				cursor: options?.cursor,
				baseUrl: options?.customUrl,
			});
		} catch (ex) {
			Logger.error(ex, 'getIssuesForRepos');
			return undefined;
		}
	}

	async getMyPullRequestsForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: { filters?: PullRequestFilter[]; cursor?: string; customUrl?: string },
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		const scope = getLogScope();
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const api = await this.getProvidersApi();
		if (
			providerId !== GitCloudHostIntegrationId.GitLab &&
			(api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === GitCloudHostIntegrationId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`);
			return undefined;
		}

		let getPullRequestsOptions: GetPullRequestsOptions | undefined;
		if (options?.filters != null) {
			if (!api.providerSupportsPullRequestFilters(providerId, options.filters)) {
				Logger.warn(`Unsupported filters for provider ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			let userAccount: ProviderAccount | undefined;
			if (providerId === GitCloudHostIntegrationId.AzureDevOps) {
				const organizations = new Set<string>();
				for (const repo of reposOrRepoIds as ProviderRepoInput[]) {
					organizations.add(repo.namespace);
				}

				if (organizations.size > 1) {
					Logger.warn(
						`Multiple organizations not supported for provider ${providerId}`,
						'getPullRequestsForRepos',
					);
					return undefined;
				} else if (organizations.size === 0) {
					Logger.warn(`No organizations found for provider ${providerId}`, 'getPullRequestsForRepos');
					return undefined;
				}

				const organization: string = first(organizations.values())!;
				try {
					userAccount = await api.getCurrentUserForInstance(providerId, organization);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return undefined;
				}
			} else {
				try {
					userAccount = await api.getCurrentUser(providerId);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return undefined;
				}
			}

			if (userAccount == null) {
				Logger.warn(`Unable to get current user for ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			let userFilterProperty: string | null;
			switch (providerId) {
				case GitCloudHostIntegrationId.Bitbucket:
				case GitCloudHostIntegrationId.AzureDevOps:
					userFilterProperty = userAccount.id;
					break;
				default:
					userFilterProperty = userAccount.username;
					break;
			}

			if (userFilterProperty == null) {
				Logger.warn(`Unable to get user property for filter for ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			getPullRequestsOptions = {
				authorLogin: options.filters.includes(PullRequestFilter.Author) ? userFilterProperty : undefined,
				assigneeLogins: options.filters.includes(PullRequestFilter.Assignee) ? [userFilterProperty] : undefined,
				reviewRequestedLogin: options.filters.includes(PullRequestFilter.ReviewRequested)
					? userFilterProperty
					: undefined,
				mentionLogin: options.filters.includes(PullRequestFilter.Mention) ? userFilterProperty : undefined,
			};
		}

		if (
			api.getProviderPullRequestsPagingMode(providerId) === PagingMode.Repo &&
			!api.isRepoIdsInput(reposOrRepoIds)
		) {
			const cursorInfo = JSON.parse(options?.cursor ?? '{}');
			const cursors: PagedRepoInput[] = cursorInfo.cursors ?? [];
			let repoInputs: PagedRepoInput[] = reposOrRepoIds.map(repo => ({ repo: repo, cursor: undefined }));
			if (cursors.length > 0) {
				repoInputs = cursors;
			}

			try {
				const cursor: { cursors: PagedRepoInput[] } = { cursors: [] };
				let hasMore = false;
				const data: ProviderPullRequest[] = [];
				await Promise.all(
					repoInputs.map(async repoInput => {
						const results = await api.getPullRequestsForRepo(providerId, repoInput.repo, {
							...getPullRequestsOptions,
							cursor: repoInput.cursor,
							baseUrl: options?.customUrl,
						});
						data.push(...results.values);
						if (results.paging?.more) {
							hasMore = true;
							cursor.cursors.push({ repo: repoInput.repo, cursor: results.paging.cursor });
						}
					}),
				);

				return {
					values: data,
					paging: {
						more: hasMore,
						cursor: JSON.stringify(cursor),
					},
				};
			} catch (ex) {
				Logger.error(ex, 'getPullRequestsForRepos');
				return undefined;
			}
		}

		try {
			return await api.getPullRequestsForRepos(providerId, reposOrRepoIds, {
				...getPullRequestsOptions,
				cursor: options?.cursor,
				baseUrl: options?.customUrl,
			});
		} catch (ex) {
			Logger.error(ex, 'getPullRequestsForRepos');
			return undefined;
		}
	}

	async searchMyPullRequests(
		repo?: T,
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	async searchMyPullRequests(
		repos?: T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>>;
	@debug()
	async searchMyPullRequests(
		repos?: T | T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<IntegrationResult<PullRequest[] | undefined>> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		const start = Date.now();
		try {
			const pullRequests = await this.searchProviderMyPullRequests(
				this._session!,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
				silent,
			);
			this.resetRequestExceptionCount('searchMyPullRequests');
			return { value: pullRequests, duration: Date.now() - start };
		} catch (ex) {
			this.handleProviderException('searchMyPullRequests', ex, {
				scope: scope,
				silent: true,
			});
			return {
				error: ex,
				duration: Date.now() - start,
			};
		}
	}

	protected abstract searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: T[],
		cancellation?: CancellationToken,
		silent?: boolean,
	): Promise<PullRequest[] | undefined>;

	async searchPullRequests(
		searchQuery: string,
		repo?: T,
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;
	async searchPullRequests(
		searchQuery: string,
		repos?: T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;
	@debug()
	async searchPullRequests(
		searchQuery: string,
		repos?: T | T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		await this.refreshSessionIfExpired(scope);

		try {
			const prs = await this.searchProviderPullRequests?.(
				this._session!,
				searchQuery,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount('searchPullRequests');
			return prs;
		} catch (ex) {
			this.handleProviderException('searchPullRequests', ex, { scope: scope });
			return undefined;
		}
	}

	protected searchProviderPullRequests?(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: T[],
		cancellation?: CancellationToken,
	): Promise<PullRequest[] | undefined>;

	getPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return this.getProviderPullRequestIdentityFromMaybeUrl?.(search);
	}

	protected getProviderPullRequestIdentityFromMaybeUrl?(search: string): PullRequestUrlIdentity | undefined;
}
