import { gitHubPullRequestRelationshipQualifiers } from '@gitlens/git-github/api/pullRequestSearchQuery.js';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueSearchCriteria, IssueShape } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestMergeMethod,
	PullRequestSearchCriteria,
	PullRequestStackInfo,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { RepositoryDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import { getGitHubNoReplyAddressParts } from '@gitlens/git/remotes/github.js';
import type { PullRequestUrlIdentity } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Emitter } from '@gitlens/utils/event.js';
import { batch } from '@gitlens/utils/promise.js';
import type { IntegrationAuthenticationProviderDescriptor } from '../authentication/integrationAuthenticationProvider.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { toCollectionScopeFailure } from '../collectionMetadata.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationServiceContext } from '../context.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import type { SearchMyPullRequestsOptions, SearchPullRequestsOptions } from '../models/gitHostIntegration.js';
import { GitHostIntegration } from '../models/gitHostIntegration.js';
import type {
	ProviderIssueSearchPage,
	ProviderPullRequestSearchPage,
	SearchMyIssuesOptions,
} from '../models/integration.js';
import type { GitHubIntegrationIds } from './github/github.utils.js';
import { getGitHubPullRequestIdentityFromMaybeUrl } from './github/github.utils.js';
import type {
	ProviderApiPagedResult,
	ProviderHierarchyResult,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepoInput,
	ProviderRepository,
} from './models.js';
import {
	getProviderPullRequestIdentity,
	IssueFilter,
	providersMetadata,
	PullRequestFilter,
	toProviderPullRequest,
} from './models.js';
import type { ProvidersApi } from './providersApi.js';

type GitHubPullRequestFacetCursor = Record<string, string>;

function toPullRequestFacetCursor(value: unknown): GitHubPullRequestFacetCursor {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};

	return Object.fromEntries(
		Object.entries(value).filter(
			([key, cursor]) => key.length !== 0 && typeof cursor === 'string' && cursor.length !== 0,
		),
	);
}

function parsePullRequestFacetCursor(cursor: string | undefined): GitHubPullRequestFacetCursor {
	if (!cursor) return {};

	try {
		const parsed = JSON.parse(cursor) as unknown;
		if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) && 'cursors' in parsed) {
			const wrapped = parsed as { type?: unknown; cursors?: unknown };
			if (wrapped.type === 'cursor') {
				return toPullRequestFacetCursor(wrapped.cursors);
			}
		}

		return toPullRequestFacetCursor(parsed);
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
	/**
	 * Base URL handed to `@gitkraken/provider-apis`, which derives BOTH the REST and the GraphQL endpoint from it
	 * by appending GitHub Enterprise's paths. Only a GHE instance base belongs here; cloud passes `undefined`,
	 * the sole value that selects the cloud endpoints (see the cloud subclass).
	 */
	protected abstract get apiBaseUrl(): string | undefined;

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
			...(result.metadata != null ? { metadata: result.metadata } : {}),
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

		// `apiBaseUrl` is undefined for cloud (which is what selects the cloud endpoints) and the GHE instance base
		// for enterprise (inherited override).
		return api.getRepo(toTokenWithInfo(this.id, session), repo.owner, repo.name, repo.project, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyPullRequests(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyPullRequestsOptions,
	): Promise<PullRequest[] | undefined> {
		return (await this.authenticationService.apis.github)?.searchMyPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: repos?.map(r => `${r.owner}/${r.name}`),
				baseUrl: this.apiBaseUrl,
				silent: options?.silent,
				state: options?.state,
			},
			cancellation,
		);
	}

	protected override async getProviderMyPullRequestsForUser(
		session: ProviderAuthenticationSession,
		options?: {
			state?: PullRequestStateFilter[];
			cursor?: string;
			includeReviewRequested?: boolean;
			filters?: PullRequestFilter[];
			summary?: boolean;
		},
	): Promise<ProviderApiPagedResult<ProviderPullRequest> | undefined> {
		const explicitFilters = options?.filters?.length ? [...new Set(options.filters)] : undefined;
		// Every account-wide read goes through our own facet search — there is deliberately no SDK
		// `getPullRequestsForUser` fallback. It could express neither a state set, nor exact relationships (its
		// `involves:` is a different question), nor the full projection, so which reads it could serve depended on
		// the options, and the two routes disagreed on more than they had to: only this one applies the Launchpad
		// ignored/included repository and organization qualifiers, so the same read returned different pull
		// requests depending on options that were supposed to affect only projection or relationship. With no
		// state and no filters this emits a single facet with no relationship qualifier, which is GitHub's own
		// `involves:@me` and `is:open` default — the same question the fallback asked, now on one route.
		const github = await this.authenticationService.apis.github;
		if (github == null) return undefined;

		const requestedStates: PullRequestStateFilter[] =
			options?.state != null && options.state.length > 0 ? [...new Set(options.state)] : ['open'];
		const facets =
			explicitFilters?.length != null
				? requestedStates.flatMap(state =>
						explicitFilters.map(filter => ({
							key: `${state}:${filter}`,
							state: state,
							search: gitHubPullRequestRelationshipQualifiers[filter],
						})),
					)
				: requestedStates.flatMap(state => [
						{ key: state, state: state, search: undefined },
						...(options?.includeReviewRequested === true
							? [
									{
										key: `${state}:${PullRequestFilter.ReviewRequested}`,
										state: state,
										search: gitHubPullRequestRelationshipQualifiers[
											PullRequestFilter.ReviewRequested
										],
									},
								]
							: []),
					]);
		const cursors = parsePullRequestFacetCursor(options?.cursor);
		const hasResumableFacetCursor = Object.keys(cursors).length !== 0;
		const facetsWithCursor = facets.filter(facet => cursors[facet.key] != null);
		// The first call has no cursor, so query every requested state. A continuation only happens after a
		// prior page reported `more:true`, whose bundle carries a cursor for each facet still in flight;
		// facets absent from the bundle are exhausted, so re-querying them from scratch would refetch the
		// same PRs (duplicated by the dedup-free sweep) and waste an API call per page. Query only the
		// states that still have a cursor, but degrade a malformed/empty cursor bundle, or one that doesn't
		// apply to the current requested states, to the first page rather than returning an empty page.
		const facetsToQuery =
			options?.cursor != null && hasResumableFacetCursor && facetsWithCursor.length !== 0
				? facetsWithCursor
				: facets;
		const results = await Promise.allSettled(
			facetsToQuery.map(async facet => ({
				key: facet.key,
				result: await github.searchMyPullRequestsPage(this, toTokenWithInfo(this.id, session), {
					baseUrl: this.apiBaseUrl,
					state: facet.state,
					cursor: cursors[facet.key],
					summary: options?.summary,
					...(facet.search != null ? { search: facet.search, includeDefaultInvolvement: false } : undefined),
				}),
			})),
		);
		if (results.every(result => result.status === 'rejected')) {
			const first = results[0];
			if (first?.status === 'rejected') throw first.reason;
		}

		const values = new Map<string, ProviderPullRequest>();
		const nextCursors: GitHubPullRequestFacetCursor = {};
		const failures = [];
		let hasMore = false;
		let truncated = false;
		let structuralIncompleteness = false;
		let unkeyedPullRequest = 0;
		for (const outcome of results) {
			if (outcome.status === 'rejected') {
				failures.push(toCollectionScopeFailure({ providerId: this.id }, outcome.reason));
				truncated = true;
				continue;
			}

			const { key, result } = outcome.value;
			for (const pr of result.values) {
				const mapped = toProviderPullRequest(pr);
				const identity = getProviderPullRequestIdentity(mapped) ?? `unkeyed:${unkeyedPullRequest++}`;
				if (!values.has(identity)) {
					values.set(identity, mapped);
				}
			}
			if (result.hasMore) {
				if (result.cursor == null || result.cursor === '{}' || result.cursor === cursors[key]) {
					truncated = true;
					structuralIncompleteness = true;
				} else {
					hasMore = true;
					nextCursors[key] = result.cursor;
				}
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
			...(failures.length || structuralIncompleteness
				? {
						metadata: {
							completeness: 'partial' as const,
							...(failures.length ? { failures: failures } : {}),
						},
					}
				: undefined),
		};
	}

	protected override async searchProviderMyIssues(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
	): Promise<IssueShape[] | undefined> {
		return (await this.searchProviderMyIssuesWithTruncation(session, repos, cancellation))?.values;
	}

	/**
	 * GitHub's account-wide issue search pages authored/assigned/mentioned independently behind one composite
	 * cursor. This variant preserves that cursor and the provider's 1,000-result search ceiling signal.
	 *
	 * `options.filters` selects which of those three searches run, so a caller can narrow the union to just its
	 * own slice (e.g. `[Assignee]` ⇒ `assignee:@me`). Omitted keeps GitHub's own definition of "mine" (all three).
	 */
	protected override async searchProviderMyIssuesWithTruncation(
		session: ProviderAuthenticationSession,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchMyIssuesOptions,
	): Promise<{ values: IssueShape[]; truncated: boolean } | undefined> {
		// `includeAllAssignees` becomes `assignee:*`, which needs a scope to mean anything — with none it matches
		// millions of issues across all of GitHub rather than "assigned to anyone in the user's world". ANY scope
		// works (one repo, several, or an org), so this refuses only the genuinely unscoped read; the scoped
		// "assigned to anyone over these repos" request is served by `searchIssuesPage`.
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
				cursor: options?.cursor,
				sort: options?.sort,
				categories: options?.filters?.length
					? {
							authored: options.filters.includes(IssueFilter.Author),
							assigned: options.filters.includes(IssueFilter.Assignee),
							mentioned: options.filters.includes(IssueFilter.Mention),
						}
					: undefined,
			},
			cancellation,
		);
	}

	/**
	 * Filtered pull-request search over a repository/organization or explicit current-user relationship scope. The
	 * API client owns criteria sanitizing, facet unioning, ordering, and the composite cursor that carries GitHub's
	 * result-ceiling signal across pages.
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
		return (await this.authenticationService.apis.github)?.searchPullRequestsPage(
			this,
			toTokenWithInfo(this.id, session),
			{
				repos: options.repos?.map(r => `${r.namespace}/${r.name}`),
				org: options.org,
				criteria: options.criteria,
				baseUrl: this.apiBaseUrl,
				cursor: options.cursor,
				pageSize: options.pageSize,
				summary: options.summary,
			},
			cancellation,
		);
	}

	/**
	 * The filtered issue search: one GraphQL request per page, no forced relationship to the current user, and no
	 * route through the SDK's repo-scoped read (whose over-limit recovery walk can spend up to 128 requests).
	 *
	 * The criteria → qualifier translation and the ordering guarantee live in the API client
	 * (`GitHubApi.searchIssuesPage`), which is also where user input is sanitized so it can't inject a qualifier.
	 */
	protected override async searchProviderIssuesPage(
		session: ProviderAuthenticationSession,
		options: {
			repos?: ProviderRepoInput[];
			org?: string;
			criteria?: IssueSearchCriteria;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<ProviderIssueSearchPage | undefined> {
		return (await this.authenticationService.apis.github)?.searchIssuesPage(
			this,
			toTokenWithInfo(this.id, session),
			{
				// `namespace` is the owner for GitHub, which is how a `repo:` qualifier names a repository.
				repos: options.repos?.map(r => `${r.namespace}/${r.name}`),
				org: options.org,
				criteria: options.criteria,
				baseUrl: this.apiBaseUrl,
				includeBody: true,
				cursor: options.cursor,
				pageSize: options.pageSize,
			},
			cancellation,
		);
	}

	/**
	 * Counts several scopes in ONE request. GitHub's `search` reports `issueCount` on a zero-node selection, so a
	 * count preview costs no issue transfer — measured, 30 aliased counts are a single rate-limit point.
	 */
	protected override async countProviderIssues(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: IssueSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<(number | undefined)[] | undefined> {
		return (await this.authenticationService.apis.github)?.countIssues(
			this,
			toTokenWithInfo(this.id, session),
			scopes.map(s => ({
				repos: s.repos?.map(r => `${r.namespace}/${r.name}`),
				org: s.org,
				criteria: s.criteria,
			})),
			{ baseUrl: this.apiBaseUrl },
			cancellation,
		);
	}

	/**
	 * Resolves several issues by `(owner, repo, number)` in ONE request, by aliasing the point read rather than a
	 * search — see {@link GitHubApi.getIssuesBatch} for why that distinction is the whole design.
	 */
	protected override async getProviderIssuesBatch(
		session: ProviderAuthenticationSession,
		coordinates: readonly { owner: string; repo: string; number: number }[],
		cancellation?: AbortSignal,
	): Promise<(IssueShape | undefined)[] | undefined> {
		return (await this.authenticationService.apis.github)?.getIssuesBatch(
			this,
			toTokenWithInfo(this.id, session),
			coordinates,
			{ baseUrl: this.apiBaseUrl, includeBody: true },
			cancellation,
		);
	}

	/**
	 * Counts several pull-request scopes in ONE request. Like {@link countProviderIssues}, GitHub's `search`
	 * reports `issueCount` on a zero-node selection, so a count preview costs no pull-request transfer.
	 */
	protected override async countProviderPullRequests(
		session: ProviderAuthenticationSession,
		scopes: readonly { repos?: ProviderRepoInput[]; org?: string; criteria?: PullRequestSearchCriteria }[],
		cancellation?: AbortSignal,
	): Promise<(number | undefined)[] | undefined> {
		return (await this.authenticationService.apis.github)?.countPullRequests(
			this,
			toTokenWithInfo(this.id, session),
			scopes.map(s => ({
				repos: s.repos?.map(r => `${r.namespace}/${r.name}`),
				org: s.org,
				criteria: s.criteria,
			})),
			{ baseUrl: this.apiBaseUrl },
			cancellation,
		);
	}

	protected override async searchProviderPullRequests(
		session: ProviderAuthenticationSession,
		searchQuery: string,
		repos?: GitHubRepositoryDescriptor[],
		cancellation?: AbortSignal,
		options?: SearchPullRequestsOptions,
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

	/**
	 * Stack membership for every stacked pull request in the repository, keyed by pull request number.
	 *
	 * List surfaces get their pull requests from the shared providers API, whose type carries no stack
	 * membership, so the `stack`/`stackEntry` fields selected on the native per-pull-request reads never
	 * reach them. This fills that gap in a single request for the whole repository, rather than a
	 * per-pull-request enrichment that would scale with the list.
	 *
	 * `undefined` means unavailable (not enrolled in the preview, or not connected) as distinct from an
	 * empty map, which means the repository genuinely has no stacks.
	 */
	override async getStacksByPullRequestNumber(
		owner: string,
		repo: string,
		cancellation?: AbortSignal,
	): Promise<Map<number, PullRequestStackInfo> | undefined> {
		// The shared read path — it refreshes an expired session before use, which a bare `getSession()`
		// does not (it returns the cached session verbatim once one exists, expired or not).
		const session = await this.resolveReadSession(undefined, undefined);
		if (session == null) return undefined;

		const stacks = await (
			await this.authenticationService.apis.github
		)?.getRepositoryStacks(
			this,
			toTokenWithInfo(this.id, session),
			owner,
			repo,
			{
				baseUrl: this.apiBaseUrl,
			},
			cancellation,
		);
		if (stacks == null) return undefined;

		const byNumber = new Map<number, PullRequestStackInfo>();
		for (const stack of stacks) {
			// Defensive: this is a public-preview payload reaching us through an unvalidated cast, and a
			// malformed entry must cost its own stack's badges, not the whole panel.
			const members = stack?.pull_requests;
			const baseRef = stack?.base?.ref;
			if (members == null || baseRef == null) continue;

			// `pull_requests` is ordered bottom to top, and `position` is 1-based from the bottom.
			members.forEach((pr, i) => {
				byNumber.set(pr.number, {
					id: stack.id,
					number: stack.number,
					size: members.length,
					position: i + 1,
					baseRef: baseRef,
				});
			});
		}

		return byNumber;
	}

	protected override async mergeProviderPullRequest(
		session: ProviderAuthenticationSession,
		pr: PullRequest,
		options?: {
			mergeMethod?: PullRequestMergeMethod;
		},
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const id = pr.nodeId;
		const headRefSha = pr.refs?.head?.sha;
		if (id == null || headRefSha == null) return false;

		const api = await this.authenticationService.apis.github;

		// GitHub rejects stacked pull requests on the legacy merge mutation, so they take the
		// asynchronous merge instead — which also lands every layer below this one.
		if (pr.stack != null) {
			return (
				(await api?.mergeStackedPullRequest(
					this,
					toTokenWithInfo(this.id, session),
					pr.repository.owner,
					pr.repository.repo,
					Number(pr.id),
					headRefSha,
					{
						mergeMethod: options?.mergeMethod,
						baseUrl: this.apiBaseUrl,
					},
					cancellation,
				)) ?? false
			);
		}

		return (
			api?.mergePullRequest(
				this,
				toTokenWithInfo(this.id, session),
				id,
				headRefSha,
				{
					mergeMethod: options?.mergeMethod,
					baseUrl: this.apiBaseUrl,
				},
				cancellation,
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

	protected override get apiBaseUrl(): string | undefined {
		// Undefined on purpose, NOT 'https://api.github.com'. `@gitkraken/provider-apis` treats this value as an
		// *enterprise* base and derives both endpoints from it by appending GitHub Enterprise's paths:
		// `getRESTBaseUrl` appends `/api/v3` and `getGraphQLEndpoint` appends `/api/graphql` (githubHelpers.ts).
		// Handing it the cloud host therefore built `https://api.github.com/api/graphql`, which GitHub answers
		// 404 — every cloud GraphQL read (orgs, repos, PR/issue search) failed as `not-found`. Omitting it is
		// what selects the cloud endpoints (`GITHUB_API_URL` / `GITHUB_GRAPHQL_API_URL`), so cloud must pass
		// nothing and only GHE passes its instance base.
		return undefined;
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
