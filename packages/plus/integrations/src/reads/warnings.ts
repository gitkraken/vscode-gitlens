import type { IntegrationIds } from '../constants.js';
import type { IssueFilter, IssueSearchCapabilities, PullRequestFilter } from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';
import type { ProviderWarning } from '../results.js';
import type { IssueSearchCriteriaRejection } from './filters.js';

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
	| 'Issue search';

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
		`The requested account-wide issue filters (${filters.join(', ')}) are not supported by '${id}'${supported.length ? ` (supported: ${supported.join(', ')})` : ''}; skipped to avoid returning a wider result than requested.`,
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
		`The requested account-wide pull request filters (${filters.join(', ')}) are not supported by '${id}'${supported.length ? ` (supported: ${supported.join(', ')})` : ''}; skipped to avoid returning a wider result than requested.`,
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
			const expressible = supported != null ? describeIssueSearchCapabilities(supported) : '';
			message = `The requested issue search criteria (${rejection.criteria.join(', ')}) are not supported by '${id}'${expressible ? ` (supported: ${expressible})` : ''}; skipped to avoid returning a wider result than requested.`;
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
	].join(', ');
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
 * Returns `undefined` when the provider declares no ceiling, so the caller falls back to the generic wording
 * rather than reporting a limit it invented.
 */
export function issueSearchCapResultWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	totalCount: number | undefined,
): ProviderWarning | undefined {
	const limit = providersMetadata[id]?.issueSearchResultLimit;
	if (limit == null) return undefined;
	// Below the ceiling this warning would be a false claim; the caller's truncation had another cause.
	if (totalCount == null || totalCount <= limit) return undefined;

	return {
		...otherWarning(
			id,
			domain,
			connectionId,
			`Issue search matched ${totalCount} results, but '${id}' serves at most ${limit}; narrow the search to read the rest.`,
		),
		omission: {
			kind: 'provider-limit',
			// The items past the ceiling can't be fetched by anything, so never offer a "load more".
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
