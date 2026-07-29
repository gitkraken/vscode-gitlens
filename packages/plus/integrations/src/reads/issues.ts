import type { IssueShape } from '@gitlens/git/models/issue.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId, type IntegrationIds } from '../constants.js';
import { IssueFilter, PagingMode, providersMetadata, type ProviderReposInput } from '../providers/models.js';
import { mergeCollectionMetadata } from '../providers/utils/providerPaging.js';
import type { ProviderPagedResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { resolveAccountWideIssueFilters } from './filters.js';
import {
	drainToRequestedPage,
	isPageNumberAdvanceable,
	pageToCursor,
	refusedPage,
	resolveContinuation,
	resolveCurrentPage,
	toProviderPageInfo,
	usableCursor,
} from './paging.js';
import {
	gitHostOnlySurfaceWarning,
	issuesUnsupportedWarning,
	otherWarning,
	truncationWarning,
	unsupportedAccountWideIssueFiltersWarning,
} from './warnings.js';

export async function listIssuesPage(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		repos?: ProviderReposInput;
		/** Narrows the account-wide read to one org/account. Requires a host with a project layer (Azure). */
		org?: string;
		/** Narrows the account-wide read to one project. Requires a host with a project layer (Azure). */
		project?: string;
		/**
		 * Narrows to the requested relationship(s). On the account-wide path this replaces the provider's own
		 * definition of "my issues" (GitHub/GHE: authored ∪ assigned ∪ mentioned; Azure: assigned ∪ authored;
		 * GitLab: assigned-to-me), so `[Assignee]` yields `assignee:@me` everywhere it's expressible. A set the
		 * provider can't express server-side is refused whole (warning + `fetchFailed`), never widened — check
		 * getSupportedFilters first to avoid that path.
		 */
		filters?: IssueFilter[];
		/** Broadens the read to every assignee. Contradicts `filters`; passing both is refused. */
		includeAllAssignees?: boolean;
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
	const page = Math.max(1, options.page ?? 1);
	if (isIssuesHostIntegrationId(options.providerId)) {
		return refusedPage(
			page,
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'repository issue reads')],
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
			[gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'repository issue reads')],
			true,
		);
	}

	await ctx.forceRefreshIfRequested(integration, options.forceSync, options.connectionId);

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	// A git host whose issue tracker is deprecated (Bitbucket, superseded by dedicated issue integrations)
	// reports issues as explicitly unsupported rather than serving a partial/legacy source or a silent empty.
	if (!integration.supportsIssues) {
		return refusedPage(page, [issuesUnsupportedWarning(options.providerId, domain, options.connectionId)], true);
	}

	const accountWide = (options.repos?.length ?? 0) === 0;

	if (accountWide) {
		// The account-wide read is cursor-only, so a refusal can't claim the requested position — it reports
		// page 1, per ProviderPageInfo.currentPage.
		const refused = (warning: ProviderWarning) => refusedPage<IssueShape>(1, [warning], true);

		// Checked before the provider-specific guards below: a caller passing both has a contradictory request
		// whatever the provider, and saying so is more useful than reporting one half of it as unsupported.
		// `filters` narrows this read to a relationship (`[Assignee]` ⇒ just assigned-to-me); `includeAllAssignees`
		// broadens it to every assignee. Honoring either silently would answer a question the caller didn't ask.
		if (options.filters?.length && options.includeAllAssignees === true) {
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'`filters` and `includeAllAssignees` are contradictory for an account-wide issue read; pass only one.',
				),
			);
		}

		if (
			options.includeAllAssignees === true &&
			(options.providerId === GitCloudHostIntegrationId.GitHub ||
				options.providerId === GitSelfManagedHostIntegrationId.CloudGitHubEnterprise)
		) {
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					'`includeAllAssignees` is not supported for account-wide GitHub issue reads; scope the read to repositories instead.',
				),
			);
		}

		// Only a host with a project layer can narrow server-side. Reject the request rather than serving an
		// unscoped list as if it had been narrowed: the caller would otherwise have to filter client-side,
		// which desynchronizes the filtered `items` from this read's `hasMore`/`currentPage` and shows
		// "no issues" for a page that simply held none of the requested project's.
		if ((options.org != null || options.project != null) && !integration.supportsProjectDiscovery) {
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`Project-scoped issue reads are not supported by '${options.providerId}'; scope the read to repositories instead.`,
				),
			);
		}

		// Narrowing the account-wide read is only honest when the provider can express it server-side: its
		// per-relationship queries produced the page and the cursor together, so dropping items afterward would
		// leave `items` describing a different result set than `hasMore`/`currentPage`.
		const resolvedIssueFilters = resolveAccountWideIssueFilters(options.providerId, options.filters);
		if (resolvedIssueFilters.unsupported) {
			return refused(
				unsupportedAccountWideIssueFiltersWarning(
					options.providerId,
					domain,
					options.connectionId,
					options.filters!,
				),
			);
		}

		// The repo-scoped core rejects empty repos (GitHub/Bitbucket/Azure); read the account-wide,
		// already-user-scoped core instead. GitHub exposes a composite cursor across its authored,
		// assigned, and mentioned searches. Walk it internally when the caller supplies only page N.
		const readAccountWidePage = (cursor: string | undefined) =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() =>
					integration.searchMyIssuesWithTruncationResult(undefined, undefined, options.connectionId, {
						includeAllAssignees: options.includeAllAssignees,
						filters: resolvedIssueFilters.filters,
						cursor: cursor,
						org: options.org,
						project: options.project,
					}),
				{ warnOnMissingSession: warnOnMissingSession },
			);
		const first = await readAccountWidePage(options.cursor);
		let value = first.value;
		const warnings = first.warning != null ? [first.warning] : [];
		let allMetadata = value?.metadata;
		let pageFetchFailed = first.warning != null && value == null;
		let currentPage = value?.page ?? 1;
		let currentTruncated = value?.truncated ?? false;
		let requestedPageMissing = false;
		if (options.cursor == null && page > 1 && value != null) {
			// Guard against the empty-cursor sentinel: a provider that claims another page without handing
			// back a usable cursor would otherwise be re-read with `'{}'` and answer with page 1 again.
			for (
				let nextCursor = usableCursor(value.cursor);
				currentPage < page && value.hasMore && nextCursor != null;
				nextCursor = usableCursor(value.cursor)
			) {
				const next = await readAccountWidePage(nextCursor);
				if (next.warning != null) {
					appendDedupedWarning(warnings, next.warning);
				}
				if (next.value == null) {
					pageFetchFailed = pageFetchFailed || next.warning != null;
					value = undefined;
					requestedPageMissing = true;
					break;
				}

				value = next.value;
				allMetadata = mergeCollectionMetadata(allMetadata, value.metadata);
				currentTruncated = currentTruncated || value.truncated;
				currentPage = value.page ?? currentPage + 1;
				// A provider that hands back the same cursor isn't advancing; stop rather than loop forever.
				if (usableCursor(value.cursor) === nextCursor) {
					currentTruncated = true;
					break;
				}
			}

			// A numbered page beyond the provider's terminal cursor is genuinely empty. Never return or
			// relabel the last available page as the requested one.
			if (currentPage < page) {
				requestedPageMissing = true;
			}
		} else if (options.cursor == null && page > 1) {
			requestedPageMissing = true;
		}

		// GitHub, GitLab, and Azure implement an account-wide issue search; a provider that doesn't (Bitbucket
		// exposes no issues at all, and `supportsIssues` already short-circuits it above) returns `undefined`
		// with no error. Surface that as an explicit unsupported warning + fetchFailed rather than a silent
		// empty success — the caller must fall back (e.g. broadenIssues over repos).
		if (value == null && warnings.length === 0) {
			return refused(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`Account-wide issue search is not supported by '${options.providerId}'; scope the read to repositories instead.`,
				),
			);
		}

		const items = requestedPageMissing ? [] : (value?.values ?? []);
		// Fold in structured per-scope failures from the account-wide fan-out (e.g. Azure across projects):
		// scope-aware warnings + `fetchFailed` when a scope failed, without discarding the successful items.
		const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
		// An account-wide search that couldn't confirm completeness (a provider cap with no cursor, or a
		// per-scope backstop/failure) is incomplete and can't be paged; report it as truncated (+ a
		// provider-neutral warning, unless a structured failure already explains it) rather than a complete
		// list. Don't hard-code GitHub's "100 per category" cap here — Azure reaches this via a per-project
		// backstop, and other providers may cap differently.
		// The account-wide read is cursor-only (its composite cursor spans several provider searches, so a
		// page number can't address it): `hasMore` without a real cursor is a dead end, so report it as
		// terminal-but-incomplete rather than inviting the caller to page forever.
		const continuation = resolveContinuation(
			{
				hasMore: requestedPageMissing ? false : (value?.hasMore ?? false),
				cursor: requestedPageMissing ? undefined : usableCursor(value?.cursor),
				truncated: currentTruncated,
			},
			undefined,
		);
		const truncated = continuation.truncated || assessment.truncated;
		if (truncated && warnings.length === 0) {
			warnings.push(
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`Account-wide issue search for '${options.providerId}' was truncated; results may be incomplete.`,
				),
			);
		}
		return {
			items: items,
			warnings: warnings,
			page: {
				// Positional, per ProviderPageInfo.currentPage. `currentPage` already carries what the provider
				// reported or what the internal drain counted; a requested page past the terminal cursor is
				// reported as that empty page N. The account-wide read is cursor-only, so a `page` the caller
				// didn't pair with a cursor is never echoed.
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
			fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
		};
	}

	const cursor = options.cursor ?? pageToCursor(page);
	const { value, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			// The shapes seam returns normalized IssueShape, and is overridable by a provider whose only issue
			// client already yields shapes (serving this path without a raw ProviderIssue round-trip).
			integration.getMyIssuesForReposAsShapesResult(
				options.repos ?? [],
				// Forward `page`/`pageSize` alongside the cursor so PagingMode.Repo/Project hosts honor the
				// requested page and page size rather than ignoring a synthesized page-number cursor.
				{
					filters: options.filters,
					includeAllAssignees: options.includeAllAssignees,
					cursor: cursor,
					page: options.page,
					pageSize: options.itemsPerPage,
				},
				options.connectionId,
			),
		{ warnOnMissingSession: warnOnMissingSession },
	);

	let items = value?.values ?? [];
	const warnings = warning != null ? [warning] : [];
	let pageFetchFailed = warning != null && value == null;
	let paged = toProviderPageInfo(options.itemsPerPage ?? items.length, value?.paging);
	let allMetadata = value?.metadata;

	// Cursor-only repo-scoped hosts (e.g. GitHub) ignore a synthesized page-number cursor, so a page-only
	// request is advanced through the provider's own continuations (see drainToRequestedPage).
	if (
		providersMetadata[options.providerId]?.issuesPagingMode === PagingMode.Repos &&
		options.page != null &&
		options.page > 1 &&
		options.cursor == null &&
		paged.page.currentPage === 1
	) {
		const drained = await drainToRequestedPage(
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
							integration.getMyIssuesForReposAsShapesResult(
								options.repos ?? [],
								{
									filters: options.filters,
									includeAllAssignees: options.includeAllAssignees,
									cursor: cursor,
									pageSize: options.itemsPerPage,
								},
								options.connectionId,
							),
						{ warnOnMissingSession: warnOnMissingSession },
					),
			},
		);
		items = drained.items;
		paged = drained.paged;
		allMetadata = drained.metadata;
		pageFetchFailed = drained.fetchFailed;
	}

	// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
	// them to any captured thrown-error warning without discarding the partial result's items.
	const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
	// Never advertise `hasMore` without a continuation the caller can act on, and only synthesize a page
	// number for a host that reads it as one (see `isPageNumberAdvanceable`).
	const issuesPageAdvanceable = isPageNumberAdvanceable(providersMetadata[options.providerId]?.issuesPagingMode);
	const continuation = resolveContinuation(paged, issuesPageAdvanceable ? paged.page.currentPage + 1 : undefined);
	// A provider read that couldn't confirm completeness (e.g. Bitbucket's single-page repo issue read
	// that dropped a repo) sets `paging.truncated`; surface it as a terminal `page.truncated` so a partial
	// page isn't published as complete. Metadata incompleteness is an independent source of the same signal.
	const truncated = continuation.truncated || assessment.truncated;
	if (truncated && warnings.length === 0) {
		warnings.push(truncationWarning(options.providerId, domain, options.connectionId, 'Issue'));
	}
	return {
		items: items,
		warnings: warnings,
		page: {
			...paged.page,
			// Positional, per ProviderPageInfo.currentPage: the drain (above) already advanced `paged.page` for
			// a cursor-only host, and a caller-threaded cursor advanced the provider without one.
			currentPage: resolveCurrentPage({
				providerPage: paged.page.currentPage,
				requestedPage: page,
				suppliedCursor: options.cursor,
				pageAdvanceable: issuesPageAdvanceable,
			}),
			truncated: truncated || undefined,
		},
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
	};
}
