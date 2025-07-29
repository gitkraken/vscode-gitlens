import type { AuthenticationSession, CancellationToken } from 'vscode';
import { md5 } from '@env/crypto';
import { GitCloudHostIntegrationId } from '../../../constants.integrations';
import type { Account, UnidentifiedAuthor } from '../../../git/models/author';
import type { DefaultBranch } from '../../../git/models/defaultBranch';
import type { Issue, IssueShape } from '../../../git/models/issue';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '../../../git/models/issueOrPullRequest';
import type { PullRequest, PullRequestMergeMethod, PullRequestState } from '../../../git/models/pullRequest';
import type { RepositoryMetadata } from '../../../git/models/repositoryMetadata';
import { uniqueBy } from '../../../system/iterable';
import { flatSettled, nonnullSettled } from '../../../system/promise';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider';
import type { ProviderAuthenticationSession } from '../authentication/models';
import { GitHostIntegration } from '../models/gitHostIntegration';
import type { BitbucketRepositoryDescriptor, BitbucketWorkspaceDescriptor } from './bitbucket/models';
import { fromProviderPullRequest, providersMetadata } from './models';

const metadata = providersMetadata[GitCloudHostIntegrationId.Bitbucket];
const authProvider = Object.freeze({ id: metadata.id, scopes: metadata.scopes });

export class BitbucketIntegration extends GitHostIntegration<
	GitCloudHostIntegrationId.Bitbucket,
	BitbucketRepositoryDescriptor
> {
	readonly authProvider: IntegrationAuthenticationProviderDescriptor = authProvider;
	readonly id = GitCloudHostIntegrationId.Bitbucket;
	protected readonly key = this.id;
	readonly name: string = 'Bitbucket';
	get domain(): string {
		return metadata.domain;
	}

	protected get apiBaseUrl(): string {
		return 'https://api.bitbucket.org/2.0';
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
		return (await this.container.bitbucket)?.getAccountForCommit(
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

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		id: string,
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.container.bitbucket)?.getIssueOrPullRequest(
			this,
			accessToken,
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrl,
			{
				type: type,
			},
		);
	}

	protected override async getProviderIssue(
		{ accessToken }: AuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return (await this.container.bitbucket)?.getIssue(
			this,
			accessToken,
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrl,
		);
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
		return (await this.container.bitbucket)?.getPullRequestForBranch(
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
		return (await this.container.bitbucket)?.getPullRequestForCommit(
			this,
			accessToken,
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
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
			const user = await api.getCurrentUser(this.id, { accessToken: accessToken });
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

	private _workspaces: Map<string, BitbucketWorkspaceDescriptor[] | undefined> | undefined;
	private async getProviderResourcesForUser(
		session: AuthenticationSession,
		force: boolean = false,
	): Promise<BitbucketWorkspaceDescriptor[] | undefined> {
		this._workspaces ??= new Map<string, BitbucketWorkspaceDescriptor[] | undefined>();
		const { accessToken } = session;
		const cachedResources = this._workspaces.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();
			const account = await this.getProviderCurrentAccount(session);
			if (account?.id == null) return undefined;

			const resources = await api.getBitbucketResourcesForUser(account.id, { accessToken: accessToken });
			this._workspaces.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id })) : undefined,
			);
		}

		return this._workspaces.get(accessToken);
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

		const remotes = await flatSettled(this.container.git.openRepositories.map(r => r.git.remotes.getRemotes()));
		const workspaceRepos = await nonnullSettled(
			remotes.map(async r => {
				const integration = await r.getIntegration();
				const [namespace, name] = r.path.split('/');
				return integration?.id === this.id ? { name: name, namespace: namespace } : undefined;
			}),
		);

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const workspaces = await this.getProviderResourcesForUser(session);
		if (workspaces == null || workspaces.length === 0) return undefined;

		const authoredPrs = workspaces.map(async ws => {
			const prs = await api.getBitbucketPullRequestsAuthoredByUserForWorkspace(user.id, ws.slug, {
				accessToken: session.accessToken,
			});
			return prs?.map(pr => fromProviderPullRequest(pr, this));
		});

		const reviewingPrs = api
			.getPullRequestsForRepos(this.id, workspaceRepos, {
				query: `state="OPEN" AND reviewers.uuid="${user.id}"`,
				accessToken: session.accessToken,
			})
			.then(r => r.values?.map(pr => fromProviderPullRequest(pr, this)));

		return [
			...uniqueBy(
				await flatSettled([...authoredPrs, reviewingPrs]),
				pr => pr.url,
				(orig, _cur) => orig,
			),
		];
	}

	protected override async searchProviderMyIssues(
		session: AuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		if (repos == null || repos.length === 0) return undefined;

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const workspaces = await this.getProviderResourcesForUser(session);
		if (workspaces == null || workspaces.length === 0) return undefined;

		const api = await this.container.bitbucket;
		if (!api) return undefined;
		const issueResult = await flatSettled(
			repos.map(repo => {
				return api.getUsersIssuesForRepo(
					this,
					session.accessToken,
					user.id,
					repo.owner,
					repo.name,
					this.apiBaseUrl,
				);
			}),
		);
		return issueResult;
	}

	private readonly storagePrefix = 'bitbucket';
	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const accountStorageKey = md5(this._session.accessToken);

		const storedAccount = this.container.storage.get(`${this.storagePrefix}:${accountStorageKey}:account`);
		const storedWorkspaces = this.container.storage.get(`${this.storagePrefix}:${accountStorageKey}:workspaces`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;
		let workspaces = storedWorkspaces?.data?.map(o => ({ ...o }));

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

		if (storedWorkspaces == null) {
			workspaces = await this.getProviderResourcesForUser(this._session, true);
			await this.container.storage.store(`${this.storagePrefix}:${accountStorageKey}:workspaces`, {
				v: 1,
				timestamp: Date.now(),
				data: workspaces,
			});
		}
		this._workspaces ??= new Map<string, BitbucketWorkspaceDescriptor[] | undefined>();
		this._workspaces.set(this._session.accessToken, workspaces);
	}

	protected override providerOnDisconnect(): void {
		this._accounts = undefined;
		this._workspaces = undefined;
	}
}

const bitbucketCloudDomainRegex = /^bitbucket\.org$/i;
export function isBitbucketCloudDomain(domain: string | undefined): boolean {
	return domain != null && bitbucketCloudDomainRegex.test(domain);
}
