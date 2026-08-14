import type { PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { supportedOrderedCloudIntegrationIds } from '../constants.js';
import type { ProviderSweepTarget, PullRequestSweepOptions } from '../manager.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IntegrationResult } from '../models/integration.js';
import type { PullRequestFilter } from '../providerFilters.js';
import type { ProviderPullRequest, ProviderReposInput, ProviderRepository } from '../providers/models.js';
import { getProviderPullRequestIdentity } from '../providers/models.js';
import type { ProviderWarning } from '../results.js';
import { appendDedupedWarning, reconcileOmissionsWithFailure, toProviderWarning } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { noConnectionWarning, truncationWarning } from './warnings.js';

/**
 * The all-pages reads: a provider read run repeatedly until it runs out of pages, as opposed to the single-page
 * reads the facade's paged surface exposes. `sweepPullRequests` and `broadenIssues` are built on these.
 *
 * A drain's job is to keep going where a single page would stop, so what distinguishes it is its failure
 * bookkeeping rather than its loop: it must return the prefix it did read plus enough signal for the caller to
 * know the result is not authoritative — `truncated` when pages remain unread (a page backstop, or a provider
 * claiming another page while handing back no usable cursor), `fetchFailed` when a page or scope failed
 * outright. Discarding the prefix on a late failure, or returning it as if complete, are the two mistakes these
 * exist to prevent.
 */

/**
 * Runs a result-returning read and captures failure as a neutral {@link ProviderWarning} rather than
 * letting it throw or silently vanish. Handles both a returned `{ error }` (the read cores' contract)
 * and a hard throw; a soft warning (`{ value, error }`) yields the value *and* a warning.
 */
export async function runCaptured<T>(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	fn: () => Promise<IntegrationResult<T>>,
	options?: { warnOnMissingSession?: boolean },
): Promise<{ value?: T; warning?: ProviderWarning }> {
	try {
		const result = await fn();
		if (result == null) {
			// The read core returns undefined only when it couldn't resolve a session. For a per-connection
			// or explicit-domain read that means the requested target is gone or its authentication is invalid,
			// which must not be reported as an empty account. The untargeted primary path legitimately yields
			// nothing when the provider isn't connected, so leave it as an empty result.
			return connectionId != null || options?.warnOnMissingSession
				? { warning: noConnectionWarning(id, domain, connectionId) }
				: {};
		}
		if (result.error != null) {
			return { value: result.value, warning: toProviderWarning(id, domain, connectionId, result.error) };
		}
		return { value: result.value };
	} catch (ex) {
		return { warning: toProviderWarning(id, domain, connectionId, ex) };
	}
}

/**
 * Drains every page of the user's pull requests for one git-host integration, threading the opaque
 * next-cursor the provider returns (so it works for both page- and cursor-based hosts). Stops at
 * `maxPages` (marking `truncated`) or on a hard read failure (marking `fetchFailed`), keeping the
 * pages fetched so far. A soft warning (`{ value, error }`) is recorded but the drain continues.
 */
export async function drainPullRequests(
	integration: GitHostIntegration,
	id: IntegrationIds,
	domain: string | undefined,
	repos: ProviderReposInput,
	state: PullRequestStateFilter[] | undefined,
	filters: PullRequestFilter[] | undefined,
	/**
	 * Breadth opt-ins that only the account-wide read can express. Grouped rather than passed positionally
	 * because they are same-typed neighbors a transposition would silently swap, and picked from the sweep
	 * options rather than restated so a third opt-in is declared once.
	 */
	accountWideOptions: Pick<PullRequestSweepOptions, 'includeReviewRequested' | 'includeReviews'> | undefined,
	connectionId: string | undefined,
	maxPages: number,
	attributeUnavailableProvider: boolean,
): Promise<{
	items: ProviderPullRequest[];
	warnings: ProviderWarning[];
	fetchFailed: boolean;
	truncated: boolean;
	failedProvider: boolean;
}> {
	const items: ProviderPullRequest[] = [];
	const itemIndexByIdentity = new Map<string, number>();
	const warnings: ProviderWarning[] = [];
	let cursor: string | undefined;
	let page = 0;
	// SDK metadata failures across pages mean the collection is incomplete even when no page threw; carry
	// this through the terminal returns instead of resetting it to false at the last page.
	let fetchFailed = false;
	let truncated = false;
	// A page the provider capped or couldn't vouch for. Decides the CAUSE the terminal warning reports: a cap
	// outranks a budget stop, because raising a budget cannot un-cap a page.
	let providerTruncated = false;
	// The subset of that which no other warning already explains — decides whether this drain raises one of
	// its own on an otherwise clean exit.
	let unexplainedTruncation = false;

	// With no repos this is an account-wide "my PRs" sweep. The repo-scoped core rejects an empty `repos`
	// input, so read the provider-native account-wide core instead.
	const accountWide = repos.length === 0;
	// The breadth opt-ins are only expressible on the account-wide core, so gate them here — the single place
	// that already knows which core it is about to call.
	const includeReviewRequested = accountWide && (accountWideOptions?.includeReviewRequested ?? false);
	const includeReviews = accountWide && (accountWideOptions?.includeReviews ?? false);
	/** Every cursor already followed, so a provider that cycles them can't keep the drain walking in circles. */
	const seenCursors = new Set<string>();

	for (;;) {
		page++;
		// Snapshot the mutable loop cursor so the read closure doesn't capture a later-reassigned value.
		const pageCursor = cursor;
		const { value, warning } = await runCaptured(id, domain, connectionId, () =>
			accountWide
				? integration.getMyPullRequestsForUserResult(
						{
							state: state,
							cursor: pageCursor,
							includeReviewRequested: includeReviewRequested,
							filters: filters,
							// Lite by default; the full projection (reviews) only when a caller opts in.
							summary: !includeReviews,
						},
						connectionId,
					)
				: integration.getMyPullRequestsForReposResult(
						repos,
						{ state: state, filters: filters, cursor: pageCursor },
						connectionId,
					),
		);
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// An implicit sweep may silently skip a provider that has no session before it yields data.
			// Once a page has been returned, however, losing that session leaves an unread tail and must
			// be attributed even when the provider wasn't explicitly requested.
			const sessionLostAfterProgress = warning == null && page > 1;
			const unavailable = warning == null && (attributeUnavailableProvider || sessionLostAfterProgress);
			if (unavailable) {
				appendDedupedWarning(warnings, noConnectionWarning(id, domain, connectionId));
			}
			// `warning` set → a hard read failure (incomplete items); otherwise not connected / no session.
			const failed = fetchFailed || warning != null || unavailable;
			// A cap seen on an earlier page still left results out, so it is still worth saying — but as part
			// of a read that failed, never as an omission. (`failed` is always true here when anything was
			// latched: reaching this exit past page 1 means a later page was lost.)
			if (unexplainedTruncation) {
				appendDedupedWarning(
					warnings,
					truncationWarning(id, domain, connectionId, 'Pull request', failed ? 'interrupted' : 'exhausted'),
				);
			}
			// An earlier page may already have emitted an omission before this one died; it asserts the read
			// succeeded, which is no longer true.
			reconcileOmissionsWithFailure(warnings, failed);
			return {
				items: items,
				warnings: warnings,
				fetchFailed: failed,
				truncated: truncated || sessionLostAfterProgress,
				// Only a top-level first-page rejection means the provider itself failed. A later-page or
				// per-scope failure still yielded a usable provider slice and stays represented separately.
				failedProvider: page === 1 && (warning != null || unavailable),
			};
		}

		// Composite account-wide queries can surface the same PR on different relationship/state pages
		// (for example authored + review-requested, or closed + merged). Keep the first stable position but
		// replace its value with the latest representation so a later, richer merged state wins. A provider
		// row without a canonical URL falls back to repository-scoped identity; a row with neither stays
		// unkeyed and is retained so unrelated incomplete rows are never collapsed.
		for (const pullRequest of value.values) {
			const identity = getProviderPullRequestIdentity(pullRequest);
			if (identity == null) {
				items.push(pullRequest);
				continue;
			}

			const existingIndex = itemIndexByIdentity.get(identity);
			if (existingIndex == null) {
				itemIndexByIdentity.set(identity, items.length);
				items.push(pullRequest);
			} else {
				items[existingIndex] = pullRequest;
			}
		}

		// Assess this page's SDK metadata: append scope-aware warnings (deduped across pages), and remember
		// whether a structured failure or incompleteness occurred.
		const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata);
		fetchFailed = fetchFailed || assessment.fetchFailed;
		const pageTruncated =
			(value as { truncated?: boolean }).truncated === true ||
			value.paging?.truncated === true ||
			assessment.truncated;
		truncated = truncated || pageTruncated;
		// A page the provider itself capped, or one whose completeness it couldn't confirm. Latched from ANY
		// source, SDK metadata included: no budget of ours un-caps a page, so a later `maxPages` hit must not
		// claim raising it would help.
		providerTruncated = providerTruncated || pageTruncated;
		// Whether this drain owes its OWN warning for that is a separate question — `mergeAssessmentInto` has
		// already appended one when the fact came from SDK metadata, and repeating it would be noise.
		unexplainedTruncation = unexplainedTruncation || (pageTruncated && !assessment.truncated);

		if (!(value.paging?.more ?? false)) {
			// A read that can't confirm completeness (single-page provider reads with no `hasNextPage`)
			// sets `paging.truncated`; propagate it (and any top-level `truncated` and SDK incompleteness)
			// so the sweep doesn't claim an all-pages result.
			if (unexplainedTruncation) {
				appendDedupedWarning(
					warnings,
					truncationWarning(
						id,
						domain,
						connectionId,
						'Pull request',
						fetchFailed ? 'interrupted' : 'exhausted',
					),
				);
			}
			reconcileOmissionsWithFailure(warnings, fetchFailed);
			return {
				items: items,
				warnings: warnings,
				fetchFailed: fetchFailed,
				truncated: truncated,
				failedProvider: false,
			};
		}

		// Resolve the continuation BEFORE deciding why the drain stops. `page-budget` claims the missing items
		// are reachable, which is only true with a usable cursor in hand — and a provider can report another
		// page while handing back none (Bitbucket Server does, when it omits `nextPageStart`). Checking the
		// budget first would label that unreachable tail as merely unfetched, so raising `maxPages` would
		// return the identical set.
		const nextCursor = value.paging?.cursor;
		// A cursor already used isn't a continuation either — following it refetches a page we have, and a
		// provider that cycles (A→B→A) would otherwise burn the whole budget and then be reported as merely
		// out of budget. Tracked as a SET rather than compared one-back, matching the SDK's own `followCursors`:
		// `drainToRequestedPage` and `collectProviderPagedResult` compare only the previous cursor, which a
		// cycle slips past. That is tolerable there and not here, because only this drain reports `page-budget`.
		const continuable = nextCursor != null && nextCursor !== '{}' && !seenCursors.has(nextCursor);
		if (!continuable || page >= maxPages) {
			// `providerTruncated` outranks the budget: a page the provider capped stays capped however many
			// pages we are allowed to read, so promising `page-budget` on top of it would be a load-more that
			// cannot deliver the capped part.
			appendDedupedWarning(
				warnings,
				truncationWarning(
					id,
					domain,
					connectionId,
					'Pull request',
					fetchFailed ? 'interrupted' : continuable && !providerTruncated ? 'page-budget' : 'exhausted',
				),
			);
			reconcileOmissionsWithFailure(warnings, fetchFailed);
			return {
				items: items,
				warnings: warnings,
				fetchFailed: fetchFailed,
				truncated: true,
				failedProvider: false,
			};
		}

		seenCursors.add(nextCursor);
		cursor = nextCursor;
	}
}

/**
 * Drains every page of repositories under an org for one git-host integration, threading the opaque
 * next-cursor the provider returns. Stops at `maxPages` (marking `truncated`) or on a hard read failure
 * (marking `fetchFailed`), keeping the pages fetched so far.
 */
export async function drainRepositories(
	integration: GitHostIntegration,
	id: IntegrationIds,
	domain: string | undefined,
	org: string,
	project: string | undefined,
	connectionId: string | undefined,
	maxPages: number,
): Promise<{
	repos: ProviderRepository[];
	warnings: ProviderWarning[];
	fetchFailed: boolean;
	truncated: boolean;
}> {
	const repos: ProviderRepository[] = [];
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;
	let truncated = false;
	let cursor: string | undefined;
	let page = 0;

	for (;;) {
		page++;
		const pageCursor = cursor;
		const { value, warning } = await runCaptured(
			id,
			domain,
			connectionId,
			() =>
				integration.getRepositoriesForOrgResult(org, {
					project: project,
					cursor: pageCursor,
					connectionId: connectionId,
				}),
			{ warnOnMissingSession: true },
		);
		if (warning != null) {
			warnings.push(warning);
		}
		if (value == null) {
			const interruptedAfterProgress = page > 1;
			if (interruptedAfterProgress && warning == null) {
				// Not a backstop: the read was cut short mid-drain, which is why it also sets `fetchFailed`
				// below. A retry may complete it, so this must not claim the succeeded-but-capped omission.
				appendDedupedWarning(
					warnings,
					truncationWarning(id, domain, connectionId, 'Repository', 'interrupted'),
				);
			}
			const failed = fetchFailed || warning != null || interruptedAfterProgress;
			// An SDK omission from an earlier page asserts the read succeeded; this one didn't.
			reconcileOmissionsWithFailure(warnings, failed);
			return {
				repos: repos,
				warnings: warnings,
				fetchFailed: failed,
				truncated: truncated || interruptedAfterProgress,
			};
		}

		repos.push(...value.values);
		const assessment = mergeAssessmentInto(warnings, id, domain, connectionId, value.metadata);
		fetchFailed = fetchFailed || assessment.fetchFailed;
		truncated = truncated || value.truncated === true || value.paging?.truncated === true || assessment.truncated;
		if (!(value.paging?.more ?? false)) {
			reconcileOmissionsWithFailure(warnings, fetchFailed);
			return {
				repos: repos,
				warnings: warnings,
				fetchFailed: fetchFailed,
				truncated: truncated,
			};
		}

		if (page >= maxPages) {
			reconcileOmissionsWithFailure(warnings, fetchFailed);
			return { repos: repos, warnings: warnings, fetchFailed: fetchFailed, truncated: true };
		}

		const nextCursor = value.paging?.cursor;
		if (nextCursor == null || nextCursor === '{}') {
			// Provider says there is more but didn't return a usable cursor; stop rather than refetch the same page.
			reconcileOmissionsWithFailure(warnings, fetchFailed);
			return { repos: repos, warnings: warnings, fetchFailed: fetchFailed, truncated: true };
		}

		cursor = nextCursor;
	}
}

export function resolvePullRequestSweepTargets(options: PullRequestSweepOptions | undefined): {
	targets: readonly ProviderSweepTarget[];
	attributeUnavailableProviders: boolean;
} {
	if (options?.targets != null) {
		if (options.providerIds != null || options.connectionId != null) {
			throw new TypeError("Pull request sweep 'targets' cannot be combined with 'providerIds' or 'connectionId'");
		}

		const seenProviderIds = new Set<IntegrationIds>();
		for (const target of options.targets) {
			if (seenProviderIds.has(target.providerId)) {
				throw new TypeError(
					`Pull request sweep targets must contain at most one target per provider; duplicate '${target.providerId}'`,
				);
			}

			seenProviderIds.add(target.providerId);
		}

		return { targets: options.targets, attributeUnavailableProviders: true };
	}

	const providerIds =
		options?.providerIds ?? supportedOrderedCloudIntegrationIds.filter(id => !isIssuesHostIntegrationId(id));
	const connectionId = providerIds.length === 1 ? options?.connectionId : undefined;
	return {
		targets: providerIds.map(providerId => ({ providerId: providerId, connectionId: connectionId })),
		attributeUnavailableProviders: options?.providerIds != null,
	};
}

export async function getCurrentAccountId(
	integration: GitHostIntegration,
	connectionId: string | undefined,
): Promise<string | undefined> {
	try {
		return (await integration.getCurrentAccount({ connectionId: connectionId }))?.id;
	} catch {
		// Authorship is optional enrichment; don't turn a successful PR read into a failure if identity lookup fails.
		return undefined;
	}
}
