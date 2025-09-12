import type { AuthenticationSession, CancellationToken, EventEmitter } from 'vscode';
import { md5 } from '@env/crypto';
import { GitSelfManagedHostIntegrationId } from '../../../constants.integrations';
import type { Container } from '../../../container';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService';
import type { ProviderAuthenticationSession } from '../authentication/models';
import type { IntegrationConnectionChangeEvent } from '../integrationService';
import { GitHostIntegration } from '../models/gitHostIntegration';
import type { IntegrationKey } from '../models/integration';
import type { BitbucketRepositoryDescriptor } from './bitbucket/models';
import type { ProviderRepository } from './models';
import { fromProviderPullRequest, providersMetadata } from './models';
import type { ProvidersApi } from './providersApi';

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
		{ accessToken }: AuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		return api.mergePullRequest(this.id, pr, {
			accessToken: accessToken,
			mergeMethod: options?.mergeMethod,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		return (await this.container.bitbucket)?.getServerAccountForCommit(
			this,
			accessToken,
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
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		{ id }: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		if (type === 'issue') {
			return undefined;
		}
		return (await this.container.bitbucket)?.getServerPullRequestById(
			this,
			accessToken,
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
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		branch: string,
		_options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getServerPullRequestForBranch(
			this,
			accessToken,
			repo.owner,
			repo.name,
			branch,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.container.bitbucket)?.getServerPullRequestForCommit(
			this,
			accessToken,
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	public override async getRepoInfo(repo: { owner: string; name: string }): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		return api.getRepo(this.id, repo.owner, repo.name, undefined, {
			accessToken: this._session?.accessToken,
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
	protected override async getProviderCurrentAccount({
		accessToken,
	}: AuthenticationSession): Promise<Account | undefined> {
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(accessToken);
		if (cachedAccount == null) {
			const api = await this.getProvidersApi();
			const user = await api.getCurrentUser(this.id, { accessToken: accessToken, baseUrl: this.apiBaseUrl });
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
		const prs = await api.getBitbucketServerPullRequestsForCurrentUser(this.apiBaseUrl, {
			accessToken: session.accessToken,
		});
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
