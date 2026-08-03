import type { IssueSearchCriteria } from '@gitlens/git/models/issue.js';
import type { IntegrationIds } from '../constants.js';
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
import { resolveIssueSearchCriteria } from './filters.js';
import {
	gitHostOnlySurfaceWarning,
	issuesUnsupportedWarning,
	otherWarning,
	unsupportedIssueSearchCriteriaWarning,
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
	/** Same criteria model as `searchIssuesPage`, validated against the same capability table. */
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

	// Validate and normalize every scope first, so a refusal costs no request at all and the countable ones are
	// still batched together.
	const countable: { key: string; repos?: ProviderRepoInput[]; org?: string; criteria?: IssueSearchCriteria }[] = [];
	for (const scope of options.scopes) {
		const rejection = rejectScope(options.providerId, scope);
		if (rejection != null) {
			appendDedupedWarning(warnings, rejection(domain, options.connectionId));
			fetchFailed = true;
			continue;
		}

		countable.push({
			key: scope.key,
			repos: scope.repos as ProviderRepoInput[] | undefined,
			org: scope.org,
			criteria: scope.criteria,
		});
	}

	const items: IssueCountResult[] = [];
	for (let i = 0; i < countable.length; i += issueCountChunkSize) {
		const chunk = countable.slice(i, i + issueCountChunkSize);
		const { value, warning } = await runCaptured(
			options.providerId,
			domain,
			options.connectionId,
			() =>
				integration.countIssuesResult(
					chunk.map(s => ({ repos: s.repos, org: s.org, criteria: s.criteria })),
					undefined,
					options.connectionId,
				),
			{ warnOnMissingSession: warnOnMissingSession },
		);
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// This chunk contributes nothing, but the chunks around it still do. Drop only these scopes.
			fetchFailed = true;
			continue;
		}

		for (let j = 0; j < chunk.length; j++) {
			const count = value[j];
			items.push({
				key: chunk[j].key,
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
function findDuplicateKey(scopes: readonly IssueCountScope[]): string | undefined {
	const seen = new Set<string>();
	for (const scope of scopes) {
		if (seen.has(scope.key)) return scope.key;

		seen.add(scope.key);
	}
	return undefined;
}

/**
 * Why one scope can't be counted, as a warning builder awaiting the attribution — or `undefined` when it can.
 *
 * The two refusals mirror `searchIssuesPage`'s exactly, and deliberately: a count that didn't apply the same
 * constraints as the read it previews would be a wrong number rather than a missing one, which is worse.
 */
function rejectScope(
	providerId: IntegrationIds,
	scope: IssueCountScope,
): ((domain: string | undefined, connectionId: string | undefined) => ProviderWarning) | undefined {
	const hasRepos = (scope.repos?.length ?? 0) > 0;
	// A search names repositories by path, so an id-based input can't scope the count.
	if (hasRepos && scope.repos!.some(r => typeof r === 'string' || typeof r === 'number')) {
		return (domain, connectionId) =>
			otherWarning(
				providerId,
				domain,
				connectionId,
				`Issue count scope '${scope.key}' cannot be scoped by repository id; pass repository descriptors (namespace + name) instead.`,
			);
	}

	const hasUserRelationship =
		scope.criteria?.relationships?.some(r => r === 'authored' || r === 'assigned' || r === 'mentioned') === true;
	if (!hasRepos && !(scope.org != null && scope.org.length > 0) && !hasUserRelationship) {
		return (domain, connectionId) =>
			otherWarning(
				providerId,
				domain,
				connectionId,
				`Issue count scope '${scope.key}' is unscoped; pass \`repos\`, \`org\`, or a relationship to the current user. \`any-assignee\` and \`unassigned\` are not scopes.`,
			);
	}

	const resolved = resolveIssueSearchCriteria(providerId, scope.criteria);
	if (resolved.rejection != null) {
		const rejection = resolved.rejection;
		return (domain, connectionId) =>
			unsupportedIssueSearchCriteriaWarning(providerId, domain, connectionId, rejection);
	}

	// A relationship set is an OR across several searches, which one count can't express: summing them would
	// double-count anything matching two, and taking the max would under-report. Rather than answer with a wrong
	// number, ask the caller to count each relationship as its own scope — where the keys make the OR explicit.
	if ((scope.criteria?.relationships?.length ?? 0) > 1) {
		return (domain, connectionId) =>
			otherWarning(
				providerId,
				domain,
				connectionId,
				`Issue count scope '${scope.key}' requests several relationships, which a single count can't express (they are OR-ed, so overlapping matches would be double-counted); pass one scope per relationship.`,
			);
	}

	return undefined;
}
