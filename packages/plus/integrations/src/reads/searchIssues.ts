import type { IssueSearchCriteria, IssueShape } from '@gitlens/git/models/issue.js';
import type { IntegrationIds } from '../constants.js';
import type { ProviderReposInput } from '../providers/models.js';
import type { ProviderPagedResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { resolveIssueSearchCriteria, resolveIssueSearchScope } from './filters.js';
import { refusedPage, resolveContinuation, resolveCurrentPage, usableCursor } from './paging.js';
import {
	gitHostOnlySurfaceWarning,
	issueSearchCapResultWarning,
	issuesUnsupportedWarning,
	otherWarning,
	truncationWarning,
	unsupportedIssueSearchCriteriaWarning,
} from './warnings.js';

/**
 * The FILTERED issue search: issues matching structured criteria over a repository/org scope, with no forced
 * relationship to the current user.
 *
 * A sibling of `listIssuesPage` rather than a mode of it, deliberately. That read is already two divergent
 * branches (a cursor-composite account-wide path and a page-draining repo-scoped one) around a documented
 * contract where `filters` REPLACES the provider's definition of "my issues". This search answers a different
 * question — its relationships include two that are not about the user at all — and routes around the SDK's
 * repo-scoped read entirely, whose over-limit recovery walk can spend up to 128 requests and still return an
 * incomplete set. Folding the two together would multiply that branch matrix and put every existing consumer of
 * `listIssuesPage` at risk; keeping them siblings shares the primitives below without sharing the branch space,
 * for the same reason `broaden.ts`, `sweeps.ts` and `issueTracker.ts` are separate files.
 *
 * Contract details worth knowing before calling:
 * - Ordering is ALWAYS most-recently-updated-first. Not an option: a "show the N most recent" policy at the
 *   provider's result ceiling is only correct under a guaranteed order.
 * - Paging is cursor-only. `page` alone walks 1..N internally (O(N) requests); a page past the last one is an
 *   empty page N, never page N−1 relabeled.
 * - At the provider's result ceiling the read SUCCEEDS and reports an omission carrying the total match count,
 *   so a consumer can say how many were withheld. It never falls back to a per-repository recovery walk.
 */
export async function searchIssuesPage(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		/** Repositories to search. Combines with `org`; both become scope constraints on the same query. */
		repos?: ProviderReposInput;
		/** Organization/account to search. Combines with `repos`. */
		org?: string;
		/**
		 * What to narrow on, validated against `getSupportedFilters().issueSearch` before the read runs. A
		 * criterion the provider can't express server-side refuses the whole read (warning + `fetchFailed`)
		 * rather than serving a list that was never narrowed.
		 */
		criteria?: IssueSearchCriteria;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderPagedResult<IssueShape>> {
	const page = Math.max(1, Math.trunc(options.page ?? 1));
	// Cursor-only, so a refusal can't claim the requested position — it reports page 1, per
	// ProviderPageInfo.currentPage.
	const refused = (warning: ProviderWarning) => refusedPage<IssueShape>(1, [warning], true);

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Filtered issue search'),
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connection or domain that no longer resolves is a broken target, not an empty account —
		// surface a no-connection warning + fetchFailed rather than a silent empty page.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return refusedPage(1, early.warnings, early.fetchFailed);
	}
	if (!isGitHostIntegration(integration)) {
		return refused(
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Filtered issue search'),
		);
	}

	await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	if (!integration.supportsIssues) {
		return refused(issuesUnsupportedWarning(options.providerId, domain, options.connectionId));
	}

	const scope = resolveIssueSearchScope(options.repos, options.org, options.criteria);
	switch (scope.rejection) {
		case 'unscoped':
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'A filtered issue search must be scoped: pass `repos`, `org`, or a relationship to the current user (`authored`/`assigned`/`mentioned`). `any-assignee` and `unassigned` are not scopes — either one alone matches every such issue on the host.',
				),
			);
		case 'repo-ids':
			// A search query names repositories by PATH, so repository ids can't be expressed as a scope. Refusing
			// is the only honest answer: dropping them would search the whole org (or the whole host) as if the
			// caller had asked for that.
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'A filtered issue search cannot be scoped by repository id; pass repository descriptors (namespace + name) instead.',
				),
			);
	}

	const resolved = resolveIssueSearchCriteria(options.providerId, options.criteria);
	if (resolved.rejection != null) {
		return refused(
			unsupportedIssueSearchCriteriaWarning(options.providerId, domain, options.connectionId, resolved.rejection),
		);
	}

	const readPage = (cursor: string | undefined) =>
		runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() =>
				integration.searchIssuesPageResult(
					{
						repos: scope.repos,
						org: options.org,
						criteria: options.criteria,
						cursor: cursor,
						pageSize: options.itemsPerPage,
					},
					undefined,
					options.connectionId,
				),
			{ warnOnMissingSession: warnOnMissingSession },
		);

	const first = await readPage(options.cursor);
	let value = first.value;
	const warnings = first.warning != null ? [first.warning] : [];
	let pageFetchFailed = first.warning != null && value == null;
	let currentPage = value?.page ?? 1;
	let currentTruncated = value?.truncated ?? false;
	// The largest total any page reported. Kept across the internal walk so a cap detected on page 1 is still
	// reportable after paging on to page N.
	let totalCount = value?.totalCount;

	if (options.cursor == null && page > 1 && value != null) {
		// Guard against the empty-cursor sentinel: a provider that claims another page without handing back a
		// usable cursor would otherwise be re-read with `'{}'` and answer with page 1 again.
		for (
			let nextCursor = usableCursor(value.cursor);
			currentPage < page && value.hasMore && nextCursor != null;
			nextCursor = usableCursor(value.cursor)
		) {
			const next = await readPage(nextCursor);
			if (next.warning != null) {
				appendDedupedWarning(warnings, next.warning);
			}
			if (next.value == null) {
				pageFetchFailed = next.warning != null;
				// Load-bearing for the unsupported-read check below, which distinguishes "no page at all" from
				// "a page that was genuinely empty".
				value = undefined;
				break;
			}

			value = next.value;
			currentTruncated = currentTruncated || value.truncated;
			if (value.totalCount != null) {
				totalCount = Math.max(totalCount ?? 0, value.totalCount);
			}
			currentPage = value.page ?? currentPage + 1;
			// A provider that hands back the same cursor isn't advancing; stop rather than loop forever.
			if (usableCursor(value.cursor) === nextCursor) {
				currentTruncated = true;
				break;
			}
		}
	}

	// A numbered page the walk never reached is genuinely empty — the provider's continuations ran out (or a page
	// failed) before it. Never return or relabel the last available page as the requested one. Derived rather than
	// flagged along the way: every case reduces to "a page was asked for by number and the walk fell short",
	// including the one where no walk ran because `page > 1` was requested against a terminal first page.
	const requestedPageMissing = options.cursor == null && page > 1 && currentPage < page;

	// A provider that doesn't implement the search hook returns `undefined` with no error. Surface that as an
	// explicit unsupported warning + fetchFailed rather than a silent empty success, so a caller isn't left
	// unable to tell it apart from an account with no matching issues. `getSupportedFilters().issueSearch`
	// declares this ahead of the read, so a consumer that checks it never reaches here.
	if (value == null && warnings.length === 0) {
		return refused(
			unsupportedIssueSearchCriteriaWarning(options.providerId, domain, options.connectionId, {
				reason: 'unsupported-search',
			}),
		);
	}

	const items = requestedPageMissing ? [] : (value?.values ?? []);
	// Cursor-only: `hasMore` without a real cursor is a dead end, so report it as terminal-but-incomplete rather
	// than inviting the caller to page forever.
	const continuation = resolveContinuation(
		{
			hasMore: requestedPageMissing ? false : (value?.hasMore ?? false),
			cursor: requestedPageMissing ? undefined : usableCursor(value?.cursor),
			truncated: currentTruncated,
		},
		undefined,
	);
	const truncated = continuation.truncated;
	// Only reachable when nothing else already explained the incompleteness — and a failed page always warns
	// first, so a read that gets here SUCCEEDED. That is why the cause below is unconditionally `exhausted` and
	// `fetchFailed` is never set from here.
	if (truncated && warnings.length === 0) {
		// The result ceiling is the one truncation cause this read can EXPLAIN with a number, so it gets its own
		// warning carrying the total. Anything else truncated (an unusable continuation, a provider that stopped
		// advancing) falls back to the generic wording.
		warnings.push(
			issueSearchCapResultWarning(options.providerId, domain, options.connectionId, totalCount) ??
				truncationWarning(
					options.providerId,
					domain,
					options.connectionId,
					'Issue search',
					// `exhausted`: this read exposes no budget the caller could raise, so nothing it could call
					// would return the withheld items.
					'exhausted',
				),
		);
	}

	return {
		items: items,
		warnings: warnings,
		page: {
			// Positional, per ProviderPageInfo.currentPage. A requested page past the terminal cursor is reported
			// as that empty page N; otherwise this read is cursor-only, so a `page` the caller didn't pair with a
			// cursor is never echoed.
			currentPage: requestedPageMissing
				? page
				: resolveCurrentPage({
						providerPage: currentPage,
						requestedPage: page,
						suppliedCursor: options.cursor,
						pageAdvanceable: false,
					}),
			itemsPerPage: items.length,
			truncated: truncated || undefined,
		},
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		fetchFailed: pageFetchFailed || undefined,
	};
}
