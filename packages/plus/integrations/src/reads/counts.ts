import type { IssueSearchCriteria } from '@gitlens/git/models/issue.js';
import type { PullRequestSearchCriteria } from '@gitlens/git/models/pullRequest.js';
import { chunk } from '@gitlens/utils/array.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type { ProviderRepoInput, ProviderReposInput } from '../providers/models.js';
import { providersMetadata } from '../providers/models.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import {
	resolveIssueSearchCriteria,
	resolveIssueSearchScope,
	resolvePullRequestSearchCriteria,
	resolvePullRequestSearchScope,
} from './filters.js';
import {
	gitHostOnlySurfaceWarning,
	issuesUnsupportedWarning,
	otherWarning,
	unsupportedIssueSearchCriteriaWarning,
	unsupportedPullRequestSearchCriteriaWarning,
} from './warnings.js';

/**
 * How many scopes go into one upstream request.
 *
 * Measured against the live GitHub API, 30 aliased counts cost a single rate-limit point and ~2s, and 60 cost the
 * same point and roughly twice as long — so the constraint isn't rate limit, it's latency and the provider's
 * (uncontracted, so not to be leaned on) query-complexity limits. 25 keeps a chunk comfortably inside both while
 * still collapsing a realistic filter matrix into one or two requests.
 */
const issueCountChunkSize = 25;

/**
 * How many pull-request scopes go into one upstream request.
 *
 * The same latency/complexity reasoning as {@link issueCountChunkSize}, kept slightly smaller because a pull-request
 * scope can fan out into one aliased count PER requested state (open/closed/merged), so a chunk of scopes carries a
 * small multiple of that many `search` aliases.
 */
const pullRequestCountChunkSize = 15;

/**
 * One scope to count.
 *
 * `key` is caller-owned and echoed back verbatim, so a batch result needs no positional matching by the consumer.
 * It never reaches the provider query — the aliases in the upstream document are generated — so it can be any
 * string the caller finds meaningful.
 */
export interface IssueCountScope {
	key: string;
	/** Repositories to count over. Combines with `org`, exactly as in `searchIssuesPage`. */
	repos?: ProviderReposInput;
	org?: string;
	/**
	 * Same criteria model as `searchIssuesPage`, validated against the same capability table.
	 *
	 * `criteria.sort` does not affect the count — a total is invariant under ordering — but it is still VALIDATED,
	 * and an unsupported key refuses this scope exactly as it would refuse the read. That is the point of the
	 * count: it previews the constraints the read will apply, so one that accepted what the read refuses would
	 * promise a fetch that can't happen, which is worse than no preview at all.
	 */
	criteria?: IssueSearchCriteria;
}

/** The count for one {@link IssueCountScope}, echoed back under the caller's own `key`. */
export interface IssueCountResult {
	key: string;
	/**
	 * Total matches the provider reports. `undefined` when the provider didn't report one for this scope — NEVER
	 * zero, which is a real answer. Render the difference: an unreported count means "unknown", and showing it as
	 * 0 would tell the user this filter matches nothing.
	 */
	count?: number;
	/**
	 * True when `count` exceeds the provider's own result ceiling, so a full read CANNOT return everything no
	 * matter how it is paged. This is the signal to warn before starting an expensive fetch.
	 */
	exceedsProviderLimit: boolean;
	/** The ceiling itself, when the provider declares one. */
	providerLimit?: number;
}

/**
 * One scope to count pull requests over — the PR twin of {@link IssueCountScope}.
 *
 * `key` is caller-owned and echoed back verbatim, never reaching the provider query (the aliases are generated), so
 * it can be any string the caller finds meaningful.
 */
export interface PullRequestCountScope {
	key: string;
	/** Repositories to count over. Combines with `org`, exactly as in `searchPullRequestsPage`. */
	repos?: ProviderReposInput;
	org?: string;
	/**
	 * Same criteria model as `searchPullRequestsPage`, validated against the same capability table — so a count
	 * refuses exactly what the read would, and never previews a fetch that can't happen.
	 */
	criteria?: PullRequestSearchCriteria;
}

/** The count for one {@link PullRequestCountScope}, echoed back under the caller's own `key`. */
export interface PullRequestCountResult {
	key: string;
	/**
	 * Total matches the provider reports. `undefined` when the provider didn't report one for this scope — NEVER
	 * zero, which is a real answer. For a multi-state scope this is the LARGEST of its per-state counts, the same
	 * total `searchPullRequestsPage` surfaces, not their sum.
	 */
	count?: number;
	/**
	 * True when `count` exceeds the provider's own per-search result ceiling, so a full read CANNOT return
	 * everything no matter how it is paged. This is the signal to warn before starting an expensive fetch.
	 */
	exceedsProviderLimit: boolean;
	/** The ceiling itself, when the provider declares one. */
	providerLimit?: number;
}

/**
 * Counts issues for many scopes without fetching any — the probe behind a "this will fetch ~N issues" preview.
 *
 * A distinct method rather than a `countOnly` flag on `searchIssuesPage`, because transferring ZERO issues is the
 * entire value: a flag would return a paged result whose `items`, `cursor` and `hasMore` are all meaningless, and
 * every consumer would have to know which fields to ignore. A separate method has a return type that only
 * describes counts.
 *
 * Scopes are batched into as few upstream requests as possible ({@link issueCountChunkSize} each). A chunk that
 * fails warns and drops only its own scopes, leaving the successful chunks' counts intact — so a partial answer is
 * still useful — with `fetchFailed` set. A scope refused for its own reasons (unscoped, inexpressible criteria) is
 * likewise isolated: its siblings are still counted.
 *
 * Cheap is not free: each chunk is a network request, so a caller driving this from UI state is expected to
 * debounce and cache.
 */
export async function countIssues(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		scopes: readonly IssueCountScope[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderResult<IssueCountResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<IssueCountResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Issue counts'));
	}

	// Nothing was asked for, so nothing is missing: an empty success, not a refusal.
	if (options.scopes.length === 0) return { items: [], warnings: [] };

	const duplicateKey = findDuplicateKey(options.scopes);
	if (duplicateKey != null) {
		// Refuses the whole call rather than deduping: `key` exists so the caller can match results without
		// positional bookkeeping, and two results under one key make that ambiguous for EVERY scope, not just the
		// repeated one.
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Duplicate issue count scope key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connection or domain that no longer resolves is a broken target, not an empty account.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return { items: [], warnings: early.warnings, fetchFailed: early.fetchFailed || undefined };
	}
	if (!isGitHostIntegration(integration)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Issue counts'));
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	if (!integration.supportsIssues) {
		return refused(issuesUnsupportedWarning(options.providerId, domain, options.connectionId));
	}

	const providerLimit = providersMetadata[options.providerId]?.issueSearchResultLimit;
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	// Validate every scope first, so a refusal costs no request at all and the countable ones are still batched
	// together.
	const countable: IssueCountScope[] = [];
	for (const scope of options.scopes) {
		const warning = rejectScope(options.providerId, domain, options.connectionId, scope);
		if (warning != null) {
			// `push`, not `appendDedupedWarning`: every rejection message embeds the scope's own key, and duplicate
			// keys were already refused above, so no two of these can ever collapse — deduping them would only pay
			// the O(n²) key comparison to prove it.
			warnings.push(warning);
			fetchFailed = true;
			continue;
		}

		countable.push(scope);
	}

	// Chunks are independent requests over their own slice of scopes — nothing in one reads what another produced,
	// and `runCaptured` never throws — so they run concurrently, bounded like every other fan-out on the facade.
	// Sequentially they would spend exactly the resource this probe is tuned to conserve: latency, ~2s per chunk.
	// `mapBounded` returns in input order, so `items` and `warnings` stay in scope order.
	const batches = await mapBounded(chunk(countable, issueCountChunkSize), providerFanOutConcurrency, batch =>
		runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() =>
				integration.countIssuesResult(
					batch.map(s => ({
						repos: s.repos as ProviderRepoInput[] | undefined,
						org: s.org,
						criteria: s.criteria,
					})),
					undefined,
					options.connectionId,
				),
			{ warnOnMissingSession: warnOnMissingSession },
		).then(result => ({ batch: batch, ...result })),
	);

	const items: IssueCountResult[] = [];
	for (const { batch, value, warning } of batches) {
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// This batch contributes nothing, but the batches around it still do. Drop only these scopes.
			fetchFailed = true;
			continue;
		}

		for (let i = 0; i < batch.length; i++) {
			const count = value[i];
			items.push({
				key: batch[i].key,
				count: count,
				// Only a reported count can exceed a declared ceiling; unknown-vs-limit is not a comparison.
				exceedsProviderLimit: count != null && providerLimit != null && count > providerLimit,
				providerLimit: providerLimit,
			});
		}
	}

	// A provider with no count support returns `undefined` with no error, which lands as an empty `items` and no
	// warning. Say so explicitly rather than letting it read as "every scope matched nothing".
	if (items.length === 0 && warnings.length === 0) {
		return refused(
			unsupportedIssueSearchCriteriaWarning(options.providerId, domain, options.connectionId, {
				reason: 'unsupported-search',
			}),
		);
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/** The first key that appears twice, or `undefined` when every key is unique. */
function findDuplicateKey(scopes: readonly { key: string }[]): string | undefined {
	const seen = new Set<string>();
	for (const scope of scopes) {
		if (seen.has(scope.key)) return scope.key;

		seen.add(scope.key);
	}
	return undefined;
}

/**
 * Why one scope can't be counted, as the warning to report — or `undefined` when it can.
 *
 * The scope and criteria rules come from {@link resolveIssueSearchScope} / {@link resolveIssueSearchCriteria},
 * the same validators `searchIssuesPage` uses, so a count always previews the constraints the read would apply.
 * That is not cosmetic: a count computed under different constraints is a WRONG number rather than a missing
 * one, which is worse. Only the wording is local, because these name the offending scope's key.
 */
function rejectScope(
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	scope: IssueCountScope,
): ProviderWarning | undefined {
	const scoping = resolveIssueSearchScope(scope.repos, scope.org, scope.criteria);
	switch (scoping.rejection) {
		case 'repo-ids':
			return otherWarning(
				providerId,
				domain,
				connectionId,
				`Issue count scope '${scope.key}' cannot be scoped by repository id; pass repository descriptors (namespace + name) instead.`,
			);
		case 'unscoped':
			return otherWarning(
				providerId,
				domain,
				connectionId,
				`Issue count scope '${scope.key}' is unscoped; pass \`repos\`, \`org\`, or a relationship to the current user. \`any-assignee\` and \`unassigned\` are not scopes.`,
			);
	}

	const resolved = resolveIssueSearchCriteria(providerId, scope.criteria);
	if (resolved.rejection != null) {
		return unsupportedIssueSearchCriteriaWarning(providerId, domain, connectionId, resolved.rejection);
	}

	// Count-only, with no counterpart in the read: a relationship set is an OR across several searches, which one
	// count can't express — summing them would double-count anything matching two, and taking the max would
	// under-report. Rather than answer with a wrong number, ask the caller to count each relationship as its own
	// scope, where the keys make the OR explicit.
	if ((scope.criteria?.relationships?.length ?? 0) > 1) {
		return otherWarning(
			providerId,
			domain,
			connectionId,
			`Issue count scope '${scope.key}' requests several relationships, which a single count can't express (they are OR-ed, so overlapping matches would be double-counted); pass one scope per relationship.`,
		);
	}

	return undefined;
}

/**
 * Counts pull requests for many scopes without fetching any — the PR twin of {@link countIssues}, and the probe
 * behind a "this will fetch ~N pull requests" preview.
 *
 * Identical batching, per-scope isolation, and `key`-echo contract as {@link countIssues}; see it for the cost
 * model and the `count: undefined` ≠ zero rule. The one difference is inherent to pull requests: a scope's criteria
 * can name several STATES, which the provider counts as independent searches — the reported `count` is the LARGEST
 * of them (mirroring `searchPullRequestsPage`'s total), so an unpaged read still can't exceed a single search's
 * ceiling undetected.
 */
export async function countPullRequests(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		scopes: readonly PullRequestCountScope[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderResult<PullRequestCountResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<PullRequestCountResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Pull request counts'),
		);
	}

	// Nothing was asked for, so nothing is missing: an empty success, not a refusal.
	if (options.scopes.length === 0) return { items: [], warnings: [] };

	const duplicateKey = findDuplicateKey(options.scopes);
	if (duplicateKey != null) {
		// Refuses the whole call rather than deduping: `key` exists so the caller can match results without
		// positional bookkeeping, and two results under one key make that ambiguous for EVERY scope, not just the
		// repeated one.
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Duplicate pull request count scope key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		// A supplied connection or domain that no longer resolves is a broken target, not an empty account.
		const early = ctx.earlyReturnConnectionWarnings(options.providerId, options.connectionId, options.domain);
		return { items: [], warnings: early.warnings, fetchFailed: early.fetchFailed || undefined };
	}
	if (!isGitHostIntegration(integration)) {
		return refused(
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Pull request counts'),
		);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	// A provider with no filtered pull-request search has no count either: refuse ONCE for the provider rather than
	// letting every scope repeat the same rejection. `undefined` criteria probes only the search's existence.
	const searchSupport = resolvePullRequestSearchCriteria(options.providerId, undefined);
	if (searchSupport.rejection != null) {
		return refused(
			unsupportedPullRequestSearchCriteriaWarning(
				options.providerId,
				domain,
				options.connectionId,
				searchSupport.rejection,
			),
		);
	}

	const providerLimit = providersMetadata[options.providerId]?.pullRequestSearchResultLimit;
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	// Validate every scope first, so a refusal costs no request at all and the countable ones are still batched
	// together.
	const countable: PullRequestCountScope[] = [];
	for (const scope of options.scopes) {
		const warning = rejectPullRequestScope(options.providerId, domain, options.connectionId, scope);
		if (warning != null) {
			// `push`, not `appendDedupedWarning`: every rejection message embeds the scope's own key, and duplicate
			// keys were already refused above, so no two of these can ever collapse.
			warnings.push(warning);
			fetchFailed = true;
			continue;
		}

		countable.push(scope);
	}

	// Chunks are independent requests over their own slice of scopes, `runCaptured` never throws, so they run
	// concurrently, bounded like every other fan-out on the facade. `mapBounded` returns in input order, so `items`
	// and `warnings` stay in scope order.
	const batches = await mapBounded(chunk(countable, pullRequestCountChunkSize), providerFanOutConcurrency, batch =>
		runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() =>
				integration.countPullRequestsResult(
					batch.map(s => ({
						repos: s.repos as ProviderRepoInput[] | undefined,
						org: s.org,
						criteria: s.criteria,
					})),
					undefined,
					options.connectionId,
				),
			{ warnOnMissingSession: warnOnMissingSession },
		).then(result => ({ batch: batch, ...result })),
	);

	const items: PullRequestCountResult[] = [];
	for (const { batch, value, warning } of batches) {
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// This batch contributes nothing, but the batches around it still do. Drop only these scopes.
			fetchFailed = true;
			continue;
		}

		for (let i = 0; i < batch.length; i++) {
			const count = value[i];
			items.push({
				key: batch[i].key,
				count: count,
				// Only a reported count can exceed a declared ceiling; unknown-vs-limit is not a comparison.
				exceedsProviderLimit: count != null && providerLimit != null && count > providerLimit,
				providerLimit: providerLimit,
			});
		}
	}

	// A provider that reported nothing for any scope and raised no warning: say so explicitly rather than letting it
	// read as "every scope matched nothing".
	if (items.length === 0 && warnings.length === 0) {
		return refused(
			unsupportedPullRequestSearchCriteriaWarning(options.providerId, domain, options.connectionId, {
				reason: 'unsupported-search',
			}),
		);
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/**
 * Why one pull-request scope can't be counted, as the warning to report — or `undefined` when it can. The PR twin
 * of {@link rejectScope}, validating against the same {@link resolvePullRequestSearchScope} /
 * {@link resolvePullRequestSearchCriteria} the read uses, so a count always previews the constraints the read
 * would apply.
 */
function rejectPullRequestScope(
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	scope: PullRequestCountScope,
): ProviderWarning | undefined {
	const scoping = resolvePullRequestSearchScope(providerId, scope.repos, scope.org, scope.criteria);
	switch (scoping.rejection) {
		case 'repo-ids':
			return otherWarning(
				providerId,
				domain,
				connectionId,
				`Pull request count scope '${scope.key}' cannot be scoped by repository id; pass repository descriptors (namespace + name) instead.`,
			);
		case 'unscoped':
			return otherWarning(
				providerId,
				domain,
				connectionId,
				`Pull request count scope '${scope.key}' is unscoped; pass \`repos\`, \`org\`, or at least one current-user relationship.`,
			);
		case 'unsupported-repository-scope':
		case 'unsupported-organization-scope':
			return unsupportedPullRequestSearchCriteriaWarning(providerId, domain, connectionId, {
				reason: 'unsupported-criteria',
				criteria: [
					scoping.rejection === 'unsupported-repository-scope' ? 'repositoryScope' : 'organizationScope',
				],
			});
	}

	const resolved = resolvePullRequestSearchCriteria(providerId, scope.criteria);
	if (resolved.rejection != null) {
		return unsupportedPullRequestSearchCriteriaWarning(providerId, domain, connectionId, resolved.rejection);
	}

	// Count-only, with no counterpart in the read: a relationship set is an OR across several searches, which one
	// count can't express — summing would double-count overlaps and max would under-report. Ask the caller to count
	// each relationship as its own scope, where the keys make the OR explicit. (States are disjoint, so a scope may
	// still name several — the provider counts them as the max, not a refusal.)
	if ((scope.criteria?.relationships?.length ?? 0) > 1) {
		return otherWarning(
			providerId,
			domain,
			connectionId,
			`Pull request count scope '${scope.key}' requests several relationships, which a single count can't express (they are OR-ed, so overlapping matches would be double-counted); pass one scope per relationship.`,
		);
	}

	return undefined;
}
