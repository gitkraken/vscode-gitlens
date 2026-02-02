import type { AuthenticationSession, CancellationToken, EventEmitter } from 'vscode';
import { md5 } from '@env/crypto.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.integrations.js';
import type { Container } from '../../../container.js';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author.js';
import type { DefaultBranch } from '../../../git/models/defaultBranch.js';
import type { Issue, IssueShape } from '../../../git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest.js';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest.js';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationKey } from '../models/integration.js';
import type { BitbucketRepositoryDescriptor } from './bitbucket/models.js';
import type { ProviderRepository } from './models.js';
import { fromProviderPullRequest, providersMetadata } from './models.js';
import type { ProvidersApi } from './providersApi.js';

const metadata = providersMetadata[GitSelfManagedHostIntegrationId.BitbucketServer];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

export class BitbucketServerIntegration extends GitHostIntegration<
	GitSelfManagedHostIntegrationId.BitbucketServer,
	BitbucketRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = GitSelfManagedHostIntegrationId.BitbucketServer;
	protected readonly key =
		`${this.id}:${this.domain}` satisfies IntegrationKey<GitSelfManagedHostIntegrationId.BitbucketServer>;
	readonly name: string = 'Bitbucket Data Center';

	constructor(
		container: Container,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: EventEmitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(container, authenticationService, getProvidersApi, didChangeConnection);
	}

	get domain(): string {
		return this._domain;
	}

	protected get apiBaseUrl(): string {
		const protocol = this._session?.protocol ?? 'https:';
		return `${protocol}//${this.domain}/rest/api/1.0`;
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		return api.mergePullRequest(toTokenWithInfo(this.id, session), pr, {
			mergeMethod: options?.mergeMethod,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		return (await this.container.bitbucket)?.getServerAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
			{
				avatarSize: options?.avatarSize,
			},
		);
	}

	protected override async getProviderAccountForEmail(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_email: string,
		_options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderDefaultBranch(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		{ id }: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		if (type === 'issue') {
			return undefined;
		}
		return (await this.container.bitbucket)?.getServerPullRequestById(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderIssue(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_id: string,
	): Promise<Issue | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getServerPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getServerPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	public override async getRepoInfo(repo: { owner: string; name: string }): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		const tokenOptInfo = this._session ? toTokenWithInfo(this.id, this._session) : { providerId: this.id };
		return api.getRepo(tokenOptInfo, repo.owner, repo.name, undefined, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_cancellation?: CancellationToken,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	private _accounts: Map<string, Account | undefined> | undefined;
	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const { accessToken } = session;
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const api = await this.getProvidersApi();
			const user = await api.getCurrentUser(toTokenWithInfo(this.id, session), {
				baseUrl: this.apiBaseUrl,
			});
			this._accounts.set(
				accessToken,
				user
					? {
							provider: this,
							id: user.id,
							name: user.name ?? undefined,
							email: user.email ?? undefined,
							avatarUrl: user.avatarUrl ?? undefined,
							username: user.username ?? undefined,
						}
					: undefined,
			);
		}

		return this._accounts.get(accessToken);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
	): Promise<PullRequest[] | undefined> {
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		const api = await this.getProvidersApi();
		if (!api) {
			return undefined;
		}
		const prs = await api.getBitbucketServerPullRequestsForCurrentUser(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrl,
		);
		return prs?.map(pr => fromProviderPullRequest(pr, this));
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		return Promise.resolve(undefined);
	}

	private readonly storagePrefix = 'bitbucket-server';
	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const accountStorageKey = md5(this._session.accessToken);

		const storedAccount = this.container.storage.get(`${this.storagePrefix}:${accountStorageKey}:account`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;

		if (storedAccount == null) {
			account = await this.getProviderCurrentAccount(this._session);
			if (account != null) {
				// Clear all other stored workspaces and repositories and accounts when our session changes
				await this.container.storage.deleteWithPrefix(this.storagePrefix);
				await this.container.storage.store(`${this.storagePrefix}:${accountStorageKey}:account`, {
					v: 1,
					timestamp: Date.now(),
					data: {
						id: account.id,
						name: account.name,
						email: account.email,
						avatarUrl: account.avatarUrl,
						username: account.username,
					},
				});
			}
		}
		this._accounts ??= new Map<string, Account | undefined>();
		this._accounts.set(this._session.accessToken, account);
	}

	protected override providerOnDisconnect(): void {
		this._accounts = undefined;
	}
}
