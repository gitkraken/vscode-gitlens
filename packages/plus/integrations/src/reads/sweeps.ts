import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type {
	ClosedPullRequestSweepOptions,
	ProviderSweepTarget,
	ProviderSweepTargetEvent,
	PullRequestSweepOptions,
} from '../manager.js';
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

/**
 * Drain ONE sweep target. Extracted from the fan-out so the fan-out callback has a single exit: every
 * per-target observation (see `onTargetSettled`) is then reported in one place instead of at each of this
 * function's several early returns, where a missed branch would silently drop a provider's attribution.
 *
 * `undefined` means the target resolved to no reachable connection and is deliberately not attributed in the
 * aggregate result.
 */
async function sweepTarget(
	ctx: ProviderReadContext,
	options: PullRequestSweepOptions | undefined,
	target: ProviderSweepTarget,
	attributeUnavailableProviders: boolean,
): Promise<SweepSlice | undefined> {
	const { providerId: id, connectionId, domain: requestedDomain } = target;
	const repos = options?.repos ?? [];
	const maxPages = options?.maxPages ?? 100;
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
		return rejectedTarget([gitHostOnlySurfaceWarning(id, requestedDomain, connectionId, 'pull request sweeps')]);
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
		return rejectedTarget([gitHostOnlySurfaceWarning(id, requestedDomain, connectionId, 'pull request sweeps')]);
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
		options,
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
		items: drain.items.map(pr => fromProviderPullRequest(pr, integration, { currentAccountId: currentAccountId })),
		providerId: id,
	};
}

/**
 * How a target ended, as the consumer buckets it. `failedProvider` outranks `fetchFailed` because a target
 * whose provider failed produced no slice to be partial about, and `undefined` is the target that resolved to
 * no reachable connection at all.
 */
function sliceOutcome(slice: SweepSlice | undefined): ProviderSweepTargetEvent['outcome'] {
	if (slice == null) return 'skipped';
	if (slice.failedProvider) return 'failed-provider';
	if (slice.fetchFailed) return 'fetch-failed';
	return 'ok';
}

/**
 * Per-target reporting for a sweep's `onTargetSettled`, opened once per sweep: this stamps the fan-out start,
 * the returned function stamps one target's start, and the function IT returns is the only thing that can
 * report that target. The timestamps therefore never cross a boundary, so there is no pair of interchangeable
 * numbers for a call site to transpose, and the whole reporting concern is one value the fan-out either has or
 * does not. That is also what keeps the option free when it is omitted: with no observer there is nothing to
 * open, so no clock is read and no reporting object exists — do not "simplify" that into an unconditional
 * open, because a host whose perf gate is off (the default) is entitled to pay nothing for it.
 *
 * The try/catch is what makes the observer observation-only: called from the fan-out's success path, a throwing
 * callback would otherwise propagate out of the `mapBounded` task and reject the entire sweep — corrupting the
 * read, not just the metric. Swallowed silently; the consumer owns its own aggregation. The `void`-typed
 * callback also admits an `async` consumer, whose rejection is created only after `observe` returns — the
 * `Promise.resolve(...).catch` swallows that too, so it cannot escape as an unhandled rejection.
 *
 * The domain is resolved here rather than carried out of {@link sweepTarget}, so every target reports it by the
 * same rule no matter how far it got. `resolveDomainForRead` needs no integration instance, which is what makes
 * that possible: a target rejected by the first guard resolves the same host a fully drained one does.
 */
function startSweepReporting(
	ctx: ProviderReadContext,
	observe: (event: ProviderSweepTargetEvent) => void | PromiseLike<unknown>,
) {
	const fanOutStartedAt = performance.now();

	return function beginTarget(target: ProviderSweepTarget) {
		const startedAt = performance.now();

		return function reportSettled(slice: SweepSlice | undefined) {
			try {
				void Promise.resolve(
					observe({
						providerId: target.providerId,
						domain: ctx.resolveDomainForRead(target.providerId, target.connectionId, target.domain),
						connectionId: target.connectionId,
						count: slice?.items.length ?? 0,
						durationMs: performance.now() - startedAt,
						queueWaitMs: startedAt - fanOutStartedAt,
						outcome: sliceOutcome(slice),
						truncated: slice?.truncated ?? false,
					}),
				).catch(() => {});
			} catch {}
		};
	};
}

export async function sweepPullRequests(
	ctx: ProviderReadContext,
	options?: PullRequestSweepOptions,
): Promise<ProviderSweepResult<PullRequestShape>> {
	const { targets, attributeUnavailableProviders } = resolvePullRequestSweepTargets(options);

	const observe = options?.onTargetSettled;
	const beginTarget = observe != null ? startSweepReporting(ctx, observe) : undefined;

	const results = await mapBounded(targets, providerFanOutConcurrency, async target => {
		const reportSettled = beginTarget?.(target);
		const slice = await sweepTarget(ctx, options, target, attributeUnavailableProviders);
		reportSettled?.(slice);
		return slice;
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
