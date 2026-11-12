import type { IntegrationIds } from '../constants.js';
import { isGitHostIntegration } from '../models/publicIntegration.js';
import { githubGraphQLInt32Max, isAzureProviderId, isGitHubProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning, PullRequestBatchResult, PullRequestBatchTarget } from '../results.js';
import { isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import { readEtaggedBatch } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { getCurrentAccountIdentity, runCaptured } from './drains.js';
import type { PullRequestEtagInclude } from './etag.js';
import {
	findInvalidPullRequestEtagInclude,
	normalizePullRequestEtagIncludes,
	pullRequestEtag,
	pullRequestEtagFieldsFromShape,
	pullRequestEtagIncludes,
} from './etag.js';
import { findDuplicateKey, trimCoordinateFields, unresolvedIntegration } from './issueBatch.js';
import { gitHostOnlySurfaceWarning, otherWarning, unsupportedWarning } from './warnings.js';

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
 * ONE integration call per invocation when no target carries an `etag`, whatever the target count: the manager makes
 * a single `getPullRequestsBatchResult` call and the integration fans its targets out (chunked for GitHub/GHE, one
 * request per target with bounded concurrency everywhere else) and settles each independently, so one bad target
 * never spends more than its own slot — see `GitHostIntegration.getPullRequestsBatchResult`.
 *
 * With etags, up to THREE on a host with a cheap check (GitHub/GHE, GitLab, Azure DevOps and Bitbucket Cloud so far):
 * the cheap check of the targets that carry one, a full read of the targets that don't, started alongside it, and a
 * full read of the targets whose etag no longer matches — see `readEtaggedBatch`. A host without a cheap check still
 * makes one call.
 */

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
		/**
		 * Widens every etag to the listed inputs, each of which a host changes without moving the pull request's
		 * update time, and each of which costs its own fields in the cheap check. `'checks'` is the check rollup.
		 * Order and repeats don't matter. An unknown value refuses the whole call. Changes only which etag is
		 * computed; the full read is the same. Calls that differ in this set never match each other's etags.
		 */
		etagIncludes?: readonly PullRequestEtagInclude[];
		/** See {@link IntegrationManager.getPullRequestsBatch}. */
		mergeQueue?: boolean;
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

	// Same as a bad target: refused whole before any request, naming the value and what's allowed.
	const invalidInclude = findInvalidPullRequestEtagInclude(options.etagIncludes ?? []);
	if (invalidInclude != null) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Unknown pull request etag include '${invalidInclude}'; expected one of ${pullRequestEtagIncludes.map(i => `'${i}'`).join(', ')}.`,
			),
		);
	}

	// The validated value must be the one sent to the provider, so every string field is trimmed once here.
	const targets = options.targets.map(trimCoordinateFields);

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
	const etagIncludes = normalizePullRequestEtagIncludes(options.etagIncludes ?? []);
	// Resolved once, so the cheap check and the full read select the same data and their etags agree even if the host's
	// setting changes while the call is in flight.
	const mergeQueue = options.mergeQueue ?? ctx.getPullRequestReadOptions().mergeQueue === true;
	const toCoordinate = (t: PullRequestBatchTarget) => ({
		owner: t.owner,
		repo: t.repo,
		number: t.number,
		project: t.project,
	});

	// Read once per invocation, however many full reads it takes, and only when one does: a call whose every
	// target is unchanged has no row to resolve authorship for.
	let currentAccount: Promise<{ id: string; username?: string } | undefined> | undefined;

	const result = await readEtaggedBatch({
		providerId: options.providerId,
		domain: domain,
		connectionId: options.connectionId,
		targets: targets,
		supportsEtags: integration.supportsPullRequestEtags,
		readFull: batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				async () =>
					integration.getPullRequestsBatchResult(
						batch.map(toCoordinate),
						{
							currentAccount: await (currentAccount ??= getCurrentAccountIdentity(
								integration,
								options.connectionId,
							)),
							mergeQueue: mergeQueue,
						},
						undefined,
						options.connectionId,
					),
				// A missing session must surface as a connection warning, including on the primary path, which
				// otherwise reads it as "not connected" and says nothing.
				{ warnOnMissingSession: true },
			),
		readEtagFields: batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() =>
					integration.getPullRequestsEtagFieldsResult(
						batch.map(toCoordinate),
						{ etagIncludes: etagIncludes, mergeQueue: mergeQueue },
						undefined,
						options.connectionId,
					),
				{ warnOnMissingSession: true },
			),
		itemEtag: pr => pullRequestEtag(pullRequestEtagFieldsFromShape(pr), etagIncludes),
		fieldsEtag: fields => pullRequestEtag(fields, etagIncludes),
		unsupportedWarning: () =>
			unsupportedWarning(
				options.providerId,
				domain,
				options.connectionId,
				`${surface} is not supported by '${options.providerId}'; resolve pull requests individually instead.`,
			),
	});

	return {
		items: result.items.map(row => ({
			key: row.key,
			...(row.value != null ? { pullRequest: row.value } : {}),
			...(row.unchanged ? { unchanged: true as const } : {}),
			...(row.etag != null ? { etag: row.etag } : {}),
		})),
		warnings: result.warnings,
		fetchFailed: result.fetchFailed,
	};
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
		if (target.owner.length === 0 || target.repo.length === 0) {
			return `Pull request batch target '${target.key}' requires a non-empty owner and repo.`;
		}
		if (requiresProject && !target.project) {
			return `Pull request batch target '${target.key}' requires a project for '${providerId}'.`;
		}
	}
	return undefined;
}
