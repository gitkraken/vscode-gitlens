import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { IntegrationIds, IssuesHostIntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import type { IssueEtagInclude } from '../models/integration.js';
import { issueEtagIncludes } from '../models/integration.js';
import { isIssuesIntegration } from '../models/issuesIntegration.js';
import { githubGraphQLInt32Max, isAzureProviderId, isGitHubProviderId } from '../providers/providerErrors.js';
import type { ProviderResult, ProviderWarning } from '../results.js';
import { areDomainsOnSameHost, hostFromDomain } from '../utils/domain.utils.js';
import {
	isGitHostIntegration,
	isIssuesHostIntegrationId,
	isIssuesSelfManagedHostIntegrationId,
} from '../utils/integration.utils.js';
import type { EtaggedBatchRow } from './batchEtags.js';
import { readEtaggedBatch } from './batchEtags.js';
import type { ProviderReadContext } from './context.js';
import { runCaptured } from './drains.js';
import {
	findInvalidIssueEtagInclude,
	issueEtag,
	issueEtagFieldsFromShape,
	normalizeIssueEtagIncludes,
} from './etag.js';
import {
	gitHostOnlySurfaceWarning,
	issuesUnsupportedWarning,
	issueTrackerOnlySurfaceWarning,
	noConnectionWarning,
	otherWarning,
	unsupportedWarning,
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
 * ONE integration call per invocation when no target carries an `etag`, whatever the target count, as in
 * `getPullRequestsBatch`: the integration fans its targets out (chunked for GitHub/GHE, one request per target with
 * bounded concurrency on GitLab and Azure DevOps and on the trackers) and settles each independently, so failing
 * targets spend at most one strike of the integration's failure budget.
 *
 * With etags, up to THREE on a host with a cheap check (GitHub/GHE, GitLab and Azure DevOps; Jira Cloud and Linear
 * among the trackers): the cheap check of the targets that carry one, a full read of the rest started alongside it,
 * and a full read of the targets whose etag no longer matches — see `readEtaggedBatch`. Every other tracker still makes
 * one call and etags its rows.
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
			/** The {@link IssueBatchResult.etag} of the copy the caller holds; see {@link IssueBatchResult}. */
			etag?: string;
	  }
	/**
	 * An issue tracker's issue, by its own identifier (e.g. `ABC-123`) within a resource. Jira (Cloud and Data
	 * Center) and Linear. For Jira Data Center `resourceId` is the host — the instance's single resource, as
	 * `listOrgs` reports it — and `resourceUrl` is not needed, since the browser link is built from the
	 * connection's own base URL; Jira Cloud requires it.
	 */
	| {
			key: string;
			resourceId: string;
			resourceUrl?: string;
			identifier: string;
			/**
			 * The {@link IssueBatchResult.etag} of the copy the caller holds. Checked cheaply on Jira Cloud and Linear;
			 * every other tracker accepts it but reads the issue in full.
			 */
			etag?: string;
	  };

type CoordinateTarget = Extract<IssueBatchTarget, { owner: string }>;
type TrackerTarget = Extract<IssueBatchTarget, { resourceId: string }>;

/**
 * The answer for one {@link IssueBatchTarget}, in one of four states:
 * - `{ key, issue, etag }` — read in full. Every fully read row carries an `etag`, whether or not the caller sent
 *   one, so a caller can seed its etags from the reads it already makes.
 * - `{ key, unchanged: true, etag }` — the cheap check proved the caller's copy current, and nothing else was
 *   fetched. Only for a target that sent an `etag`, on a host with a cheap check.
 * - `{ key }` — PROVEN ABSENT.
 * - no row, with `fetchFailed` and a warning — the read could not check. Never treat that as absent.
 */
export interface IssueBatchResult {
	key: string;
	/**
	 * The resolved issue, or `undefined` when it PROVABLY does not exist (or is not visible to this connection) —
	 * or when it is `unchanged`.
	 *
	 * Absent is an answer here, unlike every paged read on this facade: a target that FAILED — its own request
	 * outright, or just its own alias within an otherwise-answering GitHub chunk (e.g. an org enforcing SAML SSO
	 * the token isn't authorized for) — is not returned at all and sets `fetchFailed`, so a caller can tell
	 * "proven absent" from "unknown" and cache the first without ever caching the second.
	 */
	issue?: IssueShape;
	/**
	 * Opaque: compare for equality only, never parse. Computed by core from the issue's change state — its state and
	 * update time, plus each input the call's `etagIncludes` listed — and NOT the provider's HTTP ETag. Send it back
	 * as the target's `etag`. An etag from another scheme or another `etagIncludes` set simply compares unequal and
	 * costs a full read, never a false `unchanged`. A host can add a reaction without moving the update time, so
	 * unless `'reactions'` is listed, an `unchanged` copy's `thumbsUpCount` may be stale.
	 */
	etag?: string;
	/** The caller's copy is current (its `etag` matched); `issue` is absent because nothing was read. */
	unchanged?: true;
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
		/**
		 * Widens every etag to the listed inputs, each of which a host changes without moving the issue's update
		 * time, and each of which costs its own fields in the cheap check. `'reactions'` is the thumbs-up count; it
		 * widens nothing on a host whose rows carry no real count (Azure DevOps work items and the trackers). Order
		 * and repeats don't matter. An unknown value refuses the whole call. Changes only which etag is computed; the
		 * full read is the same. Calls that differ in this set never match each other's etags.
		 */
		etagIncludes?: readonly IssueEtagInclude[];
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

	// Same as a bad target: refused whole before any request, naming the value and what's allowed.
	const invalidInclude = findInvalidIssueEtagInclude(options.etagIncludes ?? []);
	if (invalidInclude != null) {
		return refused(
			otherWarning(
				options.providerId,
				undefined,
				options.connectionId,
				`Unknown issue etag include '${invalidInclude}'; expected one of ${issueEtagIncludes.map(i => `'${i}'`).join(', ')}.`,
			),
		);
	}

	const etagIncludes = normalizeIssueEtagIncludes(options.etagIncludes ?? []);

	if (isIssuesHostIntegrationId(options.providerId)) {
		return getIssuesBatchForTracker(
			ctx,
			options.providerId,
			options.targets,
			options.connectionId,
			options.domain,
			etagIncludes,
		);
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

	// The validated value must be the one sent to the provider, so every string field is trimmed once here.
	const trimmedTargets = targets.map(trimCoordinateFields);

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream, where a blank owner or repo
	// would come back as a missing repository — a proven absence the caller would cache.
	const invalid = findInvalidCoordinateTarget(options.providerId, trimmedTargets);
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

	const toCoordinate = (t: CoordinateTarget) => ({
		owner: t.owner,
		repo: t.repo,
		number: t.number,
		project: t.project,
	});
	const result = await readEtaggedBatch({
		providerId: options.providerId,
		domain: domain,
		connectionId: options.connectionId,
		targets: trimmedTargets,
		supportsEtags: integration.supportsIssueEtags,
		readFull: batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() => integration.getIssuesBatchResult(batch.map(toCoordinate), undefined, options.connectionId),
				// A missing session must surface as a connection warning, including on the primary path, which
				// otherwise reads it as "not connected" and says nothing — and this read would then call it
				// unsupported.
				{ warnOnMissingSession: true },
			),
		readEtagFields: batch =>
			runCaptured(
				options.providerId,
				domain,
				options.connectionId,
				() =>
					integration.getIssuesEtagFieldsResult(
						batch.map(toCoordinate),
						{ etagIncludes: etagIncludes },
						undefined,
						options.connectionId,
					),
				{ warnOnMissingSession: true },
			),
		itemEtag: issue => issueEtag(issueEtagFieldsFromShape(issue), etagIncludes),
		fieldsEtag: fields => issueEtag(fields, etagIncludes),
		// A provider that doesn't implement the batch hook answers `undefined` with no error. Either way its targets
		// are DROPPED rather than reported as absent — the difference between "unknown" and "proven absent" is the
		// read's whole value, and a failure must never be cached as an answer.
		unsupportedWarning: () =>
			unsupportedWarning(
				options.providerId,
				domain,
				options.connectionId,
				`${surface} is not supported by '${options.providerId}'; resolve issues individually instead.`,
			),
	});

	return toIssueBatchResult(result);
}

/**
 * The tracker form. ONE integration call per invocation when no target carries an `etag`, whatever the target count:
 * the integration makes one single-issue request per target, with bounded concurrency, and settles each independently
 * — see `IssuesIntegration.getIssuesByResourceIdBatchResult`. With etags, a tracker with a cheap check (Jira Cloud's
 * bulk fetch, Linear's per-team query) takes the coordinate form's `readEtaggedBatch` flow; every other tracker
 * ignores a target's `etag` and reads and etags every found row in full.
 *
 * `resourceId` is trusted and the read does no resource discovery. It is handed to the provider's by-resource-id
 * read as-is, never wrapped into a synthesized descriptor: Linear and Trello answer `undefined` for a descriptor
 * that fails `isIssueResourceDescriptor`, which would be published as a proven absence.
 *
 * `domain` selects the host of a self-managed tracker (Jira Data Center), as it does for
 * `listIssueTrackerIssuesPage`, and is ignored for the cloud trackers, which have a single canonical host. Unlike
 * the paged reads, this one never falls back to the primary connection for a self-managed tracker: it requires a
 * `domain` or a `connectionId` with a configured host and refuses otherwise. Two self-hosted instances routinely
 * issue the same project and issue keys, and `issue: undefined` is a proven absence a caller may cache — an answer
 * from whichever host happens to be primary would be cached under a key that names a different instance (#5872).
 */
async function getIssuesBatchForTracker(
	ctx: ProviderReadContext,
	providerId: IssuesHostIntegrationIds,
	targets: readonly IssueBatchTarget[],
	connectionId: string | undefined,
	domain: string | undefined,
	etagIncludes: readonly IssueEtagInclude[],
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

	// The validated value must be the one sent to the provider, so every string field is trimmed once here.
	const trimmedTargets = targets.map(trimTrackerTarget);

	// Deterministic caller bugs, refused like a duplicate key rather than sent upstream to fail one by one.
	const invalid = findInvalidTrackerTarget(providerId, trimmedTargets);
	if (invalid != null) {
		return refused(otherWarning(providerId, undefined, connectionId, invalid));
	}

	// A `domain` only selects a host when it parses to one, and a `connectionId` only when it names a configured
	// connection that has one; anything else would resolve the primary host instead, which is the fallback this
	// read refuses.
	if (
		isIssuesSelfManagedHostIntegrationId(providerId) &&
		(domain != null
			? hostFromDomain(domain) == null
			: connectionId == null ||
				!ctx.getConfigured(providerId).some(c => c.id === connectionId && hostFromDomain(c.domain) != null))
	) {
		return refused(
			otherWarning(
				providerId,
				undefined,
				connectionId,
				`${surface} requires a domain or a configured connection id for '${providerId}': every configured host can hold a different issue under the same key, so the read does not answer from the primary connection.`,
			),
		);
	}

	const integration = await ctx.getIntegrationForRead(providerId, connectionId, domain);
	if (integration == null) return unresolvedIntegration(ctx, providerId, connectionId, domain);
	if (!isIssuesIntegration(integration)) {
		return refused(issueTrackerOnlySurfaceWarning(providerId, connectionId, surface));
	}

	const unsupported = (): ProviderWarning =>
		unsupportedWarning(
			providerId,
			undefined,
			connectionId,
			`${surface} is not supported by '${providerId}'; its single-issue read cannot prove an absence, so a miss would not be safe to cache.`,
		);
	if (!integration.supportsIssueLookupByResourceId) return refused(unsupported());

	// A self-managed tracker's single resource is its host, and a caller keys (and caches) each answer by
	// `resourceId` while the read is addressed to the host `domain`/`connectionId` resolved. When they disagree,
	// host B's answer — including a cacheable absence — would be stored under host A's key. Refused whole, like
	// the caller bugs above: a target naming another host means the call selected a host its caller did not mean.
	if (isIssuesSelfManagedHostIntegrationId(providerId)) {
		const mismatched = trimmedTargets.find(t => !areDomainsOnSameHost(t.resourceId, integration.domain));
		if (mismatched != null) {
			return refused(
				otherWarning(
					providerId,
					undefined,
					connectionId,
					`Issue batch target '${mismatched.key}' requires the resource id of '${providerId}' to name the host the read resolved to.`,
				),
			);
		}
	}

	const resolvedDomain = ctx.domainForRead(integration, providerId, connectionId, domain);

	const toResourceTarget = (t: TrackerTarget) => ({
		resourceId: t.resourceId,
		identifier: t.identifier,
		resourceUrl: t.resourceUrl,
	});
	const result = await readEtaggedBatch({
		providerId: providerId,
		domain: resolvedDomain,
		connectionId: connectionId,
		targets: trimmedTargets,
		supportsEtags: integration.supportsIssueEtagsByResourceId,
		readFull: batch =>
			runCaptured(
				providerId,
				resolvedDomain,
				connectionId,
				() => integration.getIssuesByResourceIdBatchResult(batch.map(toResourceTarget), connectionId),
				// The read core answers `undefined` when it cannot resolve a session. That must surface as a connection
				// warning, including on the primary path, rather than as nothing — or worse, be read as absence.
				{ warnOnMissingSession: true },
			),
		readEtagFields: batch =>
			runCaptured(
				providerId,
				resolvedDomain,
				connectionId,
				() =>
					integration.getIssuesEtagFieldsByResourceIdBatchResult(
						batch.map(toResourceTarget),
						{ etagIncludes: etagIncludes },
						connectionId,
					),
				{ warnOnMissingSession: true },
			),
		itemEtag: issue => issueEtag(issueEtagFieldsFromShape(issue), etagIncludes),
		fieldsEtag: fields => issueEtag(fields, etagIncludes),
		unsupportedWarning: unsupported,
	});

	return toIssueBatchResult(result);
}

/** The etag flow's rows as this read's results, under the `issue` name the result type gives the item. */
function toIssueBatchResult(result: ProviderResult<EtaggedBatchRow<IssueShape>>): ProviderResult<IssueBatchResult> {
	return {
		items: result.items.map(row => ({
			key: row.key,
			...(row.value != null ? { issue: row.value } : {}),
			...(row.unchanged ? { unchanged: true as const } : {}),
			...(row.etag != null ? { etag: row.etag } : {}),
		})),
		warnings: result.warnings,
		fetchFailed: result.fetchFailed,
	};
}

function isCoordinateTarget(target: IssueBatchTarget): target is CoordinateTarget {
	return 'owner' in target;
}

function isTrackerTarget(target: IssueBatchTarget): target is TrackerTarget {
	return 'resourceId' in target;
}

/**
 * Trims `owner`, `repo` and `project` once, shared by every coordinate-form batch read (this one, the pull request
 * batch and the pull-requests-by-branch read): leading/trailing whitespace can't change which repository a
 * coordinate names, so it's stripped and accepted rather than refused, matching #5821's scope-name precedent.
 */
export function trimCoordinateFields<T extends { owner: string; repo: string; project?: string }>(target: T): T {
	return { ...target, owner: target.owner.trim(), repo: target.repo.trim(), project: target.project?.trim() };
}

/** Trims `resourceId`, `resourceUrl` and `identifier` once; the validated value must be the one sent to the provider. */
function trimTrackerTarget(target: TrackerTarget): TrackerTarget {
	return {
		...target,
		resourceId: target.resourceId.trim(),
		resourceUrl: target.resourceUrl?.trim() || undefined,
		identifier: target.identifier.trim(),
	};
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
		if (target.owner.length === 0) {
			return `Issue batch target '${target.key}' requires a non-empty owner.`;
		}
		if (isAzure) {
			if (!target.project) {
				return `Issue batch target '${target.key}' requires a project for '${providerId}'.`;
			}
		} else if (target.repo.length === 0) {
			return `Issue batch target '${target.key}' requires a non-empty repo.`;
		}
	}
	return undefined;
}

function findInvalidTrackerTarget(
	providerId: IssuesHostIntegrationIds,
	targets: readonly TrackerTarget[],
): string | undefined {
	for (const target of targets) {
		if (target.resourceId.length === 0) {
			return `Issue batch target '${target.key}' requires a resource id.`;
		}
		if (target.identifier.length === 0) {
			return `Issue batch target '${target.key}' requires an issue identifier.`;
		}
		if (providerId === IssuesCloudHostIntegrationId.Jira && !target.resourceUrl) {
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
