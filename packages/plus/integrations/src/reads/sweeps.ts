import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type { ClosedPullRequestSweepOptions, PullRequestSweepOptions } from '../manager.js';
import { fromProviderPullRequest } from '../providers/models.js';
import type { ProviderSweepResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { drainPullRequests, getCurrentAccountId, resolvePullRequestSweepTargets } from './drains.js';
import { resolveAccountWidePullRequestFilters, resolvePullRequestFilters } from './filters.js';
import {
	gitHostOnlySurfaceWarning,
	noConnectionWarning,
	unsupportedAccountWidePullRequestFiltersWarning,
	unsupportedFiltersWarning,
} from './warnings.js';

/**
 * The all-pages pull request reads: one drain per provider target, aggregated into a single sweep result.
 *
 * A sweep exposes no continuation of its own — it drains everything it can reach — so its whole contract lives in
 * the completeness signals it returns: `page.allPages` asserts every page of every target was read,
 * `page.truncated` says pages remain unread, and `failedProviderIds`/`incompleteProviderIds` separate a provider
 * that produced nothing from one that produced a slice with a gap. That split is why the aggregation below can't
 * be collapsed into the generic fan-out merge the hierarchy reads use.
 */

/** One provider target's drained slice, before the cross-provider aggregation. */
interface SweepSlice {
	items: PullRequestShape[];
	warnings: ProviderWarning[];
	fetchFailed: boolean;
	truncated: boolean;
	providerId: IntegrationIds;
	failedProvider: boolean;
}

export async function sweepPullRequests(
	ctx: ProviderReadContext,
	options?: PullRequestSweepOptions,
): Promise<ProviderSweepResult<PullRequestShape>> {
	const { targets, attributeUnavailableProviders } = resolvePullRequestSweepTargets(options);
	const maxPages = options?.maxPages ?? 100;
	const repos = options?.repos ?? [];

	const results = await mapBounded(targets, providerFanOutConcurrency, async target => {
		const { providerId: id, connectionId, domain: requestedDomain } = target;
		/** A target that never reached a drain: the provider itself failed, so its slice is empty and attributed. */
		const rejectedTarget = (warnings: ProviderWarning[]): SweepSlice => ({
			items: [],
			warnings: warnings,
			fetchFailed: true,
			truncated: false,
			providerId: id,
			failedProvider: true,
		});

		if (isIssuesHostIntegrationId(id)) {
			return rejectedTarget([
				gitHostOnlySurfaceWarning(id, requestedDomain, connectionId, 'pull request sweeps'),
			]);
		}

		const integration = await ctx.getIntegrationForRead(id, connectionId, requestedDomain);
		if (integration == null) {
			// A requested connection that can't be resolved is a broken connection — surface it as a
			// warning + fetchFailed rather than dropping the provider's slice silently.
			const early = ctx.earlyReturnConnectionWarnings(id, connectionId, requestedDomain);
			if (early.warnings.length === 0 && !attributeUnavailableProviders) return undefined;

			return rejectedTarget(
				early.warnings.length !== 0 ? early.warnings : [noConnectionWarning(id, requestedDomain, connectionId)],
			);
		}
		if (!isGitHostIntegration(integration)) {
			return rejectedTarget([
				gitHostOnlySurfaceWarning(id, requestedDomain, connectionId, 'pull request sweeps'),
			]);
		}

		await ctx.forceRefreshIfRequested(integration, options?.forceSync, connectionId);

		const domain = ctx.domainForRead(integration, id, connectionId, requestedDomain);
		const accountWide = repos.length === 0;
		const requestedFilters = target.filters ?? options?.filters;
		const resolved = accountWide
			? resolveAccountWidePullRequestFilters(id, requestedFilters)
			: resolvePullRequestFilters(id, requestedFilters);
		if (resolved.unsupported) {
			return rejectedTarget([
				accountWide
					? unsupportedAccountWidePullRequestFiltersWarning(id, domain, connectionId, requestedFilters ?? [])
					: unsupportedFiltersWarning(id, domain, connectionId),
			]);
		}

		const drain = await drainPullRequests(
			integration,
			id,
			domain,
			repos,
			options?.states,
			resolved.filters,
			accountWide ? (options?.includeReviewRequested ?? false) : false,
			accountWide ? (options?.includeReviews ?? false) : false,
			connectionId,
			maxPages,
			attributeUnavailableProviders,
		);
		const currentAccountId = drain.items.some(pr => pr.author != null)
			? await getCurrentAccountId(integration, connectionId)
			: undefined;
		// Normalize the raw provider-apis PRs to the GitLens-owned shape here, where the per-provider
		// `integration` (the mapper's provider reference) is in scope; the aggregation below only sees drains.
		return {
			...drain,
			items: drain.items.map(pr =>
				fromProviderPullRequest(pr, integration, { currentAccountId: currentAccountId }),
			),
			providerId: id,
		};
	});

	const items: PullRequestShape[] = [];
	const warnings: ProviderWarning[] = [];
	const failedProviderIds = new Set<IntegrationIds>();
	const incompleteProviderIds = new Set<IntegrationIds>();
	let fetchFailed = false;
	let truncated = false;
	for (const drain of results) {
		if (drain == null) {
			continue;
		}

		items.push(...drain.items);
		for (const w of drain.warnings) {
			appendDedupedWarning(warnings, w);
		}
		if (drain.fetchFailed) {
			fetchFailed = true;
		}
		if (drain.failedProvider) {
			failedProviderIds.add(drain.providerId);
		} else if (drain.fetchFailed || drain.truncated) {
			incompleteProviderIds.add(drain.providerId);
		}
		if (drain.truncated) {
			truncated = true;
		}
	}

	return {
		items: items,
		warnings: warnings,
		// `allPages` asserts completeness — it must be false when any provider truncated (a single-page
		// account-wide read that couldn't confirm it drained everything) OR a drain aborted on a read
		// failure (its slice is incomplete). Either way the sweep did not read every page.
		page: {
			currentPage: 1,
			itemsPerPage: items.length,
			allPages: !truncated && !fetchFailed,
			truncated: truncated || undefined,
		},
		// A sweep drains every page itself and exposes no cursor to resume — so `hasMore` must be false even
		// when the read was incomplete. Terminal incompleteness is expressed through `page.truncated` +
		// `allPages: false` + warnings; setting `hasMore: true` here would make a consumer that drains while
		// `hasMore` re-run the identical sweep forever with no cursor to advance.
		hasMore: false,
		fetchFailed: fetchFailed || undefined,
		failedProviderIds: [...failedProviderIds],
		incompleteProviderIds: [...incompleteProviderIds],
	};
}

/**
 * Closed/merged counterpart of {@link sweepPullRequests}, feeding Kepler's Kanban "done" column. Applies
 * the native cross-provider state filter (`Closed` + `Merged`) so it works beyond GitHub.
 */
export function sweepClosedPullRequests(
	ctx: ProviderReadContext,
	options?: ClosedPullRequestSweepOptions,
): Promise<ProviderSweepResult<PullRequestShape>> {
	return sweepPullRequests(ctx, { ...options, states: ['closed', 'merged'] });
}
