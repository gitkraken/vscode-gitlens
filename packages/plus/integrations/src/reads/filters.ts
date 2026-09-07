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
	if (criteria.updatedAfter != null && !supported.updatedAfter) {
		unsupported.push('updatedAfter');
	}
	if (criteria.createdAfter != null && !supported.createdAfter) {
		unsupported.push('createdAfter');
	}
	if (criteria.includeArchived === true && !supported.includeArchived) {
		unsupported.push('includeArchived');
	}
	// `!= null`, not truthy: `draft: false` (only ready-for-review) is as much a request as `draft: true`.
	if (criteria.draft != null && !supported.draft) {
		unsupported.push('draft');
	}
	// Folded into the same `unsupported-criteria` rejection rather than its own reason, so a caller asking for one
	// inexpressible filter and one inexpressible sort learns about both at once. `updated:desc` is always in
	// `sorts` for a usable search, so the omitted (default) case never rejects.
	if (criteria.sort != null && !supported.sorts.includes(criteria.sort)) {
		unsupported.push(`sort:${criteria.sort}`);
	}

	return unsupported.length > 0 ? { rejection: { reason: 'unsupported-criteria', criteria: unsupported } } : {};
}

/** Why a filtered pull-request search's repository/organization boundary was refused. */
export type PullRequestSearchScopeRejection =
	| { reason: 'unscoped' }
	| { reason: 'repo-ids' }
	| { reason: 'unsupported-repository-scope' }
	| { reason: 'unsupported-organization-scope' }
	/** Scope names a query cannot carry AS GIVEN; see {@link unusableSearchScopeNames}. */
	| { reason: 'unusable-scope'; scopes: string[] };

/**
 * Validates the search boundary independently from its criteria. A current-user relationship is itself a safe
 * account-wide boundary; without one, a repository or organization scope is mandatory.
 *
 * Scope names go through the same {@link unusableSearchScopeNames} rule the issue search uses — shared rather
 * than re-derived, because the defect is identical on both reads.
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
		if (repos.some(r => typeof r === 'string' || typeof r === 'number')) {
			return { rejection: { reason: 'repo-ids' } };
		}
		if (supported?.repositoryScope !== true) return { rejection: { reason: 'unsupported-repository-scope' } };

		resolvedRepos = repos as ProviderRepoInput[];
	}

	const hasOrganizationScope = org != null && org.length > 0;
	if (hasOrganizationScope && supported?.organizationScope !== true) {
		return { rejection: { reason: 'unsupported-organization-scope' } };
	}

	// After the capability checks and before the "is it scoped at all" rule: a scope the provider cannot express
	// at all is the more fundamental refusal, and an unusable value that WAS supplied must not be reported as a
	// missing one. `org` is passed bare, matching the issue twin — the helper applies its own empty-means-
	// unsupplied guard, so re-testing `hasOrganizationScope` here would only make the two resolvers look like
	// they differ.
	const unusable = unusableSearchScopeNames(org, resolvedRepos);
	if (unusable.length > 0) return { rejection: { reason: 'unusable-scope', scopes: unusable } };

	if (resolvedRepos != null || hasOrganizationScope || (criteria?.relationships?.length ?? 0) > 0) {
		return { repos: resolvedRepos };
	}

	return { rejection: { reason: 'unscoped' } };
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
 * Whether a provider exposes the FILTERED issue search at all — the one predicate a caller can check BEFORE
 * building criteria, so a read that would only be refused is never issued.
 *
 * The same test {@link resolveIssueSearchCriteria} makes for its `unsupported-search` rejection, named rather
 * than re-derived at each call site: a caller writing `supportedIssueSearch != null` itself is a copy free to
 * disagree with the validator about what "has a search" means. `broadenIssues` reads it to pick its engine —
 * the org-scoped search where there is one, the repository drain where there isn't — which is a CHOICE rather
 * than a refusal, so it needs the predicate without the rejection.
 */
export function supportsFilteredIssueSearch(id: IntegrationIds): boolean {
	return providersMetadata[id]?.supportedIssueSearch != null;
}

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
	updatedAfter: false,
	createdAfter: false,
	includeArchived: false,
	draft: false,
	repositoryScope: false,
	organizationScope: false,
	sorts: [],
};

/** Why a filtered issue search's scope was refused, or `undefined` when it is usable. */
export type IssueSearchScopeRejection =
	/** No repositories, no org, and no user-relative relationship: a search of the whole host. */
	| { reason: 'unscoped' }
	/** Repositories given as ids. A search names repositories by PATH, so ids can't express a scope. */
	| { reason: 'repo-ids' }
	/** Scope names a query cannot carry AS GIVEN; see {@link unusableSearchScopeNames}. */
	| { reason: 'unusable-scope'; scopes: string[] };

/**
 * Whether a scope name reaches the provider NAMING THE SAME SCOPE — the one rule behind every `unusable-scope`
 * refusal, and the canonical home for its reasoning: the call sites point here rather than restating it.
 *
 * The defect it exists to prevent: the boundary is checked against the value AS SUPPLIED while the request is
 * built from the value AFTER the provider sanitizes it, so a name a query cannot spell produces a read that is no
 * longer the read that was authorized. Three outcomes, all of which LOOK LIKE SUCCESS, so there is nothing for a
 * consumer to branch on:
 * - **emptied** — a value of only quotes/whitespace/control characters emits no scope qualifier at all. A scope is
 *   also what makes a relationship-less read legal, so the request carries neither and every item on the host
 *   matches: measured at 52 million issues across unrelated accounts.
 * - **altered** — a quote inside a real name sanitizes to a real but DIFFERENT scope (`git"kraken` -> `gitkraken`),
 *   whose answer looks entirely normal.
 * - **split** — whitespace delimits qualifiers, so `my org` emits `org:my org`: a search of `my` additionally
 *   filtered by the free text `org`. Measured against the live API this is a wrong NARROWING rather than a
 *   widening — `org:gitkraken bar` returns 12 where `org:gitkraken` returns 379.
 *
 * Refusing beats sanitizing, and the count probes are why it matters most: they deliberately apply exactly the
 * qualifiers their search would, so a sanitized scope makes the count AGREE with the wrong search rather than
 * disagree with it, and a consumer cross-checking "N matched" cannot detect it by construction. Nor can it
 * pre-empt the rule — the free-text sanitizing rules are published precisely so a caller can mirror them, the
 * scope rules are not — so only the caller knows which scope it meant, and the refusal goes back to it NAMING the
 * offending value.
 *
 * Provider-NEUTRAL by design, and deliberately not an import of GitHub's `sanitizeGitHubQualifierValue`: this
 * module validates for every provider, and a GitHub-specific rule reaching in here would be wrong for the next
 * one that declares a search. Only GitHub and GHE declare one today, so the character class below is GitHub's in
 * practice; it is stated as the common part of any query language because each class breaks a query on its own
 * terms — a quote closes its own qualifier, a control character cannot appear at all, whitespace delimits the
 * next qualifier — but a provider whose names legitimately carry one (Azure DevOps project names can contain
 * spaces) needs its own rule alongside its `supported*Search` capability rather than an exception here.
 *
 * EDGES ARE STRIPPED before the test, which is what keeps the predicate no stricter than the provider's own
 * sanitizing — the invariant that makes refusing safe to add, since it means this can only reject a name the
 * provider would have altered, never one it would have resolved correctly. Leading and trailing whitespace AND
 * control characters both qualify: a sanitizer maps a control character to a space, then collapses and trims, so
 * `'gitkraken\n'` and `'gitkraken\u0000'` alike emit `org:gitkraken` — the scope that was asked for. Note this
 * is wider than `String.trim()`, which leaves control characters in place.
 *
 * None of the three outcomes above survives the stripping, so the rule loses nothing: an all-edge value still
 * empties, an INNER space or control character still splits (`'git\u0000kraken'` emits `git kraken`, two
 * tokens), and a quote still alters wherever it sits.
 */
function isUsableSearchScopeName(name: string): boolean {
	const stripped = stripSearchScopeEdges(name);
	// eslint-disable-next-line no-control-regex
	return stripped.length > 0 && !/["\u0000-\u001f\u007f\s]/.test(stripped);
}

/** The leading/trailing run a provider's sanitizing removes — see {@link isUsableSearchScopeName}. */
function stripSearchScopeEdges(value: string): string {
	// eslint-disable-next-line no-control-regex
	return value.replace(/^[\s\u0000-\u001f\u007f]+|[\s\u0000-\u001f\u007f]+$/g, '');
}

/**
 * The scope names a search cannot carry as given, as the strings to name in the refusal — empty when every one is
 * usable. See {@link isUsableSearchScopeName} for the rule and why it refuses rather than sanitizes.
 */
function unusableSearchScopeNames(org: string | undefined, repos: readonly ProviderRepoInput[] | undefined): string[] {
	const unusable: string[] = [];

	// An EMPTY org is "no org supplied" and falls through to the remaining scopes; any other unusable value WAS
	// supplied, so it is refused rather than dropped.
	if (org != null && org.length > 0 && !isUsableSearchScopeName(org)) {
		unusable.push(org);
	}

	// A `repo:` qualifier names a repository by its JOINED `namespace/name` path, which is the value the rule
	// below is applied to. Both halves are read defensively, through the SAME locals the label is built from: the
	// descriptor form is only narrowed from a union by an element-type check, so a half-built descriptor reaches
	// here as `undefined` and must refuse rather than throw out of a facade that reports refusals as warnings —
	// and reporting it as `undefined/a` would name a value the caller never passed.
	for (const repo of repos ?? []) {
		const namespace = repo.namespace ?? '';
		const name = repo.name ?? '';
		const path = `${namespace}/${name}`;
		// BOTH the composite and each half, because neither sees what the other does:
		// - the composite catches an offender the halves cannot, since an edge of a half is an INTERIOR character
		//   of the path — `{ 'git ', 'kraken' }` has two usable-looking halves and emits `repo:git /kraken`.
		// - the halves catch a BLANK one the composite cannot, since that offender sits at a composite EDGE where
		//   stripping removes it — `' /a'` strips to `'/a'`, a perfectly spellable qualifier naming no repository.
		// Each half is measured after the same stripping, so `' '` and `''` are one case rather than two.
		if (
			!isUsableSearchScopeName(path) ||
			stripSearchScopeEdges(namespace).length === 0 ||
			stripSearchScopeEdges(name).length === 0
		) {
			unusable.push(path);
		}
	}

	return unusable;
}

/**
 * Validates that a filtered issue search is scoped at all, and narrows `repos` to the descriptor form the
 * provider query needs.
 *
 * Shared by `searchIssuesPage` and `countIssues` because a count computed under different constraints than the
 * read it previews is a WRONG number rather than a missing one. The rejection is returned as a reason code, not a
 * warning: the two callers word it differently (whole-read vs naming the offending scope's key), and wording is
 * the warning layer's business.
 *
 * `repo-ids` and `unscoped` are mutually exclusive — one requires repositories and the other requires none — so
 * their relative order is free. `unusable-scope` is NOT: it must precede `unscoped`, so a value that was supplied
 * but cannot be used is never reported as a missing one.
 *
 * Every scope name is checked for naming the same scope after the provider sanitizes it, not merely for being
 * non-empty, and that distinction is a SECURITY one rather than a nicety — see {@link isUsableSearchScopeName}.
 */
export function resolveIssueSearchScope(
	repos: ProviderReposInput | undefined,
	org: string | undefined,
	criteria: IssueSearchCriteria | undefined,
): { rejection?: IssueSearchScopeRejection; repos?: ProviderRepoInput[] } {
	let resolvedRepos: ProviderRepoInput[] | undefined;

	if (repos?.length) {
		// `ProviderReposInput` is a union of descriptor and id arrays; only the descriptor form is usable here.
		if (repos.some(r => typeof r === 'string' || typeof r === 'number')) {
			return { rejection: { reason: 'repo-ids' } };
		}

		resolvedRepos = repos as ProviderRepoInput[];
	}

	// Checked BEFORE the "is it scoped at all" rule below, so an unusable value is never reported as a missing
	// one: it was supplied, and telling the caller to pass a scope it already passed names the wrong defect.
	const unusable = unusableSearchScopeNames(org, resolvedRepos);
	if (unusable.length > 0) return { rejection: { reason: 'unusable-scope', scopes: unusable } };

	if (resolvedRepos != null) return { repos: resolvedRepos };
	if (org != null && org.length > 0) return {};
	if (criteria?.relationships?.some(r => userScopingIssueSearchRelationships.includes(r)) === true) return {};

	return { rejection: { reason: 'unscoped' } };
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
			// Copied, so mutating the result can't corrupt the metadata table.
			sorts: [...(pullRequestSearch?.sorts ?? [])],
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
