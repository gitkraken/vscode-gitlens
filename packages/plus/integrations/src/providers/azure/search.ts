import { escapeWiqlString } from '@gitkraken/provider-apis';
import type { IssueSearchCriteria, IssueSearchRelationship, IssueSorting } from '@gitlens/git/models/issue.js';
import type { PullRequestSearchCriteria, PullRequestSorting } from '@gitlens/git/models/pullRequest.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import type { ProviderPullRequest } from '../models.js';
import { parsePageCursor } from '../utils/providerPaging.js';

/**
 * The most work items one filtered search can reach, however it is paged.
 *
 * Azure DevOps documents 20,000 work items as its query result limit, and may refuse a larger WIQL result set
 * (`VS402337`) rather than truncate it. The page read therefore asks for a window bounded by `$top`, the first
 * 20,000 matches under the requested order. Azure DevOps Server 2020 answers that bounded query with 20,014 matches
 * (it even answered one without `$top`), so the ceiling is this read's, kept at the documented limit.
 */
export const azureWorkItemSearchResultLimit = 20000;

/** The work items one detail read can resolve: `workitemsbatch` rejects more than 200 ids. */
export const azureWorkItemBatchLimit = 200;

/**
 * A search page size from a caller's `itemsPerPage`, within `[1, max]`. A value that isn't a finite number takes the
 * default: `NaN` would survive the clamp and serve empty pages that never advance.
 */
export function toAzureSearchPageSize(value: number | undefined, fallback: number, max: number): number {
	const size = value != null && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(1, size));
}

/**
 * Each filtered-search relationship as the WIQL clause that expresses it.
 *
 * `@Me` rather than an identity looked up per read: Azure resolves the macro to the identity the credential
 * authenticates as, which is exactly the "current user" the relationship names, and needs no account read.
 * `mentioned` is absent. `@RecentMentions` only covers the last 30 days, so declaring it would serve an arbitrary
 * window under a relationship that promises every mention.
 */
const relationshipClauses: Partial<Record<IssueSearchRelationship, string>> = {
	authored: '[System.CreatedBy] = @Me',
	assigned: '[System.AssignedTo] = @Me',
	'any-assignee': "[System.AssignedTo] <> ''",
	unassigned: "[System.AssignedTo] = ''",
};

/** The relationships {@link toAzureWorkItemSearchWiql} can express. */
export const azureWorkItemSearchRelationships = Object.keys(relationshipClauses) as IssueSearchRelationship[];

/**
 * Each orderable key as its WIQL `ORDER BY` column.
 *
 * A strict subset of the SDK's WIQL columns: `priority` and `resolved` are left out because their columns are
 * process-template fields. On an on-premises collection running the XML process model, a field its process never
 * declared fails the whole query with `TF51005` rather than ordering nothing, so declaring them would turn a
 * working search into a refused one on exactly the installations this search exists for. Every key kept orders a
 * system field, except `closed`, whose column the open/closed filter below already depends on.
 */
const sortColumns: Partial<Record<IssueSorting, string>> = {
	'updated:desc': '[System.ChangedDate] Desc',
	'updated:asc': '[System.ChangedDate] Asc',
	'created:desc': '[System.CreatedDate] Desc',
	'created:asc': '[System.CreatedDate] Asc',
	'closed:desc': '[Microsoft.VSTS.Common.ClosedDate] Desc',
	'closed:asc': '[Microsoft.VSTS.Common.ClosedDate] Asc',
	'comments:desc': '[System.CommentCount] Desc',
	'comments:asc': '[System.CommentCount] Asc',
	'title:desc': '[System.Title] Desc',
	'title:asc': '[System.Title] Asc',
};

/** The sort keys {@link toAzureWorkItemSearchWiql} can express. */
export const azureWorkItemSearchSorts = Object.keys(sortColumns) as IssueSorting[];

/**
 * Translates filtered-search criteria into ONE WIQL query over a collection.
 *
 * Relationships are OR-ed inside one parenthesized group rather than run as separate queries, which is what lets a
 * single query both page and count their union exactly: an item matching two relationships is one row, never two.
 * The projects bound the query by name through `[System.TeamProject]`, so a repository scope reaches the work items
 * of its project; with no project the collection itself is the scope.
 *
 * The open/closed split mirrors the SDK's WIQL, so this search and the ordinary project read agree on which work
 * items are open. Free text is a `Contains` substring match on the title, and each label a `Contains` over the
 * tags, which Azure matches against whole tags — AND-ed, like the criteria model's labels.
 *
 * Throws for a relationship or sort key it cannot express. The facade validates both against the declared
 * capability first, so reaching here with one means the declaration and this translation disagree.
 */
export function toAzureWorkItemSearchWiql(
	criteria: IssueSearchCriteria | undefined,
	sort: IssueSorting,
	projects: readonly string[] | undefined,
): string {
	const clauses: string[] = [];
	if (projects?.length) {
		clauses.push(`[System.TeamProject] IN (${projects.map(p => `'${escapeWiqlString(p)}'`).join(', ')})`);
	}

	switch (criteria?.state ?? 'open') {
		case 'open':
			clauses.push("[Microsoft.VSTS.Common.ClosedDate] = ''", "[Microsoft.VSTS.Common.ResolvedDate] = ''");
			break;
		case 'closed':
			clauses.push("([Microsoft.VSTS.Common.ClosedDate] <> '' OR [Microsoft.VSTS.Common.ResolvedDate] <> '')");
			break;
		case 'all':
			break;
	}

	const relationships = [...new Set(criteria?.relationships ?? [])];
	if (relationships.length > 0) {
		const expressions = relationships.map(r => {
			const clause = relationshipClauses[r];
			if (clause == null) throw new Error(`Azure DevOps cannot search work items by the '${r}' relationship`);

			return clause;
		});
		clauses.push(`(${expressions.join(' OR ')})`);
	}

	const text = criteria?.text?.trim();
	if (text) {
		clauses.push(`[System.Title] Contains '${escapeWiqlString(text)}'`);
	}
	for (const label of criteria?.labels ?? []) {
		clauses.push(`[System.Tags] Contains '${escapeWiqlString(label)}'`);
	}
	if (criteria?.updatedAfter != null) {
		clauses.push(`[System.ChangedDate] >= '${toWiqlDate(criteria.updatedAfter, 'updatedAfter')}'`);
	}
	if (criteria?.createdAfter != null) {
		clauses.push(`[System.CreatedDate] >= '${toWiqlDate(criteria.createdAfter, 'createdAfter')}'`);
	}

	const column = sortColumns[sort];
	if (column == null) throw new Error(`Azure DevOps cannot order a work item search by '${sort}'`);

	// `[System.Id]` makes the order total, so a work item tying on the sort column can't cross a page boundary
	// between two requests and be served twice or never.
	const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
	return `SELECT [System.Id] FROM WorkItems${where} ORDER BY ${column}, [System.Id] Desc`;
}

/**
 * A criteria date as the UTC-midnight literal WIQL compares against. A literal with a time is only accepted by a
 * query sent with `timePrecision=true`, which is how the search sends every query: without it WIQL compares whole
 * days in the server's time zone, and the instant would differ from the one the pull request filter applies.
 */
function toWiqlDate(value: string, name: string): string {
	return parseCriteriaDate(value, name).toISOString().replace('.000Z', 'Z');
}

/**
 * A criteria date as UTC midnight.
 *
 * Validated to the `YYYY-MM-DD` the criteria model documents rather than parsed leniently: the WIQL value lands
 * inside a quoted literal, where any other shape is either refused or read in the server's locale, and the pull
 * request filter must apply the same instant the work-item query does.
 */
function parseCriteriaDate(value: string, name: string): Date {
	const date = toCriteriaDate(value);
	if (date == null) throw new Error(`Invalid ${name} '${value}'; expected an ISO date (YYYY-MM-DD)`);

	return date;
}

function toCriteriaDate(value: string): Date | undefined {
	const trimmed = value.trim();
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
	const date = match != null ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
	return date == null || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed
		? undefined
		: date;
}

/**
 * Why a search's dates can't be applied, or `undefined` when they can. The search checks this before any request,
 * so a date it would refuse costs nothing, and in a count refuses only its own scope.
 */
export function getInvalidAzureSearchDate(
	criteria: { updatedAfter?: string; createdAfter?: string } | undefined,
): string | undefined {
	for (const [name, value] of [
		['updatedAfter', criteria?.updatedAfter],
		['createdAfter', criteria?.createdAfter],
	] as const) {
		if (value != null && toCriteriaDate(value) == null) {
			return `invalid ${name} '${value}'; expected an ISO date (YYYY-MM-DD)`;
		}
	}
	return undefined;
}

/**
 * The criteria a pull-request search applies AFTER the provider read, as one predicate.
 *
 * Azure's pull request query takes a creator, a reviewer, a status and a repository, and nothing else, so text,
 * draft state and dates are matched here against each fully drained facet. Applying them to a complete facet is
 * exact rather than a post-filter of a page: nothing the predicate removes was ever counted toward a page or a
 * total, so a count and its list always agree.
 *
 * What each criterion matches is bounded by what the list endpoint returns, which is narrower than the web UI:
 * - text is a case-insensitive substring of the title or of the description — which Azure truncates to its first
 *   400 characters in a pull request list, so a term only found past that is not matched;
 * - `updatedAfter` compares Azure's `updatedDate`, which the SDK derives from the close date, or the creation date
 *   for a pull request still open, since Azure reports no last-activity date. An old but active pull request is
 *   therefore matched by its creation date.
 */
export function toAzurePullRequestSearchFilter(
	criteria: PullRequestSearchCriteria | undefined,
): (pr: ProviderPullRequest) => boolean {
	const text = criteria?.text?.trim().toLowerCase();
	const draft = criteria?.draft;
	const updatedAfter =
		criteria?.updatedAfter != null ? parseCriteriaDate(criteria.updatedAfter, 'updatedAfter') : undefined;
	const createdAfter =
		criteria?.createdAfter != null ? parseCriteriaDate(criteria.createdAfter, 'createdAfter') : undefined;

	return pr =>
		(!text || pr.title.toLowerCase().includes(text) || (pr.description?.toLowerCase().includes(text) ?? false)) &&
		(draft == null || pr.isDraft === draft) &&
		(updatedAfter == null || pr.updatedDate >= updatedAfter) &&
		(createdAfter == null || pr.createdDate >= createdAfter);
}

/** The pull-request sort keys the search can order its merged facets by. */
export const azurePullRequestSearchSorts: PullRequestSorting[] = [
	'updated:desc',
	'updated:asc',
	'created:desc',
	'created:asc',
];

/**
 * A pull request's position in the merged search result: the sort date plus the identity that breaks ties.
 *
 * The identity makes the order TOTAL, which is what lets a cursor resume strictly after the last row served rather
 * than at a numeric offset. An offset would skip or repeat rows whenever a pull request changes state or date
 * between two pages; a keyset position only moves past rows that sort before it.
 */
export interface AzurePullRequestSearchPosition {
	time: number;
	identity: string;
}

export function toAzurePullRequestSearchPosition(
	pr: ProviderPullRequest,
	sort: PullRequestSorting,
	identity: string,
): AzurePullRequestSearchPosition {
	return { time: (sort.startsWith('created') ? pr.createdDate : pr.updatedDate).getTime(), identity: identity };
}

/** Orders two positions under `sort`, ties broken by identity so no two rows ever compare equal. */
export function compareAzurePullRequestSearchPositions(
	a: AzurePullRequestSearchPosition,
	b: AzurePullRequestSearchPosition,
	sort: PullRequestSorting,
): number {
	if (a.time !== b.time) return sort.endsWith(':asc') ? a.time - b.time : b.time - a.time;

	return a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0;
}

/**
 * Where a filtered pull-request search resumes: after `after`, in the drain its first page read, under the query
 * `key` fingerprints. Bound to its query and served only from its own drain for the same reasons
 * {@link AzureWorkItemSearchCursor} is bound to its query and snapshot.
 */
export interface AzurePullRequestSearchCursor {
	key: string;
	drain: string;
	page: number;
	after: AzurePullRequestSearchPosition;
}

/**
 * The fingerprint {@link AzurePullRequestSearchCursor.key} carries for a query.
 *
 * It only guards a caller threading a cursor under a different query, and keeps the query itself out of the opaque
 * cursor. It never selects cached results: those are keyed by the full query (see the callers), so a fingerprint
 * collision can at worst accept a cursor, never serve another query's rows.
 */
export function toAzurePullRequestSearchCursorKey(query: unknown): string {
	return fnv1aHash64(JSON.stringify(query));
}

/** Reads a caller-supplied cursor for the query fingerprinted as `key`; see {@link parseAzureWorkItemSearchCursor}. */
export function parseAzurePullRequestSearchCursor(
	cursor: string | undefined,
	key: string,
): AzurePullRequestSearchCursor | undefined {
	if (cursor == null) return undefined;

	let parsed: Partial<AzurePullRequestSearchCursor> | undefined;
	try {
		parsed = JSON.parse(cursor) as Partial<AzurePullRequestSearchCursor>;
	} catch {}

	const after = parsed?.after;
	if (
		parsed?.key !== key ||
		typeof parsed.drain !== 'string' ||
		!parsed.drain ||
		!Number.isSafeInteger(parsed.page) ||
		parsed.page! < 1 ||
		typeof after?.time !== 'number' ||
		!Number.isFinite(after.time) ||
		typeof after.identity !== 'string'
	) {
		throw new Error(
			'Pull request search cursor was produced by a different query; restart the read without a cursor',
		);
	}

	return { key: key, drain: parsed.drain, page: parsed.page!, after: { time: after.time, identity: after.identity } };
}

/**
 * Where a filtered work-item search resumes: an offset into the id snapshot its first page queried, the id of that
 * snapshot, and the fingerprint of the query that produced it.
 *
 * A continuation is only served from ITS snapshot, where the offset is exact. Each first page queries a snapshot of
 * its own, so a pagination of the same query started later never replaces the one an earlier pagination is reading.
 * The snapshot is kept for as long as the pagination keeps reading it; once it is gone the continuation is REFUSED
 * rather than resumed against a fresh query, since under an `updated` order a re-query can move an unseen work item
 * ahead of the offset, where it would be skipped without anything saying so. A cursor without a `snapshot` is the
 * facade's own page marker, which names a page by number with no snapshot behind it and is read against a fresh
 * query as exactly that.
 *
 * The fingerprint binds the cursor to its query (scope, criteria and order) without publishing any of them inside
 * the opaque cursor. A cursor for another query is REFUSED rather than silently restarted: this read is cursor-only,
 * so a restart would be served under the page number the caller supplied alongside it — page 1's rows labelled as
 * page N.
 */
export interface AzureWorkItemSearchCursor {
	key: string;
	snapshot?: string;
	offset: number;
	page: number;
}

/** The fingerprint {@link AzureWorkItemSearchCursor.key} carries for a query; see {@link toAzurePullRequestSearchCursorKey}. */
export function toAzureWorkItemSearchCursorKey(collection: string, wiql: string): string {
	return fnv1aHash64(JSON.stringify([collection, wiql]));
}

/**
 * Whether `cursor` starts a work-item search's first page: none at all, or the facade's page-1 marker, which
 * {@link parseAzureWorkItemSearchCursor} reads the same way.
 */
export function isAzureWorkItemSearchFirstPage(cursor: string | undefined): boolean {
	return cursor == null || parsePageCursor(cursor) === 1;
}

/**
 * Reads a caller-supplied cursor for the query fingerprinted as `key`.
 *
 * Returns `undefined` when there is no cursor, and throws when there is one this query can't resume, since treating
 * a foreign or malformed cursor as page 1 would publish the first page's rows as the page the caller asked for.
 *
 * The one cursor it accepts without a fingerprint is the facade's own page marker (`{ value, type: 'page' }`), which
 * `broadenIssues` sends to retry or reach a numbered page it holds no cursor for. It names a position rather than a
 * query, so it is honored as the offset of that page at `pageSize` — page 1 being no cursor at all.
 */
export function parseAzureWorkItemSearchCursor(
	cursor: string | undefined,
	key: string,
	pageSize: number,
): AzureWorkItemSearchCursor | undefined {
	if (cursor == null) return undefined;

	const pageMarker = parsePageCursor(cursor);
	if (pageMarker != null && Number.isSafeInteger(pageMarker) && pageMarker >= 1) {
		return pageMarker === 1 ? undefined : { key: key, offset: (pageMarker - 1) * pageSize, page: pageMarker };
	}

	let parsed: Partial<AzureWorkItemSearchCursor> | undefined;
	try {
		parsed = JSON.parse(cursor) as Partial<AzureWorkItemSearchCursor>;
	} catch {}

	if (
		parsed?.key !== key ||
		typeof parsed.snapshot !== 'string' ||
		!parsed.snapshot ||
		!Number.isSafeInteger(parsed.offset) ||
		parsed.offset! < 0 ||
		!Number.isSafeInteger(parsed.page) ||
		parsed.page! < 1
	) {
		throw new Error('Work item search cursor was produced by a different query; restart the read without a cursor');
	}

	return { key: key, snapshot: parsed.snapshot, offset: parsed.offset!, page: parsed.page! };
}
