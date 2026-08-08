import { graphql, GraphqlResponseError } from '@octokit/graphql';
import { request } from '@octokit/request';
import { RequestError } from '@octokit/request-error';
import type { Endpoints, RequestParameters } from '@octokit/types';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestClientError,
	RequestNotFoundError,
	RequestRateLimitError,
} from '@gitlens/git/errors.js';
import type { Account, UnidentifiedAuthor } from '@gitlens/git/models/author.js';
import type { DefaultBranch } from '@gitlens/git/models/defaultBranch.js';
import type { Issue, IssueSearchCriteria, IssueShape, IssueSorting } from '@gitlens/git/models/issue.js';
import { defaultIssueSort } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequest,
	PullRequestSearchCriteria,
	PullRequestShape,
	PullRequestState,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { RepositoryMetadata } from '@gitlens/git/models/repositoryMetadata.js';
import type { GitRevisionRange } from '@gitlens/git/models/revision.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type { RepositoryVisibility } from '@gitlens/git/providers/types.js';
import { getGitHubNoReplyAddressParts } from '@gitlens/git/remotes/github.js';
import { effectiveIssueSort, getIssueComparator } from '@gitlens/git/utils/issue.utils.js';
import {
	createRevisionRange,
	getRevisionRangeParts,
	isRevisionRange,
	isSha,
} from '@gitlens/git/utils/revision.utils.js';
import { chunk } from '@gitlens/utils/array.js';
import { base64 } from '@gitlens/utils/base64.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { uniqueBy } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { parseUri } from '@gitlens/utils/uri.js';
import type { Version } from '@gitlens/utils/version.js';
import { fromString, satisfies } from '@gitlens/utils/version.js';
import type {
	GitHubBlame,
	GitHubBlameRange,
	GitHubBranch,
	GitHubCommit,
	GitHubCommitRef,
	GitHubContributor,
	GitHubIssue,
	GitHubIssueOrPullRequest,
	GitHubPagedResult,
	GitHubPageInfo,
	GitHubPullRequest,
	GitHubPullRequestLite,
	GitHubPullRequestState,
	GitHubSshSigningKey,
	GitHubTag,
} from '../models.js';
import {
	fromGitHubIssue,
	fromGitHubIssueOrPullRequestState,
	fromGitHubPullRequest,
	fromGitHubPullRequestLite,
} from '../models.js';
import type { GitHubApiConfig } from './config.js';
import { githubSearchResultLimit } from './config.js';
import {
	gitHubIssueSearchRelationships,
	toGitHubIssueSearchQualifiers,
	toGitHubIssueSearchScopeQualifiers,
	toGitHubIssueSortQualifier,
} from './issueSearchQuery.js';
import { toGitHubPullRequestSearchFacets } from './pullRequestSearchQuery.js';
import type { GitHubTokenInfo } from './token.js';

const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
/**
 * What an issue-search cursor records when the caller asked for no ordering at all.
 *
 * A sentinel rather than an omitted field, because omitted already means something else and more important: a
 * cursor persisted before ordering existed. Distinguishing the two is what lets an old cursor keep resuming while
 * a genuine change from unordered to ordered is still refused. Not an `IssueSorting`, so it can never collide
 * with one.
 */
const unsortedCursorSort = 'unsorted' as const;
const emptyBlameResult: GitHubBlame = Object.freeze({ ranges: [] });

// Transient gateway/network failures (e.g. an upstream `502 Bad Gateway`) are worth a few quick
// retries before surfacing to the caller. octokit provides no built-in retry for the standalone
// `request`/`graphql` functions we use (its retry/throttle plugins only attach to the `Octokit`
// class), so we retry here — but only for idempotent reads (REST GET/HEAD, GraphQL queries),
// never for mutations.
const maxRequestRetries = 2;
const requestRetryBaseDelay = 300; // ms
const requestRetryMaxDelay = 2000; // ms

/** How many email->login user searches to alias into a single GraphQL request (keeps query cost within limits). */
const accountResolveBatchSize = 25;

// Pull-request search selects the full PR fragment (reviews, requests, refs, commits, etc.),
// which makes GitHub reject broad 100-node searches with `Resource limits for this query
// exceeded` on large repositories. Thirty keeps the default within that GraphQL cost budget
// while callers that know their scope is cheap can still opt into the supported 100-node max.
const defaultPullRequestSearchPageSize = 30;
const maxPullRequestSearchPageSize = 100;

function isRetryableTransientError(ex: unknown): ex is RequestError {
	// An aborted request is rethrown as the original `AbortError` (not a `RequestError`), so it is
	// excluded here. octokit maps a fetch/network failure to a `RequestError` with status 500 and
	// no response — those, along with real gateway statuses, are transient and safe to retry.
	if (!(ex instanceof RequestError)) return false;

	switch (ex.status) {
		case 502: // Bad Gateway
		case 503: // Service Unavailable
		case 504: // Gateway Timeout
			return true;
		case 500: // Internal Server Error — only the network-failure variant (no response)
			return ex.response == null;
		default:
			return false;
	}
}

/**
 * When a rate-limited request may be retried, as a UTC epoch in seconds, or `undefined` when the response says
 * nothing useful. Header precedence follows GitHub's own guidance
 * (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api): `retry-after` wins when present —
 * it is the only one a secondary limit reliably sets — and `x-ratelimit-reset` covers the primary limit.
 */
function rateLimitResetAt(ex: RequestError): number | undefined {
	const headers = ex.response?.headers;
	if (headers == null) return undefined;

	// `retry-after` is a delay in seconds, not an epoch, so it has to be added to now to compare with `resetAt`.
	const retryAfter = toPositiveInt(headers['retry-after']);
	if (retryAfter != null) return Math.floor(Date.now() / 1000) + retryAfter;

	return toPositiveInt(headers['x-ratelimit-reset']);
}

function toPositiveInt(value: string | number | undefined): number | undefined {
	if (value == null) return undefined;

	const parsed = typeof value === 'number' ? value : parseInt(value, 10);
	// Rejects NaN and a nonsensical negative/zero, either of which would present as an already-elapsed reset.
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getRequestRetryDelay(attempt: number): number {
	// Exponential backoff with equal jitter, capped — spreads retries so a brief upstream blip
	// isn't hammered by every in-flight request landing on the same schedule.
	const backoff = Math.min(requestRetryMaxDelay, requestRetryBaseDelay * 2 ** (attempt - 1));
	return Math.round(backoff / 2 + Math.random() * (backoff / 2));
}

/** One aliased `search` field in a multi-search issue request; see {@link GitHubApi.searchIssuesByAlias}. */
interface AliasedIssueSearch {
	/** GraphQL alias, also the key this search's cursor is stored under. Must not be `page` or `truncated`. */
	alias: string;
	/** The fully-composed GitHub search query, qualifiers included. */
	query: string;
}

/** One page of a multi-search issue request, with its composite cursor across every alias. */
export interface AliasedIssueSearchResult {
	values: IssueShape[];
	/** Opaque composite cursor; absent when every alias is exhausted. */
	cursor?: string;
	hasMore: boolean;
	page: number;
	/** True when the read cannot return everything — GitHub's search ceiling, or an unusable continuation. */
	truncated: boolean;
	/**
	 * The largest `issueCount` any single alias reported, which is what {@link githubSearchResultLimit} applies
	 * to (the ceiling is per search, not per request). Absent when no request was made — every alias was already
	 * exhausted — so `undefined` means "not reported", never zero matches.
	 */
	totalCount?: number;
}

/** One page of the filtered pull-request search. */
export interface PullRequestSearchResult {
	values: PullRequestShape[];
	/** Opaque cursor carrying each active facet continuation plus the positional page. */
	cursor?: string;
	hasMore: boolean;
	page: number;
	/** True at GitHub's search ceiling or when GitHub advertises a page without a usable cursor. */
	truncated: boolean;
	/**
	 * The largest pre-ceiling `issueCount` any relationship × state facet reported, which is what
	 * {@link githubSearchResultLimit} applies to. Never the number of rows reachable after that ceiling.
	 */
	totalCount?: number;
}

// Matches a GraphQL document whose operation is definitely a read query — the `query` keyword as
// the first significant token, after any leading whitespace or `#` comment lines. We retry only
// when this matches; a mutation (even one prefixed by a comment), a subscription, or anything we
// can't classify is left non-retryable so a transient failure can never re-run a mutation.
const graphqlReadQueryRegex = /^(?:\s|#[^\n]*\n?)*query\b/;

const gqlIssueOrPullRequestFragment = `
closed
closedAt
createdAt
id
number
state
title
updatedAt
url
`;
/**
 * Stacked-pull-request selections, appended to a pull request's selection set rather than baked into
 * the fragments below: GitHub Enterprise Server schemas lag github.com, and selecting `stack` there
 * fails the entire query with "Field 'stack' doesn't exist on type 'PullRequest'" — which would take
 * every PR feature down with it, not just stacks. Always add these via `gqlPullRequestStackFragmentFor`.
 */
const gqlPullRequestStackFragment = `
stack {
	id
	number
	size
	baseRefName
}
stackEntry {
	position
}
`;

function gqlPullRequestStackFragmentFor(options?: { baseUrl?: string }): string {
	return isGitHubDotCom(options) ? gqlPullRequestStackFragment : '';
}

/** One layer of a stack, as returned by the stacks REST API. Ordered bottom to top. */
export interface GitHubStackLayer {
	number: number;
	state: string;
	draft?: boolean;
	merged_at?: string | null;
	head: { ref: string; sha: string };
}

export interface GitHubStackResource {
	id: string;
	number: number;
	/** The stack's trunk — what the bottom member targets. */
	base: { ref: string; sha?: string };
	/** False once every member has merged; such a stack can no longer be extended. */
	open?: boolean;
	/** Members ordered bottom to top. */
	pull_requests: GitHubStackLayer[];
}

/** Result of the asynchronous merge used for stacked pull requests. */
interface GitHubAsyncMergeResult {
	status: 'pending' | 'merged' | 'enqueued' | 'failed';
	/** Everything but `status` is nested here — flattening it silently loses the poll ticket. */
	details?: {
		/** Always present; on `failed` it is the only explanation of why. */
		message?: string;
		/** Only while `pending` — the ticket to poll. */
		uuid?: string;
		/** Only once `merged`. */
		sha?: string;
		merge_method?: string;
		merge_action?: string;
		expected_head_sha?: string;
	};
}

/**
 * A 409 means a merge request is already in flight and carries its ticket, so it resumes rather than fails.
 *
 * The body has to be dug out of `original`: `requestCore` routes every 4xx through `handleRequestError`,
 * which re-wraps octokit's `RequestError` in a `RequestClientError` carrying only `message` and `original`.
 */
function getAsyncMergeUuidFromConflict(ex: unknown): string | undefined {
	const err = (RequestClientError.is(ex) ? ex.original : ex) as
		| { status?: number; response?: { data?: GitHubAsyncMergeResult } }
		| undefined;
	if (err?.status !== 409) return undefined;

	return err.response?.data?.details?.uuid;
}

const asyncMergePollIntervalMs = 2000;
/** A stack merges one layer at a time and GitHub only promises "a few minutes", so the ceiling is
 *  generous — giving up early would report a failure for a merge still in progress. */
const maxAsyncMergePolls = 300;

const gqlPullRequestLiteFragment = `
${gqlIssueOrPullRequestFragment}
author {
	login
	avatarUrl(size: $avatarSize)
	url
}
body
baseRefName
baseRefOid
headRefName
headRefOid
headRepository {
	isFork
	name
	owner {
		login
	}
	sshUrl
	url
}
isCrossRepository
isDraft
mergedAt
permalink
repository {
	isFork
	name
	owner {
		login
	}
	sshUrl
	url
	viewerPermission
}
`;
const gqlPullRequestFragment = `
${gqlPullRequestLiteFragment}
additions
assignees(first: 25) {
	nodes {
		login
		avatarUrl(size: $avatarSize)
		url
	}
}
body
changedFiles
checksUrl
deletions
mergeable
mergedBy {
	login
}
reviewDecision
latestReviews(first: 25) {
	nodes {
		author {
			login
			avatarUrl(size: $avatarSize)
			url
		}
		state
	}
}
reviewRequests(first: 25) {
	nodes {
		asCodeOwner
		id
		requestedReviewer {
			... on User {
				login
				avatarUrl(size: $avatarSize)
				url
			}
		}
	}
}
commits(last: 1) {
	totalCount
	nodes {
		commit {
			statusCheckRollup {
				state
			}
		}
	}
}
totalCommentsCount
viewerCanUpdate
`;

const gqIssueFragment = `
${gqlIssueOrPullRequestFragment}
assignees(first: 100) {
	nodes {
		login
		url
		avatarUrl(size: $avatarSize)
	}
}
author {
	login
	avatarUrl
	url
}
comments {
	totalCount
}
labels(first: 50) {
	nodes {
		color
		name
	}
}
reactions(content: THUMBS_UP) {
	totalCount
}
repository {
	name
	owner {
		login
	}
	viewerPermission
	url
}
`;

export class GitHubApi {
	private readonly _onDidReauthenticate = new Emitter<void>();
	get onDidReauthenticate(): Event<void> {
		return this._onDidReauthenticate.event;
	}

	private readonly _disposables: { dispose(): void }[] = [];

	constructor(readonly config: GitHubApiConfig) {
		this._disposables.push(this._onDidReauthenticate);
		if (config.onConfigChanged != null) {
			this._disposables.push(
				config.onConfigChanged(() => {
					this.resetCaches();
				}),
			);
		}
	}

	dispose(): void {
		for (const d of this._disposables) {
			d.dispose();
		}
		this._disposables.length = 0;
	}

	private resetCaches(): void {
		this._defaults.clear();
		this._enterpriseVersions.clear();
	}

	async getCurrentAccount(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			viewer: {
				databaseId: number | null;
				name: string | null;
				email: string | null;
				login: string | null;
				avatarUrl: string | null;
			};
		}

		try {
			const query = `query getCurrentAccount($avatarSize: Int) {
	viewer {
		databaseId
		name
		email
		login
		avatarUrl(size: $avatarSize)
	}
}`;

			const rsp = await this.graphql<QueryResult>(provider, token, query, { ...options }, scope);
			if (rsp?.viewer?.login == null) return undefined;

			return {
				provider: provider,
				// `id` is the provider's own id, as it is for every other provider, and `username` the handle
				// filters and viewer matching key on. Falls back to the login only when GitHub omits the
				// database id, which leaves the two equal rather than leaving `id` empty.
				id: rsp.viewer.databaseId != null ? String(rsp.viewer.databaseId) : rsp.viewer.login,
				name: rsp.viewer.name ?? undefined,
				email: rsp.viewer.email ?? undefined,
				// If we are GitHub Enterprise, we may need to convert the avatar URL since it might require authentication
				avatarUrl:
					!rsp.viewer.avatarUrl || isGitHubDotCom(options)
						? (rsp.viewer.avatarUrl ?? undefined)
						: rsp.viewer.email && options?.baseUrl != null
							? await this.createEnterpriseAvatarUrl(
									provider,
									token,
									options.baseUrl,
									rsp.viewer.email,
									options.avatarSize,
								)
							: undefined,
				username: rsp.viewer.login ?? undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
		}),
	})
	async getAccountForCommit(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		rev: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | UnidentifiedAuthor | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						object:
							| {
									author?: {
										name: string | null;
										email: string | null;
										avatarUrl: string;
										user: {
											login: string | null;
										} | null;
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getAccountForCommit(
	$owner: String!
	$repo: String!
	$rev: GitObjectID!
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $rev) {
			... on Commit {
				author {
					name
					email
					avatarUrl(size: $avatarSize)
					user {
						login
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					rev: rev,
				},
				scope,
			);

			const author = rsp?.repository?.object?.author;
			if (author == null) return undefined;

			return {
				provider: provider,
				...(author?.user?.login != null
					? {
							id: author.user.login,
							username: author.user.login,
						}
					: {
							id: undefined,
							username: undefined,
						}),
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				// If we are GitHub Enterprise, we may need to convert the avatar URL since it might require authentication
				avatarUrl:
					!author.avatarUrl || isGitHubDotCom(options)
						? (author.avatarUrl ?? undefined)
						: author.email && options?.baseUrl != null
							? await this.createEnterpriseAvatarUrl(
									provider,
									token,
									options.baseUrl,
									author.email,
									options.avatarSize,
								)
							: undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;
			if (ex.message.includes('Variable $rev of type GitObjectID! was provided invalid value')) {
				return undefined;
			}

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, email) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			email: email,
		}),
	})
	async getAccountForEmail(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		email: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			search:
				| {
						nodes:
							| {
									name: string | null;
									email: string | null;
									avatarUrl: string;
									login: string | null;
							  }[]
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getAccountForEmail(
	$emailQuery: String!
	$avatarSize: Int
) {
	search(type: USER, query: $emailQuery, first: 1) {
		nodes {
			... on User {
				name
				email
				avatarUrl(size: $avatarSize)
				login
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					emailQuery: `in:email ${email}`,
				},
				scope,
			);

			const author = rsp?.search?.nodes?.[0];
			if (author?.login == null) return undefined;

			return {
				provider: provider,
				id: author.login,
				name: author.name ?? undefined,
				email: author.email ?? undefined,
				// If we are GitHub Enterprise, we may need to convert the avatar URL since it might require authentication
				avatarUrl:
					!author.avatarUrl || isGitHubDotCom(options)
						? (author.avatarUrl ?? undefined)
						: author.email && options?.baseUrl != null
							? await this.createEnterpriseAvatarUrl(
									provider,
									token,
									options.baseUrl,
									author.email,
									options.avatarSize,
								)
							: undefined,
				username: author.login ?? undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({ args: (provider, token) => ({ provider: provider?.name, token: `<token:${token.microHash}>` }) })
	async getAccountsForEmails(
		provider: Provider,
		token: GitHubTokenInfo,
		emails: string[],
		options?: { baseUrl?: string },
	): Promise<Map<string, string>> {
		const scope = getScopedLogger();

		// Resolves email -> login for many emails in one request via field aliasing, chunked to keep query cost within
		// GitHub's limits. Each email is passed as a GraphQL variable (never interpolated into the query string) so an
		// attacker-controllable commit email can't inject query structure. Keyed by lowercased email.
		//
		// This is intentionally best-effort: user-by-email search only matches accounts whose email is public, and the
		// search API is subject to GitHub's separate search/secondary rate limits, so misses and per-batch failures are
		// expected and tolerated. GitHub noreply addresses (the common case) are decoded locally by the caller without
		// hitting this at all.
		const result = new Map<string, string>();
		if (emails.length === 0) return result;

		interface QueryResult {
			[alias: string]: { nodes?: ({ login: string | null } | null)[] | null } | null | undefined;
		}

		for (const batch of chunk(emails, accountResolveBatchSize)) {
			const declarations = batch.map((_, i) => `$q${i}: String!`).join(', ');
			const fields = batch
				.map((_, i) => `e${i}: search(type: USER, query: $q${i}, first: 1) { nodes { ... on User { login } } }`)
				.join('\n\t');
			const query = `query getAccountsForEmails(${declarations}) {\n\t${fields}\n}`;

			const variables: RequestParameters = { ...options };
			batch.forEach((email, i) => {
				variables[`q${i}`] = `in:email ${email}`;
			});

			try {
				const rsp = await this.graphql<QueryResult>(provider, token, query, variables, scope);
				if (rsp == null) continue;

				batch.forEach((email, i) => {
					const login = rsp[`e${i}`]?.nodes?.[0]?.login;
					if (login) {
						result.set(email.toLowerCase(), login);
					}
				});
			} catch (ex) {
				// Best-effort enrichment — a failed batch (e.g. query cost) shouldn't abort the others.
				scope?.error(ex);
			}
		}

		return result;
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getDefaultBranch(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
	): Promise<DefaultBranch | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						defaultBranchRef: { name: string } | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getDefaultBranch(
	$owner: String!
	$repo: String!
) {
	repository(name: $repo, owner: $owner) {
		defaultBranchRef {
			name
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
				},
				scope,
			);

			const defaultBranch = rsp?.repository?.defaultBranchRef?.name ?? undefined;
			if (defaultBranch == null) return undefined;

			return {
				provider: provider,
				name: defaultBranch,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, number) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			number: number,
		}),
	})
	async getIssueOrPullRequest(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
		},
	): Promise<IssueOrPullRequest | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository?: { issueOrPullRequest?: GitHubIssueOrPullRequest };
		}

		try {
			const query = `query getIssueOrPullRequest(
	$owner: String!
	$repo: String!
	$number: Int!
) {
	repository(name: $repo, owner: $owner) {
		issueOrPullRequest(number: $number) {
			__typename
			... on Issue {
				${gqlIssueOrPullRequestFragment}
			}
			... on PullRequest {
				${gqlIssueOrPullRequestFragment}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					number: number,
				},
				scope,
			);

			const issue = rsp?.repository?.issueOrPullRequest;
			if (issue == null) return undefined;

			return {
				provider: provider,
				type: issue.__typename === 'PullRequest' ? 'pullrequest' : 'issue',
				id: String(issue.number),
				nodeId: issue.id,
				createdDate: new Date(issue.createdAt),
				updatedDate: new Date(issue.updatedAt),
				title: issue.title,
				closed: issue.closed,
				closedDate: issue.closedAt == null ? undefined : new Date(issue.closedAt),
				url: issue.url,
				state: fromGitHubIssueOrPullRequestState(issue.state),
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, number) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			number: number,
		}),
	})
	async getIssue(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			includeBody?: boolean;
		},
	): Promise<Issue | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						issue: GitHubIssue | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getIssue(
			$owner: String!
			$repo: String!
			$number: Int!
			$avatarSize: Int
		) {
			repository(name: $repo, owner: $owner) {
				issue(number: $number) {
					${gqIssueFragment}${
						options?.includeBody
							? `
						body
						`
							: ''
					}
				}
			}
		}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					number: number,
				},
				scope,
			);

			if (rsp?.repository?.issue == null) return undefined;

			return fromGitHubIssue(rsp.repository.issue, provider);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, number) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			number: number,
		}),
	})
	async getPullRequest(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		number: number,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						pullRequest: GitHubPullRequestLite | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getPullRequest(
	$owner: String!
	$repo: String!
	$number: Int!
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		pullRequest(number: $number) {
			${gqlPullRequestLiteFragment}
			${gqlPullRequestStackFragmentFor(options)}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					number: number,
				},
				scope,
			);

			if (rsp?.repository?.pullRequest == null) return undefined;

			return fromGitHubPullRequestLite(rsp.repository.pullRequest, provider);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, branch) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			branch: branch,
		}),
	})
	async getPullRequestForBranch(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		branch: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
			include?: GitHubPullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						ref:
							| {
									associatedPullRequests?: {
										nodes?: GitHubPullRequestLite[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getPullRequestForBranch(
	$owner: String!
	$repo: String!
	$branch: String!
	$limit: Int!
	$include: [PullRequestState!]
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		ref(qualifiedName: $branch) {
			associatedPullRequests(first: $limit, orderBy: {field: UPDATED_AT, direction: DESC}, states: $include) {
				nodes {
					${gqlPullRequestLiteFragment}
					${gqlPullRequestStackFragmentFor(options)}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					branch: `refs/heads/${branch}`,
					// Since GitHub sort doesn't seem to really work, look for a max of 10 PRs and then sort them ourselves
					limit: 10,
				},
				scope,
			);

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.ref?.associatedPullRequests?.nodes?.filter(
				pr => pr != null && (!pr.repository.isFork || pr.repository.owner.login === owner),
			);
			if (prs == null || prs.length === 0) return undefined;

			if (prs.length > 1) {
				prs.sort(
					(a, b) =>
						(a.repository.owner.login === owner ? -1 : 1) - (b.repository.owner.login === owner ? -1 : 1) ||
						(a.state === 'OPEN' ? -1 : 1) - (b.state === 'OPEN' ? -1 : 1) ||
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			}

			return fromGitHubPullRequestLite(prs[0], provider);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo, rev) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			rev: rev,
		}),
	})
	async getPullRequestForCommit(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		rev: string,
		options?: {
			baseUrl?: string;
			avatarSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						object?: {
							associatedPullRequests?: {
								nodes?: GitHubPullRequestLite[];
							};
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getPullRequestForCommit(
	$owner: String!
	$repo: String!
	$rev: GitObjectID!
	$avatarSize: Int
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $rev) {
			... on Commit {
				associatedPullRequests(first: 2, orderBy: {field: UPDATED_AT, direction: DESC}) {
					nodes {
						${gqlPullRequestLiteFragment}
						${gqlPullRequestStackFragmentFor(options)}
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
					rev: rev,
				},
				scope,
				cancellation,
			);

			// If the pr is not from a fork, keep it e.g. show root pr's on forks, otherwise, ensure the repo owners match
			const prs = rsp?.repository?.object?.associatedPullRequests?.nodes?.filter(
				pr => pr != null && (!pr.repository.isFork || pr.repository.owner.login === owner),
			);
			if (prs == null || prs.length === 0) return undefined;

			if (prs.length > 1) {
				prs.sort(
					(a, b) =>
						(a.repository.owner.login === owner ? -1 : 1) - (b.repository.owner.login === owner ? -1 : 1) ||
						(a.state === 'MERGED' ? -1 : 1) - (b.state === 'MERGED' ? -1 : 1) ||
						new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
				);
			}

			return fromGitHubPullRequestLite(prs[0], provider);
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getRepositoryMetadata(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: {
			baseUrl?: string;
		},
		cancellation?: AbortSignal,
	): Promise<RepositoryMetadata | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						owner: {
							login: string;
						};
						name: string;
						parent:
							| {
									owner: {
										login: string;
									};
									name: string;
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getRepositoryMetadata(
	$owner: String!
	$repo: String!
) {
	repository(name: $repo, owner: $owner) {
		owner {
			login
		}
		name
		parent {
			owner {
				login
			}
			name
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					...options,
					owner: owner,
					repo: repo,
				},
				scope,
				cancellation,
			);

			const r = rsp?.repository ?? undefined;
			if (r == null) return undefined;

			return {
				provider: provider,
				owner: r.owner.login,
				name: r.name,
				isFork: r.parent != null,
				parent:
					r.parent != null
						? {
								owner: r.parent.owner.login,
								name: r.parent.name,
							}
						: undefined,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref, path) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
			path: path,
		}),
	})
	async getBlame(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path: string,
	): Promise<GitHubBlame> {
		const scope = getScopedLogger();

		interface QueryResult {
			viewer: { name: string };
			repository:
				| {
						object: {
							blame: {
								ranges: GitHubBlameRange[];
							};
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getBlameRanges(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String!
) {
	viewer { name }
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			...on Commit {
				blame(path: $path) {
					ranges {
						startingLine
						endingLine
						commit {
							oid
							parents(first: 8) { nodes { oid } }
							message
							additions
							changedFiles
							deletions
							author {
								avatarUrl
								date
								email
								name
							}
							committer {
								date
								email
								name
							}
						}
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: path,
				},
				scope,
			);
			if (rsp == null) return emptyBlameResult;

			const ranges = rsp.repository?.object?.blame?.ranges;
			if (ranges == null || ranges.length === 0) return { ranges: [], viewer: rsp.viewer?.name };

			return { ranges: ranges, viewer: rsp.viewer?.name };
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyBlameResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getBranches(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubBranch>> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						refs: {
							pageInfo: {
								endCursor: string;
								hasNextPage: boolean;
							};
							nodes: GitHubBranch[];
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getBranches(
	$owner: String!
	$repo: String!
	$branchQuery: String
	$cursor: String
	$limit: Int = 100
) {
	repository(owner: $owner, name: $repo) {
		refs(query: $branchQuery, refPrefix: "refs/heads/", first: $limit, after: $cursor) {
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				name
				target {
					oid
					...on Commit {
						authoredDate
						committedDate
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					branchQuery: options?.query,
					cursor: options?.cursor,
					limit: Math.min(100, options?.limit ?? 100),
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const refs = rsp.repository?.refs;
			if (refs == null) return emptyPagedResult;

			return {
				paging: {
					cursor: refs.pageInfo.endCursor,
					more: refs.pageInfo.hasNextPage,
				},
				values: refs.nodes,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
		}),
	})
	async getCommit(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined> {
		const scope = getScopedLogger();

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /repos/{owner}/{repo}/commits/{ref}',
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			const result = rsp?.data;
			if (result == null) return undefined;

			const { commit } = result;
			return {
				oid: result.sha,
				parents: { nodes: result.parents.map(p => ({ oid: p.sha })) },
				message: commit.message,
				additions: result.stats?.additions,
				changedFiles: result.files?.length,
				deletions: result.stats?.deletions,
				author: {
					avatarUrl: result.author?.avatar_url ?? undefined,
					date: commit.author?.date ?? new Date().toString(),
					email: commit.author?.email ?? undefined,
					name: commit.author?.name ?? '',
				},
				committer: {
					date: commit.committer?.date ?? new Date().toString(),
					email: commit.committer?.email ?? undefined,
					name: commit.committer?.name ?? '',
				},
				files: result.files,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}

		// const results = await this.getCommits(token, owner, repo, ref, { limit: 1 });
		// if (results.values.length === 0) return undefined;

		// return { ...results.values[0], viewer: results.viewer };
	}

	@trace({
		args: (token, owner, repo, ref, path) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
			path: path,
		}),
	})
	async getCommitForFile(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path: string,
	): Promise<(GitHubCommit & { viewer?: string }) | undefined> {
		if (isSha(ref)) return this.getCommit(token, owner, repo, ref);

		// TODO: optimize this -- only need to get the sha for the ref
		const results = await this.getCommits(token, owner, repo, ref, { limit: 1, path: path });
		if (results.values.length === 0) return undefined;

		const commit = await this.getCommit(token, owner, repo, results.values[0].oid);
		return { ...(commit ?? results.values[0]), viewer: results.viewer };
	}

	@trace({
		args: (token, owner, repo, refs, mode, date) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			refs: refs,
			mode: mode,
			date: date,
		}),
	})
	async getBranchesWithCommits(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		refs: string[],
		mode: 'contains' | 'pointsAt',
		date?: Date,
	): Promise<string[]> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository: {
				refs: {
					nodes: {
						name: string;
						target: {
							history: {
								nodes: { oid: string }[];
							};
						};
					}[];
				};
			};
		}

		const limit = mode === 'contains' ? 10 : 1;

		try {
			const query = `query getBranchesWithCommits(
	$owner: String!
	$repo: String!
	$since: GitTimestamp!
	$until: GitTimestamp!
) {
	repository(owner: $owner, name: $repo) {
		refs(first: 100, refPrefix: "refs/heads/") {
			nodes {
				name
				target {
					... on Commit {
						history(first: ${limit}, since: $since until: $until) {
							nodes { oid }
						}
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					since: date?.toISOString(),
					until: date?.toISOString(),
				},
				scope,
			);

			const nodes = rsp?.repository?.refs?.nodes;
			if (nodes == null) return [];

			const branches = [];

			for (const branch of nodes) {
				for (const commit of branch.target.history.nodes) {
					if (refs.includes(commit.oid)) {
						branches.push(branch.name);
						break;
					}
				}
			}

			return branches;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
		}),
	})
	async getCommitCount(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
	): Promise<number | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository: {
				ref: {
					target: {
						history: { totalCount: number };
					};
				};
			};
		}

		try {
			const query = `query getCommitCount(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	repository(owner: $owner, name: $repo) {
		ref(qualifiedName: $ref) {
			target {
				... on Commit {
					history(first: 1) {
						totalCount
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);

			const count = rsp?.repository?.ref?.target.history.totalCount;
			return count;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, branch, refs, mode, date) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			branch: branch,
			refs: refs,
			mode: mode,
			date: date,
		}),
	})
	async getBranchWithCommit(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		branch: string,
		refs: string[],
		mode: 'contains' | 'pointsAt',
		date?: Date,
	): Promise<string[]> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository: {
				ref: {
					target: {
						history: {
							nodes: { oid: string }[];
						};
					};
				};
			};
		}

		const limit = mode === 'contains' ? 100 : 1;

		try {
			const query = `query getBranchWithCommit(
	$owner: String!
	$repo: String!
	$ref: String!
	$since: GitTimestamp!
	$until: GitTimestamp!
) {
	repository(owner: $owner, name: $repo) {
		ref(qualifiedName: $ref) {
			target {
				... on Commit {
					history(first: ${limit}, since: $since until: $until) {
						nodes { oid }
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: `refs/heads/${branch}`,
					since: date?.toISOString(),
					until: date?.toISOString(),
				},
				scope,
			);

			const nodes = rsp?.repository?.ref?.target?.history?.nodes;
			if (nodes == null) return [];

			const branches = [];

			for (const commit of nodes) {
				if (refs.includes(commit.oid)) {
					branches.push(branch);
					break;
				}
			}

			return branches;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
		}),
	})
	async getCommits(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			all?: boolean;
			authors?: GitUser[];
			before?: string;
			limit?: number;
			path?: string;
			since?: string | Date;
			until?: string | Date;
		},
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const scope = getScopedLogger();

		if (options?.limit === 1 && options?.path == null) {
			return this.getCommitsCoreSingle(token, owner, repo, ref);
		}

		if (isRevisionRange(ref)) {
			return this.getCommitsCoreRange(token, owner, repo, ref);
		}

		interface QueryResult {
			viewer: { name: string };
			repository:
				| {
						object:
							| {
									history: {
										pageInfo: GitHubPageInfo;
										nodes: GitHubCommit[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommits(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String
	$author: CommitAuthor
	$after: String
	$before: String
	$limit: Int = 100
	$since: GitTimestamp
	$until: GitTimestamp
) {
	viewer { name }
	repository(name: $repo, owner: $owner) {
		object(expression: $ref) {
			... on Commit {
				history(first: $limit, author: $author, path: $path, after: $after, before: $before, since: $since, until: $until) {
					pageInfo {
						startCursor
						endCursor
						hasNextPage
						hasPreviousPage
					}
					nodes {
						... on Commit {
							oid
							message
							parents(first: 8) { nodes { oid } }
							additions
							changedFiles
							deletions
							author {
								avatarUrl
								date
								email
								name
							}
							committer {
								 date
								 email
								 name
							 }
						}
					}
				}
			}
		}
	}
}`;

			let authors: { id?: string; emails?: string[] } | undefined;
			if (options?.authors != null) {
				if (options.authors.length === 1) {
					const [author] = options.authors;
					authors = {
						id: author.id,
						emails: author.email ? [author.email] : undefined,
					};
				} else {
					const emails = options.authors.filter(a => a.email).map(a => a.email!);
					authors = emails.length ? { emails: emails } : undefined;
				}
			}

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					after: options?.after,
					before: options?.before,
					path: options?.path,
					author: authors,
					limit: Math.min(100, options?.limit ?? 100),
					since: typeof options?.since === 'string' ? options?.since : options?.since?.toISOString(),
					until: typeof options?.until === 'string' ? options?.until : options?.until?.toISOString(),
				},
				scope,
			);
			const history = rsp?.repository?.object?.history;
			if (history == null) return emptyPagedResult;

			return {
				paging:
					history.pageInfo.endCursor != null
						? {
								cursor: history.pageInfo.endCursor ?? undefined,
								more: history.pageInfo.hasNextPage,
							}
						: undefined,
				values: history.nodes,
				viewer: rsp?.viewer.name,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
		}),
	})
	async getCommitShas(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			before?: string;
			limit?: number;
			path?: string;
			since?: string | Date;
			until?: string | Date;
		},
	): Promise<PagedResult<string>> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						object:
							| {
									history: {
										pageInfo: GitHubPageInfo;
										nodes: { oid: string }[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommitShas(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String
	$after: String
	$before: String
	$limit: Int = 100
	$since: GitTimestamp
	$until: GitTimestamp
) {
	repository(name: $repo, owner: $owner) {
		object(expression: $ref) {
			... on Commit {
				history(first: $limit, path: $path, after: $after, before: $before, since: $since, until: $until) {
					pageInfo {
						startCursor
						endCursor
						hasNextPage
						hasPreviousPage
					}
					nodes {
						... on Commit { oid }
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					after: options?.after,
					before: options?.before,
					path: options?.path,
					limit: Math.min(100, options?.limit ?? 100),
					since: typeof options?.since === 'string' ? options?.since : options?.since?.toISOString(),
					until: typeof options?.until === 'string' ? options?.until : options?.until?.toISOString(),
				},
				scope,
			);
			const history = rsp?.repository?.object?.history;
			if (history == null) return emptyPagedResult;

			return {
				paging:
					history.pageInfo.endCursor != null
						? {
								cursor: history.pageInfo.endCursor ?? undefined,
								more: history.pageInfo.hasNextPage,
							}
						: undefined,
				values: history.nodes.map(n => n.oid),
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	private async getCommitsCoreRange(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		range: GitRevisionRange,
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const scope = getScopedLogger();

		try {
			const result = await this.getComparison(token, owner, repo, range);
			if (result == null) return emptyPagedResult;

			return {
				values: result.commits
					?.map<GitHubCommit>(r => ({
						oid: r.sha,
						parents: { nodes: r.parents.map(p => ({ oid: p.sha })) },
						message: r.commit.message,
						author: {
							avatarUrl: r.author?.avatar_url ?? undefined,
							date: r.commit.author?.date ?? r.commit.committer?.date ?? new Date().toString(),
							email: r.author?.email ?? r.commit.author?.email ?? undefined,
							name: r.author?.name ?? r.commit.author?.name ?? '',
						},
						committer: {
							date: r.commit.committer?.date ?? new Date().toString(),
							email: r.committer?.email ?? r.commit.committer?.email ?? undefined,
							name: r.committer?.name ?? r.commit.committer?.name ?? '',
						},
					}))
					.reverse(),
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	private async getCommitsCoreSingle(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
	): Promise<PagedResult<GitHubCommit> & { viewer?: string }> {
		const scope = getScopedLogger();

		interface QueryResult {
			viewer: { name: string };
			repository: { object: GitHubCommit } | null | undefined;
		}

		try {
			const query = `query getCommit(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	viewer { name }
	repository(name: $repo owner: $owner) {
		object(expression: $ref) {
			...on Commit {
				oid
				parents(first: 8) { nodes { oid } }
				message
				additions
				changedFiles
				deletions
				author {
					avatarUrl
					date
					email
					name
				}
				committer {
					date
					email
					name
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const commit = rsp.repository?.object;
			return commit != null ? { values: [commit], viewer: rsp.viewer.name } : emptyPagedResult;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
		}),
	})
	async getCommitRefs(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		options?: {
			after?: string;
			before?: string;
			first?: number;
			last?: number;
			path?: string;
			since?: string;
			until?: string;
		},
	): Promise<GitHubPagedResult<GitHubCommitRef> | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						object:
							| {
									history: {
										pageInfo: GitHubPageInfo;
										totalCount: number;
										nodes: GitHubCommitRef[];
									};
							  }
							| null
							| undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommitRefs(
	$owner: String!
	$repo: String!
	$ref: String!
	$after: String
	$before: String
	$first: Int
	$last: Int
	$path: String
	$since: GitTimestamp
	$until: GitTimestamp
) {
	repository(name: $repo, owner: $owner) {
		object(expression: $ref) {
			... on Commit {
				history(first: $first, last: $last, path: $path, since: $since, until: $until, after: $after, before: $before) {
					pageInfo { startCursor, endCursor, hasNextPage, hasPreviousPage }
					totalCount
					nodes { oid }
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: options?.path,
					first: options?.first,
					last: options?.last,
					after: options?.after,
					before: options?.before,
					since: options?.since,
					until: options?.until,
				},
				scope,
			);
			const history = rsp?.repository?.object?.history;
			if (history == null) return undefined;

			return {
				pageInfo: history.pageInfo,
				totalCount: history.totalCount,
				values: history.nodes,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref, date) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
			date: date,
		}),
	})
	async getTagsWithCommit(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		date: Date,
	): Promise<string[]> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository: {
				refs: {
					nodes: {
						name: string;
						target: {
							history: {
								nodes: { oid: string }[];
							};
						};
					}[];
				};
			};
		}

		try {
			const query = `query getTagsWithCommit(
	$owner: String!
	$repo: String!
	$since: GitTimestamp!
	$until: GitTimestamp!
) {
	repository(owner: $owner, name: $repo) {
		refs(first: 100, refPrefix: "refs/tags/") {
			nodes {
				name
				target {
					... on Commit {
						history(first: 10, since: $since until: $until) {
							nodes { oid }
						}
					}
				}
			}
		}
	}
}`;
			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					since: date.toISOString(),
					until: date.toISOString(),
				},
				scope,
			);

			const nodes = rsp?.repository?.refs?.nodes;
			if (nodes == null) return [];

			const tags = [];

			for (const tag of nodes) {
				for (const commit of tag.target.history.nodes) {
					if (commit.oid === ref) {
						tags.push(tag.name);
						break;
					}
				}
			}

			return tags;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref, path, sha) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
			path: path,
			sha: sha,
		}),
	})
	async getNextCommitRefs(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path: string,
		sha: string,
	): Promise<string[]> {
		// Get the commit date of the current commit
		const commitDate = await this.getCommitDate(token, owner, repo, sha);
		if (commitDate == null) return [];

		// Get a resultset (just need the cursor and totals), to get the page info we need to construct a cursor to page backwards
		let result = await this.getCommitRefs(token, owner, repo, ref, { path: path, first: 1, since: commitDate });
		if (result == null) return [];

		// Construct a cursor to allow use to walk backwards in time (starting at the tip going back in time until the commit date)
		const cursor = `${result.pageInfo.startCursor!.split(' ', 1)[0]} ${result.totalCount}`;

		let last;
		[, last] = cursor.split(' ', 2);
		// We can't ask for more commits than are left in the cursor (but try to get more to be safe, since the date isn't exact enough)
		last = Math.min(parseInt(last, 10), 5);

		// Get the set of refs before the cursor
		result = await this.getCommitRefs(token, owner, repo, ref, { path: path, last: last, before: cursor });
		if (result == null) return [];

		const nexts: string[] = [];

		for (const { oid } of result.values) {
			if (oid === sha) break;

			nexts.push(oid);
		}

		return nexts.reverse();
	}

	private async getCommitDate(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		sha: string,
	): Promise<string | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						object: { committer: { date: string } } | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getCommitDate(
	$owner: String!
	$repo: String!
	$sha: GitObjectID!
) {
	repository(name: $repo, owner: $owner) {
		object(oid: $sha) {
			... on Commit { committer { date } }
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					sha: sha,
				},
				scope,
			);
			const date = rsp?.repository?.object?.committer.date;
			return date;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getContributors(token: GitHubTokenInfo, owner: string, repo: string): Promise<GitHubContributor[]> {
		const scope = getScopedLogger();

		// TODO@eamodio implement pagination

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /repos/{owner}/{repo}/contributors',
				{
					owner: owner,
					repo: repo,
					per_page: 100,
				},
				scope,
			);

			const result = rsp?.data;
			if (result == null) return [];

			return rsp.data;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (provider, token, username) => ({
			provider: provider?.name,
			token: `<token:${token.microHash}>`,
			username: username,
		}),
	})
	async getUserSshSigningKeys(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		username: string,
		options?: { baseUrl?: string },
	): Promise<GitHubSshSigningKey[]> {
		const scope = getScopedLogger();

		// SSH signing keys are public, so this works for any user with the current token (no extra scope needed).
		// TODO@eamodio implement pagination
		try {
			const rsp = await this.request(
				provider,
				token,
				'GET /users/{username}/ssh_signing_keys',
				{ username: username, per_page: 100, ...options },
				scope,
			);
			return rsp?.data ?? [];
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({ args: (provider, token) => ({ provider: provider?.name, token: `<token:${token.microHash}>` }) })
	async getCurrentUserSshSigningKeys(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		options?: { baseUrl?: string },
	): Promise<GitHubSshSigningKey[]> {
		const scope = getScopedLogger();

		// TODO@eamodio implement pagination
		try {
			const rsp = await this.request(
				provider,
				token,
				'GET /user/ssh_signing_keys',
				{ per_page: 100, ...options },
				scope,
			);
			return rsp?.data ?? [];
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return [];

			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getDefaultBranchName(token: GitHubTokenInfo, owner: string, repo: string): Promise<string | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						defaultBranchRef: { name: string } | null | undefined;
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getDefaultBranch(
	$owner: String!
	$repo: String!
) {
	repository(owner: $owner, name: $repo) {
		defaultBranchRef {
			name
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp == null) return undefined;

			return rsp.repository?.defaultBranchRef?.name ?? undefined;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getCurrentUser(token: GitHubTokenInfo, owner: string, repo: string): Promise<GitUser | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			viewer: {
				name: string;
				email: string;
				login: string;
				id: string;
			};
			repository: { viewerPermission: string } | null | undefined;
		}

		try {
			const query = `query getCurrentUser(
	$owner: String!
	$repo: String!
) {
	viewer { name, email, login, id }
	repository(owner: $owner, name: $repo) { viewerPermission }
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp == null) return undefined;

			return {
				name: rsp.viewer?.name,
				email: rsp.viewer?.email,
				username: rsp.viewer?.login,
				id: rsp.viewer?.id,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, range) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			range: range,
		}),
	})
	async getComparison(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		range: GitRevisionRange,
	): Promise<Endpoints['GET /repos/{owner}/{repo}/compare/{basehead}']['response']['data'] | undefined> {
		const scope = getScopedLogger();

		if (!isRevisionRange(range, 'qualified-triple-dot')) {
			// GitHub doesn't support the `..` range notation, so convert it to `...` since it will work for many of our usages
			const parts = getRevisionRangeParts(range);
			range = createRevisionRange(parts?.left || 'HEAD', parts?.right || 'HEAD', '...');
		}

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /repos/{owner}/{repo}/compare/{basehead}',
				{
					owner: owner,
					repo: repo,
					basehead: range,
				},
				scope,
			);

			const result = rsp?.data;
			if (result == null) return undefined;

			return result;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getRepositoryVisibility(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
	): Promise<RepositoryVisibility | undefined> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getRepositoryVisibility(
	$owner: String!
	$repo: String!
) {
	repository(owner: $owner, name: $repo) {
		visibility
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
				},
				scope,
			);
			if (rsp?.repository?.visibility == null) return undefined;

			return rsp.repository.visibility === 'PUBLIC' ? 'public' : 'private';
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, owner, repo) => ({ token: `<token:${token.microHash}>`, owner: owner, repo: repo }) })
	async getTags(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: { query?: string; cursor?: string; limit?: number },
	): Promise<PagedResult<GitHubTag>> {
		const scope = getScopedLogger();

		interface QueryResult {
			repository:
				| {
						refs: {
							pageInfo: {
								endCursor: string;
								hasNextPage: boolean;
							};
							nodes: GitHubTag[];
						};
				  }
				| null
				| undefined;
		}

		try {
			const query = `query getTags(
	$owner: String!
	$repo: String!
	$tagQuery: String
	$cursor: String
	$limit: Int = 100
) {
	repository(owner: $owner, name: $repo) {
		refs(query: $tagQuery, refPrefix: "refs/tags/", first: $limit, after: $cursor, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				name
				target {
					oid
					...on Tag {
						message
						tagger { date }
						target {
					...on Commit {
								oid
						authoredDate
						committedDate
						message
					}
						}
					}
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					tagQuery: options?.query,
					cursor: options?.cursor,
					limit: Math.min(100, options?.limit ?? 100),
				},
				scope,
			);
			if (rsp == null) return emptyPagedResult;

			const refs = rsp.repository?.refs;
			if (refs == null) return emptyPagedResult;

			return {
				paging: {
					cursor: refs.pageInfo.endCursor,
					more: refs.pageInfo.hasNextPage,
				},
				values: refs.nodes,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return emptyPagedResult;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({
		args: (token, owner, repo, ref, path) => ({
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			ref: ref,
			path: path,
		}),
	})
	async resolveReference(
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		ref: string,
		path?: string,
	): Promise<string | undefined> {
		const scope = getScopedLogger();

		try {
			if (!path) {
				interface QueryResult {
					repository: { object: GitHubCommitRef } | null | undefined;
				}

				const query = `query resolveReference(
	$owner: String!
	$repo: String!
	$ref: String!
) {
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			oid
		}
	}
}`;

				const rsp = await this.graphql<QueryResult>(
					undefined,
					token,
					query,
					{
						owner: owner,
						repo: repo,
						ref: ref,
					},
					scope,
				);
				return rsp?.repository?.object?.oid ?? undefined;
			}

			interface QueryResult {
				repository:
					| {
							object: {
								history: {
									nodes: GitHubCommitRef[];
								};
							};
					  }
					| null
					| undefined;
			}

			const query = `query resolveReference(
	$owner: String!
	$repo: String!
	$ref: String!
	$path: String!
) {
	repository(owner: $owner, name: $repo) {
		object(expression: $ref) {
			... on Commit {
				history(first: 1, path: $path) {
					nodes { oid }
				}
			}
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				undefined,
				token,
				query,
				{
					owner: owner,
					repo: repo,
					ref: ref,
					path: path,
				},
				scope,
			);
			return rsp?.repository?.object?.history.nodes?.[0]?.oid ?? undefined;
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, query) => ({ token: `<token:${token.microHash}>`, query: query }) })
	async searchCommits(
		token: GitHubTokenInfo,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<GitHubCommit> | undefined> {
		const scope = getScopedLogger();

		const limit = Math.min(100, options?.limit ?? 100);

		let page;
		let pageSize;
		let previousCount;
		if (options?.cursor != null) {
			[page, pageSize, previousCount] = options.cursor.split(' ', 3);
			page = parseInt(page, 10);
			// TODO@eamodio need to figure out how allow different page sizes if the limit changes
			pageSize = parseInt(pageSize, 10);
			previousCount = parseInt(previousCount, 10);
		} else {
			page = 1;
			pageSize = limit;
			previousCount = 0;
		}

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /search/commits',
				{
					q: query,
					sort: options?.sort,
					order: options?.order,
					per_page: pageSize,
					page: page,
				},
				scope,
			);

			const data = rsp?.data;
			if (data == null || data.items.length === 0) return undefined;

			const commits = data.items.map<GitHubCommit>(result => ({
				oid: result.sha,
				parents: { nodes: result.parents.map(p => ({ oid: p.sha! })) },
				message: result.commit.message,
				author: {
					avatarUrl: result.author?.avatar_url ?? undefined,
					date: result.commit.author?.date ?? result.commit.committer?.date ?? new Date().toString(),
					email: result.author?.email ?? result.commit.author?.email ?? undefined,
					name: result.author?.name ?? result.commit.author?.name ?? '',
				},
				committer: {
					date: result.commit.committer?.date ?? result.committer?.date ?? new Date().toString(),
					email: result.committer?.email ?? result.commit.committer?.email ?? undefined,
					name: result.committer?.name ?? result.commit.committer?.name ?? '',
				},
			}));

			const count = previousCount + data.items.length;
			const hasMore = data.incomplete_results || data.total_count > count;

			return {
				pageInfo: {
					startCursor: `${page} ${pageSize} ${previousCount}`,
					endCursor: hasMore ? `${page + 1} ${pageSize} ${count}` : undefined,
					hasPreviousPage: data.total_count > 0 && page > 1,
					hasNextPage: hasMore,
				},
				totalCount: data.total_count,
				values: commits,
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	@trace({ args: (token, query) => ({ token: `<token:${token.microHash}>`, query: query }) })
	async searchCommitShas(
		token: GitHubTokenInfo,
		query: string,
		options?: {
			cursor?: string;
			limit?: number;
			order?: 'asc' | 'desc' | undefined;
			sort?: 'author-date' | 'committer-date' | undefined;
		},
	): Promise<GitHubPagedResult<{ sha: string; authorDate: number; committerDate: number }> | undefined> {
		const scope = getScopedLogger();

		const limit = Math.min(100, options?.limit ?? 100);

		let page;
		let pageSize;
		let previousCount;
		if (options?.cursor != null) {
			[page, pageSize, previousCount] = options.cursor.split(' ', 3);
			page = parseInt(page, 10);
			// TODO@eamodio need to figure out how allow different page sizes if the limit changes
			pageSize = parseInt(pageSize, 10);
			previousCount = parseInt(previousCount, 10);
		} else {
			page = 1;
			pageSize = limit;
			previousCount = 0;
		}

		try {
			const rsp = await this.request(
				undefined,
				token,
				'GET /search/commits',
				{
					q: query,
					sort: options?.sort,
					order: options?.order,
					per_page: pageSize,
					page: page,
				},
				scope,
			);

			const data = rsp?.data;
			if (data == null || data.items.length === 0) return undefined;

			const count = previousCount + data.items.length;
			const hasMore = data.incomplete_results || data.total_count > count;

			return {
				pageInfo: {
					startCursor: `${page} ${pageSize} ${previousCount}`,
					endCursor: hasMore ? `${page + 1} ${pageSize} ${count}` : undefined,
					hasPreviousPage: data.total_count > 0 && page > 1,
					hasNextPage: hasMore,
				},
				totalCount: data.total_count,
				values: data.items.map(r => ({
					sha: r.sha,
					authorDate: new Date(r.commit.author.date).getTime(),
					committerDate: new Date(r.commit.committer?.date ?? r.commit.author.date).getTime(),
				})),
			};
		} catch (ex) {
			if (ex instanceof RequestNotFoundError) return undefined;

			throw this.handleException(ex, undefined, scope);
		}
	}

	private _enterpriseVersions = new Map<string, Version | null>();

	@trace({ args: (provider, token) => ({ provider: provider?.name, token: `<token:${token.microHash}>` }) })
	private async getEnterpriseVersion(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		options?: { baseUrl?: string },
	): Promise<Version | undefined> {
		const { accessToken } = token;
		let version = this._enterpriseVersions.get(accessToken);
		if (version != null) return version;
		if (version === null) return undefined;

		const scope = getScopedLogger();

		try {
			const rsp = await this.request(provider, token, 'GET /meta', options, scope);
			const v = (rsp?.data as unknown as { installed_version: string | null | undefined })?.installed_version;
			version = v ? fromString(v) : null;
		} catch (_ex) {
			debugger;
			version = null;
		}

		this._enterpriseVersions.set(accessToken, version);
		return version ?? undefined;
	}

	// Runs `execute`, retrying transient gateway/network failures with backoff. `retryable` gates
	// retries to idempotent reads; `signal` lets an in-flight cancellation abort the backoff wait.
	private async requestWithRetries<T>(
		execute: () => Promise<T>,
		retryable: boolean,
		signal: AbortSignal | undefined,
		scope: ScopedLogger | undefined,
	): Promise<T> {
		let attempt = 0;
		while (true) {
			try {
				return await execute();
			} catch (ex) {
				if (!retryable || attempt >= maxRequestRetries || signal?.aborted || !isRetryableTransientError(ex)) {
					throw ex;
				}

				attempt++;
				const delay = getRequestRetryDelay(attempt);
				scope?.warn(
					`Transient request failure (status ${ex.status}); retrying ${attempt}/${maxRequestRetries} in ${delay}ms`,
				);
				await this.delayWithAbort(delay, signal);
				// Bail rather than retry if we were cancelled while waiting
				if (signal?.aborted) throw new CancellationError();
			}
		}
	}

	private delayWithAbort(ms: number, signal: AbortSignal | undefined): Promise<void> {
		return new Promise<void>(resolve => {
			if (signal?.aborted) {
				resolve();
				return;
			}

			let timer: ReturnType<typeof setTimeout>;
			const onAbort = () => {
				clearTimeout(timer);
				resolve();
			};
			timer = setTimeout(() => {
				signal?.removeEventListener('abort', onAbort);
				resolve();
			}, ms);
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	// Inflight dedupe: identical concurrent GraphQL requests share a single promise
	// to cut redundant traffic during graph/details enrichment bursts.
	private readonly _pendingGraphQL = new Map<string, Promise<unknown>>();

	private async graphql<T>(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		query: string,
		variables: RequestParameters,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<T | undefined> {
		const { accessToken, ...tokenInfo } = token;
		// Only dedupe when no cancellation/request option is in play — sharing a promise that
		// carries one caller's AbortSignal would let one cancellation cancel for everyone.
		const dedupable = cancellation == null && variables?.request == null;
		let dedupeKey: string | undefined;
		if (dedupable) {
			try {
				dedupeKey = `${token.microHash}|${provider?.id ?? ''}|${query}|${JSON.stringify(variables ?? null)}`;
			} catch {
				// Non-serializable variable (BigInt, function, circular ref) — fall through to direct exec.
				dedupeKey = undefined;
			}
			if (dedupeKey != null) {
				const inflight = this._pendingGraphQL.get(dedupeKey);
				if (inflight != null) return inflight as Promise<T | undefined>;
			}
		}

		const run = async (): Promise<T | undefined> => {
			try {
				if (cancellation != null) {
					if (cancellation.aborted) throw new CancellationError();

					variables = {
						...variables,
						request: { ...variables?.request, signal: cancellation },
					};
				}

				// Retry transient gateway/network failures, but only confirmed read queries — never
				// mutations (re-running one isn't idempotent)
				const retryable = graphqlReadQueryRegex.test(query);
				return await this.requestWithRetries(
					() =>
						this.config.wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
							this.getDefaults(accessToken, graphql)(query, variables),
						),
					retryable,
					cancellation,
					scope,
				);
			} catch (ex) {
				if (ex instanceof GraphqlResponseError) {
					switch (ex.errors?.[0]?.type) {
						case 'NOT_FOUND':
							throw new RequestNotFoundError(ex);
						case 'FORBIDDEN':
							throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Forbidden, ex);
						case 'RATE_LIMITED': {
							let resetAt: number | undefined;

							const reset = ex.headers?.['x-ratelimit-reset'];
							if (reset != null) {
								resetAt = parseInt(reset, 10);
								if (Number.isNaN(resetAt)) {
									resetAt = undefined;
								}
							}

							throw new RequestRateLimitError(ex, accessToken, resetAt);
						}
					}

					if (Logger.isDebugging) {
						this.config.onDebugError?.(`GitHub request failed: ${ex.errors?.[0]?.message ?? ex.message}`);
					}
				} else if (ex instanceof RequestError || ex.name === 'AbortError') {
					this.handleRequestError(provider, token, ex, scope);
				} else if (Logger.isDebugging) {
					this.config.onDebugError?.(`GitHub request failed: ${ex.message}`);
				}

				throw ex;
			}
		};

		if (dedupeKey == null) return run();

		const promise = run();
		this._pendingGraphQL.set(dedupeKey, promise);
		// Clear from the inflight map once the promise settles — successes and failures both
		// clear, so failed requests don't poison subsequent retries. Use `then(cleanup, cleanup)`
		// rather than `finally` so a rejected request doesn't spawn an orphaned (unhandled) promise;
		// the real caller still receives the rejection via the returned `promise`.
		const cleanup = () => {
			if (this._pendingGraphQL.get(dedupeKey) === promise) {
				this._pendingGraphQL.delete(dedupeKey);
			}
		};
		promise.then(cleanup, cleanup);
		return promise;
	}

	private async request<R extends keyof Endpoints>(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		route: R,
		options: (Endpoints[R]['parameters'] & RequestParameters) | undefined,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<Endpoints[R]['response']> {
		return (await this.requestCore(
			provider,
			token,
			route,
			options,
			scope,
			cancellation,
		)) as Endpoints[R]['response'];
	}

	/**
	 * REST call for routes `@octokit/types` doesn't describe yet — currently the stacked-pull-request
	 * merge APIs, which are in public preview and absent from the generated endpoint map. Prefer
	 * `request` for anything typed.
	 */
	private async requestPreview<T>(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		route: string,
		options: RequestParameters | undefined,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<T> {
		return (await this.requestCore(provider, token, route, options, scope, cancellation)) as T;
	}

	private async requestCore(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		route: string,
		options: RequestParameters | undefined,
		scope: ScopedLogger | undefined,
		cancellation?: AbortSignal | undefined,
	): Promise<unknown> {
		const { accessToken } = token;
		try {
			let signal: AbortSignal | undefined;
			if (cancellation != null) {
				if (cancellation.aborted) throw new CancellationError();

				signal = cancellation;
				options = { ...options, request: { ...options?.request, signal: signal } };
			}

			// Retry transient gateway/network failures on idempotent reads only
			const method = route.split(' ', 1)[0].toUpperCase();
			const retryable = method === 'GET' || method === 'HEAD';
			return await this.requestWithRetries(
				() =>
					this.config.wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
						this.getDefaults(accessToken, request)(route, options),
					),
				retryable,
				signal,
				scope,
			);
		} catch (ex) {
			if (ex instanceof RequestError || ex.name === 'AbortError') {
				this.handleRequestError(provider, token, ex, scope);
			} else if (Logger.isDebugging) {
				this.config.onDebugError?.(`GitHub request failed: ${ex.message}`);
			}

			throw ex;
		}
	}

	private _defaults = new Map<typeof request | typeof graphql, Map<string, typeof request | typeof graphql>>();
	private getDefaults(token: string, rqst: typeof request): typeof request;
	private getDefaults(token: string, gql: typeof graphql): typeof graphql;
	private getDefaults(
		token: string,
		requestOrGraphQL: typeof request | typeof graphql,
	): typeof request | typeof graphql {
		let map = this._defaults.get(requestOrGraphQL);
		if (map == null) {
			map = new Map();
			this._defaults.set(requestOrGraphQL, map);
		}

		let defaults = map.get(token);
		if (defaults == null) {
			const configFetch = this.config.fetch;
			const configIsWeb = this.config.isWeb;
			defaults = requestOrGraphQL.defaults({
				headers: {
					authorization: `token ${token}`,
				},
				request: {
					fetch: configIsWeb
						? (url: string, options: { headers?: Record<string, string> }) => {
								if (options.headers != null) {
									// Strip out the user-agent (since it causes warnings in a webworker)
									const { 'user-agent': userAgent, ...headers } = options.headers;
									if (userAgent) {
										options.headers = headers;
									}
								}
								return configFetch(url, options);
							}
						: configFetch,
					hook:
						Logger.enabled('trace') || Logger.isDebugging
							? async (rqst: typeof request, options: any) => {
									const sw = maybeStopWatch(`[GITHUB] ${options.method} ${options.url}`, {
										log: { onlyExit: true },
									});
									try {
										return await rqst(options);
									} finally {
										let message;
										try {
											if (typeof options.query === 'string') {
												const match = /(^[^({\n]+)/.exec(options.query);
												message = ` ${match?.[1].trim() ?? options.query}`;
											}
										} catch {}
										sw?.stop({ message: message });
									}
								}
							: undefined,
				},
			});
			map.set(token, defaults);
		}

		return defaults;
	}

	private handleRequestError(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		ex: RequestError | (Error & { name: 'AbortError' }),
		scope: ScopedLogger | undefined,
	): void {
		if (ex.name === 'AbortError') throw new CancellationError(ex);

		const { accessToken, ...tokenInfo } = token;
		switch (ex.status) {
			case 404: // Not found
			case 410: // Gone
			case 422: // Unprocessable Entity
				throw new RequestNotFoundError(ex);
			case 429: // Too Many Requests
				// GitHub returns "a `403` or `429` response" for BOTH its primary and secondary rate limits
				// (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). 429 is unambiguous —
				// unlike 403, it is never a permission failure — so it needs no message check.
				throw new RequestRateLimitError(ex, accessToken, rateLimitResetAt(ex));
			case 401: // Unauthorized
				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Unauthorized, ex);
			case 403: // Forbidden
				// The other status the rate limits arrive on, but 403 is also a plain permission failure, so here
				// the message is the discriminant.
				if (ex.message.includes('rate limit')) {
					throw new RequestRateLimitError(ex, accessToken, rateLimitResetAt(ex));
				}
				throw new AuthenticationError(tokenInfo, AuthenticationErrorReason.Forbidden, ex);
			case 500: // Internal Server Error
				scope?.error(ex);
				if (ex.response != null) {
					provider?.trackRequestException();
					this.config.onRequestError?.(
						provider,
						`${provider?.name ?? 'GitHub'} failed to respond and might be experiencing issues.${
							provider == null || provider.id === 'github'
								? ' Please visit the [GitHub status page](https://githubstatus.com) for more information.'
								: ''
						}`,
					);
				}
				return;
			case 502: // Bad Gateway
				scope?.error(ex);
				// GitHub seems to return this status code for timeouts
				if (ex.message.includes('timeout')) {
					provider?.trackRequestException();
					this.config.onRequestError?.(provider, `${provider?.name ?? 'GitHub'} request timed out`);
					return;
				}
				break;
			case 503: // Service Unavailable
				scope?.error(ex);
				provider?.trackRequestException();
				this.config.onRequestError?.(
					provider,
					`${provider?.name ?? 'GitHub'} failed to respond and might be experiencing issues.${
						provider == null || provider.id === 'github'
							? ' Please visit the [GitHub status page](https://githubstatus.com) for more information.'
							: ''
					}`,
				);
				return;
			default:
				if (ex.status >= 400 && ex.status < 500) throw new RequestClientError(ex);
				break;
		}

		scope?.error(ex);
		if (Logger.isDebugging) {
			this.config.onDebugError?.(
				`GitHub request failed: ${(ex.response as any)?.errors?.[0]?.message ?? ex.message}`,
			);
		}
	}

	private handleException(
		ex: Error,
		provider: Provider | undefined,
		scope: ScopedLogger | undefined,
		silent?: boolean,
	): Error {
		scope?.error(ex);
		// debugger;

		if (ex instanceof AuthenticationError && !silent) {
			void this.showAuthenticationErrorMessage(ex, provider);
		}
		return ex;
	}

	private async showAuthenticationErrorMessage(ex: AuthenticationError, provider: Provider | undefined) {
		if (ex.reason === AuthenticationErrorReason.Unauthorized || ex.reason === AuthenticationErrorReason.Forbidden) {
			const reauthenticated = await this.config.onAuthenticationFailure?.(ex, provider);
			if (reauthenticated) {
				this.resetCaches();
				this._onDidReauthenticate.fire();
			}
		}
	}

	private async createEnterpriseAvatarUrl(
		provider: Provider | undefined,
		token: GitHubTokenInfo,
		baseUrl: string,
		email: string,
		avatarSize: number | undefined,
	): Promise<string | undefined> {
		avatarSize = avatarSize ?? 16;
		const { accessToken } = token;

		const version = await this.getEnterpriseVersion(provider, token, { baseUrl: baseUrl });
		if (satisfies(version, '>= 3.0.0')) {
			let url: string | undefined;

			const parts = getGitHubNoReplyAddressParts(email);
			if (parts != null) {
				if (parseUri(baseUrl).authority === parts.authority) {
					if (parts.userId != null) {
						url = `${baseUrl}/enterprise/avatars/u/${encodeURIComponent(parts.userId)}?s=${avatarSize}`;
					} else if (parts.login != null) {
						url = `${baseUrl}/enterprise/avatars/${encodeURIComponent(parts.login)}?s=${avatarSize}`;
					}
				}
			}

			url ??= `${baseUrl}/enterprise/avatars/u/e?email=${encodeURIComponent(email)}&s=${avatarSize}`;

			const configFetch = this.config.fetch;
			const rsp = await this.config.wrapForForcedInsecureSSL(provider?.getIgnoreSSLErrors() ?? false, () =>
				configFetch(url, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } }),
			);

			if (rsp.ok) {
				const data = base64(new Uint8Array(await rsp.arrayBuffer()));
				const mimeType = rsp.headers.get('content-type');
				return `data:${mimeType};base64,${data}`;
			}
		}

		// The /u/e endpoint automatically falls back to gravatar if not found
		return `https://avatars.githubusercontent.com/u/e?email=${encodeURIComponent(email)}&s=${avatarSize}`;
	}

	/**
	 * One page of the current user's pull requests, filtered by state and optionally by an explicit
	 * relationship qualifier. Backs the PR sweeps, which drain it page by page.
	 *
	 * Ordering is part of the contract, not an option: always `sort:updated` (most recently updated first),
	 * matching {@link searchPullRequestsPage}. A caller that stops before `hasMore` clears — every sweep with a
	 * page budget — therefore retains a well-defined recency window instead of an arbitrary slice of GitHub's
	 * relevance ranking.
	 */
	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchMyPullRequestsPage(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			search?: string;
			user?: string;
			repos?: string[];
			baseUrl?: string;
			avatarSize?: number;
			silent?: boolean;
			state?: PullRequestStateFilter;
			cursor?: string;
			/**
			 * Uses the lightweight PR fragment while retaining identity, body, author, repository, and branch refs.
			 * Intended for aggregate/list surfaces that do not consume review, check, or diff statistics.
			 */
			summary?: boolean;
			/**
			 * Adds GitHub's provider-native `involves:@me` relationship. Disable when `search` already carries
			 * an explicit relationship qualifier such as `author:@me` or `review-requested:@me`.
			 */
			includeDefaultInvolvement?: boolean;
		},
		cancellation?: AbortSignal,
	): Promise<{ values: PullRequest[]; cursor?: string; hasMore: boolean; truncated: boolean }> {
		const scope = getScopedLogger();
		const limit = Math.min(100, this.config.getLaunchpadQueryLimit?.() ?? 100);

		try {
			interface SearchResult {
				search: {
					issueCount: number;
					pageInfo: {
						endCursor?: string | null;
						hasNextPage: boolean;
					};
					nodes: GitHubPullRequest[];
				};
			}

			const query = `query searchMyPullRequests(
		$search: String!
		$cursor: String
		$avatarSize: Int
	) {
		search(first: ${limit}, after: $cursor, query: $search, type: ISSUE) {
			issueCount
			pageInfo {
				endCursor
				hasNextPage
			}
			nodes {
				...on PullRequest {
					${options?.summary ? gqlPullRequestLiteFragment : gqlPullRequestFragment}
					${gqlPullRequestStackFragmentFor(options)}
				}
			}
		}
	}`;

			let search = options?.search?.trim() ?? '';

			if (options?.user) {
				search += ` user:${options.user}`;
			}

			if (options?.repos?.length) {
				search += ` repo:${options.repos.join(' repo:')}`;
			}

			const ignoredRepos = this.config.getLaunchpadIgnoredRepositories?.() ?? [];
			if (ignoredRepos.length) {
				search += ` -repo:${ignoredRepos.join(' -repo:')}`;
			}

			const enabledOrgs = this.config.getLaunchpadIncludedOrganizations?.() ?? [];
			if (enabledOrgs.length) {
				search += ` org:${enabledOrgs.join(' org:')}`;
			} else {
				const ignoredOrgs = this.config.getLaunchpadIgnoredOrganizations?.() ?? [];
				if (ignoredOrgs.length) {
					search += ` -org:${ignoredOrgs.join(' -org:')}`;
				}
			}

			const stateQualifier =
				options?.state === 'closed'
					? 'is:closed is:unmerged'
					: options?.state === 'merged'
						? 'is:merged'
						: options?.state === 'all'
							? ''
							: 'is:open';

			const relationshipQualifier =
				options?.includeDefaultInvolvement === false
					? 'is:pr archived:false'
					: 'is:pr involves:@me archived:false';
			// Ordering is part of the contract, not an option — same as `searchPullRequestsPage`. Without it
			// GitHub answers in `best-match` (relevance) order, so any result set the caller stops short of
			// draining is an arbitrary sample rather than "the N most recent": which rows land inside a page
			// budget can then shift with GitHub's ranking even when nothing changed upstream. Consumers that
			// cap the walk depend on this to make their window deterministic and time-bounded.
			const rsp = await this.graphql<SearchResult>(
				provider,
				token,
				query,
				{
					search: [stateQualifier, relationshipQualifier, search, 'sort:updated']
						.filter(Boolean)
						.join(' ')
						.trim(),
					cursor: options?.cursor,
					baseUrl: options?.baseUrl,
					avatarSize: options?.avatarSize,
				},
				scope,
				cancellation,
			);
			if (rsp == null) return { values: [], hasMore: false, truncated: false };

			const results: PullRequest[] = rsp.search.nodes.map(pr =>
				options?.summary ? fromGitHubPullRequestLite(pr, provider) : fromGitHubPullRequest(pr, provider),
			);
			return {
				values: results,
				cursor: rsp.search.pageInfo.endCursor ?? undefined,
				hasMore: rsp.search.pageInfo.hasNextPage,
				truncated: rsp.search.issueCount > githubSearchResultLimit,
			};
		} catch (ex) {
			throw this.handleException(ex, provider, scope, options?.silent);
		}
	}

	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchMyPullRequests(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			search?: string;
			user?: string;
			repos?: string[];
			baseUrl?: string;
			avatarSize?: number;
			silent?: boolean;
			state?: PullRequestStateFilter;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest[]> {
		return (await this.searchMyPullRequestsPage(provider, token, options, cancellation)).values;
	}

	/**
	 * The current user's issues: authored ∪ assigned ∪ mentioned, each its own aliased search behind one composite
	 * cursor. Bound to `@me` by construction, unlike {@link searchIssuesPage}.
	 *
	 * Ordering is OPT-IN here, and that asymmetry with {@link searchIssuesPage} is deliberate: this read has never
	 * requested a sort, so GitHub has always answered it in relevance order. Emitting a default would change which
	 * issues its already-shipped consumers see, so an omitted `sort` still emits no `sort:` qualifier at all and
	 * keeps today's result. Pass one to get a defined order — which is also what makes a page budget meaningful,
	 * since relevance ranking can shift under an unchanged upstream.
	 */
	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchMyIssues(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			search?: string;
			user?: string;
			repos?: string[];
			baseUrl?: string;
			avatarSize?: number;
			includeBody?: boolean;
			includeAllAssignees?: boolean;
			cursor?: string;
			/** Requested order. Omitted leaves GitHub's relevance order, which is what this read has always served. */
			sort?: IssueSorting;
			/**
			 * Which of the three "my issues" searches to run. Omitted runs all three (GitHub's own definition of
			 * "mine": authored ∪ assigned ∪ mentioned). Supplied, only the `true` ones run — so a caller wanting
			 * `assignee:@me` parity asks for `{ assigned: true }` instead of filtering the union client-side (which
			 * can't work: the dropped items still counted toward this page, so `hasMore`/`cursor` would describe a
			 * different result set than `values`).
			 *
			 * At least one must be `true`; an all-`false` set reads nothing rather than silently widening back to
			 * the union. The facade never sends one (an empty filter set means "unfiltered" there).
			 */
			categories?: { authored?: boolean; assigned?: boolean; mentioned?: boolean };
		},
		cancellation?: AbortSignal,
	): Promise<AliasedIssueSearchResult | undefined> {
		let search = options?.search?.trim() ?? '';

		if (options?.user) {
			search += ` user:${options.user}`;
		}

		if (options?.repos != null && options.repos.length > 0) {
			const repo = '  repo:';
			search += `${repo}${options.repos.join(repo)}`;
		}

		// A requested sort goes through the same table `searchIssuesPage` uses, so the two GitHub issue reads can't
		// diverge the first time a key is added. Omitted appends nothing — see this method's contract above.
		const sortQualifier = toGitHubIssueSortQualifier(options?.sort);
		const baseFilters = ['type:issue is:open archived:false', sortQualifier].filter(Boolean).join(' ');
		// `includeAllAssignees` broadens the assigned category from "assigned to me" to "assigned to anyone"
		// (`assignee:*` is GitHub's has-any-assignee qualifier). Authored/mentioned stay bound to `@me` — they're
		// user-relative by definition, so an all-assignees read still only surfaces the current user's authored
		// and mentioned issues plus every assigned-to-anyone issue.
		//
		// NOTE: `assignee:*` requires a SCOPE to be meaningful, but any scope will do — one repository, several,
		// or an org (measured: `repo:a repo:b … assignee:*` returns exactly the sum of the two per-repo counts).
		// It is only the UNSCOPED form that is meaningless, matching millions of issues across all of GitHub, so
		// callers must supply `repos` (or an org qualifier via `search`); the facade refuses the unscoped case.
		const assignedQualifier = options?.includeAllAssignees ? 'assignee:*' : 'assignee:@me';

		// A category is read when the caller asked for it AND it hasn't been exhausted (a `null` cursor slot,
		// which `searchIssuesByAlias` maintains). An excluded category needs no cursor bookkeeping: a missing
		// response category reads back as `null`, so it stays excluded across continuations on its own.
		const categories = options?.categories;
		const requested = {
			authored: categories?.authored ?? categories == null,
			assigned: categories?.assigned ?? categories == null,
			mentioned: categories?.mentioned ?? categories == null,
		};

		// Two things are fixed here rather than incidental:
		// - the alias names are this read's persisted cursor keys, so they can't be renamed;
		// - the ORDER is assigned → mentioned → authored, which is the order the union is emitted in and, because
		//   the dedupe keeps the first occurrence of a url, also the precedence between the three. An issue that
		//   is both assigned to and authored by the user surfaces as the assigned one.
		const searches: AliasedIssueSearch[] = [];
		if (requested.assigned) {
			searches.push({ alias: 'assigned', query: `${search} ${baseFilters} ${assignedQualifier}`.trim() });
		}
		if (requested.mentioned) {
			searches.push({ alias: 'mentioned', query: `${search} ${baseFilters} mentions:@me`.trim() });
		}
		if (requested.authored) {
			searches.push({ alias: 'authored', query: `${search} ${baseFilters} author:@me`.trim() });
		}

		// Field by field, like `searchIssuesPage`: `options` also carries `repos`/`includeAllAssignees`/`categories`,
		// already folded into `searches[].query` above and undeclared by the callee.
		return this.searchIssuesByAlias(
			provider,
			token,
			searches,
			{
				baseUrl: options?.baseUrl,
				avatarSize: options?.avatarSize,
				includeBody: options?.includeBody,
				cursor: options?.cursor,
				sort: options?.sort,
				// This read emitted no `sort:` qualifier at all before ordering existed, so a cursor with no
				// recorded key came out of a relevance-ordered walk.
				legacySort: unsortedCursorSort,
			},
			cancellation,
		);
	}

	/**
	 * The filtered issue search: issues matching structured criteria over a repository/org scope, with no forced
	 * relationship to the current user. The issue counterpart of {@link searchMyPullRequestsPage}, and distinct
	 * from {@link searchMyIssues}, which is permanently bound to `@me`.
	 *
	 * Ordering is `criteria.sort`, defaulting to most-recently-updated-first — the order this read served before
	 * ordering was an option, so an omitted `sort` emits the identical query. What is NOT optional is that SOME
	 * order is always requested: without one GitHub answers in relevance order, and at the result ceiling that
	 * makes which rows are reachable a function of GitHub's ranking rather than of the request. A key GitHub can't
	 * express (`closed`, `priority`, …) is refused by the facade before the request, not silently downgraded.
	 *
	 * With more than one relationship the page is a UNION of several searches, each ordered by the provider; the
	 * merged page is re-sorted here so the whole page honors the requested key. Across pages the order is still
	 * per-alias — see {@link searchIssuesByAlias}.
	 *
	 * Each requested relationship becomes its own aliased search, unioned and deduped by url; with none, a single
	 * search runs over the scope alone. `criteria.text` and the other free-form values are sanitized so user input
	 * cannot inject a qualifier and re-scope the search — see {@link toGitHubIssueSearchQualifiers}.
	 */
	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchIssuesPage(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			repos?: string[];
			org?: string;
			criteria?: IssueSearchCriteria;
			baseUrl?: string;
			avatarSize?: number;
			includeBody?: boolean;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<AliasedIssueSearchResult | undefined> {
		// Resolved once: the emitted qualifier, the merged page's comparator and the cursor's fingerprint must all
		// be the same key, which is what `effectiveIssueSort` exists to guarantee.
		const sort = effectiveIssueSort(options?.criteria?.sort);
		const base = [
			...toGitHubIssueSearchScopeQualifiers(options?.org, options?.repos),
			...toGitHubIssueSearchQualifiers(options?.criteria, sort),
		].join(' ');

		// One aliased search per relationship, OR-ed by union. They can't be one query: GitHub AND-s qualifiers,
		// so `author:@me assignee:@me` would return the intersection — issues the user both opened and is assigned
		// to — instead of either set. With no relationship the scope + criteria are already the whole query.
		const relationships = options?.criteria?.relationships;
		const searches: AliasedIssueSearch[] = relationships?.length
			? relationships.map(r => ({
					alias: gitHubIssueSearchRelationships[r].alias,
					query: `${base} ${gitHubIssueSearchRelationships[r].qualifier}`.trim(),
				}))
			: [{ alias: 'matched', query: base }];

		// Forwarded field by field rather than spread: `options` also carries `repos`/`org`/`criteria`, which are
		// already baked into `searches[].query` above and which the callee declares nothing about. `sort` is the
		// EFFECTIVE key, since the merged page and the cursor's fingerprint must both use the one the query used.
		return this.searchIssuesByAlias(
			provider,
			token,
			searches,
			{
				baseUrl: options?.baseUrl,
				avatarSize: options?.avatarSize,
				includeBody: options?.includeBody,
				cursor: options?.cursor,
				pageSize: options?.pageSize,
				sort: sort,
				// This read has always emitted `sort:updated`, which is `defaultIssueSort` — so a cursor with no
				// recorded key came out of a walk under exactly that key, and only a caller asking for a
				// different one has to restart.
				legacySort: defaultIssueSort,
			},
			cancellation,
		);
	}

	/**
	 * Counts issues for several scopes in ONE request, transferring no issues at all — each scope is an aliased
	 * `search` selecting only `issueCount`, with `first: 0` so no nodes are fetched.
	 *
	 * This is what makes a "this will fetch ~N issues" preview affordable: measured against the live API, 30
	 * aliased counts cost a single rate-limit point. It is still a network request per chunk, so a caller is
	 * expected to debounce and cache.
	 *
	 * Returns counts positionally — one per input scope, same order — because a caller-supplied key must never
	 * reach the GraphQL document (it would break it); the aliases are generated. `undefined` in a slot means the
	 * response omitted that alias, which the caller reports as "not counted" rather than as zero.
	 */
	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async countIssues(
		provider: Provider,
		token: GitHubTokenInfo,
		scopes: readonly { repos?: string[]; org?: string; criteria?: IssueSearchCriteria }[],
		options?: { baseUrl?: string },
		cancellation?: AbortSignal,
	): Promise<(number | undefined)[]> {
		const scope = getScopedLogger();
		if (scopes.length === 0) return [];

		const queries = scopes.map(s => {
			// The same resolved key the search would use, so the count previews the query it previews. Ordering
			// cannot change a total, but emitting a DIFFERENT qualifier string than the search does would break the
			// parity this probe is for.
			const qualifiers = [
				...toGitHubIssueSearchScopeQualifiers(s.org, s.repos),
				...toGitHubIssueSearchQualifiers(s.criteria, effectiveIssueSort(s.criteria?.sort)),
			];

			// A relationship set is OR-ed across searches, which a single count can't express — the facade splits
			// such a scope into one count per relationship before calling, so at most one is present here.
			const relationship = s.criteria?.relationships?.[0];
			if (relationship != null) {
				qualifiers.push(gitHubIssueSearchRelationships[relationship].qualifier);
			}
			return qualifiers.join(' ');
		});

		// Aliases are positional and generated (`s0`, `s1`, …): a caller's key is arbitrary text and would break
		// the document, so the caller maps results back by index.
		const params = queries.map((_, i) => `$q${i}: String!`).join('\n\t\t\t\t');
		// `first: 0` is what makes this cheap — `issueCount` alone, no nodes over the wire.
		const fields = queries
			.map((_, i) => `s${i}: search(query: $q${i}, type: ISSUE, first: 0) { issueCount }`)
			.join('\n\t\t\t\t');
		const query = `query countIssues(
				${params}
			) {
				${fields}
			}`;

		const variables: Record<string, unknown> = { baseUrl: options?.baseUrl };
		queries.forEach((q, i) => {
			variables[`q${i}`] = q;
		});

		try {
			const rsp = await this.graphql<Record<string, { issueCount?: number } | undefined>>(
				provider,
				token,
				query,
				variables,
				scope,
				cancellation,
			);
			if (rsp == null) return queries.map(() => undefined);

			return queries.map((_, i) => rsp[`s${i}`]?.issueCount);
		} catch (ex) {
			throw this.handleException(ex, provider, scope);
		}
	}

	/**
	 * The aliased-search engine behind every GitHub issue search: one GraphQL request carrying N independently
	 * cursored `search` fields, `@include`-gated so an exhausted or unrequested one costs nothing.
	 *
	 * It exists as one implementation because the properties that make it correct are subtle and must not be
	 * reproduced per read: each alias advances on its OWN cursor and is dropped from the request once exhausted
	 * (so a finished search is never re-queried, which would re-emit its first page); results are mapped
	 * node-by-node so one unmappable issue can't discard the page; the union is deduped by `url` rather than by
	 * `IssueShape.id`, which for some providers is a per-repository number; and a provider that claims another
	 * page while withholding its `endCursor` is reported as truncated instead of paged forever.
	 *
	 * {@link searchMyIssues} is one configuration of it (its three `@me` categories), and its alias names are
	 * that read's published cursor keys.
	 *
	 * `searches` must have unique aliases, each a valid GraphQL name that is none of `page`, `truncated` or
	 * `sort` — the composite cursor keys aliases at its top level, alongside those three reserved fields.
	 *
	 * `sort` is the order the caller asked for, which this does two things with. Each alias comes back ordered by
	 * it (the qualifier is already in `searches[].query`), but the UNION of several aliases is not, so the merged
	 * page is re-sorted here; and the key is recorded in the cursor, so a continuation that changed it THROWS
	 * rather than serving a sequence with gaps and repeats. Omitted means the caller asked for no order at all
	 * ({@link searchMyIssues}'s default), which re-sorts nothing and pins nothing.
	 *
	 * `legacySort` is the order the calling read produced BEFORE this field existed, and is what a cursor with no
	 * recorded key is compared against — such a cursor is not of unknown order, it is of that read's old one.
	 */
	private async searchIssuesByAlias(
		provider: Provider,
		token: GitHubTokenInfo,
		searches: readonly AliasedIssueSearch[],
		options: {
			baseUrl?: string;
			avatarSize?: number;
			includeBody?: boolean;
			cursor?: string;
			pageSize?: number;
			sort?: IssueSorting;
			legacySort: IssueSorting | typeof unsortedCursorSort;
		},
		cancellation?: AbortSignal,
	): Promise<AliasedIssueSearchResult | undefined> {
		const scope = getScopedLogger();

		type SearchCategory = {
			issueCount: number;
			pageInfo?: { endCursor?: string | null; hasNextPage: boolean };
			nodes: (GitHubIssue | null)[] | null;
		};
		/**
		 * Aliases are keyed at the TOP LEVEL, alongside `page` and `truncated` — the format
		 * {@link searchMyIssues} has always published, so it stays flat rather than nesting the aliases: a
		 * consumer's persisted cursor has to keep resuming where it left off.
		 *
		 * A slot of `null` means exhausted and a missing slot means never requested; both keep that alias out of
		 * the next request.
		 */
		interface SearchCursor {
			page?: number;
			truncated?: boolean;
			/**
			 * The order this cursor's pages were produced under: an `IssueSorting`, or `unsortedCursorSort` when
			 * the caller asked for none. Written as a value rather than left absent in the no-order case
			 * specifically so that ABSENT keeps meaning "cursor from before ordering existed", which is accepted
			 * and sealed instead of refused — a consumer's persisted cursor has to keep working across this change.
			 *
			 * Those three cases are the whole domain, so it is typed as them rather than as `string`: a foreign
			 * cursor carrying something else is caught by the mismatch check either way.
			 */
			sort?: IssueSorting | typeof unsortedCursorSort;
			[alias: string]: string | number | boolean | null | undefined;
		}

		// Enforced, not just documented: aliases share the cursor's top level with `page` and `truncated`, so an
		// alias colliding with either would overwrite it — and the failure would be SILENT, a page number replaced
		// by a cursor string that reads back as page 1, restarting the walk with no error and no truncation flag.
		// Cheap to check, and it fails at the one call that introduced the collision rather than in a consumer's
		// persisted cursor.
		const reserved = searches.filter(s => s.alias === 'page' || s.alias === 'truncated' || s.alias === 'sort');
		if (reserved.length > 0) {
			throw new Error(
				`Issue search alias(es) ${reserved.map(s => `'${s.alias}'`).join(', ')} collide with the composite cursor's reserved keys`,
			);
		}

		// A key GitHub cannot express emits no `sort:` qualifier, so each alias would come back in RELEVANCE order
		// while the union below is sorted by that key and the cursor sealed under it: an arbitrary subset,
		// presented as ordered, resumable only into more of the same. Refused here rather than downgraded, which
		// is the rule the whole feature is built on. Unreachable through the facade — no `supportedIssueSorts`
		// table declares a key without a qualifier — so this guards the direct callers of the two public reads,
		// where `title` is expressible enough to have a comparator and not enough to be a GitHub search qualifier.
		if (options.sort != null && toGitHubIssueSortQualifier(options.sort) == null) {
			throw new Error(`GitHub cannot order an issue search by '${options.sort}'`);
		}

		let cursor: SearchCursor | undefined;
		if (options?.cursor != null) {
			try {
				cursor = JSON.parse(options.cursor) as SearchCursor;
			} catch {}
		}
		// The order this request is being made under, as the cursor records it.
		const requestedSort = options.sort ?? unsortedCursorSort;
		// A cursor produced under a DIFFERENT order can't be resumed: every alias would continue from a position in
		// a differently-ordered result set, so the continuation re-emits rows already seen and skips rows never
		// seen. REFUSED rather than silently restarted from page 1, because a restart cannot be reported honestly
		// from here: this read is cursor-only, so `resolveCurrentPage` has no page of its own to trust and echoes
		// the `page` the caller supplied alongside the cursor — page 1's rows would be published as page N, which
		// is the very confusion the fingerprint exists to prevent. Refusing surfaces a warning + `fetchFailed`, and
		// the remedy ("drop the cursor") is the caller's to apply.
		//
		// A cursor with NO recorded sort predates this field — which is not the same as being of unknown order.
		// Each read produced exactly one order before ordering was an option (`sort:updated` for the filtered
		// search, relevance for `searchMyIssues`), so an absent key reads as THAT one, `legacySort`. Compared
		// rather than waved through: the facade now resolves an omitted key to `defaultIssueSort`, so the
		// account-wide read's query gained a `sort:updated` qualifier it did not have, and resuming a
		// relevance-ordered cursor inside it advances each alias through a re-ordered result set — the gaps and
		// repeats this check exists to prevent, arriving through the very case meant to keep working. A cursor
		// whose implied key matches the request still resumes, and is sealed with the current one.
		const cursorSort = cursor?.sort ?? options.legacySort;
		if (cursor != null && cursorSort !== requestedSort) {
			throw new Error(
				`Issue search cursor was produced under sort '${cursorSort}' but '${requestedSort}' was requested; restart the read without a cursor`,
			);
		}

		const page = Math.max(1, Math.trunc(cursor?.page ?? 1));
		// A slot is a continuation string, `null` (exhausted), or absent. Anything else came from a malformed or
		// foreign cursor, and is read as absent rather than threaded back into the request as a continuation.
		const slotFor = (alias: string): string | null | undefined => {
			const slot = cursor?.[alias];
			return slot === null || typeof slot === 'string' ? slot : undefined;
		};
		// Every requested search is in the document; an exhausted one is switched OFF by its `@include` gate
		// rather than removed, so a continuation's request keeps the shape of the first one and GitHub's
		// query-document cache still recognizes it. `active` is what actually runs.
		const isActive = (s: AliasedIssueSearch) => slotFor(s.alias) !== null;
		const active = searches.filter(isActive);
		// Reading nothing is the honest answer to "every requested search is exhausted (or none was requested)":
		// widening back to the full set would return items the caller excluded, or re-emit a finished page.
		if (active.length === 0) {
			return { values: [], hasMore: false, page: page, truncated: cursor?.truncated === true };
		}

		// GitHub's search caps a page at 100 regardless of what is asked for.
		const pageSize = Math.min(100, Math.max(1, Math.trunc(options?.pageSize ?? 100)));
		// `includeAssigned` etc. — the same variable names the read published before the aliases were made
		// data-driven, so a recorded/asserted request shape stays recognizable.
		const includeVar = (alias: string) => `include${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
		const params = searches.flatMap(s => [
			`$${s.alias}: String!`,
			`$${s.alias}Cursor: String`,
			`$${includeVar(s.alias)}: Boolean!`,
		]);
		const fields = searches.map(
			s => `${s.alias}: search(first: ${pageSize}, after: $${s.alias}Cursor, query: $${s.alias}, type: ISSUE)
					@include(if: $${includeVar(s.alias)}) {
					issueCount
					pageInfo {
						endCursor
						hasNextPage
					}
					nodes {
						... on Issue {
							${gqIssueFragment}
							${options?.includeBody ? 'body' : ''}
						}
					}
				}`,
		);
		const query = `query searchIssues(
				${params.join('\n\t\t\t\t')}
				$avatarSize: Int
			) {
				${fields.join('\n\t\t\t\t')}
			}`;

		const variables: Record<string, unknown> = {
			baseUrl: options?.baseUrl,
			avatarSize: options?.avatarSize,
		};
		for (const s of searches) {
			variables[s.alias] = s.query;
			variables[`${s.alias}Cursor`] = slotFor(s.alias) ?? undefined;
			variables[includeVar(s.alias)] = isActive(s);
		}

		try {
			const rsp = await this.graphql<Record<string, SearchCategory | undefined>>(
				provider,
				token,
				query,
				variables,
				scope,
				cancellation,
			);
			if (rsp == null) return { values: [], hasMore: false, page: page, truncated: false };

			// Map node-by-node so one unmappable issue can't discard the whole result set
			const issues: IssueShape[] = [];
			for (const s of active) {
				for (const node of rsp[s.alias]?.nodes ?? []) {
					if (node?.id == null) continue;

					try {
						issues.push(fromGitHubIssue(node, provider));
					} catch (ex) {
						scope?.warn(`skipped unmappable issue; id=${node.id}, url=${node.url}, ex=${ex}`);
					}
				}
			}

			// Dedupe by `url`, not `IssueShape.id`: for some providers `id` is a per-repository number, so an
			// id-keyed map would collapse distinct issues across repositories.
			const deduped = [
				...uniqueBy(
					issues,
					r => r.url,
					(original, _current) => original,
				),
			];

			// Each alias arrived ordered by the server; their concatenation is not, so the merged page is ordered
			// here. AFTER the dedupe, not before, and that ordering is load-bearing: the alias order is also the
			// dedupe's precedence (an issue both assigned to and authored by the user surfaces as the assigned one,
			// per `searchMyIssues`), and sorting first would hand `uniqueBy` a different first occurrence and
			// silently change which copy wins. The pull-request path sorts BEFORE its dedupe because its facets
			// carry no such precedence — the difference is deliberate, not an inconsistency to tidy up.
			//
			// A comparator is always available for a key GitHub declares (`created`/`updated`/`comments`/
			// `reactions` are all on `IssueShape`), so `undefined` here means the capability table has outrun this
			// read; leave the provider's per-alias order rather than inventing one.
			//
			// Counted over `active`, not `searches`: continuations exhaust aliases one at a time, so a later page of
			// a three-category walk can come from ONE surviving search — already ordered by the server. Re-sorting
			// it could only reproduce that order, while hiding a provider that ignored the qualifier.
			const comparator = options?.sort != null ? getIssueComparator(options.sort) : undefined;
			if (comparator != null && active.length > 1) {
				deduped.sort(comparator);
			}

			// Every alias gets a slot, so an inactive one keeps its `null` and stays out of the next request. A
			// missing slot would be read as "never requested", which for a `searches` set that still lists it
			// would restart it from its first page.
			// The order is pinned on the way out too, so the next round can refuse a changed key (see above).
			const next: SearchCursor = { page: page + 1, sort: requestedSort };
			let hasMore = false;
			let continuationMissing = false;
			let maxIssueCount = 0;
			for (const s of searches) {
				const category = rsp[s.alias];
				const endCursor =
					category?.pageInfo?.hasNextPage && category.pageInfo.endCursor ? category.pageInfo.endCursor : null;
				next[s.alias] = endCursor;
				if (endCursor != null) {
					hasMore = true;
				}
				if (category?.pageInfo?.hasNextPage === true && category.pageInfo.endCursor == null) {
					continuationMissing = true;
				}
				maxIssueCount = Math.max(maxIssueCount, category?.issueCount ?? 0);
			}

			// GitHub search exposes at most `githubSearchResultLimit` results PER SEARCH, so the ceiling is
			// reached as soon as any one alias exceeds it. Paging removes the old 100-item truncation; only that
			// upstream ceiling or an unusable continuation leaves the read incomplete.
			const truncated =
				cursor?.truncated === true || maxIssueCount > githubSearchResultLimit || continuationMissing;
			next.truncated = truncated || undefined;
			return {
				values: deduped,
				cursor: hasMore ? JSON.stringify(next) : undefined,
				hasMore: hasMore,
				page: page,
				truncated: truncated,
				totalCount: maxIssueCount,
			};
		} catch (ex) {
			throw this.handleException(ex, provider, scope);
		}
	}

	/**
	 * Searches pull requests over a repository/org or current-user relationship scope. One GraphQL document carries
	 * every active relationship × state facet, so one HTTP request serves one page even when the logical search is
	 * a union. The cursor preserves each facet's continuation plus the positional page.
	 *
	 * Ordering is always most-recently-updated-first, and user text is sanitized before it reaches the provider
	 * query. See {@link toGitHubPullRequestSearchFacets}.
	 */
	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchPullRequestsPage(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			repos?: string[];
			org?: string;
			criteria?: PullRequestSearchCriteria;
			baseUrl?: string;
			avatarSize?: number;
			cursor?: string;
			pageSize?: number;
		},
		cancellation?: AbortSignal,
	): Promise<PullRequestSearchResult | undefined> {
		const scope = getScopedLogger();

		const pageSize = Math.min(
			maxPullRequestSearchPageSize,
			Math.max(1, Math.trunc(options?.pageSize ?? defaultPullRequestSearchPageSize)),
		);
		const facets = toGitHubPullRequestSearchFacets(options?.criteria);
		const facetAliases = facets.map(f => f.alias).sort();
		const scopeQualifiers = toGitHubIssueSearchScopeQualifiers(options?.org, options?.repos);
		const facetSearches = new Map(
			facets.map(f => [f.alias, [...scopeQualifiers, ...f.qualifiers].join(' ')] as const),
		);
		// Bind a cursor to every qualifier without publishing the user text/scope inside the opaque cursor. FNV-1a
		// is a compact drift key, not a security primitive: a mismatch only degrades safely to page 1.
		let cursorKeyHash = 0x811c9dc5;
		for (const value of [...facetSearches.entries()].sort(([a], [b]) => a.localeCompare(b)).flat()) {
			for (let i = 0; i < value.length; i++) {
				cursorKeyHash ^= value.charCodeAt(i);
				cursorKeyHash = Math.imul(cursorKeyHash, 0x01000193);
			}
			cursorKeyHash ^= 0;
			cursorKeyHash = Math.imul(cursorKeyHash, 0x01000193);
		}
		const cursorKey = (cursorKeyHash >>> 0).toString(36);

		type SearchCategory = {
			issueCount: number;
			pageInfo?: { endCursor?: string | null; hasNextPage: boolean };
			nodes: (GitHubPullRequest | null)[] | null;
		};
		interface SearchCursor {
			key: string;
			page: number;
			facets: Record<string, string | null>;
			truncated?: boolean;
			totalCount?: number;
		}

		let cursor: SearchCursor | undefined;
		if (options?.cursor != null) {
			try {
				const parsed = JSON.parse(options.cursor) as Partial<SearchCursor>;
				const parsedFacets = parsed.facets;
				if (parsedFacets != null && typeof parsedFacets === 'object' && !Array.isArray(parsedFacets)) {
					const parsedAliases = Object.keys(parsedFacets).sort();
					const sameFacets =
						parsedAliases.length === facetAliases.length &&
						parsedAliases.every((alias, index) => alias === facetAliases[index]);
					const usableSlots = Object.values(parsedFacets).every(
						slot => slot === null || (typeof slot === 'string' && slot.length > 0),
					);
					if (parsed.key === cursorKey && sameFacets && usableSlots) {
						cursor = {
							key: cursorKey,
							page:
								typeof parsed.page === 'number' && Number.isFinite(parsed.page)
									? Math.max(1, Math.trunc(parsed.page))
									: 1,
							facets: parsedFacets,
							truncated: parsed.truncated === true,
							totalCount:
								typeof parsed.totalCount === 'number' && Number.isFinite(parsed.totalCount)
									? Math.max(0, Math.trunc(parsed.totalCount))
									: undefined,
						};
					}
				}
			} catch {}
		}
		const page = cursor?.page ?? 1;
		const isActive = (alias: string): boolean => cursor?.facets[alias] !== null;
		const activeFacets = facets.filter(f => isActive(f.alias));
		if (activeFacets.length === 0) {
			return {
				values: [],
				hasMore: false,
				page: page,
				truncated: cursor?.truncated === true,
				totalCount: cursor?.totalCount,
			};
		}

		const includeVar = (alias: string): string => `include${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
		const params = facets.flatMap(f => [
			`$${f.alias}Search: String!`,
			`$${f.alias}Cursor: String`,
			`$${includeVar(f.alias)}: Boolean!`,
		]);
		const fields = facets.map(
			f => `${f.alias}: search(first: ${pageSize}, after: $${f.alias}Cursor, query: $${f.alias}Search, type: ISSUE)
				@include(if: $${includeVar(f.alias)}) {
				issueCount
				pageInfo {
					endCursor
					hasNextPage
				}
				nodes {
					... on PullRequest {
						${gqlPullRequestFragment}
					}
				}
			}`,
		);
		const query = `query searchPullRequestsPage(
			${params.join('\n\t\t\t')}
			$avatarSize: Int
		) {
			${fields.join('\n\t\t\t')}
		}`;

		const variables: Record<string, unknown> = {
			baseUrl: options?.baseUrl,
			avatarSize: options?.avatarSize,
		};
		for (const facet of facets) {
			variables[`${facet.alias}Search`] = facetSearches.get(facet.alias);
			variables[`${facet.alias}Cursor`] = cursor?.facets[facet.alias] ?? undefined;
			variables[includeVar(facet.alias)] = isActive(facet.alias);
		}

		try {
			const rsp = await this.graphql<Record<string, SearchCategory | undefined>>(
				provider,
				token,
				query,
				variables,
				scope,
				cancellation,
			);
			if (rsp == null) return { values: [], hasMore: false, page: page, truncated: false };

			const pullRequests: PullRequestShape[] = [];
			for (const facet of activeFacets) {
				for (const node of rsp[facet.alias]?.nodes ?? []) {
					if (node?.id == null) continue;

					try {
						pullRequests.push(fromGitHubPullRequest(node, provider));
					} catch (ex) {
						scope?.warn(`skipped unmappable pull request; id=${node.id}, url=${node.url}, ex=${ex}`);
					}
				}
			}
			pullRequests.sort((a, b) => b.updatedDate.getTime() - a.updatedDate.getTime());
			const values = [
				...uniqueBy(
					pullRequests,
					pr => pr.url,
					(original, _current) => original,
				),
			];

			const nextFacets: Record<string, string | null> = {};
			let hasMore = false;
			let continuationMissing = false;
			let totalCount = cursor?.totalCount ?? 0;
			let providerLimitReached = false;
			for (const facet of facets) {
				if (!isActive(facet.alias)) {
					nextFacets[facet.alias] = null;
					continue;
				}

				const category = rsp[facet.alias];
				const endCursor =
					category?.pageInfo?.hasNextPage === true && category.pageInfo.endCursor
						? category.pageInfo.endCursor
						: null;
				nextFacets[facet.alias] = endCursor;
				if (endCursor != null) {
					hasMore = true;
				}
				if (category?.pageInfo?.hasNextPage === true && category.pageInfo.endCursor == null) {
					continuationMissing = true;
				}
				totalCount = Math.max(totalCount, category?.issueCount ?? 0);
				providerLimitReached ||= (category?.issueCount ?? 0) > githubSearchResultLimit;
			}
			const truncated = cursor?.truncated === true || providerLimitReached || continuationMissing;
			const next: SearchCursor = {
				key: cursorKey,
				page: page + 1,
				facets: nextFacets,
				truncated: truncated || undefined,
				totalCount: totalCount,
			};

			return {
				values: values,
				cursor: hasMore ? JSON.stringify(next) : undefined,
				hasMore: hasMore,
				page: page,
				truncated: truncated,
				totalCount: totalCount,
			};
		} catch (ex) {
			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({ args: (provider, token) => ({ provider: provider.name, token: `<token:${token.microHash}>` }) })
	async searchPullRequests(
		provider: Provider,
		token: GitHubTokenInfo,
		options?: {
			search?: string;
			user?: string;
			repos?: string[];
			baseUrl?: string;
			avatarSize?: number;
			include?: PullRequestState[];
		},
		cancellation?: AbortSignal,
	): Promise<PullRequest[]> {
		const scope = getScopedLogger();
		const pageSize = 10;
		const include = options?.include?.length ? options.include : undefined;
		const requiresPagination = shouldPaginateGitHubSearchState(include);

		interface SearchResult {
			search: {
				pageInfo: {
					endCursor?: string | null;
					hasNextPage: boolean;
				};
				nodes: GitHubPullRequest[];
			};
		}

		try {
			const query = `query searchPullRequests(
	$searchQuery: String!
		$cursor: String
	$avatarSize: Int
) {
		search(first: ${pageSize}, after: $cursor, query: $searchQuery, type: ISSUE) {
			pageInfo {
				endCursor
				hasNextPage
			}
		nodes {
			...on PullRequest {
				${gqlPullRequestFragment}
				${gqlPullRequestStackFragmentFor(options)}
			}
		}
	}
}`;

			let search = options?.search?.trim() ?? '';

			if (options?.user) {
				search += ` user:${options.user}`;
			}

			if (options?.repos != null && options.repos.length > 0) {
				const repo = ' repo:';
				search += `${repo}${options.repos.join(repo)}`;
			}

			const searchQuery = ['is:pr', toGitHubSearchStateQualifier(include), 'archived:false', search.trim()]
				.filter(Boolean)
				.join(' ');

			// Bound the paginated case with a defensive page backstop like the other paged provider drains, so a
			// large, low-match result set can't fan out into an unbounded request loop.
			const maxSearchPages = 20;
			let cursor: string | undefined;
			const results: PullRequest[] = [];
			for (let page = 0; page < maxSearchPages; page++) {
				const rsp = await this.graphql<SearchResult>(
					provider,
					token,
					query,
					{
						searchQuery: searchQuery,
						cursor: cursor,
						baseUrl: options?.baseUrl,
						avatarSize: options?.avatarSize,
					},
					scope,
					cancellation,
				);
				if (rsp == null) return results;

				const pageResults = filterPullRequestsBySearchState(
					rsp.search.nodes.map(pr => fromGitHubPullRequest(pr, provider)),
					include,
				);
				results.push(...pageResults);

				cursor = rsp.search.pageInfo.endCursor ?? undefined;
				if (!requiresPagination || results.length >= pageSize || !rsp.search.pageInfo.hasNextPage) {
					break;
				}
			}

			return results.slice(0, pageSize);
		} catch (ex) {
			throw this.handleException(ex, provider, scope);
		}
	}

	/**
	 * Every stack in the repository, each with its members bottom to top.
	 *
	 * One request regardless of how many pull requests are involved — which is what makes it the right
	 * shape for list surfaces, whose pull requests arrive through the shared providers API and so carry no
	 * stack membership of their own. Callers join the result by pull request number.
	 *
	 * A `404` means the repository isn't enrolled in the stacked-pull-requests preview; that's reported as
	 * `undefined` rather than an error, since "no stacks" and "not available" both mean nothing to show.
	 */
	@trace({
		args: (provider, token, owner, repo) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
		}),
	})
	async getRepositoryStacks(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		options?: { baseUrl?: string },
		cancellation?: AbortSignal,
	): Promise<GitHubStackResource[] | undefined> {
		const scope = getScopedLogger();

		try {
			const rsp = await this.requestPreview<{ data: GitHubStackResource[] }>(
				provider,
				token,
				'GET /repos/{owner}/{repo}/stacks',
				{ owner: owner, repo: repo, baseUrl: options?.baseUrl },
				scope,
				cancellation,
			);

			return rsp.data;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			Logger.warn(scope, `Unable to list stacks for ${owner}/${repo}: ${ex}`);
			return undefined;
		}
	}

	/**
	 * Merges a stacked pull request, and with it every layer below it.
	 *
	 * Stacks cannot go through `mergePullRequest` — GitHub rejects stacked pull requests on the legacy
	 * synchronous merge endpoints and mutations. The replacement is asynchronous: submit, then poll a
	 * ticket until it reaches a terminal state.
	 */
	@trace({
		args: (provider, token, owner, repo, pullNumber, expectedSourceSha) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			owner: owner,
			repo: repo,
			pullNumber: pullNumber,
			expectedSourceSha: expectedSourceSha,
		}),
	})
	async mergeStackedPullRequest(
		provider: Provider,
		token: GitHubTokenInfo,
		owner: string,
		repo: string,
		pullNumber: number,
		expectedSourceSha: string,
		options?: { mergeMethod?: PullRequestMergeMethod; baseUrl?: string },
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const scope = getScopedLogger();

		try {
			let uuid: string | undefined;

			try {
				const submitted = await this.requestPreview<{ data: GitHubAsyncMergeResult }>(
					provider,
					token,
					'PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge-async',
					{
						owner: owner,
						repo: repo,
						pull_number: pullNumber,
						sha: expectedSourceSha,
						merge_method: options?.mergeMethod,
						baseUrl: options?.baseUrl,
					},
					scope,
					cancellation,
				);

				// Already merged or rejected outright — nothing to poll for. `enqueued` lands via the merge
				// queue, which can take several merge groups to settle, so it's transitional like `pending`.
				if (submitted.data.status !== 'pending' && submitted.data.status !== 'enqueued') {
					if (submitted.data.status === 'failed') {
						Logger.warn(
							scope,
							`Stacked merge refused: ${submitted.data.details?.message ?? 'no reason given'}`,
						);
					}
					return submitted.data.status === 'merged';
				}

				uuid = submitted.data.details?.uuid;
			} catch (ex) {
				// A merge request is already in flight (a retry, or a double-click) — adopt its ticket and
				// poll that instead of reporting a failure for a merge that is actually running.
				uuid = getAsyncMergeUuidFromConflict(ex);
				if (uuid == null) throw ex;
			}

			if (uuid == null) return false;

			// The stack merges server-side one layer at a time, so this can take a while. Poll on a
			// fixed interval and give up rather than hang forever if the ticket never settles.
			for (let attempt = 0; attempt < maxAsyncMergePolls; attempt++) {
				if (cancellation?.aborted) throw new CancellationError();

				await new Promise(resolve => setTimeout(resolve, asyncMergePollIntervalMs));

				const polled = await this.requestPreview<{ data: GitHubAsyncMergeResult }>(
					provider,
					token,
					'GET /repos/{owner}/{repo}/pulls/{pull_number}/merge-async/{uuid}',
					{
						owner: owner,
						repo: repo,
						pull_number: pullNumber,
						uuid: uuid,
						baseUrl: options?.baseUrl,
					},
					scope,
					cancellation,
				);

				if (polled.data.status === 'pending' || polled.data.status === 'enqueued') continue;

				if (polled.data.status === 'failed') {
					Logger.warn(scope, `Stacked merge failed: ${polled.data.details?.message ?? 'no reason given'}`);
				}
				return polled.data.status === 'merged';
			}

			Logger.warn(scope, `Timed out waiting for stacked merge of ${owner}/${repo}#${pullNumber}`);
			return false;
		} catch (ex) {
			if (isCancellationError(ex)) throw ex;

			Logger.error(ex, scope);
			throw this.handleException(ex, provider, scope);
		}
	}

	@trace({
		args: (provider, token, nodeId, expectedSourceSha) => ({
			provider: provider.name,
			token: `<token:${token.microHash}>`,
			nodeId: nodeId,
			expectedSourceSha: expectedSourceSha,
		}),
	})
	async mergePullRequest(
		provider: Provider,
		token: GitHubTokenInfo,
		nodeId: string,
		expectedSourceSha: string,
		options?: { mergeMethod?: PullRequestMergeMethod; baseUrl?: string },
		cancellation?: AbortSignal,
	): Promise<boolean> {
		const scope = getScopedLogger();
		interface QueryResult {
			mergePullRequest: { pullRequest: { id: string } | null | undefined } | null | undefined;
		}

		let githubMergeStrategy;
		switch (options?.mergeMethod) {
			case PullRequestMergeMethod.Merge: {
				githubMergeStrategy = 'MERGE';
				break;
			}

			case PullRequestMergeMethod.Rebase: {
				githubMergeStrategy = 'REBASE';
				break;
			}

			case PullRequestMergeMethod.Squash: {
				githubMergeStrategy = 'SQUASH';
				break;
			}
		}

		try {
			const query = `mutation mergePullRequest(
	$id: ID!
	$expectedSourceSha: GitObjectID!
	$mergeMethod: PullRequestMergeMethod
) {
	mergePullRequest(input: { pullRequestId: $id, expectedHeadOid: $expectedSourceSha, mergeMethod: $mergeMethod }) {
		pullRequest {
			id
		}
	}
}`;

			const rsp = await this.graphql<QueryResult>(
				provider,
				token,
				query,
				{
					id: nodeId,
					expectedSourceSha: expectedSourceSha,
					mergeMethod: githubMergeStrategy,
					baseUrl: options?.baseUrl,
				},
				scope,
				cancellation,
			);

			return rsp?.mergePullRequest?.pullRequest?.id === nodeId;
		} catch (ex) {
			throw this.handleException(ex, provider, scope);
		}
	}
}

function isGitHubDotCom(options?: { baseUrl?: string }) {
	return options?.baseUrl == null || options.baseUrl === 'https://api.github.com';
}

// Translates the requested PR states into a GitHub search state qualifier. GitHub search treats
// `is:closed` as closed-or-merged, `is:merged` as its subset, and `is:unmerged` as open + closed
// (not-merged), so `closed` and `merged` (distinct in our model) map to `is:closed is:unmerged` and
// `is:merged`. `undefined` preserves the historical open-only default.
export function toGitHubSearchStateQualifier(include: PullRequestState[] | undefined): string {
	if (include == null) return 'is:open';

	const opened = include.includes('opened');
	const closed = include.includes('closed');
	const merged = include.includes('merged');

	if (opened && closed && merged) return ''; // all states -> no qualifier
	if (opened && closed) return 'is:unmerged';
	if (closed && merged) return 'is:closed';
	// `opened && merged` isn't expressible as a single AND qualifier; omit it here and post-filter.
	if (opened && merged) return '';
	if (opened) return 'is:open';
	if (merged) return 'is:merged';
	if (closed) return 'is:closed is:unmerged';
	return 'is:open'; // empty include -> default
}

export function filterPullRequestsBySearchState<T extends { state: PullRequestState }>(
	pullRequests: T[],
	include: PullRequestState[] | undefined,
): T[] {
	const states = include?.length ? include : (['opened'] satisfies PullRequestState[]);
	const allowedStates = new Set<PullRequestState>(states);
	// There are only 3 possible states, so a full set means every state is allowed; use the deduped set
	// size rather than the raw length so duplicates (e.g. `['opened', 'opened', 'closed']`) don't skip filtering.
	if (allowedStates.size === 3) return pullRequests;

	return pullRequests.filter(pr => allowedStates.has(pr.state));
}

function shouldPaginateGitHubSearchState(include: PullRequestState[] | undefined): boolean {
	if (include == null || include.length === 0) return false;

	const uniqueStates = new Set<PullRequestState>(include);
	return uniqueStates.size === 2 && uniqueStates.has('opened') && uniqueStates.has('merged');
}
