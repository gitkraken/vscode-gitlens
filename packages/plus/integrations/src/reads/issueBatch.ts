import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { githubGraphQLInt32Max, isAzureProviderId, isGitHubProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { appendDedupedWarning, toProviderWarning } from '../results.js';
import { isGitHostIntegration, isIssuesHostIntegrationId } from '../utils/integration.utils.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import {
	gitHostOnlySurfaceWarning,
	issuesUnsupportedWarning,
	issueTrackerOnlySurfaceWarning,
	noConnectionWarning,
	otherWarning,
} from './warnings.js';

/**
 * The BATCH issue read: resolve N issues BY IDENTITY in one call — `(owner, repo, number)` coordinates on a git
 * host, `(resourceId, ABC-123)` identifiers on an issue tracker.
 *
 * A sibling of the issue searches rather than a mode of one, because it answers a different question. A search
 * asks "what matches"; this asks "does this exact issue exist", which is what a caller correlating a branch name
 * to the issue it references is actually asking. Three consequences follow, and they are the reason this exists:
 *
 * - It resolves by EXACT IDENTIFIER, so relevance never enters into it.
 * - No result ceiling applies, so there is no partial window to reason about and no omission to report.
 * - An absent slot is a PROVEN ABSENCE, not "not found within a page budget". That is the property that matters
 *   most: a caller can CACHE a miss. Emulating this with a paged list cannot prove absence without walking the
 *   whole scope, so a miss stays unproven and the walk repeats on every pass, forever.
 *
 * Modeled on `countIssues` for its shape — caller-owned `key` echoed back, per-target isolation, as few requests
 * as the provider allows — because both take a set of independent questions and answer them together.
 *
 * ONE integration call per invocation, whatever the target count, as in `getPullRequestsBatch`: the integration
 * fans its targets out (chunked for GitHub/GHE, one request per target with bounded concurrency on GitLab and
 * Azure DevOps and on the trackers) and settles each independently, so failing targets spend at most one strike
 * of the integration's failure budget.
 */

/** One issue to resolve, echoed back under the caller's own `key`. Which form a call takes depends on its provider. */
export type IssueBatchTarget =
	/**
	 * A git host's issue, by repository coordinate. GitHub/GHE, GitLab (and self-managed) and Azure DevOps (and
	 * Server); Bitbucket and Bitbucket Data Center have no issues and refuse.
	 */
	| {
			key: string;
			/** GitHub owner, GitLab namespace path (may be nested), or Azure DevOps organization (or collection). */
			owner: string;
			/**
			 * Repository name. Required, but ignored on Azure DevOps, whose work items belong to the project rather
			 * than to a repository.
			 */
			repo: string;
			/** Issue number, GitLab issue iid, or Azure DevOps work item id. */
			number: number;
			/** Azure DevOps project. Required there, ignored elsewhere. */
			project?: string;
	  }
	/** An issue tracker's issue, by its own identifier (e.g. `ABC-123`) within a resource. Jira and Linear. */
	| { key: string; resourceId: string; resourceUrl?: string; identifier: string };

type CoordinateTarget = Extract<IssueBatchTarget, { owner: string }>;
type TrackerTarget = Extract<IssueBatchTarget, { resourceId: string }>;

/** The answer for one {@link IssueBatchTarget}. */
export interface IssueBatchResult {
	key: string;
	/**
	 * The resolved issue, or `undefined` when it PROVABLY does not exist (or is not visible to this connection).
	 *
	 * Absent is an answer here, unlike every paged read on this facade: a target that FAILED — its own request
	 * outright, or just its own alias within an otherwise-answering GitHub chunk (e.g. an org enforcing SAML SSO
	 * the token isn't authorized for) — is not returned at all and sets `fetchFailed`, so a caller can tell
	 * "proven absent" from "unknown" and cache the first without ever caching the second.
	 */
	issue?: IssueShape;
}

const surface = 'Batch issue resolution';

function refused(warning: ProviderWarning): ProviderResult<IssueBatchResult> {
	return { items: [], warnings: [warning], fetchFailed: true };
}

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

	if (isIssuesHostIntegrationId(options.providerId)) {
		return getIssuesBatchForTracker(ctx, options.providerId, options.targets, options.connectionId);
	}

	const targets = options.targets;
	if (!targets.every(isCoordinateTarget)) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`${surface} for '${options.providerId}' takes repository coordinates { key, owner, repo, number, project? }, not tracker identifiers.`,
			),
		);
	}

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream, where a blank owner or repo
	// would come back as a missing repository — a proven absence the caller would cache.
	const invalid = findInvalidCoordinateTarget(options.providerId, targets);
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

	if (!integration.supportsIssues) {
		return refused(issuesUnsupportedWarning(options.providerId, domain, options.connectionId));
	}

	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	const { value: slots, warning } = await runCaptured(
		options.providerId,
		domain,
		options.connectionId,
		() =>
			integration.getIssuesBatchResult(
				targets.map(t => ({ owner: t.owner, repo: t.repo, number: t.number, project: t.project })),
				undefined,
				options.connectionId,
			),
		// A missing session must surface as a connection warning, including on the primary path, which
		// otherwise reads it as "not connected" and says nothing — and this read would then call it unsupported.
		{ warnOnMissingSession: true },
	);
	if (warning != null) {
		appendDedupedWarning(warnings, warning);
	}

	if (slots == null) {
		// A provider that doesn't implement the batch hook answers `undefined` with no error. Either way its
		// targets are DROPPED rather than reported as absent — the difference between "unknown" and "proven
		// absent" is the read's whole value, and a failure must never be cached as an answer.
		if (warning == null) {
			appendDedupedWarning(
				warnings,
				otherWarning(
					options.providerId,
					domain,
					options.connectionId,
					`${surface} is not supported by '${options.providerId}'; resolve issues individually instead.`,
				),
			);
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: IssueBatchResult[] = [];
	for (let i = 0; i < targets.length; i++) {
		const slot = slots[i];
		if (slot.status === 'rejected') {
			// Dropped, never reported absent, like a whole-call failure: only THIS target failed.
			appendDedupedWarning(
				warnings,
				toProviderWarning(options.providerId, domain, options.connectionId, slot.reason),
			);
			fetchFailed = true;
			continue;
		}

		const issue = slot.value;
		items.push({ key: targets[i].key, ...(issue != null ? { issue: issue } : {}) });
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

/**
 * The tracker form. ONE integration call per invocation, whatever the target count: the integration makes one
 * single-issue request per target, with bounded concurrency, and settles each independently — see
 * `IssuesIntegration.getIssuesByResourceIdBatchResult`.
 *
 * `resourceId` is trusted and the read does no resource discovery. It is handed to the provider's by-resource-id
 * read as-is, never wrapped into a synthesized descriptor: Linear and Trello answer `undefined` for a descriptor
 * that fails `isIssueResourceDescriptor`, which would be published as a proven absence.
 */
async function getIssuesBatchForTracker(
	ctx: ProviderReadContext,
	providerId: IssuesCloudHostIntegrationId,
	targets: readonly IssueBatchTarget[],
	connectionId: string | undefined,
): Promise<ProviderResult<IssueBatchResult>> {
	if (!targets.every(isTrackerTarget)) {
		return refused(
			otherWarning(
				providerId,
				undefined,
				connectionId,
				`${surface} for '${providerId}' takes tracker identifiers { key, resourceId, resourceUrl?, identifier }, not repository coordinates.`,
			),
		);
	}

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream to fail one by one.
	const invalid = findInvalidTrackerTarget(providerId, targets);
	if (invalid != null) {
		return refused(otherWarning(providerId, undefined, connectionId, invalid));
	}

	const integration = await ctx.getIntegrationForRead(providerId, connectionId);
	if (integration == null) return unresolvedIntegration(ctx, providerId, connectionId, undefined);
	if (!isIssuesIntegration(integration)) {
		return refused(issueTrackerOnlySurfaceWarning(providerId, connectionId, surface));
	}

	const unsupported = (): ProviderWarning =>
		otherWarning(
			providerId,
			undefined,
			connectionId,
			`${surface} is not supported by '${providerId}'; its single-issue read cannot prove an absence, so a miss would not be safe to cache.`,
		);
	if (!integration.supportsIssueLookupByResourceId) return refused(unsupported());

	const domain = ctx.domainForRead(integration, providerId, connectionId);
	const warnings: ProviderWarning[] = [];
	let fetchFailed = false;

	const { value: slots, warning } = await runCaptured(
		providerId,
		domain,
		connectionId,
		() =>
			integration.getIssuesByResourceIdBatchResult(
				targets.map(t => ({
					resourceId: t.resourceId,
					identifier: t.identifier,
					resourceUrl: t.resourceUrl?.trim() || undefined,
				})),
				connectionId,
			),
		// The read core answers `undefined` when it cannot resolve a session. That must surface as a connection
		// warning, including on the primary path, rather than as nothing — or worse, be read as absence.
		{ warnOnMissingSession: true },
	);
	if (warning != null) {
		appendDedupedWarning(warnings, warning);
	}

	if (slots == null) {
		// Dropped, never reported absent: "unknown" and "proven absent" must stay distinguishable.
		if (warning == null) {
			appendDedupedWarning(warnings, unsupported());
		}
		return { items: [], warnings: warnings, fetchFailed: true };
	}

	const items: IssueBatchResult[] = [];
	for (let i = 0; i < targets.length; i++) {
		const slot = slots[i];
		if (slot.status === 'rejected') {
			// Dropped, never reported absent, like a whole-call failure.
			appendDedupedWarning(warnings, toProviderWarning(providerId, domain, connectionId, slot.reason));
			fetchFailed = true;
			continue;
		}

		const issue = slot.value;
		items.push({ key: targets[i].key, ...(issue != null ? { issue: issue } : {}) });
	}

	return { items: items, warnings: warnings, fetchFailed: fetchFailed || undefined };
}

function isCoordinateTarget(target: IssueBatchTarget): target is CoordinateTarget {
	return 'owner' in target;
}

function isTrackerTarget(target: IssueBatchTarget): target is TrackerTarget {
	return 'resourceId' in target;
}

function findInvalidCoordinateTarget(
	providerId: IntegrationIds,
	targets: readonly CoordinateTarget[],
): string | undefined {
	const isAzure = isAzureProviderId(providerId);
	const isGitHub = isGitHubProviderId(providerId);
	for (const target of targets) {
		if (!Number.isSafeInteger(target.number) || target.number <= 0) {
			return `Issue batch target '${target.key}' has number ${target.number}; expected a positive integer.`;
		}
		if (isGitHub && target.number > githubGraphQLInt32Max) {
			return `Issue batch target '${target.key}' has number ${target.number}; GitHub numbers are 32-bit and cannot exceed ${githubGraphQLInt32Max}.`;
		}
		if (target.owner.trim().length === 0) {
			return `Issue batch target '${target.key}' requires a non-empty owner.`;
		}
		if (isAzure) {
			if (!target.project?.trim()) {
				return `Issue batch target '${target.key}' requires a project for '${providerId}'.`;
			}
		} else if (target.repo.trim().length === 0) {
			return `Issue batch target '${target.key}' requires a non-empty repo.`;
		}
	}
	return undefined;
}

function findInvalidTrackerTarget(
	providerId: IssuesCloudHostIntegrationId,
	targets: readonly TrackerTarget[],
): string | undefined {
	for (const target of targets) {
		if (target.resourceId.trim().length === 0) {
			return `Issue batch target '${target.key}' requires a resource id.`;
		}
		if (target.identifier.trim().length === 0) {
			return `Issue batch target '${target.key}' requires an issue identifier.`;
		}
		if (providerId === IssuesCloudHostIntegrationId.Jira && !target.resourceUrl?.trim()) {
			return `Issue batch target '${target.key}' requires the Jira resource URL so the result contains a browser link without resource discovery.`;
		}
	}
	return undefined;
}

/**
 * The answer when no integration resolves for a batch read. Targets were asked about, so this is never a silent
 * empty success: a supplied connection or domain that no longer resolves gets its own warning, and the untargeted
 * primary path (e.g. a self-managed provider with no configured host) a connection warning, as `getCurrentAccount`
 * gives — either way `fetchFailed`, so no caller mistakes the dropped targets for an answer.
 */
export function unresolvedIntegration<T>(
	ctx: ProviderReadContext,
	providerId: IntegrationIds,
	connectionId: string | undefined,
	domain: string | undefined,
): ProviderResult<T> {
	const early = ctx.earlyReturnConnectionWarnings(providerId, connectionId, domain);
	if (early.warnings.length > 0) return { items: [], warnings: early.warnings, fetchFailed: true };

	const resolvedDomain = ctx.resolveDomainForRead(providerId, connectionId, domain);
	return { items: [], warnings: [noConnectionWarning(providerId, resolvedDomain, connectionId)], fetchFailed: true };
}

export function findDuplicateKey(targets: readonly { key: string }[]): string | undefined {
	const seen = new Set<string>();
	for (const target of targets) {
		if (seen.has(target.key)) return target.key;

		seen.add(target.key);
	}
	return undefined;
}
