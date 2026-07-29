import type { IntegrationIds } from '../constants.js';
import type { IssueFilter, PullRequestFilter } from '../providerFilters.js';
import { providersMetadata } from '../providers/models.js';
import type { ProviderWarning } from '../results.js';

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
 * warning the facade emits goes through here (directly, or via one of the named builders below that pin a
 * recurring message), so the discriminant is assigned in exactly one place.
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
 * Builds a warning for a drain that stopped short of completeness (hit a page backstop, or a single-page read
 * that couldn't confirm it drained everything). `truncated`/`allPages` already carry this on the result, but
 * consumers that only inspect `warnings` would otherwise see no signal the read is partial.
 */
export function truncationWarning(
	id: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	readKind: 'Pull request' | 'Issue' | 'Repository',
): ProviderWarning {
	return otherWarning(
		id,
		domain,
		connectionId,
		`${readKind} read for '${id}' was truncated (a page backstop was reached); results may be incomplete.`,
	);
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
