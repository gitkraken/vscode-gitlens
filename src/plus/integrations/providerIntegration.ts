import type { AuthenticationSession, CancellationToken, Event, MessageItem } from 'vscode';
import { EventEmitter, window } from 'vscode';
import type { Container } from '../../container';
import { AuthenticationError, CancellationError, ProviderRequestClientError } from '../../errors';
import type { PagedResult } from '../../git/gitProvider';
import type { Account } from '../../git/models/author';
import type { DefaultBranch } from '../../git/models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../../git/models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../git/models/repositoryMetadata';
import { showIntegrationDisconnectedTooManyFailedRequestsWarningMessage } from '../../messages';
import { configuration } from '../../system/configuration';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../gk/account/subscription';
import type {
	IntegrationAuthenticationProviderDescriptor,
	IntegrationAuthenticationSessionDescriptor,
} from './authentication/integrationAuthentication';
import type {
	GetIssuesOptions,
	GetPullRequestsOptions,
	PagedProjectInput,
	PagedRepoInput,
	ProviderAccount,
	ProviderId,
	ProviderIssue,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderReposInput,
	SelfHostedProviderId,
} from './providers/models';
import { HostedProviderId, IssueFilter, PagingMode, PullRequestFilter } from './providers/models';
import type { ProvidersApi } from './providers/providersApi';

export type SupportedProviderIds = ProviderId;
export type SupportedHostedProviderIds = HostedProviderId;
export type SupportedSelfHostedProviderIds = SelfHostedProviderId;
export type ProviderKey = `${SupportedHostedProviderIds}` | `${SupportedSelfHostedProviderIds}:${string}`;
export type ProviderKeyById<T extends SupportedProviderIds> = T extends SupportedHostedProviderIds
	? `${SupportedHostedProviderIds}`
	: `${SupportedSelfHostedProviderIds}:${string}`;

export type RepositoryDescriptor = { key: string } & Record<string, unknown>;

export abstract class ProviderIntegration<
	ID extends SupportedProviderIds = SupportedProviderIds,
	T extends RepositoryDescriptor = RepositoryDescriptor,
> {
	private readonly _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	constructor(
		protected readonly container: Container,
		protected readonly api: ProvidersApi,
	) {}

	abstract get authProvider(): IntegrationAuthenticationProviderDescriptor;
	abstract get id(): ID;
	protected abstract get key(): ProviderKeyById<ID>;
	abstract get name(): string;
	abstract get domain(): string;

	protected get authProviderDescriptor(): IntegrationAuthenticationSessionDescriptor {
		return { domain: this.domain, scopes: this.authProvider.scopes };
	}

	get icon(): string {
		return this.id;
	}

	private get connectedKey(): `connected:${ProviderIntegration['key']}` {
		return `connected:${this.key}`;
	}

	get maybeConnected(): boolean | undefined {
		return this._session === undefined ? undefined : this._session !== null;
	}

	protected _session: AuthenticationSession | null | undefined;
	protected session() {
		if (this._session === undefined) {
			return this.ensureSession(false);
		}
		return this._session ?? undefined;
	}

	@log()
	async connect(): Promise<boolean> {
		try {
			const session = await this.ensureSession(true);
			return Boolean(session);
		} catch (ex) {
			return false;
		}
	}

	@gate()
	@log()
	async disconnect(options?: { silent?: boolean; currentSessionOnly?: boolean }): Promise<void> {
		if (options?.currentSessionOnly && this._session === null) return;

		const connected = this._session != null;

		if (connected && !options?.silent) {
			if (options?.currentSessionOnly) {
				void showIntegrationDisconnectedTooManyFailedRequestsWarningMessage(this.name);
			} else {
				const disable = { title: 'Disable' };
				const signout = { title: 'Disable & Sign Out' };
				const cancel = { title: 'Cancel', isCloseAffordance: true };

				let result: MessageItem | undefined;
				if (this.container.integrationAuthentication.supports(this.authProvider.id)) {
					result = await window.showWarningMessage(
						`Are you sure you want to disable the rich integration with ${this.name}?\n\nNote: signing out clears the saved authentication.`,
						{ modal: true },
						disable,
						signout,
						cancel,
					);
				} else {
					result = await window.showWarningMessage(
						`Are you sure you want to disable the rich integration with ${this.name}?`,
						{ modal: true },
						disable,
						cancel,
					);
				}

				if (result == null || result === cancel) return;
				if (result === signout) {
					void this.container.integrationAuthentication.deleteSession(
						this.authProvider.id,
						this.authProviderDescriptor,
					);
				}
			}
		}

		this.resetRequestExceptionCount();
		this._session = null;

		if (connected) {
			// Don't store the disconnected flag if this only for this current VS Code session (will be re-connected on next restart)
			if (!options?.currentSessionOnly) {
				void this.container.storage.storeWorkspace(this.connectedKey, false);
			}

			this._onDidChange.fire();
			if (!options?.silent && !options?.currentSessionOnly) {
				this.container.integrations.disconnected(this.key);
			}
		}
	}

	@log()
	async reauthenticate(): Promise<void> {
		if (this._session === undefined) return;

		this._session = undefined;
		void (await this.ensureSession(true, true));
	}

	refresh() {
		void this.ensureSession(false);
	}

	private requestExceptionCount = 0;

	resetRequestExceptionCount(): void {
		this.requestExceptionCount = 0;
	}

	private handleProviderException<T>(ex: Error, scope: LogScope | undefined, defaultValue: T): T {
		if (ex instanceof CancellationError) return defaultValue;

		Logger.error(ex, scope);

		if (ex instanceof AuthenticationError || ex instanceof ProviderRequestClientError) {
			this.trackRequestException();
		}
		return defaultValue;
	}

	@debug()
	trackRequestException(): void {
		this.requestExceptionCount++;

		if (this.requestExceptionCount >= 5 && this._session !== null) {
			void this.disconnect({ currentSessionOnly: true });
		}
	}

	@gate()
	@debug({ exit: true })
	async isConnected(): Promise<boolean> {
		return (await this.session()) != null;
	}

	@gate()
	@debug()
	async getAccountForCommit(
		repo: T,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForCommit(this._session!, repo, ref, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>(ex, scope, undefined);
		}
	}

	protected abstract getProviderAccountForCommit(
		session: AuthenticationSession,
		repo: T,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@gate()
	@debug()
	async getAccountForEmail(
		repo: T,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const author = await this.getProviderAccountForEmail(this._session!, repo, email, options);
			this.resetRequestExceptionCount();
			return author;
		} catch (ex) {
			return this.handleProviderException<Account | undefined>(ex, scope, undefined);
		}
	}

	protected abstract getProviderAccountForEmail(
		session: AuthenticationSession,
		repo: T,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined>;

	@debug()
	async getDefaultBranch(repo: T): Promise<DefaultBranch | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const defaultBranch = this.container.cache.getRepositoryDefaultBranch(repo, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderDefaultBranch(this._session!, repo);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<DefaultBranch | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return defaultBranch;
	}

	protected abstract getProviderDefaultBranch(
		{ accessToken }: AuthenticationSession,
		repo: T,
	): Promise<DefaultBranch | undefined>;

	@debug()
	async getRepositoryMetadata(repo: T, _cancellation?: CancellationToken): Promise<RepositoryMetadata | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const metadata = this.container.cache.getRepositoryMetadata(repo, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderRepositoryMetadata(this._session!, repo);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<RepositoryMetadata | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return metadata;
	}

	protected abstract getProviderRepositoryMetadata(
		session: AuthenticationSession,
		repo: T,
	): Promise<RepositoryMetadata | undefined>;

	@debug()
	async getIssueOrPullRequest(repo: T, id: string): Promise<IssueOrPullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const issueOrPR = this.container.cache.getIssueOrPullRequest(id, repo, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderIssueOrPullRequest(this._session!, repo, id);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<IssueOrPullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return issueOrPR;
	}

	protected abstract getProviderIssueOrPullRequest(
		session: AuthenticationSession,
		repo: T,
		id: string,
	): Promise<IssueOrPullRequest | undefined>;

	@debug()
	async getPullRequestForBranch(
		repo: T,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const pr = this.container.cache.getPullRequestForBranch(branch, repo, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequestForBranch(this._session!, repo, branch, options);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return pr;
	}

	protected abstract getProviderPullRequestForBranch(
		session: AuthenticationSession,
		repo: T,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined>;

	@debug()
	async getPullRequestForCommit(repo: T, ref: string): Promise<PullRequest | undefined> {
		const scope = getLogScope();

		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		const pr = this.container.cache.getPullRequestForSha(ref, repo, this, () => ({
			value: (async () => {
				try {
					const result = await this.getProviderPullRequestForCommit(this._session!, repo, ref);
					this.resetRequestExceptionCount();
					return result;
				} catch (ex) {
					return this.handleProviderException<PullRequest | undefined>(ex, scope, undefined);
				}
			})(),
		}));
		return pr;
	}

	protected abstract getProviderPullRequestForCommit(
		session: AuthenticationSession,
		repo: T,
		ref: string,
	): Promise<PullRequest | undefined>;

	async getMyIssuesForRepos(
		reposOrRepoIds: ProviderReposInput,
		options?: {
			filters?: IssueFilter[];
			cursor?: string;
			customUrl?: string;
		},
	): Promise<PagedResult<ProviderIssue> | undefined> {
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		if (
			providerId !== HostedProviderId.GitLab &&
			(this.api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === HostedProviderId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`, 'getIssuesForRepos');
			return undefined;
		}

		let getIssuesOptions: GetIssuesOptions | undefined;
		if (providerId === HostedProviderId.AzureDevOps) {
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

			const organization: string = organizations.values().next().value;

			if (options?.filters != null) {
				if (!this.api.providerSupportsIssueFilters(providerId, options.filters)) {
					Logger.warn(`Unsupported filters for provider ${providerId}`, 'getIssuesForRepos');
					return undefined;
				}

				let userAccount: ProviderAccount | undefined;
				try {
					userAccount = await this.api.getCurrentUserForInstance(providerId, organization);
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
						const results = await this.api.getIssuesForAzureProject(
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
				userAccount = await this.api.getCurrentUser(providerId);
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

		if (
			this.api.getProviderIssuesPagingMode(providerId) === PagingMode.Repo &&
			!this.api.isRepoIdsInput(reposOrRepoIds)
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
				const data: ProviderIssue[] = [];
				await Promise.all(
					repoInputs.map(async repoInput => {
						const results = await this.api.getIssuesForRepo(providerId, repoInput.repo, {
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
			return await this.api.getIssuesForRepos(providerId, reposOrRepoIds, {
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
		options?: {
			filters?: PullRequestFilter[];
			cursor?: string;
			customUrl?: string;
		},
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		const providerId = this.authProvider.id;
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		if (
			providerId !== HostedProviderId.GitLab &&
			(this.api.isRepoIdsInput(reposOrRepoIds) ||
				(providerId === HostedProviderId.AzureDevOps &&
					!reposOrRepoIds.every(repo => repo.project != null && repo.namespace != null)))
		) {
			Logger.warn(`Unsupported input for provider ${providerId}`);
			return undefined;
		}

		let getPullRequestsOptions: GetPullRequestsOptions | undefined;
		if (options?.filters != null) {
			if (!this.api.providerSupportsPullRequestFilters(providerId, options.filters)) {
				Logger.warn(`Unsupported filters for provider ${providerId}`, 'getPullRequestsForRepos');
				return undefined;
			}

			let userAccount: ProviderAccount | undefined;
			if (providerId === HostedProviderId.AzureDevOps) {
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

				const organization: string = organizations.values().next().value;
				try {
					userAccount = await this.api.getCurrentUserForInstance(providerId, organization);
				} catch (ex) {
					Logger.error(ex, 'getPullRequestsForRepos');
					return undefined;
				}
			} else {
				try {
					userAccount = await this.api.getCurrentUser(providerId);
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
				case HostedProviderId.Bitbucket:
				case HostedProviderId.AzureDevOps:
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
			this.api.getProviderPullRequestsPagingMode(providerId) === PagingMode.Repo &&
			!this.api.isRepoIdsInput(reposOrRepoIds)
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
						const results = await this.api.getPullRequestsForRepo(providerId, repoInput.repo, {
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
			return this.api.getPullRequestsForRepos(providerId, reposOrRepoIds, {
				...getPullRequestsOptions,
				cursor: options?.cursor,
				baseUrl: options?.customUrl,
			});
		} catch (ex) {
			Logger.error(ex, 'getPullRequestsForRepos');
			return undefined;
		}
	}

	async searchMyIssues(
		repo?: RepositoryDescriptor,
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;
	async searchMyIssues(
		repos?: RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;
	@debug()
	async searchMyIssues(
		repos?: RepositoryDescriptor | RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const issues = await this.searchProviderMyIssues(
				this._session!,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount();
			return issues;
		} catch (ex) {
			return this.handleProviderException<SearchedIssue[] | undefined>(ex, scope, undefined);
		}
	}

	protected abstract searchProviderMyIssues(
		session: AuthenticationSession,
		repos?: RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedIssue[] | undefined>;

	async searchMyPullRequests(
		repo?: RepositoryDescriptor,
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined>;
	async searchMyPullRequests(
		repos?: RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined>;
	@debug()
	async searchMyPullRequests(
		repos?: RepositoryDescriptor | RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined> {
		const scope = getLogScope();
		const connected = this.maybeConnected ?? (await this.isConnected());
		if (!connected) return undefined;

		try {
			const pullRequests = await this.searchProviderMyPullRequests(
				this._session!,
				repos != null ? (Array.isArray(repos) ? repos : [repos]) : undefined,
				cancellation,
			);
			this.resetRequestExceptionCount();
			return pullRequests;
		} catch (ex) {
			return this.handleProviderException<SearchedPullRequest[] | undefined>(ex, scope, undefined);
		}
	}

	protected abstract searchProviderMyPullRequests(
		session: AuthenticationSession,
		repos?: RepositoryDescriptor[],
		cancellation?: CancellationToken,
	): Promise<SearchedPullRequest[] | undefined>;

	@gate()
	private async ensureSession(
		createIfNeeded: boolean,
		forceNewSession: boolean = false,
	): Promise<AuthenticationSession | undefined> {
		if (this._session != null) return this._session;
		if (!configuration.get('integrations.enabled')) return undefined;

		if (createIfNeeded) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		} else if (this.container.storage.getWorkspace(this.connectedKey) === false) {
			return undefined;
		}

		let session: AuthenticationSession | undefined | null;
		try {
			session = await this.container.integrationAuthentication.getSession(
				this.authProvider.id,
				this.authProviderDescriptor,
				{ createIfNeeded: createIfNeeded, forceNewSession: forceNewSession },
			);
		} catch (ex) {
			await this.container.storage.deleteWorkspace(this.connectedKey);

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				return undefined;
			}

			session = null;
		}

		if (session === undefined && !createIfNeeded) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		}

		this._session = session ?? null;
		this.resetRequestExceptionCount();

		if (session != null) {
			await this.container.storage.storeWorkspace(this.connectedKey, true);

			queueMicrotask(() => {
				this._onDidChange.fire();
				this.container.integrations.connected(this.key);
			});
		}

		return session ?? undefined;
	}

	getIgnoreSSLErrors(): boolean | 'force' {
		return this.container.integrations.ignoreSSLErrors(this);
	}
}

export async function ensurePaidPlan(providerName: string, container: Container): Promise<boolean> {
	const title = `Connecting to a ${providerName} instance for rich integration features requires a trial or paid plan.`;

	while (true) {
		const subscription = await container.subscription.getSubscription();
		if (subscription.account?.verified === false) {
			const resend = { title: 'Resend Verification' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nYou must verify your email before you can continue.`,
				{ modal: true },
				resend,
				cancel,
			);

			if (result === resend) {
				if (await container.subscription.resendVerification()) {
					continue;
				}
			}

			return false;
		}

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) break;

		if (subscription.account == null && !isSubscriptionPreviewTrialExpired(subscription)) {
			const startTrial = { title: 'Preview Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to preview ✨ features for 3 days?`,
				{ modal: true },
				startTrial,
				cancel,
			);

			if (result !== startTrial) return false;

			void container.subscription.startPreviewTrial();
			break;
		} else if (subscription.account == null) {
			const signIn = { title: 'Start Free GitKraken Trial' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to continue to use ✨ features on privately hosted repos, free for an additional 7 days?`,
				{ modal: true },
				signIn,
				cancel,
			);

			if (result === signIn) {
				if (await container.subscription.loginOrSignUp()) {
					continue;
				}
			}
		} else {
			const upgrade = { title: 'Upgrade to Pro' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`${title}\n\nDo you want to continue to use ✨ features on privately hosted repos?`,
				{ modal: true },
				upgrade,
				cancel,
			);

			if (result === upgrade) {
				void container.subscription.purchase();
			}
		}

		return false;
	}

	return true;
}
