import type { IssueShape } from '@gitlens/git/models/issue.js';
import { chunk } from '@gitlens/utils/array.js';
import { mapBounded } from '@gitlens/utils/promise.js';
import type { IntegrationIds } from '../constants.js';
import { providerFanOutConcurrency } from '../constants.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning } from '../results.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	warnOnMissingSessionForDomain,
} from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import { gitHostOnlySurfaceWarning, issuesUnsupportedWarning, otherWarning } from './warnings.js';

/**
 * The BATCH issue read: resolve N `(owner, repo, number)` coordinates in one request.
 *
 * A sibling of the issue searches rather than a mode of one, because it answers a different question. A search
 * asks "what matches"; this asks "does this exact issue exist", which is what a caller correlating a branch name
 * to the issue it references is actually asking. Three consequences follow, and they are the reason this exists:
 *
 * - It resolves by EXACT NUMBER, so relevance never enters into it.
 * - No result ceiling applies, so there is no partial window to reason about and no omission to report.
 * - An absent slot is a PROVEN ABSENCE, not "not found within a page budget". That is the property that matters
 *   most: a caller can CACHE a miss. Emulating this with a paged list cannot prove absence without walking the
 *   whole scope, so a miss stays unproven and the walk repeats on every pass, forever.
 *
 * Modeled on `countIssues` for its shape — caller-owned `key` echoed back, per-target isolation, chunked into as
 * few requests as possible — because both take a set of independent questions and answer them together.
 */

/** One issue to resolve, identified by coordinate and echoed back under the caller's own `key`. */
export interface IssueBatchTarget {
	/** Caller-owned identifier, echoed on the result so no positional matching is needed. Must be unique. */
	key: string;
	owner: string;
	repo: string;
	number: number;
}

/** The answer for one {@link IssueBatchTarget}. */
export interface IssueBatchResult {
	key: string;
	/**
	 * The resolved issue, or `undefined` when it PROVABLY does not exist (or is not visible to this connection).
	 *
	 * Absent is an answer here, unlike every paged read on this facade: a target whose chunk FAILED is not
	 * returned at all and sets `fetchFailed`, so a caller can tell "proven absent" from "unknown" and cache the
	 * first without ever caching the second.
	 */
	issue?: IssueShape;
}

/**
 * How many coordinates go into one upstream request.
 *
 * Measured rather than inherited from `issueCountChunkSize`, since that one rests on a zero-node selection and
 * this carries the full issue projection per alias. Against the live API on all-resolving coordinates: 10 took
 * 875ms, 25 took 890ms — so up to 25 is effectively free — 50 took 1.3s, and 75 took 2.7s. No complexity refusal
 * appeared up to 100.
 *
 * 25 is where latency is still flat, with room before it degrades. It also puts any realistic correlation batch
 * in ONE request, which is the whole point of the read.
 */
const issueBatchChunkSize = 25;

export async function getIssuesBatch(
	ctx: ProviderReadContext,
	options: {
		providerId: IntegrationIds;
		targets: readonly IssueBatchTarget[];
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	},
): Promise<ProviderResult<IssueBatchResult>> {
	const refused = (warning: ProviderWarning): ProviderResult<IssueBatchResult> => ({
		items: [],
		warnings: [warning],
		fetchFailed: true,
	});

	if (isIssuesHostIntegrationId(options.providerId)) {
		return refused(
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Batch issue resolution'),
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
				`Duplicate issue batch target key '${duplicateKey}'; keys identify results, so each must be unique.`,
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
			gitHostOnlySurfaceWarning(options.providerId, undefined, options.connectionId, 'Batch issue resolution'),
		);
	}

	const domain = ctx.domainForRead(integration, options.providerId, options.connectionId, options.domain);
	const warnOnMissingSession = warnOnMissingSessionForDomain(options.providerId, options.domain);

	if (!integration.supportsIssues) {
		return refused(issuesUnsupportedWarning(options.providerId, domain, options.connectionId));
	}

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	// Chunks are independent requests over their own slice of targets — nothing in one reads what another
	// produced, and `runCaptured` never throws — so they run concurrently, bounded like every other fan-out here.
	// `mapBounded` returns in input order, so `items` stays in target order.
	const batches = await mapBounded(
		chunk([...options.targets], issueBatchChunkSize),
		providerFanOutConcurrency,
		batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() =>
					integration.getIssuesBatchResult(
						batch.map(t => ({ owner: t.owner, repo: t.repo, number: t.number })),
						undefined,
						options.connectionId,
					),
				{ warnOnMissingSession: warnOnMissingSession },
			).then(result => ({ batch: batch, ...result })),
	);

	const items: IssueBatchResult[] = [];
	for (const { batch, value, warning } of batches) {
		if (warning != null) {
			appendDedupedWarning(warnings, warning);
		}
		if (value == null) {
			// A provider that doesn't implement the batch hook answers `undefined` with no error. Either way this
			// chunk contributes nothing while the chunks around it still do, so its targets are DROPPED rather
			// than reported as absent — the difference between "unknown" and "proven absent" is the read's whole
			// value, and a failure must never be cached as an answer.
			if (warning == null) {
				appendDedupedWarning(
					warnings,
					otherWarning(
						options.providerId,
						domain,
						options.connectionId,
						`Batch issue resolution is not supported by '${options.providerId}'; resolve issues individually instead.`,
					),
				);
			}
			fetchFailed = true;
			continue;
		}

		for (let i = 0; i < batch.length; i++) {
			const issue = value[i];
			items.push({ key: batch[i].key, ...(issue != null ? { issue: issue } : {}) });
		}
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function findDuplicateKey(targets: readonly { key: string }[]): string | undefined {
	const seen = new Set<string>();
	for (const target of targets) {
		if (seen.has(target.key)) return target.key;

		seen.add(target.key);
	}
	return undefined;
}
