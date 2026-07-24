import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { getGitHubNoReplyAddressParts } from '@gitlens/git/remotes/github.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Emitter } from '@gitlens/utils/event.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { batch } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { SearchMyPullRequestsOptions } from '../models/gitHostIntegration.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { SearchMyIssuesOptions } from '../models/integration.js';
import type { GitHubIntegrationIds } from './github/github.utils.js';
import { getGitHubPullRequestIdentityFromMaybeUrl } from './github/github.utils.js';
import type {
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepository,
} from './models.js';
import { providersMetadata, toProviderPullRequest, toProviderPullRequestStates } from './models.js';
import type { ProvidersApi } from './providersApi.js';

type GitHubPullRequestStateCursor = Partial<Record<PullRequestStateFilter, string>>;

function isPullRequestStateFilter(key: string): key is PullRequestStateFilter {
	return key === 'open' || key === 'closed' || key === 'merged' || key === 'all';
}

function toPullRequestStateCursor(value: unknown): GitHubPullRequestStateCursor {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};

	return Object.fromEntries(
		Object.entries(value).filter(
			([key, cursor]) => isPullRequestStateFilter(key) && typeof cursor === 'string' && cursor.length !== 0,
		),
	);
}

function parsePullRequestStateCursor(cursor: string | undefined): GitHubPullRequestStateCursor {
	if (!cursor) return {};

	try {
		const parsed = JSON.parse(cursor) as unknown;
		if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) && 'cursors' in parsed) {
			const wrapped = parsed as { type?: unknown; cursors?: unknown };
			if (wrapped.type === 'cursor') {
				return toPullRequestStateCursor(wrapped.cursors);
			}
		}

		return toPullRequestStateCursor(parsed);
	} catch {
		return {};
	}
}

const metadata = providersMetadata[GitCloudHostIntegrationId.GitHub];
const authProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: metadata.id,
	scopes: metadata.scopes,
});

const cloudEnterpriseMetadata = providersMetadata[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise];
const cloudEnterpriseAuthProvider: IntegrationAuthenticationProviderDescriptor = Object.freeze({
	id: cloudEnterpriseMetadata.id,
	scopes: cloudEnterpriseMetadata.scopes,
});

export type GitHubRepositoryDescriptor = RepositoryDescriptor;

/** How many per-login SSH signing-key lookups to run concurrently, to avoid a request burst that trips rate limiting. */
const sshSigningKeyResolveBatchSize = 10;

abstract class GitHubIntegrationBase<ID extends GitHubIntegrationIds> extends GitHostIntegration<
	ID,
	GitHubRepositoryDescriptor
> {
	protected abstract get apiBaseUrl(): string;

	protected override async getProviderAccountForCommit(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		return (await this.authenticationService.apis.github)?.getAccountForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderAccountForEmail(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.github)?.getAccountForEmail(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			email,
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderSshSigningKeysForEmails(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		emails: string[],
	): Promise<Map<string, string[]>> {
		const result = new Map<string, string[]>();

		const api = await this.authenticationService.apis.github;
		if (api == null) return result;

		const token = toTokenWithInfo(this.id, session);

		// Resolve each email to a login: GitHub noreply addresses encode it locally; the rest are resolved in a single
		// batched GraphQL request rather than one round-trip per email.
		const loginByEmail = new Map<string, string>();
		const toResolve: string[] = [];
		for (const email of emails) {
			const login = getGitHubNoReplyAddressParts(email)?.login;
			if (login != null) {
				loginByEmail.set(email.toLowerCase(), login);
			} else {
				toResolve.push(email);
			}
		}

		if (toResolve.length) {
			const resolved = await api.getAccountsForEmails(this, token, toResolve, { baseUrl: this.apiBaseUrl });
			for (const [emailLower, login] of resolved) {
				loginByEmail.set(emailLower, login);
			}
		}

		// Fetch signing keys once per distinct login (REST has no batch endpoint), in bounded batches rather than firing
		// all lookups at once, to avoid a request burst that could trip secondary rate limiting. Then map keys to each email.
		const keysByLogin = new Map<string, string[]>();
		await batch([...new Set(loginByEmail.values())], sshSigningKeyResolveBatchSize, async login => {
			const keys = await api.getUserSshSigningKeys(this, token, login, { baseUrl: this.apiBaseUrl });
			keysByLogin.set(
				login,
				keys.map(k => k.key),
			);
		});

		for (const [emailLower, login] of loginByEmail) {
			result.set(emailLower, keysByLogin.get(login) ?? []);
		}

		return result;
	}

	protected override async getProviderDefaultBranch(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
	): Promise<DefaultBranch | undefined> {
		return (await this.authenticationService.apis.github)?.getDefaultBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderLinkedIssueOrPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		{ id }: { id: string; key: string },
	): Promise<IssueOrPullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getIssueOrPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderIssue(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<Issue | undefined> {
		return (await this.authenticationService.apis.github)?.getIssue(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			Number(id),
			{
				baseUrl: this.apiBaseUrl,
				includeBody: true,
			},
		);
	}

	protected override async getProviderPullRequest(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		id: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getPullRequest(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			parseInt(id, 10),
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForBranch(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const { include, ...opts } = options ?? {};

		const toGitHubPullRequestState = (await import(/* webpackChunkName: "integrations" */ './github/models.js'))
			.toGitHubPullRequestState;
		return (await this.authenticationService.apis.github)?.getPullRequestForBranch(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			branch,
			{
				...opts,
				include: include?.map(s => toGitHubPullRequestState(s)),
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderPullRequestForCommit(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		rev: string,
	): Promise<PullRequest | undefined> {
		return (await this.authenticationService.apis.github)?.getPullRequestForCommit(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			rev,
			{
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override async getProviderRepositoryMetadata(
		session: ProviderAuthenticationSession,
		repo: GitHubRepositoryDescriptor,
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		return (await this.authenticationService.apis.github)?.getRepositoryMetadata(
			this,
			toTokenWithInfo(this.id, session),
			repo.owner,
			repo.name,
			{
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
	}

	protected override async getProviderOrganizationsForUser(
		session: ProviderAuthenticationSession,
	): Promise<ProviderHierarchyResult<ProviderOrganization> | undefined> {
		const api = await this.getProvidersApi();
		const result = await api.getGitHubOrgsForCurrentUser(toTokenWithInfo(this.id, session), {
			baseUrl: this.apiBaseUrl,
		});
		return {
			values: result.values.map(o => ({
				id: o.id,
				providerId: this.id,
				name: o.username,
				url: `https://${this.domain}/${o.username}`,
			})),
			...(result.truncated ? { truncated: true } : {}),
		};
	}

	protected override async getProviderRepositoriesForOrg(
		session: ProviderAuthenticationSession,
		org: string,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		return api.getReposForOrg(toTokenWithInfo(this.id, session), org, {
			baseUrl: this.apiBaseUrl,
			cursor: options?.cursor,
		});
	}

	protected override async getProviderRepositoriesForUser(
		session: ProviderAuthenticationSession,
		options?: { cursor?: string },
	): Promise<ProviderHierarchyResult<ProviderRepository> | undefined> {
		const api = await this.getProvidersApi();
		// `/user/repos` with the full affiliation set: the user's own repos, collaborations, and org-member
		// repos — matching gkcli's org-less `provider repos github` walk (not every repo of every org).
		return api.getReposForCurrentUser(toTokenWithInfo(this.id, session), {
			affiliations: ['owner', 'collaborator', 'organization_member'],
			baseUrl: this.apiBaseUrl,
			cursor: options?.cursor,
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

		// `apiBaseUrl` is api.github.com for cloud and the GHE instance base for enterprise (inherited override).
		return api.getRepo(toTokenWithInfo(this.id, session), repo.owner, repo.name, repo.project, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		silent?: boolean,
		state?: PullRequestStateFilter,
		_options?: SearchMyPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchMyPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				silent: silent,
				state: state,
			},
			cancellation,
		);
	}

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: { state?: PullRequestStateFilter[]; cursor?: string },
	): Promise<PagedResult<ProviderPullRequest> | undefined> {
		// An empty `state` array means "no state filter", not "read zero states": fall through to the
		// account-wide `involves:` path rather than resolving `Promise.all([])` to an empty result.
		if (options?.state != null && options.state.length > 0) {
			const github = await this.authenticationService.apis.github;
			if (github == null) return undefined;

			const requestedStates = [...new Set(options.state)];
			const cursors = parsePullRequestStateCursor(options.cursor);
			const hasResumableStateCursor = Object.keys(cursors).length !== 0;
			const statesWithCursor = requestedStates.filter(state => cursors[state] != null);
			// The first call has no cursor, so query every requested state. A continuation only happens after a
			// prior page reported `more:true`, whose bundle carries a cursor for each state still in flight;
			// states absent from the bundle are exhausted, so re-querying them from scratch would refetch the
			// same PRs (duplicated by the dedup-free sweep) and waste an API call per page. Query only the
			// states that still have a cursor, but degrade a malformed/empty cursor bundle, or one that doesn't
			// apply to the current requested states, to the first page rather than returning an empty page.
			const statesToQuery =
				options.cursor != null && hasResumableStateCursor && statesWithCursor.length !== 0
					? statesWithCursor
					: requestedStates;
			const results = await Promise.all(
				statesToQuery.map(async state => ({
					state: state,
					result: await github.searchMyPullRequestsPage(this, toTokenWithInfo(this.id, session), {
						baseUrl: this.apiBaseUrl,
						state: state,
						cursor: cursors[state],
					}),
				})),
			);

			const values = new Map<string, ProviderPullRequest>();
			const nextCursors: GitHubPullRequestStateCursor = {};
			let hasMore = false;
			let truncated = false;
			for (const { state, result } of results) {
				for (const pr of result.values) {
					values.set(pr.url, toProviderPullRequest(pr));
				}
				if (result.hasMore && result.cursor != null) {
					hasMore = true;
					nextCursors[state] = result.cursor;
				}
				if (result.truncated) {
					truncated = true;
				}
			}

			return {
				values: [...values.values()],
				paging: {
					more: hasMore,
					cursor: hasMore ? JSON.stringify({ type: 'cursor', cursors: nextCursors }) : '{}',
					truncated: truncated || undefined,
				},
			};
		}

		// The current user's login scopes the account-wide `involves:` query (see getPullRequestsForUser →
		// getPullRequestsAssociatedWithUser). Resolve it from THIS session (multi-account safe).
		const username = (await this.getProviderCurrentAccount(session))?.username;
		if (username == null) return undefined;

		const api = await this.getProvidersApi();
		const states = toProviderPullRequestStates(options?.state);
		const result = await api.getPullRequestsForUser(toTokenWithInfo(this.id, session), username, {
			baseUrl: this.apiBaseUrl,
			states: states,
			cursor: options?.cursor,
		});
		if (result == null) return undefined;

		// The SDK's account-wide `involves:` search (getPullRequestsAssociatedWithUser) drops the `states`
		// input entirely — it never reaches the query's state qualifier — so the read comes back with every
		// state. Filter client-side to honor the requested states (e.g. the closed+merged "done" sweep, which
		// would otherwise include open PRs).
		if (states != null) {
			return { ...result, values: result.values.filter(pr => states.includes(pr.state)) };
		}
		return result;
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, repos, cancellation))?.values;
	}

	/**
	 * GitHub's account-wide issue search caps each of authored/assigned/mentioned at 100 with no cursor, so the
	 * result can be incomplete. This variant preserves the `truncated` flag the API reports (the abstract
	 * {@link searchProviderMyIssues} contract can't carry it) so the facade can surface the incompleteness.
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<{ values: IssueShape[]; truncated: boolean } | undefined> {
		if ((repos == null || repos.length === 0) && options?.includeAllAssignees) {
			throw new IntegrationReadUnavailableError(
				this.name,
				'`includeAllAssignees` is not supported for account-wide issue reads; scope the read to repositories instead.',
			);
		}

		return (await this.authenticationService.apis.github)?.searchMyIssues(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				includeBody: true,
				includeAllAssignees: options?.includeAllAssignees,
			},
			cancellation,
		);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: { include?: PullRequestState[] },
	): Promise<PullRequest[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				search: searchQuery,
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				...options,
			},
			cancellation,
		);
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
	): Promise<boolean> {
		const id = pr.nodeId;
		const headRefSha = pr.refs?.head?.sha;
		if (id == null || headRefSha == null) return false;
		return (
			(await this.authenticationService.apis.github)?.mergePullRequest(
				this,
				toTokenWithInfo(this.id, session),
				id,
				headRefSha,
				{
					mergeMethod: options?.mergeMethod,
					baseUrl: this.apiBaseUrl,
				},
			) ?? false
		);
	}

	protected override async getProviderCurrentAccount(
		session: ProviderAuthenticationSession,
		options?: { avatarSize?: number },
	): Promise<Account | undefined> {
		return (await this.authenticationService.apis.github)?.getCurrentAccount(
			this,
			toTokenWithInfo(this.id, session),
			{
				...options,
				baseUrl: this.apiBaseUrl,
			},
		);
	}

	protected override getProviderPullRequestIdentityFromMaybeUrl(search: string): PullRequestUrlIdentity | undefined {
		return getGitHubPullRequestIdentityFromMaybeUrl(search, this.id);
	}
}

export class GitHubIntegration extends GitHubIntegrationBase<GitCloudHostIntegrationId.GitHub> {
	readonly authProvider = authProvider;
	readonly id = GitCloudHostIntegrationId.GitHub;
	protected readonly key = this.id;
	readonly name: string = 'GitHub';
	get domain(): string {
		return metadata.domain;
	}

	protected override get apiBaseUrl(): string {
		return 'https://api.github.com';
	}

	override access(): Promise<boolean> {
		// Always allow GitHub cloud integration access
		return Promise.resolve(true);
	}

	// This is a special case for GitHub because we use VSCode's GitHub session, and it can be disconnected
	// outside of the extension.
	override async refresh(): Promise<void> {
		const authProvider = await this.authenticationService.get(this.authProvider.id);
		const session = await authProvider.getSession(this.authProviderDescriptor);
		if (session == null && this.maybeConnected) {
			void this.disconnect({ silent: true });
		} else {
			if (session?.accessToken !== this._session?.accessToken) {
				this._session = undefined;
			}
			super.refresh();
		}
	}
}

export class GitHubEnterpriseIntegration extends GitHubIntegrationBase<GitSelfManagedHostIntegrationId.CloudGitHubEnterprise> {
	readonly authProvider = cloudEnterpriseAuthProvider;
	readonly id = GitSelfManagedHostIntegrationId.CloudGitHubEnterprise;
	protected readonly key;
	readonly name = 'GitHub Enterprise';
	get domain(): string {
		return this._domain;
	}

	protected override get apiBaseUrl(): string {
		return `https://${this._domain}/api/v3`;
	}

	constructor(
		ctx: IntegrationServiceContext,
		authenticationService: IntegrationAuthenticationService,
		getProvidersApi: () => Promise<ProvidersApi>,
		didChangeConnection: Emitter<IntegrationConnectionChangeEvent>,
		private readonly _domain: string,
	) {
		super(ctx, authenticationService, getProvidersApi, didChangeConnection);
		this.key = `${this.id}:${this.domain}` as const;
	}
}
