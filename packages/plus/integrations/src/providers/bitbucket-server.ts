import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestType } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestSearchCriteria,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import { CancellationError, raceWithSignal } from '@gitlens/utils/cancellation.js';
import { md5 } from '@gitlens/utils/crypto.js';
import type { Emitter } from '@gitlens/utils/event.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { nonnullSettled } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type {
	AuthenticationSessionLike as AuthenticationSession,
	ProviderAuthenticationSession,
} from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import type { ResponseHeaders } from '../errors.js';
import { AuthenticationError, getResponseHeader } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { SearchMyPullRequestsOptions, SearchPullRequestsOptions } from '../models/gitHostIntegration.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationKey, ProviderPullRequestCount, ProviderPullRequestSearchPage } from '../models/integration.js';
import type { BitbucketServerSearchUser } from './bitbucket-server/pullRequestSearch.js';
import type { BitbucketRepositoryDescriptor } from './bitbucket/models.js';
import type {
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderRepository,
} from './models.js';
import {
	fromProviderPullRequest,
	providerPullRequestMatchesSearch,
	ProviderPullRequestReviewState,
	providersMetadata,
	PullRequestFilter,
	toProviderPullRequestStates,
} from './models.js';
import type { ProvidersApi } from './providersApi.js';
import {
	collectProviderPagedResult,
	flatSettledOrThrow,
	parsePageCursor,
	toPageCursor,
} from './utils/providerPaging.js';

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
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
	}

	get domain(): string {
		return this._domain;
	}

	protected apiBaseUrlFor(session: ProviderAuthenticationSession): string {
		return this.getSelfManagedApiBaseUrl(session);
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
			baseUrl: this.apiBaseUrlFor(session),
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
		return (await this.authenticationService.apis.bitbucket)?.getServerAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrlFor(session),
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
		return (await this.authenticationService.apis.bitbucket)?.getServerPullRequestById(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			id,
			this.apiBaseUrlFor(session),
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
		return (await this.authenticationService.apis.bitbucket)?.getServerPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			this.apiBaseUrlFor(session),
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: BitbucketRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.bitbucket)?.getServerPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			this.apiBaseUrlFor(session),
		);
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
			baseUrl: this.apiBaseUrlFor(session),
		});
	}

	protected override async getProviderRepositoryMetadata(
		_session: AuthenticationSession,
		_repo: BitbucketRepositoryDescriptor,
		_cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return Promise.resolve(undefined);
	}

	/**
	 * Accounts by {@link getAccountKey}. One integration serves every installation on its host, and installations
	 * mounted at different context paths are different servers whose users differ, even under the same token.
	 */
	private _accounts: Map<string, Account | undefined> | undefined;

	/** The installation the session's reads address, plus the credential — what decides whose account it is. */
	private getAccountKey(session: ProviderAuthenticationSession): string {
		return `${this.apiBaseUrlFor(session)}\n${session.accessToken}`;
	}

	/**
	 * The account request the account cache would otherwise answer; see `IntegrationBase.validateCredential`. Needed
	 * without any discovery cache: a repo-scoped pull request read fans out across its repositories in the SDK with
	 * no request to the connection first, so a dead token comes back as one refused repository per request.
	 */
	protected override async validateCredential(session: ProviderAuthenticationSession): Promise<void> {
		const api = await this.getProvidersApi();
		const user = await api
			.getCurrentUser(toTokenWithInfo(this.id, session), { baseUrl: this.apiBaseUrlFor(session) })
			.catch((ex: unknown) => {
				// Bitbucket Data Center names the user it authenticated in `X-AUSERNAME`, and answers a dead token
				// exactly as it answers no credential: the same 401 and body, without that header. So a refusal that
				// names a user came from a credential that authenticated, e.g. a project access token's bot user,
				// which `/users` may refuse, and proves nothing about the scopes' refusals.
				const headers = (ex as { original?: { response?: { headers?: ResponseHeaders } } }).original?.response
					?.headers;
				if (ex instanceof AuthenticationError && getResponseHeader(headers, 'x-ausername')) {
					throw new Error('Bitbucket Data Center could not confirm the credential', { cause: ex });
				}
				throw ex;
			});
		if (user == null) {
			throw new Error('Bitbucket Data Center did not confirm the credential');
		}
	}

	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
	): Promise<Account | undefined> {
		const key = this.getAccountKey(session);
		this._accounts ??= new Map<string, Account | undefined>();

		const cachedAccount = this._accounts.get(key);
		if (cachedAccount == null) {
			const api = await this.getProvidersApi();
			const user = await api.getCurrentUser(toTokenWithInfo(this.id, session), {
				baseUrl: this.apiBaseUrlFor(session),
			});
			this._accounts.set(
				key,
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

		return this._accounts.get(key);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization>> {
		const api = await this.getProvidersApi();
		return api.getBitbucketServerProjects(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
			session.id,
		);
	}

	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository>> {
		const api = await this.getProvidersApi();
		return api.getBitbucketServerRepositories(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
			session.id,
			{
				project: org,
				cursor: options?.cursor,
			},
		);
	}

	protected override async getProviderRepositoriesForUser(
		session: ProviderAuthenticationSession,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository>> {
		const api = await this.getProvidersApi();
		return api.getBitbucketServerRepositories(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
			session.id,
			options,
		);
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: BitbucketRepositoryDescriptor[],
		_cancellation?: AbortSignal,
		options?: SearchMyPullRequestsOptions,
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
			this.apiBaseUrlFor(session),
			{ states: toProviderPullRequestStates(options?.state) },
		);
		return prs?.data.map(pr => fromProviderPullRequest(pr, this));
	}

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string; filters?: PullRequestFilter[] },
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		const api = await this.getProvidersApi();
		const states = toProviderPullRequestStates(options?.state);
		// provider-apis translates the public 1-based `page` to Bitbucket Server's `start` offset and normalizes
		// `nextPageStart` back to the next page number. Thread that number inside our opaque cursor so the
		// ProviderBackend sweep drives the drain (bounded by its maxPages).
		const page = parsePageCursor(options?.cursor);
		const result = await api.getBitbucketServerPullRequestsForCurrentUser(
			toTokenWithInfo(this.id, session),
			this.apiBaseUrlFor(session),
			{ states: states, page: page },
		);
		if (result == null) return undefined;

		const account = options?.filters?.length ? await this.getProviderCurrentAccount(session) : undefined;
		const identifiers = new Set([account?.id, account?.username].filter((id): id is string => id != null));
		if (options?.filters?.length && identifiers.size === 0) {
			throw new Error(
				'Unable to resolve the current Bitbucket Data Center account for the requested pull request filters.',
			);
		}

		const values = options?.filters?.length
			? result.data.filter(pr => {
					const isCurrentUser = (user: { id?: string | null; username?: string | null } | null | undefined) =>
						user != null &&
						((user.id != null && identifiers.has(user.id)) ||
							(user.username != null && identifiers.has(user.username)));
					const isAuthor = isCurrentUser(pr.author);
					const isRequestedReviewer = pr.reviews?.some(
						review =>
							isCurrentUser(review.reviewer) &&
							review.state === ProviderPullRequestReviewState.ReviewRequested,
					);
					return (
						(options.filters!.includes(PullRequestFilter.Author) && isAuthor) ||
						(options.filters!.includes(PullRequestFilter.ReviewRequested) && isRequestedReviewer)
					);
				})
			: result.data;

		return {
			values: values,
			paging: {
				more: result.hasMore,
				cursor: result.hasMore && result.nextPage != null ? toPageCursor(result.nextPage) : '{}',
			},
		};
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: BitbucketRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		if (cancellation?.aborted) throw new CancellationError();

		const api = await this.getProvidersApi();
		if (!api) return undefined;

		const repoInputs =
			repos != null
				? repos.map(r => ({ name: r.name, namespace: r.owner }))
				: await this.getWorkspaceRepoInputs();
		if (cancellation?.aborted) throw new CancellationError();
		// An explicitly-empty `repos` means "search these zero repos" -> no results; reserve `undefined`
		// ("scope couldn't be determined") for when no repos were requested and none were discovered.
		if (repoInputs.length === 0) return repos != null ? [] : undefined;

		const token = toTokenWithInfo(this.id, session);
		const states = toProviderPullRequestStates(options?.include);
		const providerPullRequests = await flatSettledOrThrow(
			repoInputs.map(async repo => {
				const result = await collectProviderPagedResult(cursor => {
					if (cancellation?.aborted) throw new CancellationError();

					return api.getPullRequestsForRepo(token, repo, {
						baseUrl: this.apiBaseUrlFor(session),
						cursor: cursor,
						states: states,
					});
				});
				return result.values;
			}),
		);
		if (cancellation?.aborted) throw new CancellationError();

		return providerPullRequests
			.filter(pr => providerPullRequestMatchesSearch(pr, searchQuery))
			.map(pr => fromProviderPullRequest(pr, this));
	}

	/**
	 * The filtered pull-request search, read by this module's own requests rather than the SDK's: the SDK's list
	 * reads carry no text, draft or participant-status filter and no per-facet continuation. Every request goes to
	 * the session's own address, context path included, so one connection's cursor can't be replayed on another.
	 */
	protected override async searchProviderPullRequestsPage(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			cursor?: string;
			pageSize?: number;
			summary?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestSearchPage | undefined> {
		const api = await this.getProvidersApi();
		return api.searchBitbucketServerPullRequestsPage(
			toTokenWithInfo(this.id, session),
			{
				baseUrl: this.apiBaseUrlFor(session),
				connectionId: session.id,
				provider: this,
				repos: options.repos,
				org: options.org,
				criteria: options.criteria,
				currentUser: await this.getSearchUser(session, options.criteria, cancellation),
				cursor: options.cursor,
				pageSize: options.pageSize,
			},
			cancellation,
		);
	}

	/**
	 * Counts each scope by reading it, since Bitbucket Data Center has neither a count query nor a total on its
	 * pages. The facade hands over one scope per call and runs those calls concurrently (see `countPullRequests`),
	 * so scopes here are counted one after another rather than multiplying that concurrency.
	 */
	protected override async countProviderPullRequests(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<ProviderPullRequestCount[] | undefined> {
		const api = await this.getProvidersApi();
		const token = toTokenWithInfo(this.id, session);
		const counts: ProviderPullRequestCount[] = [];
		for (const scope of scopes) {
			counts.push(
				await api.countBitbucketServerPullRequests(
					token,
					{
						baseUrl: this.apiBaseUrlFor(session),
						repos: scope.repos,
						org: scope.org,
						criteria: scope.criteria,
						currentUser: await this.getSearchUser(session, scope.criteria, cancellation),
					},
					cancellation,
				),
			);
		}
		return counts;
	}

	/**
	 * The session's own user, which a relationship facet filters by. Resolved per session rather than from the
	 * primary connection, so a read pinned to one account never filters by another's identity; an account that
	 * can't be resolved refuses the read instead of widening it to everyone's pull requests.
	 *
	 * The lookup is raced against `cancellation` so a cancelled read settles at once. The SDK's current-user read
	 * takes no signal, so the request itself runs on; its answer still lands in the per-token account cache, so a
	 * cold lookup a cancellation abandoned isn't wasted on the next read.
	 */
	private async getSearchUser(
		session: ProviderAuthenticationSession,
		criteria: PullRequestSearchCriteria | undefined,
		cancellation: AbortSignal | undefined,
	): Promise<BitbucketServerSearchUser | undefined> {
		if (!criteria?.relationships?.length) return undefined;

		const lookup = this.getProviderCurrentAccount(session);
		const account = await (cancellation != null ? raceWithSignal(lookup, cancellation) : lookup);
		if (account?.id == null || account.username == null) {
			throw new Error('Unable to resolve the current Bitbucket Data Center account for a relationship search.');
		}

		return { id: account.id, username: account.username };
	}

	private async getWorkspaceRepoInputs(): Promise<{ name: string; namespace: string }[]> {
		const remotes = await this.ctx.repositories.getOpenRemotes();
		const inputs = await nonnullSettled(
			remotes.map(async (r: GitRemote) => {
				const integration = await this.authenticationService.getByRemote(r);
				if (integration !== this) return undefined;

				// Use the remote provider's parsing so the Bitbucket Server `scm/<project>/<repo>` prefix is
				// stripped; a raw `path.split('/')` would yield namespace=`scm`, name=`<project>`.
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
		_session: AuthenticationSession,
		_repos?: BitbucketRepositoryDescriptor[],
	): Promise<IssueShape[] | undefined> {
		return Promise.resolve(undefined);
	}

	/**
	 * Bitbucket Data Center exposes no issue tracker at all (issues live in Jira), so — like Bitbucket Cloud,
	 * whose own tracker is deprecated — it is not an issue provider on the ProviderBackend surface. Without this
	 * the facade would take `supportsIssues`' default `true` and route the read to a provider that registers no
	 * issue client: the repo-scoped path fails with the SDK's `does not support function: getIssuesForReposFn`
	 * as an opaque `kind: 'other'` warning, and `broadenIssues` first drains every repo of the org before hitting
	 * the same failure. Its metadata already declares no issue filters, so this keeps both halves of the
	 * capability answer consistent.
	 */
	override get supportsIssues(): boolean {
		return false;
	}

	private readonly storagePrefix = 'bitbucket-server';
	protected override async providerOnConnect(): Promise<void> {
		if (this._session == null) return;

		const accountKey = this.getAccountKey(this._session);
		const accountStorageKey = md5(accountKey);

		const storedAccount = this.ctx.storage.get(`${this.storagePrefix}:${accountStorageKey}:account`);

		let account: Account | undefined = storedAccount?.data ? { ...storedAccount.data, provider: this } : undefined;

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
		this._accounts.set(accountKey, account);
	}

	protected override providerOnDisconnect(): void {
		this._accounts = undefined;
	}
}
