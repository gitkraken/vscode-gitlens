import type { IssueShape } from '@gitlens/git/models/issue.js';
import { effectiveIssueSort } from '@gitlens/git/utils/issue.utils.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type { ProviderBroadenOrg } from '../manager.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { ProviderReposInput } from '../providers/models.js';
import type { ProviderBroadenResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { hostFromDomain } from '../utils/domain.utils.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import type { BroadenIssuesExhaustedOrg, BroadenIssuesOrgCursor } from './cursors.js';
import { getBroadenIssuesCursor, isBroadenIssuesOrgExhausted, toBroadenIssuesCursor } from './cursors.js';
import { drainRepositories, runCaptured } from './drains.js';
import { resolveIssueSearchScope, supportsFilteredIssueSearch } from './filters.js';
import { resolveContinuation, toProviderPageInfo, usableCursor } from './paging.js';
import {
	gitHostOnlySurfaceWarning,
	issueSearchCapResultWarning,
	issuesUnsupportedWarning,
	noConnectionWarning,
	otherWarning,
	truncationWarning,
	unsupportedIssueSearchCriteriaWarning,
} from './warnings.js';

/**
 * The issue-broadening fan-out: every visible issue across a set of orgs, one page at a time.
 *
 * What makes this its own read rather than a variant of `listIssuesPage` is that one logical page spans several
 * provider positions — one per org — so its continuation is a per-org cursor BUNDLE (see `cursors.ts`) and its
 * failure attribution is per provider across those orgs. Both are the reason a page number alone can't address a
 * later page, and why {@link broadenIssues} walks prior pages itself when given only `page`.
 *
 * Each org slice runs on ONE OF TWO ENGINES, chosen by what the provider declares (#5804):
 * - the org-scoped FILTERED SEARCH where the provider has one (GitHub/GHE): one request per page, no repositories
 *   needed at all, since the search reaches the scope by naming the org;
 * - the REPOSITORY DRAIN plus the SDK's repo-scoped read where it doesn't (Azure DevOps, GitLab): up to 100
 *   requests to enumerate the org, and a read whose over-limit recovery walk can spend 128 more per repository
 *   and still return an incomplete set.
 *
 * Measured by running this read against the live API, three times per engine per org (median shown; each
 * engine returned a byte-identical result set on all three, so the sets below are not sampling noise):
 *
 * | | repo drain + SDK read | org-scoped search |
 * | --- | --- | --- |
 * | BELOW the ceiling (146 issues) | 9.3s, 11 requests, 146 issues | 6.2s, 2 requests, 146 issues |
 * | ABOVE it (1.475 issues, 217 repos) | 111s, 133 requests, 1.118 issues | 40s, 10 requests, 1.000 issues |
 * | ...of the 1.000 most recently updated | 644 | 1.000 |
 * | ...omissions reported | 99 × `recovery-budget`, no count | 1, carrying `totalCount: 1474` |
 *
 * BELOW the ceiling the two return the IDENTICAL SET (verified as set equality), so there the swap is a straight
 * saving and nothing else. ABOVE it they return DIFFERENT SETS — overlapping on 644 items, so the divergence is
 * not confined to the edge.
 *
 * Above the ceiling the search returns FEWER items and is nonetheless the more useful of the two, which is the
 * whole reason to prefer it: its 1.000 are exactly the 1.000 most recently updated (again set equality against a
 * ceiling-free enumeration, not a count), whereas the SDK read's 1.118 are an arbitrary subset — 474 of them from
 * beyond that window, at the cost of omitting 356 issues that ARE in it. Its recovery walk does not close the gap
 * it spends the budget on: all 99 of its omissions were exhausted budget.
 *
 * The second difference is what a consumer can SAY about the gap. At the ceiling the search succeeds and reports
 * one quantified omission (`issueSearchCapResultWarning` carries `totalCount`, `limit` and the order the window
 * was selected under), so a consumer can render "1.474 matched, showing the 1.000 most recently updated". The
 * SDK read reports one `recovery-budget` omission per exhausted repository, none of which carries how many issues
 * were missed — incompleteness that can be announced but not quantified.
 *
 * Note the time saving is the SMALLER half of this: 1.5× below the ceiling and 2.8× above it, against 5.5× and
 * 13.3× fewer requests. The request count is what matters for a rate limit shared with every other read.
 *
 * The public surface is the SAME on both: the options, the per-org cursor bundle, the `ProviderAttribution`
 * split, the warning dedupe and the return type. A consumer needs to know which engine ran only insofar as the
 * warnings say so.
 *
 * Broadening means ALL VISIBLE, and each engine expresses that differently — `includeAllAssignees: true` on the
 * SDK read, an OMITTED `relationships` on the search. Both resolve to no assignee constraint at all, so
 * unassigned issues ARE included. The search's equivalent is NOT `['any-assignee']`: `assignee:*` means "has some
 * assignee" and would silently exclude every unassigned issue, which is the opposite of broadening.
 *
 * Takes no `sort`, unlike `listIssuesPage` and `searchIssuesPage`. One logical page here spans several orgs, each
 * at its own provider position in a cursor bundle, so honoring an order across them would need a k-way merge with
 * a buffer per org rather than a sort of what arrived — the page is a slice of several independent walks, not a
 * union of one round's results. The search engine still orders each org's OWN query (it must: a ceiling policy of
 * "the N most recent" is only correct under a guaranteed order), so a slice is ordered where the merged page is
 * not. `searchIssuesPage({ repos, criteria: { sort } })` answers the ordered version of this question for a
 * caller that knows its repositories.
 */

export interface BroadenIssuesOptions {
	orgs: ProviderBroadenOrg[];
	page?: number;
	cursor?: string;
	forceSync?: boolean;
}

/** One org slice of the fan-out: its issues plus the position and health the aggregation keys the bundle by. */
interface BroadenSlice {
	items: IssueShape[];
	warnings: ProviderWarning[];
	broadenedProviderIds: IntegrationIds[];
	providerId: IntegrationIds;
	org: string;
	connectionId?: string;
	domain?: string;
	nextCursor?: string;
	retryPage?: number;
	hasMore: boolean;
	exhausted: boolean;
	fetchFailed: boolean;
	truncated: boolean;
}

/**
 * Accumulates provider attribution across the rounds of a page-number traversal.
 *
 * The three sets are mutually exclusive per provider and the ordering rules are what keep them so: a provider
 * that failed in one round but broadened in another is INCOMPLETE, not failed, whichever round reported first.
 */
class ProviderAttribution {
	private readonly broadened = new Set<IntegrationIds>();
	private readonly failed = new Set<IntegrationIds>();
	private readonly incomplete = new Set<IntegrationIds>();

	merge(result: ProviderBroadenResult<IssueShape>): void {
		for (const providerId of result.failedProviderIds) {
			if (this.broadened.has(providerId) || result.broadenedProviderIds.includes(providerId)) {
				this.incomplete.add(providerId);
			} else {
				this.failed.add(providerId);
			}
		}
		for (const providerId of result.incompleteProviderIds) {
			this.failed.delete(providerId);
			this.incomplete.add(providerId);
		}
		for (const providerId of result.broadenedProviderIds) {
			this.broadened.add(providerId);
			if (this.failed.delete(providerId)) {
				this.incomplete.add(providerId);
			}
		}
	}

	toResultFields(): Pick<
		ProviderBroadenResult<IssueShape>,
		'broadenedProviderIds' | 'failedProviderIds' | 'incompleteProviderIds'
	> {
		return {
			broadenedProviderIds: [...this.broadened],
			failedProviderIds: [...this.failed],
			incompleteProviderIds: [...this.incomplete],
		};
	}
}

export async function broadenIssues(
	ctx: ProviderReadContext,
	options: BroadenIssuesOptions,
): Promise<ProviderBroadenResult<IssueShape>> {
	const page = Math.max(1, Math.trunc(options.page ?? 1));

	// Kepler's existing contract persists only a page number. When no opaque continuation was supplied,
	// advance through prior pages internally so cursor-only providers still return the requested page.
	// Each recursive call below carries a cursor, so it bypasses this block and performs exactly one round.
	if (options.cursor == null && page > 1) {
		return traverseToRequestedPage(ctx, options, page);
	}

	const results = await mapBounded(options.orgs, providerFanOutConcurrency, org =>
		readOrgSlice(ctx, options, org, page),
	);

	const items: IssueShape[] = [];
	const warnings: ProviderWarning[] = [];
	const broadenedProviderIds = new Set<IntegrationIds>();
	const problemProviderIds = new Set<IntegrationIds>();
	const cursors: BroadenIssuesOrgCursor[] = [];
	const exhausted: BroadenIssuesExhaustedOrg[] = [];
	let hasMore = false;
	let fetchFailed = false;
	let truncated = false;
	for (const result of results) {
		if (result == null) {
			continue;
		}

		items.push(...result.items);
		// Deduped across orgs: several orgs of one provider commonly fail the same way (one expired token, one
		// rate limit), producing the identical warning per slice, and the array's contract is that no two entries
		// are equal — `traverseToRequestedPage` already dedupes when it folds these same warnings across rounds.
		for (const warning of result.warnings) {
			appendDedupedWarning(warnings, warning);
		}
		for (const id of result.broadenedProviderIds) {
			broadenedProviderIds.add(id);
		}
		if (result.nextCursor != null || result.retryPage != null) {
			cursors.push({
				providerId: result.providerId,
				org: result.org,
				connectionId: result.connectionId,
				domain: result.domain,
				cursor: result.nextCursor,
				retryPage: result.retryPage,
			});
		}
		if (result.exhausted) {
			exhausted.push({
				providerId: result.providerId,
				org: result.org,
				connectionId: result.connectionId,
				domain: result.domain,
			});
		}
		if (result.hasMore) {
			hasMore = true;
		}
		if (result.fetchFailed) {
			fetchFailed = true;
		}
		if (result.truncated) {
			truncated = true;
		}
		if (result.fetchFailed || result.truncated) {
			problemProviderIds.add(result.providerId);
		}
	}

	const cursor = toBroadenIssuesCursor(cursors, exhausted, options.orgs.length);
	const failedProviderIds: IntegrationIds[] = [];
	const incompleteProviderIds: IntegrationIds[] = [];
	for (const providerId of problemProviderIds) {
		if (broadenedProviderIds.has(providerId)) {
			incompleteProviderIds.push(providerId);
		} else {
			failedProviderIds.push(providerId);
		}
	}
	return {
		items: items,
		warnings: warnings,
		// `currentPage` is positional, per ProviderPageInfo.currentPage: this fan-out has no provider-reported
		// page of its own (its cursor is a per-org bundle, not a page), so the position is the one the caller
		// addressed — the `page` it supplied, or the page the internal traversal advanced to.
		page: { currentPage: page, itemsPerPage: items.length, truncated: truncated || undefined },
		// `hasMore` promises a resumable continuation, so it must be true ONLY when a real cursor was
		// produced. Repo-drain truncation (a backstop hit with no persisted repo cursor) can't be resumed —
		// re-invoking would re-drain the same repos and repeat issues — so it is surfaced as the terminal
		// `page.truncated` incompleteness signal instead of `hasMore`, matching listRepos. Guard `hasMore`
		// against a missing cursor so we never advertise a continuation the caller can't make.
		hasMore: hasMore && cursor != null,
		cursor: cursor,
		fetchFailed: fetchFailed || undefined,
		broadenedProviderIds: [...broadenedProviderIds],
		failedProviderIds: failedProviderIds,
		incompleteProviderIds: incompleteProviderIds,
		fanOutCount: options.orgs.length,
	};
}

/**
 * Advances to page N by re-running the fan-out for each prior page, threading each round's cursor bundle into the
 * next. Only the requested page's items are returned; warnings and provider attribution accumulate across the
 * whole walked prefix, since a failure in an earlier round still means this result is not authoritative.
 */
async function traverseToRequestedPage(
	ctx: ProviderReadContext,
	options: BroadenIssuesOptions,
	page: number,
): Promise<ProviderBroadenResult<IssueShape>> {
	let cursor: string | undefined;
	const traversalWarnings: ProviderWarning[] = [];
	const attribution = new ProviderAttribution();
	let traversalFetchFailed = false;
	let traversalTruncated = false;

	for (let currentPage = 1; currentPage < page; currentPage++) {
		const previous = await broadenIssues(ctx, {
			...options,
			page: currentPage,
			cursor: cursor,
			// A forced refresh belongs to the logical read, not every cursor-advancement round.
			forceSync: currentPage === 1 ? options.forceSync : false,
		});
		for (const warning of previous.warnings) {
			appendDedupedWarning(traversalWarnings, warning);
		}
		attribution.merge(previous);
		traversalFetchFailed ||= previous.fetchFailed === true;
		traversalTruncated ||= previous.page.truncated === true;
		if (!previous.hasMore || previous.cursor == null) {
			// The requested page lies past the last continuation: an empty page N, never the last page relabeled.
			return {
				items: [],
				warnings: traversalWarnings,
				page: { currentPage: page, itemsPerPage: 0, truncated: traversalTruncated || undefined },
				hasMore: false,
				fetchFailed: traversalFetchFailed || undefined,
				...attribution.toResultFields(),
				fanOutCount: options.orgs.length,
			};
		}

		cursor = previous.cursor;
	}

	const requested = await broadenIssues(ctx, { ...options, page: page, cursor: cursor, forceSync: false });
	for (const warning of requested.warnings) {
		appendDedupedWarning(traversalWarnings, warning);
	}
	attribution.merge(requested);
	return {
		...requested,
		warnings: traversalWarnings,
		page: {
			...requested.page,
			truncated: traversalTruncated || requested.page.truncated === true || undefined,
		},
		fetchFailed: traversalFetchFailed || requested.fetchFailed === true || undefined,
		...attribution.toResultFields(),
	};
}

/**
 * One org's issues as either engine below reports them, normalized to the single shape {@link readOrgSlice}'s
 * bookkeeping consumes.
 *
 * The two engines return different envelopes — the SDK read's `PagedResult` + `paging`, the search's flat page —
 * and normalizing HERE rather than per engine is what keeps the continuation, retry, attribution and exhaustion
 * rules literally the same code on both paths. A second copy of those rules per engine is how one path would come
 * to advertise a continuation the other calls terminal.
 */
interface OrgIssuesRead {
	/** The page the provider served, or `undefined` when the read returned none (which `warning` explains). */
	value?: { items: IssueShape[]; hasMore: boolean; cursor?: string; truncated: boolean };
	/** The read's own failure. Already included in `warnings`; carried separately because the retry rules key off it. */
	warning?: ProviderWarning;
	/** Everything the engine produced, the read's own failure included. */
	warnings: ProviderWarning[];
	fetchFailed: boolean;
	truncated: boolean;
	/**
	 * The engine established there is NOTHING to read for this org — the repository drain returned no
	 * repositories — so the slice is terminal and empty. Distinct from `value == null`, which means a read WAS
	 * issued and came back with no page, and so is a position to retry.
	 */
	nothingToRead?: boolean;
}

/**
 * Whether this org can be read through the FILTERED issue search instead of the repository drain.
 *
 * Two conditions, and the second is not a formality: an empty org name is dropped by the provider's scope
 * translation rather than rejected, which would leave a search of the WHOLE HOST — so the scope is validated
 * through {@link resolveIssueSearchScope}, the same rule `searchIssuesPage` refuses on, rather than by an
 * `org.name.length > 0` written here and free to drift from it.
 */
function canSearchOrgIssues(org: ProviderBroadenOrg): boolean {
	return (
		supportsFilteredIssueSearch(org.providerId) &&
		resolveIssueSearchScope(undefined, org.name, undefined).rejection == null
	);
}

/**
 * The org-scoped filtered search: ONE request per page, whatever the org contains.
 *
 * Replaces the drain + SDK read for every provider that declares a filtered issue search — the repository drain
 * costs up to 100 requests per org, and the SDK's repo-scoped read past GitHub's result ceiling enters a
 * per-repository recovery walk that can spend 128 more and still return an incomplete set. Measured on an org
 * past that ceiling: 133 requests and 111s, against this read's 10 and 40s. The search reaches the same scope by
 * NAMING the org, so it needs no repositories at all.
 *
 * It is also the more COMPLETE of the two over the window a consumer reads first, despite returning fewer items —
 * see the module docstring's table for the measurement and why that is not a contradiction.
 *
 * `criteria` is omitted entirely, and each half of that is deliberate:
 * - `relationships` OMITTED is what drops the assignee constraint, which is the substitution `includeAllAssignees:
 *   true` performs on the read this replaces. NOT `['any-assignee']`, which means "assigned to somebody" and would
 *   exclude every unassigned issue — the opposite of broadening.
 * - every other criterion left unset resolves to the provider's own default, which is the state this read already
 *   served (open issues only, archived repositories excluded).
 *
 * At the result ceiling this SUCCEEDS and reports how many matched instead of walking for the rest — see the
 * ceiling warning below.
 */
async function readOrgIssuesViaSearch(
	integration: GitHostIntegration,
	org: ProviderBroadenOrg,
	domain: string | undefined,
	cursor: string | undefined,
): Promise<OrgIssuesRead> {
	const connectionId = org.connectionId;
	const captured = await runCaptured(
		org.providerId,
		domain,
		connectionId,
		() => integration.searchIssuesPageResult({ org: org.name, cursor: cursor }, undefined, connectionId),
		{ warnOnMissingSession: true },
	);

	// A provider that declares the capability but implements no search hook answers `undefined` with no error.
	// Reported as the explicit unsupported failure rather than left as a silent empty page, so it can't be mistaken
	// for an org with no issues — and as the read's `warning`, so the slice treats it as the read failure it is.
	const warning =
		captured.warning ??
		(captured.value == null
			? unsupportedIssueSearchCriteriaWarning(org.providerId, domain, connectionId, {
					reason: 'unsupported-search',
				})
			: undefined);
	const warnings = warning != null ? [warning] : [];

	let value: OrgIssuesRead['value'];
	if (captured.value != null) {
		const page = captured.value;
		value = {
			items: page.values,
			hasMore: page.hasMore,
			cursor: usableCursor(page.cursor),
			truncated: page.truncated,
		};
		// The result ceiling is the one incompleteness this read can QUANTIFY, so it carries the total rather than
		// a bare "may be incomplete" — which is what lets a consumer say "1.474 matched, showing the 1.000 most
		// recently updated" instead of silently serving a truncated list. Only when nothing else already explained
		// the incompleteness, and only the ceiling gets the number: any other cause falls back to the generic
		// wording rather than reporting a limit it didn't hit. `exhausted`: nothing this read exposes would return
		// the withheld items.
		if (page.truncated && warnings.length === 0) {
			warnings.push(
				issueSearchCapResultWarning(
					org.providerId,
					domain,
					connectionId,
					page.totalCount,
					effectiveIssueSort(undefined),
				) ?? truncationWarning(org.providerId, domain, connectionId, 'Issue search', 'exhausted'),
			);
		}
	}

	return { value: value, warning: warning, warnings: warnings, fetchFailed: false, truncated: false };
}

/**
 * The original engine: drain the org's repositories, then read the issues across them.
 *
 * Kept for a provider that declares NO filtered issue search (Azure DevOps, GitLab), where refusing the org would
 * be a regression rather than a saving. Its cost, and the arbitrary subset it serves past the result ceiling, are
 * what {@link readOrgIssuesViaSearch} exists to avoid — see the module docstring's measurement. Those providers
 * keep both, because on them there is nothing better to switch to.
 */
async function readOrgIssuesViaRepoDrain(
	integration: GitHostIntegration,
	org: ProviderBroadenOrg,
	domain: string | undefined,
	cursor: string | undefined,
): Promise<OrgIssuesRead> {
	const connectionId = org.connectionId;
	const reposDrain = await drainRepositories(
		integration,
		org.providerId,
		domain,
		org.name,
		undefined,
		connectionId,
		100,
	);
	const warnings: ProviderWarning[] = [...reposDrain.warnings];

	const repos: ProviderReposInput = reposDrain.repos.map(r => ({ ...r }));
	if (repos.length === 0) {
		return {
			warnings: warnings,
			fetchFailed: reposDrain.fetchFailed,
			truncated: reposDrain.truncated,
			nothingToRead: true,
		};
	}

	// Broaden = "all visible": drop the assigned-to-me filter so unassigned issues are included.
	const captured = await runCaptured(
		org.providerId,
		domain,
		connectionId,
		() =>
			// Normalized shapes seam, uniform with listIssuesPage.
			integration.getMyIssuesForReposAsShapesResult(
				repos,
				{ includeAllAssignees: true, cursor: cursor },
				connectionId,
			),
		{ warnOnMissingSession: true },
	);
	if (captured.warning != null) {
		warnings.push(captured.warning);
	}
	const assessment = mergeAssessmentInto(warnings, org.providerId, domain, connectionId, captured.value?.metadata);

	let value: OrgIssuesRead['value'];
	if (captured.value != null) {
		const paged = toProviderPageInfo(captured.value.values.length, captured.value.paging);
		value = {
			items: captured.value.values,
			hasMore: paged.hasMore,
			cursor: paged.cursor,
			// Carry a truncation signal from the issue read too: a provider that couldn't confirm it drained a
			// repo (`paging.truncated`) means this org's issues may be incomplete, on top of any repo-drain
			// truncation already captured above.
			truncated: paged.truncated || assessment.truncated,
		};
	}

	return {
		value: value,
		warning: captured.warning,
		warnings: warnings,
		fetchFailed: reposDrain.fetchFailed || assessment.fetchFailed,
		truncated: reposDrain.truncated,
	};
}

/**
 * Reads one org's visible issues, through the org-scoped filtered search where the provider has one and through
 * the repository drain where it doesn't. Everything below the engine — the position, the retry slot, the
 * attribution and the exhaustion mark — is the same on both paths.
 */
async function readOrgSlice(
	ctx: ProviderReadContext,
	options: BroadenIssuesOptions,
	org: ProviderBroadenOrg,
	page: number,
): Promise<BroadenSlice> {
	const connectionId = org.connectionId;
	const requestedDomain = org.domain;
	const cursorDomain = hostFromDomain(requestedDomain) ?? requestedDomain;
	// An org slice that yielded no issues and has nothing to continue: the org's identity (which the
	// aggregation above keys the per-org cursor bundle by) plus why it produced nothing. `exhausted` marks
	// an org a prior round already drained, so it stays skipped rather than being re-read from page 1.
	const barrenSlice = (
		warnings: ProviderWarning[],
		flags?: { exhausted?: boolean; fetchFailed?: boolean; truncated?: boolean },
	): BroadenSlice => ({
		items: [],
		warnings: warnings,
		broadenedProviderIds: [],
		providerId: org.providerId,
		org: org.name,
		connectionId: connectionId,
		domain: cursorDomain,
		nextCursor: undefined,
		hasMore: false,
		exhausted: flags?.exhausted ?? false,
		fetchFailed: flags?.fetchFailed ?? false,
		truncated: flags?.truncated ?? false,
	});

	if (isIssuesHostIntegrationId(org.providerId)) {
		return barrenSlice(
			[gitHostOnlySurfaceWarning(org.providerId, requestedDomain, connectionId, 'issue broadening')],
			{
				fetchFailed: true,
			},
		);
	}

	const integration = await ctx.getIntegrationForRead(org.providerId, connectionId, requestedDomain);
	if (integration == null) {
		// A requested connection or domain that can't be resolved is a broken target — surface it as a
		// warning + fetchFailed rather than dropping the org silently.
		const early = ctx.earlyReturnConnectionWarnings(org.providerId, connectionId, requestedDomain);
		return barrenSlice(
			early.warnings.length > 0
				? early.warnings
				: [noConnectionWarning(org.providerId, requestedDomain, connectionId)],
			{ fetchFailed: true },
		);
	}
	if (!isGitHostIntegration(integration)) {
		return barrenSlice(
			[gitHostOnlySurfaceWarning(org.providerId, requestedDomain, connectionId, 'issue broadening')],
			{
				fetchFailed: true,
			},
		);
	}
	// A git host whose issue tracker is deprecated (Bitbucket) exposes no issues here — surface a
	// warning + fetchFailed and skip it (no repo drain), so broadening never serves a legacy source.
	if (!integration.supportsIssues) {
		return barrenSlice(
			[
				issuesUnsupportedWarning(
					org.providerId,
					ctx.domainForRead(integration, org.providerId, connectionId, requestedDomain),
					connectionId,
				),
			],
			{ fetchFailed: true },
		);
	}

	// An org a prior round already drained must not be re-read: cursor-only providers would answer a
	// fresh page-1 request with their first page again, duplicating issues across rounds. Skip it
	// before any work (including the repo drain) and keep it marked exhausted so it stays skipped
	// for the rest of the fan-out.
	if (isBroadenIssuesOrgExhausted(options.cursor, org, options.orgs.length)) {
		return barrenSlice([], { exhausted: true });
	}

	await ctx.forceRefreshIfRequested(integration, options.forceSync, connectionId);

	const domain = ctx.domainForRead(integration, org.providerId, connectionId, requestedDomain);
	const cursor = getBroadenIssuesCursor(options.cursor, org, page, options.orgs.length);
	const read = canSearchOrgIssues(org)
		? await readOrgIssuesViaSearch(integration, org, domain, cursor)
		: await readOrgIssuesViaRepoDrain(integration, org, domain, cursor);
	if (read.nothingToRead === true) {
		return barrenSlice(read.warnings, { fetchFailed: read.fetchFailed, truncated: read.truncated });
	}

	const warnings = read.warnings;
	let issuesFetchFailed = read.fetchFailed || (read.warning != null && read.value == null);
	const items: IssueShape[] = [];
	let hasMore = false;
	let nextCursor: string | undefined;
	let retryPage: number | undefined;
	let issuesTruncated = false;
	if (read.value != null) {
		items.push(...read.value.items);
		// An org that reports another page but no usable cursor can't be resumed: it would neither be
		// recorded in the composite cursor nor marked exhausted, so the next round would re-read its
		// page 1 and repeat every issue. Treat it as terminal-but-incomplete (which also marks the org
		// exhausted below, since `exhausted` keys off `!hasMore`).
		const continuation = resolveContinuation(read.value, undefined);
		hasMore = continuation.hasMore;
		nextCursor = continuation.cursor;
		issuesTruncated = continuation.truncated;
	} else if (read.warning != null || cursor != null) {
		// Keep the exact position that failed. Without this retry cursor a multi-org continuation would
		// omit this org from the bundle, then synthesize the next numbered page and silently skip the
		// failed page. The synthesized page cursor is also actionable for a first-page cursor-only read:
		// that provider ignores the page marker and retries its first page. A retry slot alone is NOT
		// forward progress, though: advertising `hasMore` for a persistent failure would make an infinite
		// query request it forever. Healthy sibling continuations set `hasMore` independently.
		if (cursor != null) {
			nextCursor = cursor;
			if (read.warning == null) {
				appendDedupedWarning(
					warnings,
					otherWarning(
						org.providerId,
						domain,
						connectionId,
						'Issue continuation returned no result and must be retried',
					),
				);
				issuesFetchFailed = true;
				issuesTruncated = true;
			}
		} else {
			retryPage = page;
		}
	}

	return {
		items: items,
		warnings: warnings,
		broadenedProviderIds: read.value != null ? [org.providerId] : [],
		providerId: org.providerId,
		org: org.name,
		connectionId: connectionId,
		domain: cursorDomain,
		nextCursor: nextCursor,
		retryPage: retryPage,
		hasMore: hasMore,
		// Exhausted once a successful read reports no more pages — recorded in the cursor so later
		// rounds skip it while other orgs keep paging.
		exhausted: read.value != null && !hasMore,
		fetchFailed: issuesFetchFailed,
		truncated: read.truncated || issuesTruncated,
	};
}
