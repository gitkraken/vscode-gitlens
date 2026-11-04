import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { IntegrationIds } from '../constants.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { isGitHostIntegration } from '../models/publicIntegration.js';
import { isAzureProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning, PullRequestBranchResult, PullRequestBranchTarget } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { appendBatchSlotWarning } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { getCurrentAccountIdentity, runCaptured } from './drains.js';
import { findDuplicateKey, trimCoordinateFields, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning, unsupportedWarning } from './warnings.js';

/**
 * The pull-requests-by-branch read: for each branch, every pull request whose head is that branch, in any state.
 * A relationship-free point read — unlike the account-wide sweeps, it finds a teammate's pull request from the
 * user's branch — so an empty list is a PROVEN "none" a caller can cache.
 *
 * ONE integration call per invocation, whatever the target count, settling each target independently — see
 * `GitHostIntegration.getPullRequestsForBranchesResult`. Uncached, and not routed through the integration's
 * `getPullRequestForBranch`, which caches through `IntegrationCacheProvider.getPullRequestForBranch`, answers one
 * pull request, and on several hosts looks the branch ref up, answering "none" once a merged branch is deleted.
 */

/** Pull requests returned per target. */
const pullRequestsForBranchLimit = 10;

export async function getPullRequestsForBranches(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		targets: readonly PullRequestBranchTarget[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
		/** See {@link IntegrationManager.getPullRequestsForBranches}. */
		mergeQueue?: boolean;
	},
): Promise<ProviderResult<PullRequestBranchResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<PullRequestBranchResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});
	const surface = 'Pull requests by branch';

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
				`Duplicate pull request branch target key '${duplicateKey}'; keys identify results, so each must be unique.`,
			),
		);
	}

	// The validated value must be the one sent to the provider, so every string field is trimmed once here.
	// `branch` is left alone: a git ref name can't carry surrounding whitespace, so a padded one is refused below
	// rather than being silently repaired.
	const targets = options.targets.map(target => ({
		...trimCoordinateFields(target),
		headOwner: target.headOwner?.trim(),
	}));

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream to fail one by one.
	const invalid = findInvalidTarget(options.providerId, targets);
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
	// Resolved once, so the by-name query and the batch read that settles a truncated target select the same data
	// and one target's rows never disagree on it, even if the host's setting changes while the call is in flight.
	const mergeQueue = options.mergeQueue ?? ctx.getPullRequestReadOptions().mergeQueue === true;
	const currentAccount = await getCurrentAccountIdentity(integration, options.connectionId);

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	const { value: slots, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			integration.getPullRequestsForBranchesResult(
				targets.map(t => ({
					owner: t.owner,
					repo: t.repo,
					project: t.project,
					branch: t.branch,
					headOwner: forkOwner(t),
				})),
				{ currentAccount: currentAccount, limit: pullRequestsForBranchLimit, mergeQueue: mergeQueue },
				undefined,
				options.connectionId,
			),
		// A missing session must surface as a connection warning, including on the primary path, which
		// otherwise reads it as "not connected" and says nothing.
		{ warnOnMissingSession: true },
	);
	const allKeys = targets.map(t => t.key);
	if (warning != null) {
		appendDedupedWarning(warnings, { ...warning, targetKeys: allKeys });
	}

	if (slots == null) {
		// Dropped, never reported as "none": "unknown" and "proven none" must stay distinguishable.
		if (warning == null) {
			appendDedupedWarning(warnings, {
				...unsupportedWarning(
					options.providerId,
					domain,
					options.connectionId,
					`${surface} is not supported by '${options.providerId}'.`,
				),
				targetKeys: allKeys,
			});
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: PullRequestBranchResult[] = [];
	for (let i = 0; i < targets.length; i++) {
		const slot = slots[i];
		if (slot.status === 'rejected') {
			// Dropped, never reported as "none", like a whole-call failure.
			appendBatchSlotWarning(warnings, options.providerId, domain, options.connectionId, slot, targets[i].key);
			fetchFailed = true;
			continue;
		}

		items.push({
			key: targets[i].key,
			pullRequests: slot.value.pullRequests,
			...(slot.value.truncated ? { truncated: true } : {}),
		});
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/** The owner of the fork the branch lives in, or `undefined` for a branch in the base repository. */
function forkOwner(target: PullRequestBranchTarget): string | undefined {
	return target.headOwner == null || equalsIgnoreCase(target.headOwner, target.owner) ? undefined : target.headOwner;
}

function findInvalidTarget(
	providerId: IntegrationIds,
	targets: readonly PullRequestBranchTarget[],
): string | undefined {
	const isAzure = isAzureProviderId(providerId);
	const isBitbucketServer = providerId === GitSelfManagedHostIntegrationId.BitbucketServer;
	for (const target of targets) {
		if (target.owner.length === 0 || target.repo.length === 0) {
			return `Pull request branch target '${target.key}' requires a non-empty owner and repo.`;
		}
		if (target.branch.trim().length === 0) {
			return `Pull request branch target '${target.key}' requires a non-empty branch.`;
		}
		// Sent as is, a padded name matches no branch and answers a cacheable "none".
		if (target.branch !== target.branch.trim()) {
			return `Pull request branch target '${target.key}' has branch '${target.branch}'; a branch name can't start or end with whitespace.`;
		}
		if (target.branch.startsWith('refs/')) {
			return `Pull request branch target '${target.key}' has branch '${target.branch}'; pass the branch's short name, without 'refs/heads/'.`;
		}
		if (isAzure && !target.project) {
			return `Pull request branch target '${target.key}' requires a project for '${providerId}'.`;
		}
		if (target.headOwner?.length === 0) {
			return `Pull request branch target '${target.key}' has an empty headOwner; omit it for a branch in the base repository.`;
		}
		if (forkOwner(target) != null) {
			if (isAzure) {
				return `Pull request branch target '${target.key}' has a headOwner other than its owner, which '${providerId}' can't honor: an Azure DevOps fork shares its organization, so its owner can't identify it.`;
			}
			if (isBitbucketServer) {
				return `Pull request branch target '${target.key}' has a headOwner other than its owner, which '${providerId}' can't honor: Bitbucket Data Center finds a branch's pull requests only through the repository the branch lives in, and a fork's repository can't be derived from its owner.`;
			}
		}
	}
	return undefined;
}
