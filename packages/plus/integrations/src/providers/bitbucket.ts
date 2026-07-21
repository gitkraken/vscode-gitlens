import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
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
import { batchResults, flatSettled, nonnullSettled } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type {
	AuthenticationSessionLike as AuthenticationSession,
	ProviderAuthenticationSession,
} from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId } from '../constants.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import { toCollectionScopeFailure } from '../results.js';
import type { BitbucketRepositoryDescriptor, BitbucketWorkspaceDescriptor } from './bitbucket/models.js';
import type {
	ProviderApiCollectionResult,
	ProviderApiPagedResult,
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepository,
} from './models.js';
import { fromProviderPullRequest, providersMetadata, toProviderPullRequestStates } from './models.js';
import { collectProviderPagedResult, mergeCollectionMetadata } from './utils/providerPaging.js';

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

	private _workspaces: Map<string, ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined> | undefined;
	private async getProviderResourcesForCurrentUser(
		session: ProviderAuthenticationSession,
		force: boolean = false,
	): Promise<ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined> {
		this._workspaces ??= new Map<string, ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined>();
		const { accessToken } = session;
		const cachedResources = this._workspaces.get(accessToken);

		if (cachedResources == null || force) {
			const api = await this.getProvidersApi();

			const resources = await api.getBitbucketResourcesForCurrentUser(toTokenWithInfo(this.id, session));
			let result: ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined;
			if (resources != null) {
				const values = resources.values.map(r => ({ ...r, key: r.id, name: r.name ?? r.slug }));
				let metadata: CollectionMetadata | undefined;
				if (resources.paging?.truncated === true) {
					// Hitting the page backstop is truncation (the read succeeded but stopped short), not a read
					// failure: report `partial` completeness WITHOUT a structured failure so the facade surfaces it
					// as truncated + an incompleteness warning, rather than as `fetchFailed` (which
					// `assessCollectionMetadata` derives from any `failures` entry).
					metadata = { completeness: 'partial' };
				}
				result = { values: values, ...(metadata != null ? { metadata: metadata } : {}) };
			}
			this._workspaces.set(accessToken, result);
		}

		return this._workspaces.get(accessToken);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const workspaces = await this.getProviderResourcesForCurrentUser(session);
		if (workspaces == null) return undefined;

		return {
			values: workspaces.values.map(w => ({ id: w.id, name: w.slug, url: `https://bitbucket.org/${w.slug}` })),
			...(workspaces.metadata != null ? { metadata: workspaces.metadata } : {}),
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

		const workspaceRepos = await this.getWorkspaceRepoInputs();

		const user = await this.getProviderCurrentAccount(session);
		if (user?.username == null) return undefined;

		const workspacesResult = await this.getProviderResourcesForCurrentUser(session);
		if (workspacesResult == null) return undefined;

		const workspaces = workspacesResult.values;
		if (workspaces.length === 0) return undefined;

		const authoredPrs = workspaces.map(async ws => {
			const prs = await api.getBitbucketPullRequestsAuthoredByUserForWorkspace(
				toTokenWithInfo(this.id, session),
				user.id,
				ws.slug,
				{ states: states },
			);
			return prs?.data.map(pr => fromProviderPullRequest(pr, this));
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

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined> {
		const api = await this.getProvidersApi();
		const user = await this.getProviderCurrentAccount(session);
		if (user?.id == null) return undefined;

		const workspacesResult = await this.getProviderResourcesForCurrentUser(session);
		if (workspacesResult == null) return undefined;

		const workspaces = workspacesResult.values;
		if (workspaces.length === 0) return undefined;

		// Account-wide "my PRs" for Bitbucket = the user's authored PRs across every workspace they belong to,
		// plus the PRs they've been requested to review. Bitbucket's cross-workspace read is per-workspace and
		// numbered-page, so drain each workspace fully (bounded by a defensive backstop) and concatenate.
		// There's no single cross-workspace cursor, so the aggregate is one page; `truncated` is set when a
		// workspace hit the backstop with more pages left, or when a workspace's read was dropped by a failure.
		const states = toProviderPullRequestStates(options?.state);
		const maxPagesPerWorkspace = 20;
		let truncated = workspacesResult.metadata != null && workspacesResult.metadata.completeness !== 'complete';
		// Structured per-scope failures from BOTH the authored and reviewer slices. A rejected scope is recorded
		// here (never re-thrown) so successful sibling workspaces/repos survive and the ProviderBackend facade
		// maps each failure to an actionable warning + `fetchFailed` (auth/rate-limit failures still drive
		// recovery through their warning kind, matching the SDK's own collect-across-scopes model).
		const failures: CollectionScopeFailure[] = [];
		const settled = await Promise.allSettled(
			workspaces.map(async ws => {
				const collected: ProviderPullRequest[] = [];
				let page: number | undefined;
				for (let i = 0; i < maxPagesPerWorkspace; i++) {
					const result = await api.getBitbucketPullRequestsAuthoredByUserForWorkspace(
						toTokenWithInfo(this.id, session),
						user.id,
						ws.slug,
						{ states: states, page: page },
					);
					if (result == null) break;

					collected.push(...result.data);
					if (!result.hasMore || result.nextPage == null) break;

					page = result.nextPage;
					if (i === maxPagesPerWorkspace - 1) {
						truncated = true;
					}
				}
				return collected;
			}),
		);

		const prsByUrl = new Map<string, ProviderPullRequest>();
		// `allSettled` preserves order, so `settled[i]` is `workspaces[i]`. A rejected workspace becomes a
		// structured failure (attributed to its slug) instead of a generic truncation or a re-throw, preserving
		// every sibling workspace's authored PRs.
		settled.forEach((outcome, i) => {
			if (outcome.status !== 'fulfilled') {
				failures.push(this.toWorkspaceFailure(workspaces[i].slug, outcome.reason));
				return;
			}

			for (const pr of outcome.value) {
				const key = pr.url ?? pr.id;
				if (!prsByUrl.has(key)) {
					prsByUrl.set(key, pr);
				}
			}
		});

		// Bitbucket's account-wide (per-workspace) endpoint returns authored PRs only, and the SDK exposes no
		// workspace-level reviewer query — only a repo-scoped one. Enumerate the account's repos by draining each
		// resolved workspace's repository list, then drain the real per-repo paged `getPullRequestsForRepo` for
		// each repo with `reviewerId`, so review-requested PRs aren't bounded to the currently-open remotes and a
		// reviewer PR past the first page isn't dropped. Structured per-scope failures are collected as
		// CollectionScopeFailure so the ProviderBackend facade maps them to actionable warnings (Step 3).
		const maxReposPagesPerWorkspace = 20;
		const maxPrPagesPerRepo = 20;
		// Bound concurrency: workspaces are few, so process them concurrently, but drain each workspace's repos in
		// a bounded batch rather than an unbounded Promise.all over every repo in every workspace.
		const repoBatchSize = 5;

		await Promise.all(
			workspaces.map(async ws => {
				let repos: ProviderRepository[];
				try {
					const discovered = await collectProviderPagedResult(
						cursor =>
							api.getReposForBitbucketWorkspace(toTokenWithInfo(this.id, session), ws.slug, {
								cursor: cursor,
							}),
						maxReposPagesPerWorkspace,
					);
					repos = discovered.values;
					// Repo discovery hitting its backstop leaves the workspace's repo set incomplete.
					if (discovered.truncated) {
						truncated = true;
					}
				} catch (ex) {
					// Record the workspace as a structured failure and keep going: the failure metadata drives the
					// warning + `fetchFailed` + incompleteness for every kind (auth/rate-limit stay actionable via
					// their warning kind), so sibling workspaces' repos are still drained.
					failures.push(this.toWorkspaceFailure(ws.slug, ex));
					return;
				}

				const drained = await batchResults(repos, repoBatchSize, async repo => {
					const reviewing = await collectProviderPagedResult(
						cursor =>
							api.getPullRequestsForRepo(
								toTokenWithInfo(this.id, session),
								{ namespace: repo.namespace, name: repo.name },
								{ reviewerId: user.id, states: states, cursor: cursor },
							),
						maxPrPagesPerRepo,
					);
					return { repo: repo, reviewing: reviewing };
				});

				for (let i = 0; i < drained.length; i++) {
					const outcome = drained[i];
					if (outcome.status !== 'fulfilled') {
						const repo = repos[i];
						failures.push(
							this.toRepositoryFailure(
								`${repo?.namespace ?? ws.slug}/${repo?.name ?? 'unknown'}`,
								outcome.reason,
							),
						);
						continue;
					}

					const { reviewing } = outcome.value;
					for (const pr of reviewing.values) {
						// Dedupe authored and reviewer PRs by URL, falling back to ID only when URL is absent.
						const key = pr.url ?? pr.id;
						if (!prsByUrl.has(key)) {
							prsByUrl.set(key, pr);
						}
					}
					// A per-repo PR drain hitting its own page backstop leaves the reviewer slice incomplete.
					if (reviewing.truncated) {
						truncated = true;
					}
				}
			}),
		);

		// Both slices record per-scope rejections (authored workspaces + reviewer workspaces/repos) as structured
		// failures instead of re-throwing: re-throwing would discard every successful sibling's PRs. Auth/rate-limit
		// failures stay actionable through the metadata (the facade maps kind `authentication` → an `auth` warning,
		// `rate-limit` → a `rate-limit` warning) while the survivors are returned with `fetchFailed`.
		const metadata: CollectionMetadata | undefined = mergeCollectionMetadata(
			failures.length > 0 ? { completeness: 'partial', failures: failures } : undefined,
			workspacesResult.metadata,
		);

		return {
			values: [...prsByUrl.values()],
			paging: { cursor: '{}', more: false, truncated: truncated || undefined },
			metadata: metadata,
		};
	}

	/** Classifies a caught workspace-scope error into a structured {@link CollectionScopeFailure}. */
	private toWorkspaceFailure(workspaceSlug: string, ex: unknown): CollectionScopeFailure {
		return toCollectionScopeFailure({ providerId: this.id, resourceId: workspaceSlug }, ex);
	}

	/** Classifies a caught repository-scope error into a structured {@link CollectionScopeFailure}. */
	private toRepositoryFailure(repositoryId: string, ex: unknown): CollectionScopeFailure {
		return toCollectionScopeFailure({ providerId: this.id, repositoryId: repositoryId }, ex);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: BitbucketRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		state?: PullRequestStateFilter,
	): Promise<PullRequest[] | undefined> {
		const api = await this.getProvidersApi();
		if (!api) return undefined;

		const workspaceRepos =
			repos != null
				? repos.map(r => ({ name: r.name, namespace: r.owner }))
				: await this.getWorkspaceRepoInputs();
		// An explicitly-empty `repos` means "search these zero repos" -> no results; reserve `undefined`
		// ("scope couldn't be determined") for when no repos were requested and none were discovered.
		if (workspaceRepos.length === 0) return repos != null ? [] : undefined;

		const result = await api.getPullRequestsForRepos(toTokenWithInfo(this.id, session), workspaceRepos, {
			query: searchQuery,
			states: toProviderPullRequestStates(state),
		});
		return result.values?.map(pr => fromProviderPullRequest(pr, this));
	}

	private async getWorkspaceRepoInputs(): Promise<{ name: string; namespace: string }[]> {
		const remotes = await this.ctx.repositories.getOpenRemotes();
		const inputs = await nonnullSettled(
			remotes.map(async (r: GitRemote) => {
				const integration = await this.authenticationService.getByRemote(r);
				if (integration?.id !== this.id) return undefined;

				// Use the remote provider's parsing rather than splitting `r.path`, so adornments like a
				// trailing `.git` or extra path segments don't leak into the namespace/name.
				const namespace = r.provider?.owner;
				const name = r.provider?.repoName;
				return namespace != null && name != null ? { name: name, namespace: namespace } : undefined;
			}),
		);
		// Dedupe: a repo with multiple remotes (e.g. `origin` + `upstream`) can map to the same input,
		// which would otherwise fetch and return the same PRs more than once.
		return [...new Map(inputs.map(i => [`${i.namespace}/${i.name}`, i])).values()];
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

	/**
	 * Bitbucket is not an issue provider on the ProviderBackend surface: Bitbucket Cloud deprecated its issue
	 * tracker in favor of dedicated issue integrations (e.g. Jira). The legacy per-repo `getUsersIssuesForRepo`
	 * client is retained only for autolink/hover enrichment, not for the ProviderBackend issue reads, so the
	 * facade reports issues as unsupported rather than serving a deprecated, partial source.
	 */
	override get supportsIssues(): boolean {
		return false;
	}

	private readonly storagePrefix = 'bitbucket';
	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const accountStorageKey = md5(this._session.accessToken);

		const storedAccount = this.ctx.storage.get(`${this.storagePrefix}:${accountStorageKey}:account`);
		const storedWorkspaces = this.ctx.storage.get(`${this.storagePrefix}:${accountStorageKey}:workspaces`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;

		const storedWorkspacesData = storedWorkspaces?.data as
			| ProviderApiCollectionResult<BitbucketWorkspaceDescriptor>
			| BitbucketWorkspaceDescriptor[]
			| undefined;
		let workspaces: ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined;
		if (!Array.isArray(storedWorkspacesData) && Array.isArray(storedWorkspacesData?.values)) {
			workspaces = {
				values: storedWorkspacesData.values.map((o: BitbucketWorkspaceDescriptor) => ({ ...o })),
				...(storedWorkspacesData.metadata != null ? { metadata: storedWorkspacesData.metadata } : {}),
			};
		}

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

		if (workspaces == null) {
			workspaces = await this.getProviderResourcesForCurrentUser(this._session, true);
			await this.ctx.storage.store(`${this.storagePrefix}:${accountStorageKey}:workspaces`, {
				v: 2,
				timestamp: Date.now(),
				data: workspaces,
			});
		}
		this._workspaces ??= new Map<string, ProviderApiCollectionResult<BitbucketWorkspaceDescriptor> | undefined>();
		this._workspaces.set(this._session.accessToken, workspaces);
	}

	protected override providerOnDisconnect(): void {
		this._accounts = undefined;
		this._workspaces = undefined;
	}
}
