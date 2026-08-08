import type { IssueShape } from '@gitlens/git/models/issue.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type { ProviderBroadenOrg } from '../manager.js';
import type { ProviderReposInput } from '../providers/models.js';
import type { ProviderBroadenResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { hostFromDomain } from '../utils/domain.utils.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import type { BroadenIssuesExhaustedOrg, BroadenIssuesOrgCursor } from './cursors.js';
import { getBroadenIssuesCursor, isBroadenIssuesOrgExhausted, toBroadenIssuesCursor } from './cursors.js';
import { drainRepositories, runCaptured } from './drains.js';
import { resolveContinuation, toProviderPageInfo } from './paging.js';
import { gitHostOnlySurfaceWarning, issuesUnsupportedWarning, noConnectionWarning, otherWarning } from './warnings.js';

/**
 * The issue-broadening fan-out: per org, drain that org's repositories, then read every visible issue in them.
 *
 * What makes this its own read rather than a variant of `listIssuesPage` is that one logical page spans several
 * provider positions — one per org — so its continuation is a per-org cursor BUNDLE (see `cursors.ts`) and its
 * failure attribution is per provider across those orgs. Both are the reason a page number alone can't address a
 * later page, and why {@link broadenIssues} walks prior pages itself when given only `page`.
 *
 * SUPERSEDED for a caller that already knows its repositories: `searchIssuesPage({ repos, criteria })` answers
 * the same question in one request per page, with no repository drain and no route through the SDK read whose
 * over-limit recovery walk can spend up to 128 requests. This read stays for "fan out across these orgs,
 * whatever repos they contain", whose per-provider attribution the single-provider search doesn't produce.
 *
 * If you migrate a caller, note the semantics carefully: broadening means ALL VISIBLE — it passes
 * `includeAllAssignees: true`, which resolves to no assignee constraint at all, so unassigned issues ARE
 * included. The equivalent is an OMITTED `relationships`, not `['any-assignee']`: `assignee:*` means "has some
 * assignee" and would silently exclude every unassigned issue, which is the opposite of broadening.
 *
 * Takes no `sort`, unlike `listIssuesPage` and `searchIssuesPage`. One logical page here spans several orgs, each
 * at its own provider position in a cursor bundle, so honoring an order across them would need a k-way merge with
 * a buffer per org rather than a sort of what arrived — the page is a slice of several independent walks, not a
 * union of one round's results. `searchIssuesPage({ repos, criteria: { sort } })` answers the ordered version of
 * this question for a caller that knows its repositories, and is already the recommended migration above.
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
		warnings.push(...result.warnings);
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

/** Reads one org's visible issues: drain the org's repos, then read the issues across them. */
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
	const fetchFailed = reposDrain.fetchFailed;
	const truncated = reposDrain.truncated;

	const repos: ProviderReposInput = reposDrain.repos.map(r => ({ ...r }));
	if (repos.length === 0) {
		return barrenSlice(warnings, { fetchFailed: fetchFailed, truncated: truncated });
	}

	// Broaden = "all visible": drop the assigned-to-me filter so unassigned issues are included.
	const cursor = getBroadenIssuesCursor(options.cursor, org, page, options.orgs.length);
	const issuesCaptured = await runCaptured(
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
	if (issuesCaptured.warning != null) {
		warnings.push(issuesCaptured.warning);
	}
	const issuesAssessment = mergeAssessmentInto(
		warnings,
		org.providerId,
		domain,
		connectionId,
		issuesCaptured.value?.metadata,
	);
	let issuesFetchFailed =
		issuesAssessment.fetchFailed || (issuesCaptured.warning != null && issuesCaptured.value == null);
	const items: IssueShape[] = [];
	let hasMore = false;
	let nextCursor: string | undefined;
	let retryPage: number | undefined;
	// Carry a truncation signal from the issue read too: a provider that couldn't confirm it drained
	// a repo (`paging.truncated`) means this org's issues may be incomplete, on top of any repo-drain
	// truncation already captured above.
	let issuesTruncated = false;
	if (issuesCaptured.value != null) {
		items.push(...issuesCaptured.value.values);
		const paged = toProviderPageInfo(issuesCaptured.value.values.length, issuesCaptured.value.paging);
		// An org that reports another page but no usable cursor can't be resumed: it would neither be
		// recorded in the composite cursor nor marked exhausted, so the next round would re-read its
		// page 1 and repeat every issue. Treat it as terminal-but-incomplete (which also marks the org
		// exhausted below, since `exhausted` keys off `!hasMore`).
		const continuation = resolveContinuation(paged, undefined);
		hasMore = continuation.hasMore;
		nextCursor = continuation.cursor;
		issuesTruncated = continuation.truncated || issuesAssessment.truncated;
	} else if (issuesCaptured.warning != null || cursor != null) {
		// Keep the exact position that failed. Without this retry cursor a multi-org continuation would
		// omit this org from the bundle, then synthesize the next numbered page and silently skip the
		// failed page. The synthesized page cursor is also actionable for a first-page cursor-only read:
		// that provider ignores the page marker and retries its first page. A retry slot alone is NOT
		// forward progress, though: advertising `hasMore` for a persistent failure would make an infinite
		// query request it forever. Healthy sibling continuations set `hasMore` independently.
		if (cursor != null) {
			nextCursor = cursor;
			if (issuesCaptured.warning == null) {
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
		broadenedProviderIds: issuesCaptured.value != null ? [org.providerId] : [],
		providerId: org.providerId,
		org: org.name,
		connectionId: connectionId,
		domain: cursorDomain,
		nextCursor: nextCursor,
		retryPage: retryPage,
		hasMore: hasMore,
		// Exhausted once a successful read reports no more pages — recorded in the cursor so later
		// rounds skip it while other orgs keep paging.
		exhausted: issuesCaptured.value != null && !hasMore,
		fetchFailed: fetchFailed || issuesFetchFailed,
		truncated: truncated || issuesTruncated,
	};
}
