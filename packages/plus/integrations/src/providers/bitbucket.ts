import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import { flatSettled, nonnullSettled } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type {
	AuthenticationSessionLike as AuthenticationSession,
	ProviderAuthenticationSession,
} from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { BitbucketRepositoryDescriptor, BitbucketWorkspaceDescriptor } from './bitbucket/models.js';
import type { ProviderHierarchyResult, ProviderOrganization, ProviderRepository } from './models.js';
import { fromProviderPullRequest, providersMetadata, toProviderPullRequestStates } from './models.js';

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
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const api = await this.getProvidersApi();
		return api.mergePullRequest(toTokenWithInfo(this.id, session), pr, {
			mergeMethod: options?.mergeMethod,
		});
	}

	public override async getRepoInfo(repo: {
		owner: string;
		name: string;
		project?: string;
		connectionId?: string;
	}): Promise<ProviderRepository | undefined> {
		const api = await this.getProvidersApi();
		// `connectionId` targets a specific account (multi-account); omitted reads the primary.
		const session = await this.resolveReadSession(repo.connectionId, undefined);
		if (session == null) return undefined;

		return api.getRepo(toTokenWithInfo(this.id, session), repo.owner, repo.name, repo.project, {
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
		return (await this.authenticationService.apis.bitbucket)?.getAccountForCommit(
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
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<DefaultBranch | undefined> {
		return (await this.authenticationService.apis.bitbucket)?.getDefaultBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{ baseUrl: this.apiBaseUrl },
			cancellation,
		);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		{ id }: { id: string; key: string },
		type: undefined | IssueOrPullRequestType,
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.authenticationService.apis.bitbucket)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
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
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return (await this.authenticationService.apis.bitbucket)?.getIssue(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrl,
		);
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
		return (await this.authenticationService.apis.bitbucket)?.getPullRequestForBranch(
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
		return (await this.authenticationService.apis.bitbucket)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrl,
		);
	}

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.authenticationService.apis.bitbucket)?.getRepositoryMetadata(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{ baseUrl: this.apiBaseUrl },
			cancellation,
		);
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
			const user = await api.getCurrentUser(toTokenWithInfo(this.id, session));
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
	private async getProviderResourcesForCurrentUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<BitbucketWorkspaceDescriptor[] | undefined> {
		this._workspaces ??= new Map<string, BitbucketWorkspaceDescriptor[] | undefined>();
		const { accessToken } = session;
		const cachedResources = this._workspaces.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();

			const resources = await api.getBitbucketResourcesForCurrentUser(toTokenWithInfo(this.id, session));
			this._workspaces.set(
				accessToken,
				resources != null ? resources.map(r => ({ ...r, key: r.id, name: r.name ?? r.slug })) : undefined,
			);
		}

		return this._workspaces.get(accessToken);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const workspaces = await this.getProviderResourcesForCurrentUser(session);
		if (workspaces == null) return undefined;

		return {
			values: workspaces.map(w => ({ id: w.id, name: w.slug, url: `https://bitbucket.org/${w.slug}` })),
		};
	}

	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		return api.getReposForBitbucketWorkspace(toTokenWithInfo(this.id, session), org, {
			cursor: options?.cursor,
		});
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		_silent?: boolean,
		state?: PullRequestStateFilter,
	): Promise<PullRequest[] | undefined> {
		if (repos != null) {
			// TODO: implement repos version
			return undefined;
		}

		const states = toProviderPullRequestStates(state);
		// Bitbucket's reviewing PRs use a raw BBQL query; map the requested state to its state clause.
		const stateClause =
			state === 'closed'
				? '(state="DECLINED" OR state="SUPERSEDED")'
				: state === 'merged'
					? 'state="MERGED"'
					: state === 'all'
						? undefined
						: 'state="OPEN"';

		const api = await this.getProvidersApi();
		if (!api) {
			return undefined;
		}

		const remotes = await this.ctx.repositories.getOpenRemotes();
		const workspaceRepos = await nonnullSettled(
			remotes.map(async (r: GitRemote) => {
				const integration = await this.authenticationService.getByRemote(r);
				const [namespace, name] = r.path.split('/');
				return integration?.id === this.id ? { name: name, namespace: namespace } : undefined;
			}),
		);

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const workspaces = await this.getProviderResourcesForCurrentUser(session);
		if (workspaces == null || workspaces.length === 0) return undefined;

		const authoredPrs = workspaces.map(async ws => {
			const prs = await api.getBitbucketPullRequestsAuthoredByUserForWorkspace(
				toTokenWithInfo(this.id, session),
				user.id,
				ws.slug,
				{ states: states },
			);
			return prs?.map(pr => fromProviderPullRequest(pr, this));
		});

		const reviewerClause = `reviewers.uuid="${user.id}"`;
		const reviewingPrs = api
			.getPullRequestsForRepos(toTokenWithInfo(this.id, session), workspaceRepos, {
				query: stateClause ? `${stateClause} AND ${reviewerClause}` : reviewerClause,
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
		session: ProviderAuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		if (repos == null || repos.length === 0) return undefined;

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const api = await this.authenticationService.apis.bitbucket;
		if (!api) return undefined;

		const issueResult = await flatSettled(
			repos.map(repo => {
				return api.getUsersIssuesForRepo(
					this,
					toTokenWithInfo(this.id, session),
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

		const storedAccount = this.ctx.storage.get(`${this.storagePrefix}:${accountStorageKey}:account`);
		const storedWorkspaces = this.ctx.storage.get(`${this.storagePrefix}:${accountStorageKey}:workspaces`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;

		let workspaces = storedWorkspaces?.data?.map((o: BitbucketWorkspaceDescriptor) => ({ ...o }));

		if (storedAccount == null) {
			account = await this.getProviderCurrentAccount(this._session);
			if (account != null) {
				// Clear all other stored workspaces and repositories and accounts when our session changes
				await this.ctx.storage.deleteWithPrefix(this.storagePrefix);
				await this.ctx.storage.store(`${this.storagePrefix}:${accountStorageKey}:account`, {
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
			workspaces = await this.getProviderResourcesForCurrentUser(this._session, true);
			await this.ctx.storage.store(`${this.storagePrefix}:${accountStorageKey}:workspaces`, {
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
