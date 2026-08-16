import type { IssueShape, IssueSorting } from '@gitlens/git/models/issue.js';
import { mergeAssessmentInto } from '../collectionMetadata.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IssueFilter, ProviderReposInput } from '../providers/models.js';
import { isRepoIdsInput, PagingMode, providersMetadata } from '../providers/models.js';
import { mergeCollectionMetadata } from '../providers/utils/providerPaging.js';
import type { ProviderPagedResult, ProviderWarning } from '../results.js';
import { reconcileOmissionsWithFailure } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { resolveAccountWideIssueFilters } from './filters.js';
import { resolveIssueSort, toIssueOrdering } from './ordering.js';
import {
	drainFlatPagesToRequestedPage,
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
	unmergeableIssueSortWarning,
	unsupportedAccountWideIssueFiltersWarning,
	unsupportedIssueSortWarning,
} from './warnings.js';

/**
 * Whether a repo-scoped page is assembled from SEVERAL provider queries and merged here — which is what decides
 * whether the requested order can be honored at all.
 *
 * `PagingMode.Repos` (GitHub) sends one search however many repositories are named, so its page arrives ordered by
 * the provider. `Repo` (GitLab) issues one query per repository, and `Project` (Azure) one per PROJECT — several
 * repositories of the same project are still one query, which is why that case counts distinct projects rather than
 * repositories.
 *
 * The `Repo` case has a second way to merge that has nothing to do with the count: given repository IDS rather than
 * descriptors, `getMyIssuesForReposResult` skips its per-repository fan-out entirely (that branch is guarded on
 * `!isRepoIdsInput`) and calls the SDK's `getIssuesForRepos`, which for GitLab is the multi-project aggregate that
 * merges in the SDK and refuses `priority`/`dueDate` however few scopes it was given. Treating that as merged is
 * what makes this facade refuse it up front, with the message that names the reason, instead of letting the SDK
 * reject a read the capability table had just promised.
 */
function mergesProviderQueries(pagingMode: PagingMode | undefined, repos: ProviderReposInput | undefined): boolean {
	const scopes = repos ?? [];
	switch (pagingMode) {
		case PagingMode.Repo:
			// `isRepoIdsInput` is the same predicate `ProvidersApi` selects the SDK aggregate with, so this cannot
			// disagree with the branch it is predicting.
			return isRepoIdsInput(scopes) ? scopes.length > 0 : scopes.length > 1;
		case PagingMode.Project:
			// Only the descriptor form carries a project; the id form is refused by the Azure read before it runs.
			return new Set(scopes.map(r => (typeof r === 'object' ? r.project : undefined))).size > 1;
		default:
			return false;
	}
}

/**
 * What {@link listIssuesPage} accepts, shared by name with the two functions it dispatches to.
 *
 * Named rather than left inline: three functions now take this exact shape, and reaching it from the other two as
 * `Parameters<typeof listIssuesPage>[1]` would define the contract in terms of the function that consumes it —
 * inside out, and unreadable at the point where the fields are actually used.
 */
export interface ListIssuesPageOptions {
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
	/**
	 * How to order the page, as `field:direction`. Omitted orders most-recently-updated-first wherever the
	 * provider can express that, which is this facade's default rather than the provider's own.
	 *
	 * Validated against `getSupportedFilters().issueSorts` on the repo-scoped path and `.issueSortsAccountWide`
	 * on the account-wide one — two genuinely different vocabularies for GitLab, whose two reads are different
	 * APIs. A key the provider can't express refuses the read (warning + `fetchFailed`) rather than serving a
	 * differently-ordered list, for the same reason an inexpressible filter does: the reachable window is
	 * bounded, so another order is another subset.
	 *
	 * On the repo-scoped path with SEVERAL scopes the page is a merge of one query per repository/project, so
	 * only a key a normalized issue carries can be honored: `priority`, `dueDate` and `resolved` are refused
	 * there even where the provider supports them on a single scope. Order is per page, and per scope across
	 * pages — the merge orders what a page contains, not the sequence of pages.
	 */
	sort?: IssueSorting;
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
}

/**
 * What both halves of {@link listIssuesPage} need from its shared prologue.
 *
 * A bundle rather than six parameters because the two reads take exactly the same inputs and differ only in what
 * they do with them; threading them positionally would make the two call sites read as two different reads of two
 * different things, which is the opposite of what is true.
 *
 * Note `ctx` is absent: every use of it — resolving the integration, the domain, the forced refresh, the
 * connection warnings — is in the prologue, which is what makes this the right cut.
 */
interface IssueReadContext {
	options: ListIssuesPageOptions;
	integration: GitHostIntegration;
	domain: string | undefined;
	warnOnMissingSession: boolean;
	page: number;
}

export async function listIssuesPage(
	ctx: ProviderReadContext,
	options: ListIssuesPageOptions,
): Promise<ProviderPagedResult<IssueShape>> {
	// Truncated as well as floored, like every other paged read here: `page` is reported back as
	// `page.currentPage` and compared against the position a drain reached, and neither can be fractional.
	const page = Math.max(1, Math.trunc(options.page ?? 1));
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

	// `repos` is what selects between the two: with none there is no scope to query per repository, so the
	// provider's own account-wide search answers instead. They are different provider queries with different
	// capability tables, cursors and completeness signals — see each function.
	const context: IssueReadContext = {
		options: options,
		integration: integration,
		domain: domain,
		warnOnMissingSession: warnOnMissingSession,
		page: page,
	};
	return (options.repos?.length ?? 0) === 0 ? readAccountWideIssuesPage(context) : readRepoScopedIssuesPage(context);
}

/**
 * The account-wide read: the provider's own definition of "my issues", behind a composite cursor that spans
 * several provider searches.
 *
 * Its own function rather than a branch of the paged read, because almost nothing is shared past the guards: it
 * validates a different filter table and a different sort table, it is cursor-only (a page number cannot address
 * a composite cursor), it accumulates per-scope failures across the pages it walks, and it always merges several
 * queries. The two used to share one 460-line function behind a mode flag, and the comments explaining how far
 * apart they are were the clue that they wanted separating.
 */
async function readAccountWideIssuesPage({
	options,
	integration,
	domain,
	warnOnMissingSession,
	page,
}: IssueReadContext): Promise<ProviderPagedResult<IssueShape>> {
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

	// GitHub expresses "any assignee" as `assignee:*`, which is meaningless without a scope: unscoped it
	// matches millions of issues across all of GitHub instead of the user's own world. ANY scope makes it
	// meaningful (one repository, several, or an org) — it is specifically THIS branch, the account-wide read,
	// that has none to offer. Scope the read to repositories (or use `searchIssuesPage`, whose criteria model
	// takes `any-assignee` alongside a `repos`/`org` scope) rather than reading unscoped.
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

	// Every provider's account-wide read is a UNION of several queries — GitHub's three `@me` searches,
	// GitLab's one REST call per relationship, Azure's (project x relationship) drains — so it always merges,
	// and `supportedAccountWideIssueSorts` already lists only keys a merge can honor. No separate
	// mergeability refusal is needed here, unlike on the repo-scoped path below.
	const resolvedSort = resolveIssueSort(
		providersMetadata[options.providerId]?.supportedAccountWideIssueSorts,
		options.sort,
	);
	if (resolvedSort.rejection != null) {
		return refused(
			unsupportedIssueSortWarning(options.providerId, domain, options.connectionId, resolvedSort.rejection),
		);
	}

	// `merged: true` unconditionally: this read has no scope count for a caller to reduce. It is also why no
	// `unmergeable` check follows — `supportedAccountWideIssueSorts` declares only keys a merge can honor.
	const accountWideOrdering = toIssueOrdering(resolvedSort.sort, true);

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
					sort: accountWideOrdering.sort,
				}),
			{ warnOnMissingSession: warnOnMissingSession },
		);
	const first = await readAccountWidePage(options.cursor);
	const warnings = first.warning != null ? [first.warning] : [];
	// Merged across the walked pages, so a per-scope failure reported on an earlier page isn't lost by
	// paging past it — the one thing this read accumulates that the filtered search doesn't.
	let allMetadata = first.value?.metadata;
	const drained = await drainFlatPagesToRequestedPage(first, {
		requestedPage: page,
		suppliedCursor: options.cursor,
		warnings: warnings,
		readPage: readAccountWidePage,
		fold: p => {
			allMetadata = mergeCollectionMetadata(allMetadata, p.metadata);
		},
	});
	const { value, currentPage, requestedPageMissing } = drained;
	const currentTruncated = drained.truncated;
	const pageFetchFailed = drained.fetchFailed;

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
	// Each query arrived ordered by the provider; their union is not, and the union is what this read publishes.
	// Idempotent for GitHub, whose aliased-search engine already ordered the same merge — one call here rather
	// than the same logic repeated in each of the three provider implementations.
	const orderedItems = accountWideOrdering.order(items);
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
			truncationWarning(
				options.providerId,
				domain,
				options.connectionId,
				'Account-wide issue search',
				// `exhausted`: this composite read exposes no budget the caller can raise, so nothing it
				// could call would return the withheld items.
				assessment.fetchFailed || pageFetchFailed ? 'interrupted' : 'exhausted',
			),
		);
	}
	// A metadata omission from an earlier page asserts the read succeeded; a later page may since have failed.
	reconcileOmissionsWithFailure(warnings, assessment.fetchFailed || pageFetchFailed);
	return {
		items: orderedItems,
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
			itemsPerPage: orderedItems.length,
			truncated: truncated || undefined,
		},
		hasMore: continuation.hasMore,
		cursor: continuation.cursor,
		fetchFailed: assessment.fetchFailed || pageFetchFailed || undefined,
	};
}

/**
 * The repository-scoped read: one provider query per repository or project, paged by the provider's own
 * continuation and drained internally when the caller supplied only a page number.
 *
 * See {@link readAccountWideIssuesPage} for why the two are separate functions.
 */
async function readRepoScopedIssuesPage({
	options,
	integration,
	domain,
	warnOnMissingSession,
	page,
}: IssueReadContext): Promise<ProviderPagedResult<IssueShape>> {
	const metadata = providersMetadata[options.providerId];

	// How many separate provider queries this page is assembled from, which decides whether the requested order can
	// be honored at all. `PagingMode.Repos` (GitHub) sends ONE search however many repositories are named, so its
	// page arrives ordered by the provider; `Repo` (GitLab) and `Project` (Azure) issue one query per scope and are
	// concatenated here, so a page spanning several of them is only as orderable as a normalized issue is.
	const resolvedRepoScopedSort = resolveIssueSort(metadata?.supportedIssueSorts, options.sort);
	if (resolvedRepoScopedSort.rejection != null) {
		return refusedPage(
			page,
			[
				unsupportedIssueSortWarning(
					options.providerId,
					domain,
					options.connectionId,
					resolvedRepoScopedSort.rejection,
				),
			],
			true,
		);
	}

	const issuesPagingMode = metadata?.issuesPagingMode;
	const ordering = toIssueOrdering(
		resolvedRepoScopedSort.sort,
		mergesProviderQueries(issuesPagingMode, options.repos),
	);
	// Refused rather than served as concatenated per-scope runs, which would look ordered without being so — and
	// only where it actually merges, since the same key against the same provider is perfectly answerable for a
	// single repository or project.
	if (ordering.unmergeable != null) {
		return refusedPage(
			page,
			[
				unmergeableIssueSortWarning(
					options.providerId,
					domain,
					options.connectionId,
					ordering.unmergeable,
					issuesPagingMode === PagingMode.Project ? 'projects' : 'repositories',
				),
			],
			true,
		);
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
					// The normalized `page`, so the number forwarded to the provider can't disagree with the
					// page-number cursor beside it — both are built from the same value. Only when the caller asked
					// for one: an omitted page is the provider's own first page.
					page: options.page != null ? page : undefined,
					pageSize: options.itemsPerPage,
					sort: ordering.sort,
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
		issuesPagingMode === PagingMode.Repos &&
		options.page != null &&
		page > 1 &&
		options.cursor == null &&
		paged.page.currentPage === 1
	) {
		const drained = await drainToRequestedPage(
			{ items: items, paged: paged, metadata: allMetadata, fetchFailed: pageFetchFailed },
			{
				requestedPage: page,
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
									sort: ordering.sort,
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

	// Ordered once the drain (above) has assembled whichever pages this position spans.
	items = ordering.order(items);

	// Convert the SDK collection metadata into scope-aware warnings + failure/truncation flags, appending
	// them to any captured thrown-error warning without discarding the partial result's items.
	const assessment = mergeAssessmentInto(warnings, options.providerId, domain, options.connectionId, allMetadata);
	// Never advertise `hasMore` without a continuation the caller can act on, and only synthesize a page
	// number for a host that reads it as one (see `isPageNumberAdvanceable`).
	const issuesPageAdvanceable = isPageNumberAdvanceable(issuesPagingMode);
	const continuation = resolveContinuation(paged, issuesPageAdvanceable ? paged.page.currentPage + 1 : undefined);
	// A provider read that couldn't confirm completeness (e.g. Bitbucket's single-page repo issue read
	// that dropped a repo) sets `paging.truncated`; surface it as a terminal `page.truncated` so a partial
	// page isn't published as complete. Metadata incompleteness is an independent source of the same signal.
	const truncated = continuation.truncated || assessment.truncated;
	if (truncated && warnings.length === 0) {
		warnings.push(
			truncationWarning(
				options.providerId,
				domain,
				options.connectionId,
				'Issue',
				// `exhausted`, never `page-budget`: a paged read has no budget the caller can raise, and
				// ordinary continuation is already expressed by `hasMore`/`cursor`.
				assessment.fetchFailed || pageFetchFailed ? 'interrupted' : 'exhausted',
			),
		);
	}
	// A metadata omission from an earlier page asserts the read succeeded; a later page may since have failed.
	reconcileOmissionsWithFailure(warnings, assessment.fetchFailed || pageFetchFailed);
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
