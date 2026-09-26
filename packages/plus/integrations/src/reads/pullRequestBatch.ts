import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { IntegrationIds } from '../constants.js';
import { githubGraphQLInt32Max, isAzureProviderId, isGitHubProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning, toProviderWarning } from '../results.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { getCurrentAccountIdentity, runCaptured } from './drains.js';
import { findDuplicateKey, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning } from './warnings.js';

/**
 * The BATCH pull request read: resolve N pull requests, in any state, BY COORDINATE — the pull-request twin of
 * `getIssuesBatch`, and for the same reason. "Does this exact pull request exist" is an identity question; a
 * paged list can only answer it by walking the whole scope, so a miss stays unproven and the walk repeats forever.
 * Here an absent slot is a PROVEN ABSENCE a caller can cache.
 *
 * Deliberately NOT routed through `Integration.getPullRequest`: that read answers `undefined` both when not
 * connected and on any failure, and caches through `IntegrationCacheProvider.getPullRequest`, whose key carries no
 * connection and whose by-id bucket never expires a miss.
 *
 * ONE integration call per invocation, whatever the target count: the manager makes a single
 * `getPullRequestsBatchResult` call and the integration fans its targets out (chunked for GitHub/GHE, one request
 * per target with bounded concurrency everywhere else) and settles each independently, so one bad target never
 * spends more than its own slot — see `GitHostIntegration.getPullRequestsBatchResult`.
 */

/** One pull request to resolve, identified by coordinate and echoed back under the caller's own `key`. */
export interface PullRequestBatchTarget {
	/** Caller-owned identifier, echoed on the result so no positional matching is needed. Must be unique. */
	key: string;
	/**
	 * GitHub owner, GitLab namespace path (may be nested), Bitbucket workspace, Bitbucket Data Center project key, or
	 * Azure DevOps organization.
	 */
	owner: string;
	/** Repository name or slug. */
	repo: string;
	/** Pull request number, GitLab merge request iid, or Azure DevOps pull request id. */
	number: number;
	/** Azure DevOps project. Required there, ignored elsewhere. */
	project?: string;
}

/** The answer for one {@link PullRequestBatchTarget}. */
export interface PullRequestBatchResult {
	key: string;
	/**
	 * The resolved pull request, whatever its state, or `undefined` when it PROVABLY does not exist (or is not
	 * visible to this connection). A target whose read FAILED is not returned at all and sets `fetchFailed`.
	 */
	pullRequest?: PullRequestShape;
}

export async function getPullRequestsBatch(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		targets: readonly PullRequestBatchTarget[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderResult<PullRequestBatchResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<PullRequestBatchResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Batch pull request resolution';

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, surface));
	}

	if (options.targets.length === 0) return { items: [], warnings: [] };

	const duplicateKey = findDuplicateKey(options.targets);
	if (duplicateKey != null) {
		// Refuses the whole call rather than deduping: two results under one key make matching ambiguous for EVERY
		// target, not just the repeated one.
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Duplicate pull request batch target key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream to fail one by one.
	const invalid = findInvalidTarget(options.providerId, options.targets);
	if (invalid != null) {
		return refused(otherWarning(options.providerId, undefined, options.connectionId, invalid));
	}

	const integration = await ctx.getIntegrationForRead(options.providerId, options.connectionId, options.domain);
	if (integration == null) {
		return unresolvedIntegration(ctx, options.providerId, options.connectionId, options.domain);
	}
	if (!isGitHostIntegration(integration)) {
		return refused(gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, surface));
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const currentAccount = await getCurrentAccountIdentity(integration, options.connectionId);

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	const { value: slots, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			integration.getPullRequestsBatchResult(
				options.targets.map(t => ({ owner: t.owner, repo: t.repo, number: t.number, project: t.project })),
				{ currentAccount: currentAccount },
				undefined,
				options.connectionId,
			),
		// A missing session must surface as a connection warning, including on the primary path, which
		// otherwise reads it as "not connected" and says nothing.
		{ warnOnMissingSession: true },
	);
	if (warning != null) {
		appendDedupedWarning(warnings, warning);
	}

	if (slots == null) {
		// Dropped, never reported absent: "unknown" and "proven absent" must stay distinguishable.
		if (warning == null) {
			appendDedupedWarning(
				warnings,
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`${surface} is not supported by '${options.providerId}'; resolve pull requests individually instead.`,
				),
			);
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: PullRequestBatchResult[] = [];
	for (let i = 0; i < options.targets.length; i++) {
		const slot = slots[i];
		if (slot.status === 'rejected') {
			// Dropped, never reported absent, like a whole-call failure.
			appendDedupedWarning(
				warnings,
				toProviderWarning(options.providerId, domain, options.connectionId, slot.reason),
			);
			fetchFailed = true;
			continue;
		}

		const pullRequest = slot.value;
		items.push({ key: options.targets[i].key, ...(pullRequest != null ? { pullRequest: pullRequest } : {}) });
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function findInvalidTarget(providerId: IntegrationIds, targets: readonly PullRequestBatchTarget[]): string | undefined {
	const requiresProject = isAzureProviderId(providerId);
	const isGitHub = isGitHubProviderId(providerId);
	for (const target of targets) {
		if (!Number.isSafeInteger(target.number) || target.number <= 0) {
			return `Pull request batch target '${target.key}' has number ${target.number}; expected a positive integer.`;
		}
		if (isGitHub && target.number > githubGraphQLInt32Max) {
			return `Pull request batch target '${target.key}' has number ${target.number}; GitHub numbers are 32-bit and cannot exceed ${githubGraphQLInt32Max}.`;
		}
		if (target.owner.trim().length === 0 || target.repo.trim().length === 0) {
			return `Pull request batch target '${target.key}' requires a non-empty owner and repo.`;
		}
		if (requiresProject && !target.project?.trim()) {
			return `Pull request batch target '${target.key}' requires a project for '${providerId}'.`;
		}
	}
	return undefined;
}
