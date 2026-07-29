import type { PullRequestShape, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import {
	fromProviderPullRequest,
	PagingMode,
	providersMetadata,
	type ProviderPullRequest,
	type ProviderReposInput,
	type PullRequestFilter,
} from '../providers/models.js';
import type { ProviderPagedResult } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { getCurrentAccountId, runCaptured } from './drains.js';
import { resolveAccountWidePullRequestFilters, resolvePullRequestFilters } from './filters.js';
import {
	drainToRequestedPage,
	isPageNumberAdvanceable,
	pageToCursor,
	refusedPage,
	resolveContinuation,
	resolveCurrentPage,
	toProviderPageInfo,
} from './paging.js';
import {
	gitHostOnlySurfaceWarning,
	truncationWarning,
	unsupportedAccountWidePullRequestFiltersWarning,
	unsupportedFiltersWarning,
} from './warnings.js';

export async function listPullRequestsPage(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		states?: PullRequestStateFilter[];
		/**
		 * PR relationship filters (e.g. `[Author, Assignee, ReviewRequested]`). On repo-scoped reads members
		 * combine as provider query constraints (normally an intersection); on account-wide reads they form an
		 * exact OR union. The whole set is validated against the selected path's capability.
		 */
		filters?: PullRequestFilter[];
		/**
		 * Account-wide only: include review-requested PRs when the provider's native "my PRs" query omits them.
		 * This extends the provider-native result; it is not a narrowing filter.
		 */
		includeReviewRequested?: boolean;
		page?: number;
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain when no configured connection supplies one. The value must come
		 * from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderPagedResult<PullRequestShape>> {
	const page = Math.max(1, options.page ?? 1);
	if (isIssuesHostIntegrationId(options.providerId)) {
		return refusedPage(
			page,
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'pull request reads')],
			true,
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connection or domain that no longer resolves is a broken target, not an empty account —
		// surface a no-connection warning + fetchFailed rather than a silent empty page.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return refusedPage(page, early.warnings, early.fetchFailed);
	}
	if (!isGitHostIntegration(integration)) {
		return refusedPage(
			page,
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'pull request reads')],
			true,
		);
	}

	await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	// With no repos this is an account-wide "my PRs" read; the repo-scoped core rejects an empty `repos`
	// input, so route to the account-wide, inherently user-scoped core instead (see drainPullRequests).
	// That provider-defined path takes no `pageSize`. A page-only request is handled by walking any opaque
	// continuations it supplies below. Do NOT synthesize a page-number cursor for it: cursor-based queries
	// (e.g. GitHub `involves:`) ignore a page number and would return their first page.
	const accountWide = (options.repos?.length ?? 0) === 0;
	const cursor = accountWide ? options.cursor : (options.cursor ?? pageToCursor(page));

	const resolvedFilters = accountWide
		? resolveAccountWidePullRequestFilters(options.providerId, options.filters)
		: resolvePullRequestFilters(options.providerId, options.filters);
	if (resolvedFilters.unsupported) {
		return refusedPage(
			page,
			[
				accountWide
					? unsupportedAccountWidePullRequestFiltersWarning(
							options.providerId,
							domain,
							options.connectionId,
							options.filters ?? [],
						)
					: unsupportedFiltersWarning(options.providerId, domain, options.connectionId),
			],
			true,
		);
	}

	const includeReviewRequested = accountWide ? (options.includeReviewRequested ?? false) : false;
	const { value, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			accountWide
				? integration.getMyPullRequestsForUserResult(
						{
							state: options.states,
							cursor: cursor,
							includeReviewRequested: includeReviewRequested,
							filters: resolvedFilters.filters,
							summary: true,
						},
						options.connectionId,
					)
				: integration.getMyPullRequestsForReposResult(
						options.repos ?? [],
						// Forward `page`/`pageSize` alongside the cursor so PagingMode.Repo hosts (GitLab, Bitbucket,
						// Azure), whose per-repo cursor path ignores a synthesized page-number cursor, still honor the
						// requested page and page size instead of always returning page 1. `filters` scopes the read to
						// the current user (the core resolves the account for these), so it returns the user's PRs.
						{
							state: options.states,
							filters: resolvedFilters.filters,
							cursor: cursor,
							page: options.page,
							pageSize: options.itemsPerPage,
						},
						options.connectionId,
					),
		{
			warnOnMissingSession: warnOnMissingSessionForDomain(options.providerId, options.domain),
		},
	);

	let items = value?.values ?? [];
	// Cursor-only account-wide reads start at page 1; a page-only request is advanced through opaque
	// continuations below. Repo-scoped reads report the requested page unless the provider reports its own.
	let paged = toProviderPageInfo(items.length, value?.paging);
	let allMetadata = value?.metadata;
	// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
	// them to any captured thrown-error warning without discarding the partial result's items.
	const warnings = warning != null ? [warning] : [];
	let pageFetchFailed = warning != null && value == null;

	// Cursor-only reads ignore a synthesized page-number cursor, so a page-only request is advanced through
	// the provider's own continuations (see drainToRequestedPage).
	if (
		(accountWide || providersMetadata[options.providerId]?.pullRequestsPagingMode === PagingMode.Repos) &&
		options.page != null &&
		options.page > 1 &&
		options.cursor == null &&
		paged.page.currentPage === 1
	) {
		const drained = await drainToRequestedPage<ProviderPullRequest>(
			{ items: items, paged: paged, metadata: allMetadata, fetchFailed: pageFetchFailed },
			{
				requestedPage: options.page,
				itemsPerPage: options.itemsPerPage,
				warnings: warnings,
				readPage: (cursor: string) =>
					runCaptured(
						options.providerId,
						domain,
						options.connectionId,
						() =>
							accountWide
								? integration.getMyPullRequestsForUserResult(
										{
											state: options.states,
											cursor: cursor,
											includeReviewRequested: includeReviewRequested,
											filters: resolvedFilters.filters,
											summary: true,
										},
										options.connectionId,
									)
								: integration.getMyPullRequestsForReposResult(
										options.repos ?? [],
										{
											state: options.states,
											filters: resolvedFilters.filters,
											cursor: cursor,
											pageSize: options.itemsPerPage,
										},
										options.connectionId,
									),
						{
							warnOnMissingSession: warnOnMissingSessionForDomain(options.providerId, options.domain),
						},
					),
			},
		);
		items = drained.items;
		paged = drained.paged;
		allMetadata = drained.metadata;
		pageFetchFailed = drained.fetchFailed;
	}

	const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
	// Never advertise `hasMore` without a continuation the caller can act on. The account-wide read has no
	// page to synthesize, and neither does a host that doesn't honor a page number — see
	// {@link IntegrationService.isPageNumberAdvanceable} for which do and why absence of a declared mode
	// does NOT count as one.
	const pageAdvanceable =
		!accountWide && isPageNumberAdvanceable(providersMetadata[options.providerId]?.pullRequestsPagingMode);
	const continuation = resolveContinuation(paged, pageAdvanceable ? paged.page.currentPage + 1 : undefined);
	// A single-page provider read that couldn't confirm completeness sets `paging.truncated`; surface it
	// as a terminal `page.truncated` (not `hasMore`, which has no cursor to advance) so the caller knows
	// the page may be incomplete. Metadata incompleteness is an independent source of the same signal.
	const truncated = continuation.truncated || assessment.truncated;
	if (truncated && warnings.length === 0) {
		warnings.push(truncationWarning(options.providerId, domain, options.connectionId, 'Pull request'));
	}
	const currentAccountId = items.some(pr => pr.author != null)
		? await getCurrentAccountId(integration, options.connectionId)
		: undefined;
	return {
		// Normalize the raw provider-apis PRs to the GitLens-owned shape at the surface boundary.
		items: items.map(pr => fromProviderPullRequest(pr, integration, { currentAccountId: currentAccountId })),
		warnings: warnings,
		// The account-wide read can't take a page size, so don't echo the requested `itemsPerPage` as if it
		// had been applied — report what came back.
		page: {
			...paged.page,
			// Positional, per ProviderPageInfo.currentPage: the drain (above) already advanced `paged.page`,
			// and a caller-threaded cursor advanced the provider, so neither leaves a cursor-only read stuck
			// reporting page 1.
			currentPage: resolveCurrentPage({
				providerPage: paged.page.currentPage,
				requestedPage: page,
				suppliedCursor: options.cursor,
				pageAdvanceable: pageAdvanceable,
			}),
			itemsPerPage: accountWide ? items.length : paged.page.itemsPerPage,
			truncated: truncated || undefined,
		},
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		// A metadata failure means items are incomplete even when the read didn't throw; a thrown error with
		// no recovered value is the pre-existing failure case.
		fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
	};
}
