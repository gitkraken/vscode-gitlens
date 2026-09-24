import type { CollectionScope, CollectionScopeFailure, CollectionScopeFailureKind } from '@gitkraken/provider-apis';
import type {
	PullRequestSearchCriteria,
	PullRequestSorting,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import { defaultPullRequestSort, PullRequestFilter } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import { getPullRequestComparator } from '@gitlens/git/utils/pullRequest.utils.js';
import { CancellationError, isCancellationError } from '@gitlens/utils/cancellation.js';
import { getNonce, sha256 } from '@gitlens/utils/crypto.js';
import { Logger } from '@gitlens/utils/logger.js';
import { mapSettledBounded } from '@gitlens/utils/promise.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import { toCollectionScopeFailure } from '../../collectionMetadata.js';
import type { GitSelfManagedHostIntegrationId } from '../../constants.js';
import { AuthenticationError, AuthenticationErrorReason } from '../../errors.js';
import type { ProviderPullRequestCount, ProviderPullRequestSearchPage } from '../../models/pullRequestReads.js';
import type { ProviderPullRequest, ProviderRepoInput, ProviderRequestFunction } from '../models.js';
import { fromProviderPullRequest } from '../models.js';
import { throwProviderError } from '../providerErrors.js';
import type {
	BitbucketServerPagedResponse,
	BitbucketServerPullRequest,
	BitbucketServerPullRequestUser,
	BitbucketServerUser,
} from './models.js';
import { normalizeBitbucketServerPullRequest } from './models.js';

type Token = TokenWithInfo<GitSelfManagedHostIntegrationId.BitbucketServer>;
type BitbucketServerPullRequestState = BitbucketServerPullRequest['state'];

/**
 * The relationships Bitbucket Data Center can express, in the canonical order its facets (and so its cursor) are
 * built in. A Bitbucket pull request has no assignee, and none of its pull-request endpoints filter by mention.
 */
const relationships = [
	PullRequestFilter.Author,
	PullRequestFilter.ReviewRequested,
	PullRequestFilter.Reviewed,
] as const;
type Relationship = (typeof relationships)[number];

/** The current user, which both the server-side participant filters and their client-side re-check identify. */
export interface BitbucketServerSearchUser {
	id: string;
	username: string;
}

/**
 * One provider query of the search: a repository or the current user's dashboard, times one relationship.
 *
 * A repository facet reads `/projects/{key}/repos/{slug}/pull-requests`, which filters participants, text and draft
 * state server-side, so a page narrowed to a few repositories holds only matches. Without repositories a relationship
 * reads `/dashboard/pull-requests`, the only cross-repository pull-request list Bitbucket Data Center has; it can't
 * filter text or draft state, so those are re-checked on its rows. There is no project-wide list at all, which is
 * why the capability declares no organization scope.
 *
 * States are not a facet axis: every facet asks the server for the one requested state, or for every state when
 * several are requested, and keeps the requested ones — reading the unrequested rows rather than spending one more
 * request per state.
 */
interface Facet {
	repo?: ProviderRepoInput;
	relationship?: Relationship;
	/**
	 * The dashboard role a `Reviewed` facet reads. The dashboard only applies `participantStatus` together with
	 * `role` — without one it returns every pull request the user is involved in, authored ones included, whatever
	 * the status — so `Reviewed` is read as two facets, the reviewer list and the (non-reviewer) participant list,
	 * each filtered by status server-side. Absent for every other facet.
	 */
	role?: DashboardRole;
}

type DashboardRole = 'REVIEWER' | 'PARTICIPANT';

interface SearchOptions {
	baseUrl: string;
	repos?: ProviderRepoInput[];
	/** Refused when set: Bitbucket Data Center has no project-wide pull-request list to scope it to. */
	org?: string;
	criteria?: PullRequestSearchCriteria;
	/** Required when `criteria.relationships` is non-empty. */
	currentUser?: BitbucketServerSearchUser;
}

/** A resolved query, shared by every facet of one search or count. */
interface Query extends SearchOptions {
	facets: Facet[];
	/** The requested relationships, in canonical order — the order {@link ownsRow} gives a shared row to. */
	relationships: Relationship[];
	/** The requested states, or `undefined` for every state. */
	states: Set<BitbucketServerPullRequestState> | undefined;
	sort: PullRequestSorting;
}

/** Bitbucket answers an unspecified page size with 25; a search page asks for this many per facet instead. */
const defaultSearchPageSize = 30;
/**
 * The server's own cap on a page (`page.max.pullrequests`, 1000 unless an administrator lowered it), and the one
 * page a count reads per facet: past it the count is a floor rather than more of a customer-run server's capacity
 * spent on a figure the caller uses as a cost hint.
 */
const maxPageSize = 1000;
/** Matches the SDK's own cap on concurrent Bitbucket Data Center pull-request requests. */
const facetConcurrency = 5;

/** The server states each facade state covers. `closed` is two, so it can't be sent as one `state` filter. */
const pullRequestStates: Record<Exclude<PullRequestStateFilter, 'all'>, BitbucketServerPullRequestState[]> = {
	open: ['OPEN'],
	closed: ['DECLINED', 'SUPERSEDED'],
	merged: ['MERGED'],
};

const orderParams: Partial<Record<PullRequestSorting, string>> = {
	'updated:desc': 'NEWEST',
	'updated:asc': 'OLDEST',
};

/**
 * Pull requests matching `criteria` over the requested repositories, or over the current user's relationships when
 * none are given.
 *
 * Every facet reads its own page, and the merged page is re-ordered as a whole. Each facet keeps its own
 * `nextPageStart` in the cursor, which is bound to this connection, installation and query: a cursor handed back
 * under anything else is refused rather than read as page 1 of a different search. A pull request several
 * relationships match is served by exactly one of them, the first in canonical order (see {@link ownsRow}), so facets
 * that advance independently never serve it twice across pages and the cursor carries no history of what it emitted.
 *
 * Every criterion the server applies is applied again to the rows it returns, so a server that ignores a parameter
 * (one older than 8.18, which shipped drafts, has no `draft`) narrows the page instead of silently widening it.
 *
 * A facet that fails is reported in `metadata` while its siblings still answer, and keeps its offset, so the next page
 * retries the page it missed — a transient failure recovers the rows it cost. A facet that fails its retry too is
 * dropped, and reported on every later page, which no longer reads it; one retry keeps a facet that will never answer
 * from holding `hasMore` open forever. If every facet fails on the first page, the first failure is thrown instead.
 */
export async function searchBitbucketServerPullRequestsPage(
	request: ProviderRequestFunction,
	token: Token,
	options: SearchOptions & { connectionId: string; provider: Provider; cursor?: string; pageSize?: number },
	cancellation?: AbortSignal,
): Promise<ProviderPullRequestSearchPage> {
	const query = toQuery(options);
	const comparator = getPullRequestComparator(query.sort)!;
	const key = await getCursorKey(options.connectionId, query);
	const cursor = await parseCursor(options.cursor, key, query.facets);
	const active = query.facets.flatMap((facet, index) =>
		cursor.starts[index] != null ? [{ facet: facet, start: cursor.starts[index], index: index }] : [],
	);
	// A facet dropped on an earlier page is gone from this one's reads, and the hole is still in the result.
	const failed = [...cursor.failed];
	const failures = failed.map(f => toEarlierFailure(token, query.facets[f.facet], f.kind));
	const retrying: number[] = [];
	if (active.length === 0) {
		return {
			values: [],
			hasMore: false,
			page: cursor.page,
			truncated: cursor.truncated,
			metadata: toMetadata(failures),
		};
	}

	const limit = Math.min(maxPageSize, Math.max(1, Math.trunc(options.pageSize ?? defaultSearchPageSize)));
	const results = await mapSettledBounded(active, facetConcurrency, ({ facet, start }) =>
		readFacetPage(request, token, query, facet, start, limit, false, cancellation),
	);
	const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	const cancelled = rejected.find(r => isCancellationError(r.reason));
	if (cancelled != null) throw cancelled.reason;

	// A rejected credential is the connection failing rather than one scope, so it is thrown on any page: the
	// integration's session recovery then runs once, from the thrown error, and the failure is never carried in the
	// cursor where every later page would report it again. (A repository refusing the token isn't one; see
	// `toFacetError`.)
	const credential = rejected.find(r => r.reason instanceof AuthenticationError);
	if (credential != null) throw credential.reason;
	// Only a first page on which every facet failed is a failed read. On a later page an earlier one already proved
	// some facet answered, so the rows it served stand and this page's failures join the partial-result report.
	if (cursor.page === 1 && rejected.length === results.length) throw rejected[0].reason;

	const nextStarts: (number | null)[] = cursor.starts.map(() => null);
	const values: ProviderPullRequest[] = [];
	let truncated = cursor.truncated;
	for (let i = 0; i < results.length; i++) {
		const { facet, index } = active[i];
		const result = results[i];
		if (result.status === 'rejected') {
			const failure = toCollectionScopeFailure(toCollectionScope(token, facet), result.reason);
			failures.push(failure);
			if (cursor.retrying.includes(index)) {
				// Its retry failed too: dropped, and carried so every later page still reports the hole.
				failed.push({ facet: index, kind: failure.kind });
			} else {
				// Kept at the offset it missed, so the next page retries it.
				nextStarts[index] = active[i].start;
				retrying.push(index);
			}
			continue;
		}

		nextStarts[index] = result.value.next;
		truncated ||= result.value.stalled;
		for (const { raw, normalized } of result.value.matches) {
			// Another relationship owns a row they both match, and serves it from its own facet on whichever page
			// reaches it — which also settles two facets reaching it on this one.
			if (!ownsRow(raw, facet, query)) continue;

			values.push(normalized);
		}
	}

	const hasMore = nextStarts.some(start => start != null);
	// Written on every continuation, complete or not, so removing it can't pass an incomplete read off as complete.
	const state = { failed: failed, retrying: retrying, truncated: truncated };
	return {
		values: values
			.map(pr => fromProviderPullRequest(pr, options.provider, { currentAccountId: options.currentUser?.id }))
			.sort(comparator),
		cursor: hasMore
			? JSON.stringify({
					key: key,
					page: cursor.page + 1,
					starts: nextStarts,
					state: { ...state, signature: await signState(key, cursor.page + 1, nextStarts, state) },
				})
			: undefined,
		hasMore: hasMore,
		page: cursor.page,
		truncated: truncated,
		metadata: toMetadata(failures),
	};
}

function toMetadata(failures: CollectionScopeFailure[]): ProviderPullRequestSearchPage['metadata'] {
	return failures.length > 0 ? { completeness: 'partial', failures: failures } : undefined;
}

/**
 * A facet failure carried over from an earlier page, rebuilt from the query rather than from the cursor: the cursor
 * records only which facet failed and how, so it can't name a scope or a message the read never produced.
 */
function toEarlierFailure(token: Token, facet: Facet, kind: CollectionScopeFailureKind): CollectionScopeFailure {
	return {
		scope: toCollectionScope(token, facet),
		kind: kind,
		message: 'Failed on an earlier page of this search, so later pages did not read it',
	};
}

/**
 * How many pull requests match `criteria`: the same facets, predicates and identity the search uses, so the count
 * is the number of distinct rows the search would return — the union of the requested states, not the largest of
 * them, since Bitbucket has no per-search ceiling for a maximum to stay under.
 *
 * Bitbucket Data Center has no count query and reports no total, so each facet reads one page of up to
 * {@link maxPageSize} and the count is a floor (`lowerBound`) when any facet had more. Unlike the search, one failed
 * facet fails the whole count: a count missing a facet is a wrong number rather than a partial one.
 */
export async function countBitbucketServerPullRequests(
	request: ProviderRequestFunction,
	token: Token,
	options: SearchOptions,
	cancellation?: AbortSignal,
): Promise<ProviderPullRequestCount> {
	const query = toQuery(options);
	const seen = new Set<string>();
	let lowerBound = false;
	// One facet at a time: the facade already counts several scopes concurrently.
	for (const facet of query.facets) {
		const result = await readFacetPage(request, token, query, facet, 0, maxPageSize, true, cancellation);
		for (const { raw } of result.matches) {
			seen.add(toIdentity(raw));
		}
		lowerBound ||= result.next != null || result.stalled;
	}

	return { count: seen.size, lowerBound: lowerBound || undefined };
}

/**
 * Resolves the criteria into the facets and predicates every page applies, refusing — by throwing, which the read
 * reports as a failed request — anything the capability table does not declare. The facade validates the same
 * table first, so reaching a refusal here means a caller bypassed it; refusing rather than dropping the criterion
 * keeps that caller from reading a wider set than it asked for.
 */
function toQuery(options: SearchOptions): Query {
	if (options.org != null && options.org.length > 0) {
		throw new Error('Bitbucket Data Center cannot scope a pull request search to a project');
	}

	const criteria = options.criteria;
	// No endpoint filters by date, and filtering the rows read would page through everything before the cutoff.
	if (criteria?.updatedAfter != null || criteria?.createdAfter != null) {
		throw new Error('Bitbucket Data Center cannot filter a pull request search by date');
	}

	const sort = criteria?.sort ?? defaultPullRequestSort;
	if (orderParams[sort] == null) {
		throw new Error(`Bitbucket Data Center cannot order a pull request search by '${sort}'`);
	}

	const requested = criteria?.relationships ?? [];
	const unsupported = requested.find(r => !(relationships as readonly PullRequestFilter[]).includes(r));
	if (unsupported != null) {
		throw new Error(`Bitbucket Data Center cannot search pull requests by the '${unsupported}' relationship`);
	}

	const facetRelationships = relationships.filter(r => requested.includes(r));
	if (facetRelationships.length > 0 && options.currentUser == null) {
		throw new Error('A Bitbucket Data Center relationship search requires the current user');
	}

	const requestedStates: PullRequestStateFilter[] = criteria?.states?.length ? criteria.states : ['open'];
	const states = requestedStates.includes('all')
		? undefined
		: new Set(requestedStates.flatMap(s => pullRequestStates[s as Exclude<PullRequestStateFilter, 'all'>]));

	// Sorted and deduplicated so the facets, and so the cursor, don't depend on the order repositories were passed.
	const repos = [...new Map((options.repos ?? []).map(r => [repoKey(r), r])).entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, repo]) => repo);
	for (const repo of repos) {
		for (const segment of [repo.namespace, repo.name]) {
			if (!segment || segment === '.' || segment === '..') {
				throw new Error('Invalid Bitbucket Data Center repository for a pull request search');
			}
		}
	}

	let facets: Facet[];
	if (repos.length > 0) {
		const scoped = facetRelationships.length > 0 ? facetRelationships : [undefined];
		facets = repos.flatMap(repo => scoped.map(relationship => ({ repo: repo, relationship: relationship })));
	} else if (facetRelationships.length > 0) {
		facets = facetRelationships.flatMap<Facet>(relationship =>
			relationship === PullRequestFilter.Reviewed
				? [
						{ relationship: relationship, role: 'REVIEWER' },
						{ relationship: relationship, role: 'PARTICIPANT' },
					]
				: [{ relationship: relationship }],
		);
	} else {
		throw new Error('A Bitbucket Data Center pull request search must be scoped by repositories or a relationship');
	}

	return { ...options, facets: facets, relationships: facetRelationships, states: states, sort: sort };
}

/** Project keys and repository slugs resolve case-insensitively, so two spellings name one repository. */
function repoKey(repo: ProviderRepoInput): string {
	return `${repo.namespace}/${repo.name}`.toLowerCase();
}

/**
 * A facet's classified failure, with the one correction the provider-wide classification can't make: a 403 on a
 * REPOSITORY is Bitbucket refusing that repository (the token lacks `REPO_READ` there), not the credential failing.
 *
 * Made here, where every read of a facet passes, so the search and the count can't disagree about it on any path —
 * a sibling repository's failure, a first page where every repository failed, or a count. Left an
 * `AuthenticationError`, it would reach the integration's exception handling and mark a connection that works
 * everywhere else for recovery and toward disconnecting; as a plain error naming the repository it is reported as
 * that scope's failure alone. A 401 anywhere, and a 403 on the user's own dashboard, stay the credential failing.
 */
function toFacetError(ex: unknown, facet: Facet): unknown {
	if (!(ex instanceof AuthenticationError) || facet.repo == null) return ex;
	if (ex.reason !== AuthenticationErrorReason.Forbidden) return ex;

	return new Error(
		`Bitbucket Data Center refused access to ${facet.repo.namespace}/${facet.repo.name}: ${(ex.original ?? ex).message}`,
		{ cause: ex },
	);
}

/** A pull request's identity across every facet and endpoint: its id is only unique within its repository. */
function toIdentity(pr: BitbucketServerPullRequest): string {
	return `${pr.toRef.repository.id}/${pr.id}`;
}

/**
 * Binds a cursor to everything that decides what it continues: the connection and installation it was read from,
 * the facets and every criterion. Hashed, so neither the query nor the address is published inside the cursor.
 */
function getCursorKey(connectionId: string, query: Query): Promise<string> {
	return sha256(
		JSON.stringify([
			connectionId,
			query.baseUrl,
			query.facets.map(f => [f.repo != null ? repoKey(f.repo) : null, f.relationship ?? null, f.role ?? null]),
			query.states != null ? [...query.states].sort() : null,
			query.criteria?.text?.trim() ?? '',
			query.criteria?.draft ?? null,
			query.criteria?.includeArchived === true,
			// Both: the server filters participants by username and the rows are re-checked by id or username, so a
			// renamed account is a different query even under the same id.
			query.currentUser != null ? [query.currentUser.id, query.currentUser.username] : null,
			query.sort,
		]),
	);
}

/**
 * Signs a continuation — its page, every facet's offset, which facets failed, and whether a facet stalled — so an
 * edited cursor can't pass for complete: ending a facet early by nulling its offset, or claiming a failure its read
 * never had. The key only binds a cursor to its query and travels inside it; this is keyed by a secret that never
 * leaves this process, so a signature can't be recomputed outside it. A cursor that outlives the process keeps
 * continuing, and reports its read as unconfirmed rather than as complete (see {@link parseCursor}).
 */
const stateSecret = getNonce();

function signState(
	key: string,
	page: number,
	starts: (number | null)[],
	state: Pick<SearchCursor, 'failed' | 'retrying' | 'truncated'>,
): Promise<string> {
	return sha256(JSON.stringify([stateSecret, key, page, starts, state.failed, state.retrying, state.truncated]));
}

/** The failure kinds a cursor may carry — the SDK's closed set, so a cursor can't name one the facade never maps. */
const failureKinds: ReadonlySet<string> = new Set<CollectionScopeFailureKind>([
	'authentication',
	'rate-limit',
	'not-found',
	'network',
	'provider',
	'unknown',
]);

interface SearchCursor {
	page: number;
	starts: (number | null)[];
	truncated: boolean;
	/** The facets dropped after failing their retry, by index, and how. They are never read again. */
	failed: { facet: number; kind: CollectionScopeFailureKind }[];
	/** The facets that failed on the previous page and are retried at the offset they missed, by index. */
	retrying: number[];
}

/**
 * Parses a cursor this module wrote for the same connection and query.
 *
 * The key binds a cursor to its connection, installation and query, but travels inside it, so the offsets can be
 * edited; the signature below covers them, so an edited cursor still reads but can't report its read as complete. The completeness state is
 * the part that could be turned against it, so it is signed and written on every continuation. A state that is
 * missing or doesn't verify is not refused, since that is also what a cursor from an earlier process looks like, and
 * failing a read that still works helps no one; but it can't be passed off as complete either — it degrades to
 * `truncated`, "completeness not confirmed", without the failures it can't prove. A failure is rebuilt from the facet
 * it names regardless, so even a verified one can't name a scope or text the read never produced.
 */
async function parseCursor(cursor: string | undefined, key: string, facets: Facet[]): Promise<SearchCursor> {
	const facetCount = facets.length;
	if (cursor == null || cursor === '{}') {
		return {
			page: 1,
			starts: new Array<number | null>(facetCount).fill(0),
			truncated: false,
			failed: [],
			retrying: [],
		};
	}

	let parsed: { key?: unknown; page?: unknown; starts?: unknown; state?: unknown } | undefined;
	try {
		parsed = (JSON.parse(cursor) as typeof parsed) ?? undefined;
	} catch {}

	const starts = parsed?.starts;
	if (
		parsed == null ||
		parsed.key !== key ||
		typeof parsed.page !== 'number' ||
		!Number.isSafeInteger(parsed.page) ||
		parsed.page < 2 ||
		!Array.isArray(starts) ||
		starts.length !== facetCount ||
		// 0 is a facet retrying the first page it missed; every other offset is past a page already read.
		!starts.every(start => start === null || (Number.isSafeInteger(start) && (start as number) >= 0)) ||
		!starts.some(start => start !== null)
	) {
		throw new Error('Invalid Bitbucket Data Center pull request search cursor for this connection or query');
	}

	return {
		page: parsed.page,
		starts: starts as (number | null)[],
		...(await parseState(parsed.state, key, parsed.page, starts as (number | null)[])),
	};
}

/**
 * The signed completeness state of a continuation, verified together with its page and offsets. Every continuation
 * carries one, so a state that is missing, malformed, not signed by this process, or signed for other offsets says
 * the read's completeness can't be confirmed — never that it was whole.
 */
async function parseState(
	state: unknown,
	key: string,
	page: number,
	starts: (number | null)[],
): Promise<Pick<SearchCursor, 'failed' | 'retrying' | 'truncated'>> {
	const unconfirmed = { failed: [], retrying: [], truncated: true };
	if (state == null || typeof state !== 'object') return unconfirmed;

	const { failed, retrying, truncated, signature } = state as {
		failed?: unknown;
		retrying?: unknown;
		truncated?: unknown;
		signature?: unknown;
	};
	if (
		typeof truncated !== 'boolean' ||
		!Array.isArray(retrying) ||
		// A retried facet is read again, so it must still have the offset it missed.
		!retrying.every(i => Number.isSafeInteger(i) && i >= 0 && i < starts.length && starts[i as number] !== null) ||
		!Array.isArray(failed) ||
		!failed.every(
			(f: { facet?: unknown; kind?: unknown } | null) =>
				f != null &&
				Number.isSafeInteger(f.facet) &&
				(f.facet as number) >= 0 &&
				(f.facet as number) < starts.length &&
				// A failed facet is never read again, so it has no offset left to continue from.
				starts[f.facet as number] === null &&
				typeof f.kind === 'string' &&
				failureKinds.has(f.kind),
		)
	) {
		return unconfirmed;
	}

	const verified = { failed: failed as SearchCursor['failed'], retrying: retrying as number[], truncated: truncated };
	return signature === (await signState(key, page, starts, verified)) ? verified : unconfirmed;
}

function toCollectionScope(token: Token, facet: Facet): CollectionScope {
	return facet.repo != null
		? { providerId: token.providerId, repositoryId: `${facet.repo.namespace}/${facet.repo.name}` }
		: { providerId: token.providerId };
}

interface FacetPage {
	/**
	 * The rows that match the query AND map to a pull request, with their mapping. Mapped here rather than by each
	 * caller, so the count skips exactly the rows the search can't show and the two can't disagree about them.
	 */
	matches: { raw: BitbucketServerPullRequest; normalized: ProviderPullRequest }[];
	/** The next page's `start`, or `null` when this facet is exhausted or can't be continued. */
	next: number | null;
	/** The server reported another page but no offset past this one to reach it. */
	stalled: boolean;
}

async function readFacetPage(
	request: ProviderRequestFunction,
	token: Token,
	query: Query,
	facet: Facet,
	start: number,
	limit: number,
	countOnly: boolean,
	cancellation: AbortSignal | undefined,
): Promise<FacetPage> {
	if (cancellation?.aborted) throw new CancellationError();

	let body: BitbucketServerPagedResponse<BitbucketServerPullRequest> | undefined;
	try {
		({ body } = await request<BitbucketServerPagedResponse<BitbucketServerPullRequest>>({
			url: toFacetUrl(query, facet, start, limit, countOnly),
			headers: { Authorization: `Bearer ${token.accessToken}` },
			// Aborts the request itself, so a cancelled search doesn't wait on up to a page of 1,000 per facet.
			signal: cancellation,
		}));
		if (
			body == null ||
			!Array.isArray(body.values) ||
			typeof body.isLastPage !== 'boolean' ||
			body.start !== start
		) {
			throw new Error('Invalid Bitbucket Data Center pull request page');
		}
	} catch (ex) {
		// A request the signal aborted is the cancellation, never a failed facet whose siblings answered.
		if (isCancellationError(ex)) throw ex;
		if (cancellation?.aborted) throw new CancellationError(ex instanceof Error ? ex : undefined);

		try {
			throwProviderError(token, ex);
		} catch (classified) {
			throw toFacetError(classified, facet);
		}
	}
	if (cancellation?.aborted) throw new CancellationError();

	const next = body.nextPageStart;
	const more = !body.isLastPage && Number.isSafeInteger(next) && next > start;
	const matches: FacetPage['matches'] = [];
	for (const raw of body.values) {
		if (!matchesFacet(raw, facet, query)) continue;

		try {
			matches.push({ raw: raw, normalized: normalizeBitbucketServerPullRequest(raw) });
		} catch (ex) {
			Logger.warn(`Skipped an unmappable Bitbucket Data Center pull request; id=${raw.id}, ex=${String(ex)}`);
		}
	}

	return {
		matches: matches,
		next: more ? next : null,
		stalled: !body.isLastPage && !more,
	};
}

function toFacetUrl(query: Query, facet: Facet, start: number, limit: number, countOnly: boolean): string {
	const criteria = query.criteria;
	// One requested state goes to the server; several — including `closed`, which is DECLINED and SUPERSEDED — are
	// read as every state and kept by `matchesFacet`.
	const state = query.states?.size === 1 ? [...query.states][0] : undefined;
	let url: URL;
	if (facet.repo != null) {
		url = new URL(
			`${query.baseUrl}/projects/${encodeURIComponent(facet.repo.namespace)}/repos/${encodeURIComponent(
				facet.repo.name,
			)}/pull-requests`,
		);
		url.searchParams.set('state', state ?? 'ALL');
		const text = criteria?.text?.trim();
		if (text) {
			url.searchParams.set('filterText', text);
		}
		if (criteria?.draft != null) {
			url.searchParams.set('draft', String(criteria.draft));
		}
		if (facet.relationship != null) {
			url.searchParams.set('username.1', query.currentUser!.username);
			switch (facet.relationship) {
				case PullRequestFilter.Author:
					url.searchParams.set('role.1', 'AUTHOR');
					break;
				case PullRequestFilter.ReviewRequested:
					url.searchParams.set('role.1', 'REVIEWER');
					url.searchParams.set('approved.1', 'false');
					break;
				case PullRequestFilter.Reviewed:
					// Any role: a participant who isn't a listed reviewer can still approve or ask for changes.
					break;
			}
		}
		// Properties carry the comment count a search row shows and a count never reads.
		if (countOnly) {
			url.searchParams.set('withProperties', 'false');
		}
	} else {
		url = new URL(`${query.baseUrl}/dashboard/pull-requests`);
		// The dashboard reads every state when `state` is omitted, and documents no `ALL`.
		if (state != null) {
			url.searchParams.set('state', state);
		}
		switch (facet.relationship) {
			case PullRequestFilter.Author:
				url.searchParams.set('role', 'AUTHOR');
				break;
			case PullRequestFilter.ReviewRequested:
				url.searchParams.set('role', 'REVIEWER');
				url.searchParams.set('participantStatus', 'UNAPPROVED');
				break;
			case PullRequestFilter.Reviewed:
				// The status only filters alongside a role (see `Facet.role`), so each of the two lists is its own facet.
				url.searchParams.set('role', facet.role!);
				url.searchParams.set('participantStatus', 'APPROVED,NEEDS_WORK');
				break;
		}
	}

	url.searchParams.set('order', orderParams[query.sort]!);
	url.searchParams.set('start', String(start));
	url.searchParams.set('limit', String(limit));
	return url.toString();
}

/**
 * Re-applies every constraint of the query to a row the server returned, so what the server was asked to filter and
 * what it actually filtered can't differ in the result: the dashboard has no text or draft filter, a server older
 * than 8.18 ignores `draft`, several states are read as every state, a reviewer filter can't tell a pending review
 * from one that asked for changes, and no endpoint excludes archived repositories.
 */
function matchesFacet(pr: BitbucketServerPullRequest, facet: Facet, query: Query): boolean {
	const repository = pr.toRef?.repository;
	// Without both there is no identity to deduplicate or count it by.
	if (pr.id == null || repository?.id == null) return false;
	if (query.states != null && !query.states.has(pr.state)) return false;
	if (facet.repo != null && `${repository.project?.key}/${repository.slug}`.toLowerCase() !== repoKey(facet.repo)) {
		return false;
	}

	const criteria = query.criteria;
	if (criteria?.includeArchived !== true && repository.archived === true) return false;
	if (criteria?.draft != null && (pr.draft === true) !== criteria.draft) return false;

	const text = criteria?.text?.trim().toLowerCase();
	if (text && !pr.title?.toLowerCase().includes(text) && !pr.description?.toLowerCase().includes(text)) {
		return false;
	}

	return facet.relationship == null || matchesRelationship(pr, facet.relationship, query.currentUser!, facet.role);
}

/**
 * Whether `facet` is the one that serves `pr`: the first requested relationship the pull request matches, in canonical
 * order. A pull request I authored and reviewed is served by the author facet alone, so the reviewed facet skips it
 * on whichever page it reaches it. Between the two `Reviewed` dashboard facets the reviewer list wins, should a
 * server ever list the user in both.
 *
 * Stateless, which is the point: two facets reach a shared row pages apart, and remembering what earlier pages emitted
 * would make the cursor grow with every row read. The rule only needs the row itself, and the count applies the same
 * union through its own deduplication, so list and count agree. One thing no page-based read can settle is a pull
 * request whose review state changes between two pages — it can then match a different relationship on each and be
 * served by both, just as a row updated mid-read can move between offsets.
 */
function ownsRow(pr: BitbucketServerPullRequest, facet: Facet, query: Query): boolean {
	if (facet.relationship == null) return true;

	const user = query.currentUser!;
	const owner = query.relationships.find(r => matchesRelationship(pr, r, user));
	if (owner !== facet.relationship) return false;
	if (facet.role == null) return true;

	const ownerRole: DashboardRole = matchesRelationship(pr, facet.relationship, user, 'REVIEWER')
		? 'REVIEWER'
		: 'PARTICIPANT';
	return ownerRole === facet.role;
}

/** `role` narrows `Reviewed` to one participant list; every other relationship ignores it. */
function matchesRelationship(
	pr: BitbucketServerPullRequest,
	relationship: Relationship,
	user: BitbucketServerSearchUser,
	role?: DashboardRole,
): boolean {
	const isCurrentUser = (candidate: BitbucketServerUser | undefined): boolean =>
		candidate != null &&
		(String(candidate.id) === user.id || candidate.name?.toLowerCase() === user.username.toLowerCase());
	const hasStatus = (participants: BitbucketServerPullRequestUser[] | undefined, statuses: string[]): boolean =>
		participants?.some(p => isCurrentUser(p.user) && statuses.includes(p.status)) ?? false;

	switch (relationship) {
		case PullRequestFilter.Author:
			return isCurrentUser(pr.author?.user);
		case PullRequestFilter.ReviewRequested:
			return hasStatus(pr.reviewers, ['UNAPPROVED']);
		case PullRequestFilter.Reviewed:
			return (
				(role !== 'PARTICIPANT' && hasStatus(pr.reviewers, ['APPROVED', 'NEEDS_WORK'])) ||
				(role !== 'REVIEWER' && hasStatus(pr.participants, ['APPROVED', 'NEEDS_WORK']))
			);
	}
}
