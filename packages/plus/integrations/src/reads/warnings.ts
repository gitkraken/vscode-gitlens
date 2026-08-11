import type { IntegrationIds } from '../constants.js';
import type {
	IssueFilter,
	IssueSearchCapabilities,
	IssueSorting,
	PullRequestFilter,
	PullRequestSearchCapabilities,
} from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';
import type { ProviderWarning } from '../results.js';
import type { IssueSearchCriteriaRejection, PullRequestSearchCriteriaRejection } from './filters.js';
import type { UnmergeableIssueSort, UnsupportedIssueSortRejection } from './ordering.js';

/**
 * The warnings the provider facade raises on its OWN terms, as opposed to the ones derived from a caught
 * provider error ({@link toProviderWarning}) or from SDK collection metadata (`collectionMetadata.ts`).
 *
 * These are pure message builders, kept together and out of the service so a read method reads as the decision
 * it makes ("this surface doesn't apply, refuse it") rather than as the wording of the refusal, and so the same
 * refusal can't be phrased two ways in two reads.
 */

/**
 * The single builder for a provider-neutral, non-auth warning: an unsupported capability, a
 * contradictory/inexpressible request, or a read that couldn't confirm completeness. Every `kind: 'other'`
 * warning the facade raises on its own terms goes through here (directly, or via one of the named builders
 * below that pin a recurring message), so the discriminant is assigned in one place. The warnings mapped from
 * SDK collection metadata are the documented exception — `collectionMetadata.ts` builds those from the
 * structured failure/omission it is given.
 *
 * The kinds that carry a programmatic remedy — `auth`, `rate-limit`, `not-found`, `no-connection` — are derived
 * from the caught error's type instead and never come from here; see `ProviderWarningKind` and
 * {@link noConnectionWarning}.
 */
export function otherWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	message: string,
): ProviderWarning {
	return {
		providerId: id,
		domain: domain,
		connectionId: connectionId,
		message: message,
		kind: 'other',
		isAuth: false,
	};
}

/**
 * Builds a `no-connection` warning for a per-connection read that resolved neither a session nor an error: the
 * requested `connectionId` no longer resolves (deleted, or its authentication is invalid). Consumers use this
 * to tell a truly empty account apart from a broken connection.
 */
export function noConnectionWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId?: string,
): ProviderWarning {
	return {
		providerId: id,
		domain: domain,
		connectionId: connectionId,
		message:
			connectionId != null
				? `Connection '${connectionId}' for '${id}' could not be resolved (deleted or invalid authentication).`
				: `No active connection for '${id}' could be resolved.`,
		kind: 'no-connection',
		isAuth: false,
	};
}

/** Warning for an issue-tracker provider asked for a surface only a git host serves (repos, PRs, sweeps). */
export function gitHostOnlySurfaceWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	surface: string,
): ProviderWarning {
	return otherWarning(
		id,
		domain,
		connectionId,
		`${surface} is not supported by '${id}'; use a git-host integration instead.`,
	);
}

/** Warning for a git host asked for a surface only an issue tracker serves (resource → project issue reads). */
export function issueTrackerOnlySurfaceWarning(
	id: IntegrationIds,
	connectionId: string | undefined,
	surface: string,
): ProviderWarning {
	return otherWarning(
		id,
		undefined,
		connectionId,
		`${surface} is not supported by '${id}'; use an issue-tracker integration instead.`,
	);
}

/**
 * Why a read the facade drove itself returned less than everything. The two questions a consumer cannot
 * answer from `truncated` or from the message, kept together because they are decided together:
 *
 * - `interrupted`: the read did NOT succeed — the session went away, a later page failed. It leaves an unread
 *   tail like the others, but it is a failure: it sets `fetchFailed`, and a retry is exactly the right move.
 *   Gets no omission at all, since the omission asserts the opposite.
 * - `page-budget`: the drain stopped at its own `maxPages`, with a usable cursor still in hand. The items ARE
 *   reachable and were simply not fetched, so re-running with a higher budget returns them.
 * - `exhausted`: everything else that succeeded and came back short — the provider capped the page it served,
 *   advertised another page without a usable cursor (or with one it had already handed out), or a read could
 *   not confirm it had drained everything. The default of the three: choose it whenever a raisable budget is
 *   not demonstrably what stopped the read, so a consumer is never offered a fetch that cannot deliver.
 */
export type IncompleteReadCause = 'interrupted' | 'page-budget' | 'exhausted';

/**
 * Builds the warning for a read that returned less than everything, carrying the two facts a consumer cannot
 * recover on its own: did the request succeed, and would anything fetch the rest?
 *
 * Every incompleteness warning the facade raises on its own terms goes through here, so no read can drift
 * into claiming success on a failure or offering a "load more" that cannot deliver. The omission it attaches
 * is the same shape `assessCollectionMetadata` derives from SDK metadata, so a consumer never has to care
 * which layer noticed the gap.
 *
 * No `scope`: this applies to the whole read, not to one repository or project the way an SDK-attributed
 * omission can, so a consumer acting on `recovery` re-runs the read itself.
 */
export function incompleteReadWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	message: string,
	cause: IncompleteReadCause,
): ProviderWarning {
	const warning = otherWarning(id, domain, connectionId, message);
	if (cause === 'interrupted') return warning;

	return {
		...warning,
		omission: {
			kind: 'pagination-incomplete',
			recovery: cause === 'page-budget' ? 'page-budget' : 'none',
		},
	};
}

/**
 * The read surfaces {@link truncationWarning} phrases for. `'Account-wide issue search'` names the composite
 * read that spans several provider searches rather than one surface.
 *
 * Deliberately not exported: every caller passes a literal, and publishing it would invite a consumer to switch
 * on a set that exists only to word a message.
 */
type TruncatedReadKind =
	| 'Pull request'
	| 'Issue'
	| 'Repository'
	| 'Organization'
	| 'Project'
	| 'Account-wide issue search'
	| 'Issue search'
	| 'Pull request search';

/** {@link incompleteReadWarning} for a paged or drained read, phrased per surface. */
export function truncationWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	readKind: TruncatedReadKind,
	/**
	 * Deliberately REQUIRED and not defaulted: a default would make one of these the silent fallback at any
	 * call site that forgot it, and both of the claims it carries — "the request succeeded" and "more can be
	 * fetched" — are ones this warning must never make by accident.
	 */
	cause: IncompleteReadCause,
): ProviderWarning {
	return incompleteReadWarning(id, domain, connectionId, truncationMessage(id, readKind, cause), cause);
}

function truncationMessage(id: IntegrationIds, readKind: TruncatedReadKind, cause: IncompleteReadCause): string {
	switch (cause) {
		case 'interrupted':
			// Deliberately does not name a mechanism. This fires both when a page was lost mid-drain and when a
			// drain that latched an earlier scope failure later stopped for its own reasons; "was interrupted"
			// would be false in the second. What is true in both is that something failed and results are gone.
			return `${readKind} read for '${id}' did not complete; some results are missing and the read reported a failure.`;
		case 'page-budget':
			return `${readKind} read for '${id}' stopped at its page budget; more results can be read by raising it.`;
		case 'exhausted':
			return `${readKind} read for '${id}' was truncated and cannot be continued; results may be incomplete.`;
	}
	// No `default`: `IncompleteReadCause` is declared in this file, so `noImplicitReturns` already fails the
	// build here if a cause is added without its own wording. (`collectionOmissionMessage`'s `satisfies never`
	// is not the same case — that union is the SDK's, and can widen under a dependency bump.)
}

/**
 * The one sentence every "you asked for a narrowing this provider can't express" refusal uses.
 *
 * Shared because the three callers below differ only in a noun: the wording is consumer-visible, and three
 * hand-written copies drift three ways — including the `(supported: …)` clause, which exists to avoid emitting an
 * empty parenthetical and has to be the same guard in all of them.
 */
function unsupportedNarrowingMessage(id: IntegrationIds, noun: string, requested: string, supported: string): string {
	return `The requested ${noun} (${requested}) are not supported by '${id}'${supported.length > 0 ? ` (supported: ${supported})` : ''}; skipped to avoid returning a wider result than requested.`;
}

/** Warning for an account-wide issue read whose requested filters the provider can't express server-side. */
export function unsupportedAccountWideIssueFiltersWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	filters: IssueFilter[],
): ProviderWarning {
	const supported = providersMetadata[id]?.supportedAccountWideIssueFilters ?? [];
	return otherWarning(
		id,
		domain,
		connectionId,
		unsupportedNarrowingMessage(id, 'account-wide issue filters', filters.join(', '), supported.join(', ')),
	);
}

/** Warning for an account-wide PR read whose requested relationship union cannot be expressed exactly. */
export function unsupportedAccountWidePullRequestFiltersWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	filters: PullRequestFilter[],
): ProviderWarning {
	const supported = providersMetadata[id]?.supportedAccountWidePullRequestFilters ?? [];
	return otherWarning(
		id,
		domain,
		connectionId,
		unsupportedNarrowingMessage(id, 'account-wide pull request filters', filters.join(', '), supported.join(', ')),
	);
}

/** Warning for a repo-scoped PR read whose requested filters the provider supports none of. */
export function unsupportedFiltersWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
): ProviderWarning {
	return otherWarning(
		id,
		domain,
		connectionId,
		`The requested pull request filters are not supported by '${id}'; skipped to avoid returning unfiltered results.`,
	);
}

/** Warning for a filtered pull-request search the provider cannot run as requested. */
export function unsupportedPullRequestSearchCriteriaWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	rejection: PullRequestSearchCriteriaRejection,
): ProviderWarning {
	let message: string;
	switch (rejection.reason) {
		case 'unsupported-search':
			message = `Filtered pull request search is not supported by '${id}'; use \`listPullRequestsPage\` for its own pull request reads.`;
			break;
		case 'unsupported-criteria': {
			const supported = providersMetadata[id]?.supportedPullRequestSearch;
			message = unsupportedNarrowingMessage(
				id,
				'pull request search criteria',
				rejection.criteria.join(', '),
				supported != null ? describePullRequestSearchCapabilities(supported) : '',
			);
			break;
		}
	}

	return otherWarning(id, domain, connectionId, message);
}

function describePullRequestSearchCapabilities(capabilities: PullRequestSearchCapabilities): string {
	return [
		...(capabilities.relationships.length ? [`relationships:${capabilities.relationships.join('|')}`] : []),
		...(capabilities.states.length ? [`states:${capabilities.states.join('|')}`] : []),
		...(capabilities.text ? ['text'] : []),
		...(capabilities.includeArchived ? ['includeArchived'] : []),
		...(capabilities.draft ? ['draft'] : []),
		...(capabilities.repositoryScope ? ['repository scope'] : []),
		...(capabilities.organizationScope ? ['organization scope'] : []),
	].join(', ');
}

/**
 * Warning for a filtered issue search whose criteria the provider can't serve — either it has no such search at
 * all, or it can't express what was asked for, or the set contradicts itself.
 *
 * One builder for all three because they are one decision from the caller's side ("this search can't be run as
 * asked") and the remedy differs only in what the message says. The rejection shape carries which case it is, so
 * the wording can't drift from the check that produced it (see {@link resolveIssueSearchCriteria}).
 */
export function unsupportedIssueSearchCriteriaWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	rejection: IssueSearchCriteriaRejection,
): ProviderWarning {
	let message: string;
	switch (rejection.reason) {
		case 'unsupported-search':
			message = `Filtered issue search is not supported by '${id}'; use \`listIssuesPage\` for its own issue reads.`;
			break;
		case 'unsupported-criteria': {
			const supported = providersMetadata[id]?.supportedIssueSearch;
			message = unsupportedNarrowingMessage(
				id,
				'issue search criteria',
				rejection.criteria.join(', '),
				supported != null ? describeIssueSearchCapabilities(supported) : '',
			);
			break;
		}
		case 'contradictory-relationships':
			message = `The relationships \`any-assignee\` and \`unassigned\` are contradictory — they partition the scope between them, so no issue satisfies both; pass only one.`;
			break;
	}
	// No `default`: the union is declared alongside the validator, so `noImplicitReturns` fails the build here if
	// a rejection reason is added without its own wording.

	return otherWarning(id, domain, connectionId, message);
}

/** The criteria a provider CAN express, for the "supported: …" half of a refusal message. */
function describeIssueSearchCapabilities(capabilities: IssueSearchCapabilities): string {
	const flags: [name: string, supported: boolean][] = [
		['text', capabilities.text],
		['labels', capabilities.labels],
		['milestone', capabilities.milestone],
		['updatedAfter', capabilities.updatedAfter],
		['createdAfter', capabilities.createdAfter],
		['withoutLinkedPullRequest', capabilities.withoutLinkedPullRequest],
		['state', capabilities.states],
	];
	return [
		...capabilities.relationships.map(r => `relationships:${r}`),
		...flags.filter(([, supported]) => supported).map(([name]) => name),
		...capabilities.sorts.map(s => `sort:${s}`),
	].join(', ');
}

/**
 * Warning for an issue read asked to order by a key its provider can't express server-side.
 *
 * Separate from {@link unsupportedIssueSearchCriteriaWarning} because it serves the reads that take `sort` as an
 * OPTION rather than as a criterion — repo-scoped, account-wide, and issue-tracker — where there is no criteria
 * set to fold it into. The filtered search keeps reporting it as one more `unsupported-criteria` entry, so a
 * caller there still gets a single refusal listing everything at once.
 *
 * Takes the rejection the check produced rather than a re-read supported list: which of the two tables applies is
 * the caller's own branch (`repos` present or not), so reading it back here — or threading it by hand — would be
 * free to disagree with the check that refused.
 */
export function unsupportedIssueSortWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	rejection: UnsupportedIssueSortRejection,
): ProviderWarning {
	return otherWarning(
		id,
		domain,
		connectionId,
		unsupportedNarrowingMessage(id, 'issue sort', rejection.requested, (rejection.supported ?? []).join(', ')),
	);
}

/**
 * Warning for a merged issue read asked to order by a key that no normalized issue carries.
 *
 * The distinction this exists to make is not about the provider: the provider orders by `priority` perfectly well
 * within ONE project. It is about the read, which fans out over several and merges the results here, where the
 * only fields available are the ones {@link IssueShape} models. Serving the concatenated per-scope runs would look
 * ordered without being so, which is why this refuses instead — and why the message says WHY, since the same key
 * against the same provider succeeds on a single-scope read.
 *
 * What a read fans out OVER differs by read, hence the `scope`: repositories, projects, or — where one query is
 * issued per requested relationship and the runs are unioned within a single project (Jira) — the filters
 * themselves. Naming the wrong one would tell a caller to narrow something that isn't what merged.
 */
export function unmergeableIssueSortWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	unmergeable: UnmergeableIssueSort,
	scope: 'repositories' | 'projects' | 'filters',
): ProviderWarning {
	// Both forms are spelled out rather than depluralized at runtime: the message needs each, and
	// `'repositories'.replace(/s$/, '')` is `'repositorie'`.
	const nouns = {
		repositories: { many: 'repositories', one: 'repository' },
		projects: { many: 'projects', one: 'project' },
		filters: { many: 'issue relationships', one: 'relationship' },
	}[scope];
	return otherWarning(
		id,
		domain,
		connectionId,
		`Cannot order by '${unmergeable.requested}' across several ${nouns.many}: this read merges their results, and a normalized issue carries no such field to merge on. Read one ${nouns.one} at a time, or order by a date, title, comment or reaction count.`,
	);
}

/**
 * The omission for a filtered issue search that hit the provider's RESULT CEILING: more issues matched than the
 * provider will ever serve for one query, however it is paged.
 *
 * Distinct from {@link truncationWarning} because this is the one incompleteness this read can quantify —
 * `totalCount` is how many matched, `limit` how many are reachable — which is what lets a consumer say "19.240
 * matched, showing the 1.000 most recently updated" instead of a bare "results may be incomplete". `recovery:
 * 'none'` because the items past the ceiling are UNREACHABLE, not merely unfetched: no budget, no retry, and no
 * cursor would return them. Narrowing the criteria is the only way through, which is a decision for the caller.
 *
 * The message names the ORDER, and has to now that ordering is an option: the reachable window is the top `limit`
 * under that key, so "the 1.000 most recent" is a true sentence only while the key is the default one. The same
 * value goes on the omission, so a consumer wording its own sentence doesn't have to remember what it asked for.
 *
 * Returns `undefined` when the provider declares no ceiling, so the caller falls back to the generic wording
 * rather than reporting a limit it invented.
 */
export function issueSearchCapResultWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	totalCount: number | undefined,
	sort: IssueSorting,
): ProviderWarning | undefined {
	const limit = providersMetadata[id]?.issueSearchResultLimit;
	if (limit == null) return undefined;
	// Below the ceiling this warning would be a false claim; the caller's truncation had another cause.
	if (totalCount == null || totalCount <= limit) return undefined;

	const [field, direction] = sort.split(':');
	return {
		...otherWarning(
			id,
			domain,
			connectionId,
			`Issue search matched ${totalCount} results, but '${id}' serves at most ${limit}, ordered by ${field} ${direction}ending; narrow the search to read the rest.`,
		),
		omission: {
			kind: 'provider-limit',
			// The items past the ceiling can't be fetched by anything, so never offer a "load more".
			recovery: 'none',
			limit: limit,
			totalCount: totalCount,
			sort: sort,
		},
	};
}

/** Quantified omission for a pull-request search that exceeded the provider's reachable result window. */
export function pullRequestSearchCapResultWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	totalCount: number | undefined,
): ProviderWarning | undefined {
	const limit = providersMetadata[id]?.pullRequestSearchResultLimit;
	if (limit == null || totalCount == null || totalCount <= limit) return undefined;

	return {
		...otherWarning(
			id,
			domain,
			connectionId,
			`Pull request search matched ${totalCount} results, but '${id}' serves at most ${limit}; narrow the search to read the rest.`,
		),
		omission: {
			kind: 'provider-limit',
			recovery: 'none',
			limit: limit,
			totalCount: totalCount,
		},
	};
}

/** Warning for a git host that doesn't expose issues on this surface (e.g. Bitbucket, deprecated in favor of Jira). */
export function issuesUnsupportedWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
): ProviderWarning {
	return otherWarning(
		id,
		domain,
		connectionId,
		`Issues are not supported by '${id}'; use a dedicated issue integration (e.g. Jira) instead.`,
	);
}
