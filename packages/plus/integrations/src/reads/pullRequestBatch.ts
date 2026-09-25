import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { chunk } from '@gitlens/utils/array.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId, providerFanOutConcurrency } from '../constants.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning, toProviderWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { findDuplicateKey } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, noConnectionWarning, otherWarning } from './warnings.js';

/**
 * The BATCH pull request read (#5894): the {@link IssueBatchTarget}/{@link IssueBatchResult} (`issueBatch.ts`)
 * twin for pull requests. A target's own read can fail without its chunk failing, so that failure reports as an
 * `Error` slot rather than `undefined`, which here is a cached proven absence.
 */

/** One pull request to resolve, identified by coordinate and echoed back under the caller's own `key`. */
export interface PullRequestBatchTarget {
	/** Caller-owned identifier, echoed on the result so no positional matching is needed. Must be unique. */
	key: string;
	owner: string;
	repo: string;
	number: number;
	/** Only required where a provider needs a project scope in addition to owner/repo; none of the supported providers do. */
	project?: string;
}

/** The answer for one {@link PullRequestBatchTarget}. */
export interface PullRequestBatchResult {
	key: string;
	/**
	 * The resolved pull request, or `undefined` when it PROVABLY does not exist (or is not visible to this
	 * connection). A target whose read FAILED is not returned at all (see the read's `fetchFailed`/warnings),
	 * so a caller can tell "proven absent" from "unknown" and cache only the first.
	 */
	pullRequest?: PullRequestShape;
}

/** Unmeasured (no live provider here); smaller than the issue batch's measured 25 since the PR fragment is heavier. */
const pullRequestBatchChunkSize = 15;

/** The only git hosts whose SDK exposes a way to resolve a pull request by coordinate — see the provider hooks. */
const pullRequestBatchSupportedProviderIds: readonly IntegrationIds[] = [
	GitCloudHostIntegrationId.GitHub,
	GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	GitCloudHostIntegrationId.GitLab,
	GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
];

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

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(
			gitHostOnlySurfaceWarning(
				options.providerId,
				undefined,
				options.connectionId,
				'Batch pull request resolution',
			),
		);
	}

	// Refused by id, before resolving a connection: no other git host's SDK exposes a way to resolve a pull
	// request by coordinate, so there is no hook to fall back to and no request worth issuing.
	if (!pullRequestBatchSupportedProviderIds.includes(options.providerId)) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Batch pull request resolution is not supported by '${options.providerId}'; resolve pull requests individually instead.`,
			),
		);
	}

	// Nothing was asked for, so nothing is missing: an empty success, not a refusal.
	if (options.targets.length === 0) return { items: [], warnings: [] };

	const duplicateKey = findDuplicateKey(options.targets);
	if (duplicateKey != null) {
		// Refuses the whole call rather than deduping: `key` exists so the caller can match results without
		// positional bookkeeping, and two results under one key make that ambiguous for EVERY target, not just
		// the repeated one.
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Duplicate pull request batch target key '${duplicateKey}'; keys identify results, so each must be unique.`,
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
			gitHostOnlySurfaceWarning(
				options.providerId,
				undefined,
				options.connectionId,
				'Batch pull request resolution',
			),
		);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	// Chunks are independent requests over their own slice of targets — nothing in one reads what another
	// produced, and `runCaptured` never throws — so they run concurrently, bounded like every other fan-out here.
	// `mapBounded` returns in input order, so `items` stays in target order.
	const batches = await mapBounded(
		chunk([...options.targets], pullRequestBatchChunkSize),
		providerFanOutConcurrency,
		batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() =>
					integration.getPullRequestsBatchResult(
						batch.map(t => ({ owner: t.owner, repo: t.repo, number: t.number })),
						undefined,
						options.connectionId,
					),
				{ warnOnMissingSession: warnOnMissingSession },
			).then(result => ({ batch: batch, ...result })),
	);

	const items: PullRequestBatchResult[] = [];
	for (const { batch, value, warning } of batches) {
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// The provider is supported (checked up front), so a value-less, warning-less chunk means its
			// session didn't resolve: drop its targets and warn, never report them as absent.
			if (warning == null) {
				appendDedupedWarning(warnings, noConnectionWarning(options.providerId, domain, options.connectionId));
			}
			fetchFailed = true;
			continue;
		}

		for (let i = 0; i < batch.length; i++) {
			const outcome = value[i];
			if (outcome instanceof Error) {
				// This one coordinate's read failed; drop it, never report it as absent.
				appendDedupedWarning(
					warnings,
					toProviderWarning(options.providerId, domain, options.connectionId, outcome),
				);
				fetchFailed = true;
				continue;
			}

			items.push({ key: batch[i].key, ...(outcome != null ? { pullRequest: outcome } : {}) });
		}
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}
