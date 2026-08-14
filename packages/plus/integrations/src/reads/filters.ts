import type { IntegrationIds } from '../constants.js';
import type {
	IssueFilter,
	IssueSearchCapabilities,
	IssueSearchCriteria,
	IssueSearchRelationship,
	IssueSorting,
	PullRequestFilter,
	PullRequestSearchCapabilities,
	PullRequestSearchCriteria,
} from '../providerFilters.js';
import type { ProviderRepoInput, ProviderReposInput } from '../providers/models.js';
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

/** Why {@link resolvePullRequestSearchCriteria} refused a criteria set. */
export type PullRequestSearchCriteriaRejection =
	/** The provider has no filtered pull-request search. */
	| { reason: 'unsupported-search' }
	/** The provider has one, but cannot express every requested criterion server-side. */
	| { reason: 'unsupported-criteria'; criteria: string[] };

/**
 * Validates filtered pull-request search criteria all-or-nothing. Dropping an unsupported criterion would
 * widen the provider query while leaving its page and cursor describing the wider set, so the facade refuses the
 * request before any upstream call instead.
 */
export function resolvePullRequestSearchCriteria(
	id: IntegrationIds,
	criteria: PullRequestSearchCriteria | undefined,
): { rejection?: PullRequestSearchCriteriaRejection } {
	const supported = providersMetadata[id]?.supportedPullRequestSearch;
	if (supported == null || supported.relationships.length === 0) {
		return { rejection: { reason: 'unsupported-search' } };
	}
	if (criteria == null) return {};

	const unsupported: string[] = [];
	for (const relationship of criteria.relationships ?? []) {
		if (!supported.relationships.includes(relationship)) {
			unsupported.push(`relationships:${relationship}`);
		}
	}
	for (const state of criteria.states ?? []) {
		if (!supported.states.includes(state)) {
			unsupported.push(`states:${state}`);
		}
	}
	if (criteria.text != null && criteria.text.trim().length > 0 && !supported.text) {
		unsupported.push('text');
	}
	if (criteria.includeArchived === true && !supported.includeArchived) {
		unsupported.push('includeArchived');
	}
	// `!= null`, not truthy: `draft: false` (only ready-for-review) is as much a request as `draft: true`.
	if (criteria.draft != null && !supported.draft) {
		unsupported.push('draft');
	}

	return unsupported.length > 0 ? { rejection: { reason: 'unsupported-criteria', criteria: unsupported } } : {};
}

/** Why a filtered pull-request search's repository/organization boundary was refused. */
export type PullRequestSearchScopeRejection =
	| 'unscoped'
	| 'repo-ids'
	| 'unsupported-repository-scope'
	| 'unsupported-organization-scope';

/**
 * Validates the search boundary independently from its criteria. A current-user relationship is itself a safe
 * account-wide boundary; without one, a repository or organization scope is mandatory.
 */
export function resolvePullRequestSearchScope(
	id: IntegrationIds,
	repos: ProviderReposInput | undefined,
	org: string | undefined,
	criteria: PullRequestSearchCriteria | undefined,
): { rejection?: PullRequestSearchScopeRejection; repos?: ProviderRepoInput[] } {
	const supported = providersMetadata[id]?.supportedPullRequestSearch;
	let resolvedRepos: ProviderRepoInput[] | undefined;

	if (repos?.length) {
		if (repos.some(r => typeof r === 'string' || typeof r === 'number')) return { rejection: 'repo-ids' };
		if (supported?.repositoryScope !== true) return { rejection: 'unsupported-repository-scope' };

		resolvedRepos = repos as ProviderRepoInput[];
	}

	const hasOrganizationScope = org != null && org.length > 0;
	if (hasOrganizationScope && supported?.organizationScope !== true) {
		return { rejection: 'unsupported-organization-scope' };
	}

	if (resolvedRepos != null || hasOrganizationScope || (criteria?.relationships?.length ?? 0) > 0) {
		return { repos: resolvedRepos };
	}

	return { rejection: 'unscoped' };
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

/** Why {@link resolveIssueSearchCriteria} refused a criteria set, so the caller can word the refusal exactly. */
export type IssueSearchCriteriaRejection =
	/** The provider has no filtered issue search at all. */
	| { reason: 'unsupported-search' }
	/** The provider has one, but can't express these criteria server-side. */
	| { reason: 'unsupported-criteria'; criteria: string[] }
	/** `any-assignee` and `unassigned` partition the scope between them; asking for both asks for nothing. */
	| { reason: 'contradictory-relationships' };

/**
 * Validates a filtered issue search's criteria against {@link ProviderMetadata.supportedIssueSearch}.
 *
 * All-or-nothing like its three siblings above, and for the same reason: a criterion dropped because the
 * provider can't express it would serve a WIDER result than was asked for, and narrowing the returned page
 * afterward would leave `items` describing a different result set than the `hasMore`/`cursor` the provider
 * produced with it. So an inexpressible set is refused whole and the caller surfaces a warning.
 *
 * Unlike the sibling validators this also rejects a set that is internally contradictory, because this criteria
 * model is the only one with two members that partition the scope between them (`any-assignee` ∪ `unassigned` =
 * everything, ∩ = nothing). Silently keeping one would answer a question the caller didn't ask.
 *
 * `undefined` (or an empty relationship list plus no other criterion) is a valid UNNARROWED search of the given
 * scope, not an error — the caller's `repos`/`org` is what bounds it.
 */
export function resolveIssueSearchCriteria(
	id: IntegrationIds,
	criteria: IssueSearchCriteria | undefined,
): { rejection?: IssueSearchCriteriaRejection } {
	const supported = providersMetadata[id]?.supportedIssueSearch;
	if (supported == null) return { rejection: { reason: 'unsupported-search' } };
	if (criteria == null) return {};

	const relationships = criteria.relationships;
	if (relationships?.includes('any-assignee') && relationships.includes('unassigned')) {
		return { rejection: { reason: 'contradictory-relationships' } };
	}

	const unsupported: string[] = [];
	for (const relationship of relationships ?? []) {
		if (!supported.relationships.includes(relationship)) {
			unsupported.push(`relationships:${relationship}`);
		}
	}
	// Only a criterion the caller actually SET can be unsupported. `false`/empty means "don't narrow on this",
	// which every provider can honor by doing nothing, so it must not be validated as a request.
	if (criteria.text != null && criteria.text.trim().length > 0 && !supported.text) {
		unsupported.push('text');
	}
	if (criteria.labels?.length && !supported.labels) {
		unsupported.push('labels');
	}
	if (criteria.milestone != null && !supported.milestone) {
		unsupported.push('milestone');
	}
	if (criteria.updatedAfter != null && !supported.updatedAfter) {
		unsupported.push('updatedAfter');
	}
	if (criteria.createdAfter != null && !supported.createdAfter) {
		unsupported.push('createdAfter');
	}
	if (criteria.withoutLinkedPullRequest === true && !supported.withoutLinkedPullRequest) {
		unsupported.push('withoutLinkedPullRequest');
	}
	// `'open'` is every provider's own default, so asking for it needs no state capability.
	if (criteria.state != null && criteria.state !== 'open' && !supported.states) {
		unsupported.push('state');
	}
	// Folded into the same `unsupported-criteria` rejection rather than given its own reason, so a caller asking
	// for one inexpressible filter and one inexpressible sort learns about both at once instead of fixing them one
	// refusal at a time. The `sorts` list is `supported`'s own, so this needs no branch on which surface it is.
	if (criteria.sort != null && !supported.sorts.includes(criteria.sort)) {
		unsupported.push(`sort:${criteria.sort}`);
	}

	if (unsupported.length > 0) return { rejection: { reason: 'unsupported-criteria', criteria: unsupported } };

	return {};
}

/**
 * The relationships that bound a filtered issue search to the CURRENT USER, and so can stand in for a
 * repository/org scope.
 *
 * Derived from the union rather than spelled out per call site, because the distinction it encodes is the whole
 * reason the scope rule exists: `any-assignee` and `unassigned` are deliberately absent — they describe the
 * ISSUE, not the caller, so neither reduces the search to anyone's own world (measured: unscoped `no:assignee`
 * matches ~45 million issues on GitHub).
 */
const userScopingIssueSearchRelationships: readonly IssueSearchRelationship[] = ['authored', 'assigned', 'mentioned'];

/** What a provider with NO filtered issue search reports: nothing expressible, spelled out rather than absent. */
const unsupportedIssueSearchCapabilities: IssueSearchCapabilities = {
	relationships: [],
	text: false,
	labels: false,
	milestone: false,
	updatedAfter: false,
	createdAfter: false,
	withoutLinkedPullRequest: false,
	states: false,
	sorts: [],
};

/** What a provider with no filtered pull-request search reports. */
const unsupportedPullRequestSearchCapabilities: PullRequestSearchCapabilities = {
	relationships: [],
	states: [],
	text: false,
	includeArchived: false,
	draft: false,
	repositoryScope: false,
	organizationScope: false,
};

/** Why a filtered issue search's scope was refused, or `undefined` when it is usable. */
export type IssueSearchScopeRejection =
	/** No repositories, no org, and no user-relative relationship: a search of the whole host. */
	| 'unscoped'
	/** Repositories given as ids. A search names repositories by PATH, so ids can't express a scope. */
	| 'repo-ids';

/**
 * Validates that a filtered issue search is scoped at all, and narrows `repos` to the descriptor form the
 * provider query needs.
 *
 * Shared by `searchIssuesPage` and `countIssues` because a count computed under different constraints than the
 * read it previews is a WRONG number rather than a missing one. The rejection is returned as a reason code, not a
 * warning: the two callers word it differently (whole-read vs naming the offending scope's key), and wording is
 * the warning layer's business.
 *
 * The two rejections are mutually exclusive — `repo-ids` requires repositories and `unscoped` requires none — so
 * the order they're checked in cannot change the outcome.
 */
export function resolveIssueSearchScope(
	repos: ProviderReposInput | undefined,
	org: string | undefined,
	criteria: IssueSearchCriteria | undefined,
): { rejection?: IssueSearchScopeRejection; repos?: ProviderRepoInput[] } {
	if (repos?.length) {
		// `ProviderReposInput` is a union of descriptor and id arrays; only the descriptor form is usable here.
		if (repos.some(r => typeof r === 'string' || typeof r === 'number')) return { rejection: 'repo-ids' };

		return { repos: repos as ProviderRepoInput[] };
	}

	if (org != null && org.length > 0) return {};
	if (criteria?.relationships?.some(r => userScopingIssueSearchRelationships.includes(r)) === true) return {};

	return { rejection: 'unscoped' };
}

/**
 * What {@link getSupportedFilters} reports: every vocabulary a provider's reads can express, so a consumer can
 * narrow to it BEFORE issuing a read. See that function for the capability table itself and why intersecting
 * against this is what keeps a filtered read from being refused.
 *
 * Named rather than written inline, because the same shape is the declared return type of THREE declarations that
 * all describe one value — this function, `IntegrationService.getSupportedFilters`, which only forwards to it, and
 * `IntegrationManager.getSupportedFilters`, which publishes it. Spelled out three times, a member added here
 * reached one of them and left the others a compile error away from the truth; that is exactly how the two sort
 * members below came to be written out three times.
 */
export type SupportedFilters = {
	pullRequests: PullRequestFilter[];
	pullRequestsAccountWide: PullRequestFilter[];
	/**
	 * Criteria and scopes the filtered pull-request search can express. Always present; an empty relationship list
	 * means the provider exposes no filtered pull-request search.
	 */
	pullRequestSearch: PullRequestSearchCapabilities;
	/**
	 * Filters the repo-scoped issue read accepts — and, for an issue tracker (Jira/Linear/Trello), its
	 * project-scoped read, that being its only issue surface. A tracker therefore reports here and leaves
	 * `issuesAccountWide` empty, so intersecting a tracker against that field would read "cannot filter" for a
	 * provider that filters fine.
	 */
	issues: IssueFilter[];
	issuesAccountWide: IssueFilter[];
	/**
	 * What the filtered issue search (and the count probe over the same criteria) can express. Always present: a
	 * provider with no filtered issue search reports an empty `relationships` and all-false flags, which is the
	 * signal to hide that surface rather than to hide individual chips.
	 */
	issueSearch: IssueSearchCapabilities;
	/**
	 * Sort keys the repo-scoped issue read can express — and, for an issue tracker, its project-scoped read. Empty
	 * means the read can't be ordered, so pass no `sort`.
	 *
	 * A key here is expressible on ONE provider query. A page spanning several repositories or projects is a merge,
	 * and a merge can only order by what a normalized issue carries, so `priority`/`dueDate`/`resolved` are refused
	 * there even where they are listed. Read one scope at a time to use them.
	 */
	issueSorts: IssueSorting[];
	/**
	 * Sort keys the account-wide issue read can express — a different vocabulary, not a subset: for GitLab the two
	 * reads are different APIs. Needs no mergeability caveat, because every account-wide read is a union of several
	 * queries, so only keys a merge can honor are listed at all. Empty for an issue tracker, which reports under
	 * `issueSorts`.
	 */
	issueSortsAccountWide: IssueSorting[];
};

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
 * `issueSearch` is a third, wider surface: the FILTERED issue search (`searchIssuesPage`, and the `countIssues`
 * probe over the same criteria), which is not bound to the user at all. It is a record of per-criterion flags
 * rather than a list, because its criteria aren't a single kind. An empty `relationships` means the provider has
 * no filtered issue search — hide the surface, not just its chips.
 *
 * `pullRequestSearch` describes the separate filtered PR search. Its table declares each criteria vocabulary
 * plus repository/organization scope support; an empty relationship list means the search itself is absent.
 *
 * `issueSorts` / `issueSortsAccountWide` / `issueSearch.sorts` are the ORDERING vocabulary of those same three
 * issue reads, split the same way and for the same reason (GitLab's repo-scoped read is GraphQL and its
 * account-wide read is REST, with genuinely different sort vocabularies). Empty means the read can't be ordered,
 * so pass no `sort`; a key not listed refuses the whole read exactly like an inexpressible filter. Note a key
 * listed here is expressible on ONE provider query: a read that fans out across projects can only honor a key
 * derivable from a normalized issue, so it refuses `priority`/`dueDate`/`resolved` on top of this table.
 *
 * Note this is a CAPABILITY table — "what the provider can express" — not a recommendation. A consumer
 * matching another tool's behavior may deliberately pass fewer filters than are listed here (or none, where an
 * already-scoped read would only be narrowed by them). Intersecting against this table is what keeps a
 * filtered read from being refused; it isn't a directive to use every filter in it.
 */
export function getSupportedFilters(providerId: IntegrationIds): SupportedFilters {
	const metadata = providersMetadata[providerId];
	const issueSearch = metadata?.supportedIssueSearch;
	const pullRequestSearch = metadata?.supportedPullRequestSearch;
	return {
		pullRequests: [...(metadata?.supportedPullRequestFilters ?? [])],
		pullRequestsAccountWide: [...(metadata?.supportedAccountWidePullRequestFilters ?? [])],
		pullRequestSearch: {
			...unsupportedPullRequestSearchCapabilities,
			...pullRequestSearch,
			relationships: [...(pullRequestSearch?.relationships ?? [])],
			states: [...(pullRequestSearch?.states ?? [])],
		},
		issues: [...(metadata?.supportedIssueFilters ?? [])],
		issuesAccountWide: [...(metadata?.supportedAccountWideIssueFilters ?? [])],
		// Always an object, never `undefined`: a provider WITHOUT a filtered issue search reports one whose
		// `relationships` is empty and whose flags are all false, so a consumer reads capabilities the same way
		// for every provider (and an empty `relationships` is the signal to hide the surface itself).
		//
		// Spread over the all-false baseline rather than defaulting each flag: a criterion added to
		// `IssueSearchCapabilities` then can't be forgotten here and silently reported as `undefined` (which a
		// consumer's `if (caps.x)` would read as unsupported — right answer, wrong reason, and untyped).
		// `supportedIssueSearch` is typed as the complete shape, so no member can arrive as an explicit undefined.
		issueSearch: {
			...unsupportedIssueSearchCapabilities,
			...issueSearch,
			// Copied, so mutating the result can't corrupt the metadata table.
			relationships: [...(issueSearch?.relationships ?? [])],
			sorts: [...(issueSearch?.sorts ?? [])],
		},
		issueSorts: [...(metadata?.supportedIssueSorts ?? [])],
		issueSortsAccountWide: [...(metadata?.supportedAccountWideIssueSorts ?? [])],
	};
}
