import type { IntegrationIds } from '../constants.js';
import type { IssueFilter, PullRequestFilter } from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';

/**
 * Validation of a caller-supplied relationship filter set against what a provider can express server-side.
 *
 * Every one of these is ALL-OR-NOTHING, and deliberately so: dropping the members a provider can't express
 * would silently widen the read past what was asked for (requesting Author+Mention on a host without Mention
 * would return every authored item rather than the requested set), and narrowing the returned page afterward
 * would leave `items` describing a different result set than the `hasMore`/`cursor` the provider produced with
 * it. So an inexpressible set is refused whole, and the caller surfaces a warning instead of reading unfiltered.
 *
 * The three differ only in WHICH capability they check, because they govern three different provider queries —
 * see `IntegrationManager.getSupportedFilters`, which exposes the same capability table so a consumer can
 * intersect against it and never reach a refusal.
 */
export interface ResolvedFilters<T> {
	filters?: T[];
	unsupported: boolean;
}

/**
 * Validates a repo-scoped PR filter set, so an unsupported filter never trips the read core's "Unsupported
 * filters" guard. `unsupported: true` when the caller DID request filters and the provider can't express even
 * ONE of them — the exact negation of the read core's `providerSupportsPullRequestFilters` (`every`), so this
 * can only ever pre-empt that guard, never disagree with it.
 *
 * Returns `{ filters }` (possibly undefined when none were requested — an unfiltered read is intended). Genuine
 * "my pull requests" self-scoping is delivered by the account-wide path
 * (`GitHostIntegration.getMyPullRequestsForUserResult`); this only governs the optional repo-scoped narrowing.
 */
export function resolvePullRequestFilters(
	id: IntegrationIds,
	filters: PullRequestFilter[] | undefined,
): ResolvedFilters<PullRequestFilter> {
	if (filters == null || filters.length === 0) return { unsupported: false };

	const supported = providersMetadata[id]?.supportedPullRequestFilters;
	if (supported == null || filters.some(f => !supported.includes(f))) return { unsupported: true };

	return { filters: filters, unsupported: false };
}

/**
 * Validates an account-wide PR relationship union independently from the repo-scoped capability. Dropping an
 * unsupported member would change the requested OR set, so validation is all-or-nothing.
 */
export function resolveAccountWidePullRequestFilters(
	id: IntegrationIds,
	filters: PullRequestFilter[] | undefined,
): ResolvedFilters<PullRequestFilter> {
	if (filters == null || filters.length === 0) return { unsupported: false };

	const supported = providersMetadata[id]?.supportedAccountWidePullRequestFilters;
	if (supported == null || filters.some(f => !supported.includes(f))) return { unsupported: true };

	return { filters: [...new Set(filters)], unsupported: false };
}

/**
 * Validates a caller-provided issue filter set against what the provider's ACCOUNT-WIDE issue read can express
 * server-side (`ProviderMetadata.supportedAccountWideIssueFilters`), which is a different — usually narrower —
 * set than the repo-scoped `ProviderMetadata.supportedIssueFilters`.
 *
 * Dropping the unexpressible members would silently widen the read back toward the provider's own union
 * (authored ∪ assigned ∪ mentioned for GitHub), which is the opposite of what a caller narrowing to
 * `[Assignee]` asked for.
 */
export function resolveAccountWideIssueFilters(
	id: IntegrationIds,
	filters: IssueFilter[] | undefined,
): ResolvedFilters<IssueFilter> {
	if (filters == null || filters.length === 0) return { unsupported: false };

	const supported = providersMetadata[id]?.supportedAccountWideIssueFilters;
	if (supported == null || filters.some(f => !supported.includes(f))) return { unsupported: true };

	return { filters: filters, unsupported: false };
}

/**
 * The filters `listPullRequestsPage`/`listIssuesPage` (and the sweeps) accept for a provider, so a caller can
 * narrow to what the provider can express BEFORE issuing the read.
 *
 * This matters because the filter contract is all-or-nothing: a set containing even one unsupported filter is
 * refused outright ({@link resolvePullRequestFilters}) rather than silently narrowed, since falling through to
 * an unfiltered fetch would return every PR instead of the user's. Without this accessor a consumer had to
 * hardcode its own copy of the table — reachable only by importing the internal `providers/models.js`
 * subpath — and a copy that drifts turns a supported read into an empty page with `fetchFailed`.
 *
 * Empty means "no filter of that kind is expressible": either the provider has no such surface (issue trackers
 * have no pull requests; Bitbucket exposes no issues) or its metadata declares none. Callers should treat it as
 * "don't pass filters", not as an error. Returns copies, so mutating the result can't corrupt the metadata.
 *
 * `issues` and `issuesAccountWide` are separate because the repo-scoped and account-wide issue reads are
 * different provider queries with different filter surfaces, and the same `filters` input is validated against
 * whichever one the read uses (`repos` present or not). `issuesAccountWide` is generally the narrower of the
 * two: GitLab, for instance, can express `Assignee` and `Author` account-wide, but not `Mention`.
 *
 * That split describes the GIT-HOST reads only. An issue tracker (Jira/Linear/Trello) has neither — its issues
 * live under resource → project — so it reports its filters under `issues`, which is what
 * {@link IntegrationService.listIssueTrackerIssuesPage} validates against, and leaves `issuesAccountWide`
 * empty. Reading a tracker's capability off `issuesAccountWide` therefore under-reports it.
 *
 * Note this is a CAPABILITY table — "what the provider can express" — not a recommendation. A consumer
 * matching another tool's behavior may deliberately pass fewer filters than are listed here (or none, where an
 * already-scoped read would only be narrowed by them). Intersecting against this table is what keeps a
 * filtered read from being refused; it isn't a directive to use every filter in it.
 */
export function getSupportedFilters(providerId: IntegrationIds): {
	pullRequests: PullRequestFilter[];
	pullRequestsAccountWide: PullRequestFilter[];
	issues: IssueFilter[];
	issuesAccountWide: IssueFilter[];
} {
	const metadata = providersMetadata[providerId];
	return {
		pullRequests: [...(metadata?.supportedPullRequestFilters ?? [])],
		pullRequestsAccountWide: [...(metadata?.supportedAccountWidePullRequestFilters ?? [])],
		issues: [...(metadata?.supportedIssueFilters ?? [])],
		issuesAccountWide: [...(metadata?.supportedAccountWideIssueFilters ?? [])],
	};
}
