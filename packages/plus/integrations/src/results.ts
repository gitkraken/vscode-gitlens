import type { CollectionMetadata, CollectionScopeFailure } from '@gitkraken/provider-apis';
import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IntegrationIds } from './constants.js';

/**
 * A per-provider, per-connection warning surfaced alongside (partial) read results. Consumers use
 * these to drive auth recovery, retry, or truncation messaging without the read itself throwing.
 *
 * `kind` is the programmatic discriminant (a rate-limit is retryable, a 404 is not, an auth failure
 * needs re-connection); `isAuth` is retained as a convenience mirror of `kind === 'auth'`.
 */
export interface ProviderWarning {
	providerId: IntegrationIds;
	/** Disambiguates connections on self-managed hosts (where one provider id spans multiple domains). */
	domain?: string;
	/** The specific token/connection the read was pinned to, when a `connectionId` was supplied. */
	connectionId?: string;
	message: string;
	kind: 'auth' | 'rate-limit' | 'not-found' | 'no-connection' | 'other';
	/** Convenience mirror of `kind === 'auth'`. */
	isAuth: boolean;
}

export interface ProviderPageInfo {
	currentPage: number;
	itemsPerPage: number;
	/** True when the read drained every page (a sweep), rather than returning a single page. */
	allPages?: boolean;
	/** True when a sweep stopped at its `maxPages` cap with more pages still available. */
	truncated?: boolean;
}

export interface ProviderResult<T> {
	items: T[];
	warnings: ProviderWarning[];
	/** True when a read failed and `items` is incomplete — distinguishes a failure from a genuinely empty result. */
	fetchFailed?: boolean;
}

export interface ProviderPagedResult<T> extends ProviderResult<T> {
	page: ProviderPageInfo;
	hasMore: boolean;
	/**
	 * Opaque cursor for cursor-based paging (GraphQL, per-repo/per-project cursors, etc.). For hosts that
	 * require the previous page's cursor, consumers should pass this value back to the next `cursor` option.
	 */
	cursor?: string;
	/** True when the underlying read threw and `items` is incomplete (distinct from `page.truncated`). */
	fetchFailed?: boolean;
}

export interface ProviderSweepResult<T> extends ProviderResult<T> {
	page: ProviderPageInfo;
	hasMore: boolean;
	fetchFailed?: boolean;
}

export interface ProviderBroadenResult<T> extends ProviderPagedResult<T> {
	broadenedProviderIds: IntegrationIds[];
	fanOutCount: number;
}

export type RepositoryResolutionStatus = 'resolved' | 'not-found' | 'unsupported' | 'no-connection' | 'error';

export interface RepositoryIdentity {
	providerId: IntegrationIds;
	domain: string;
	owner: string;
	name: string;
	project?: string;
	remoteUrl: string;
}

export interface RepositoryResolution {
	status: RepositoryResolutionStatus;
	identity?: RepositoryIdentity;
	warning?: ProviderWarning;
}

export interface ResolveRepositoryResult {
	resolution: RepositoryResolution;
	/** True when core-gitlens can't resolve the host at all (the CLI equivalent is likewise unsupported). */
	cliUnsupported: boolean;
}

/**
 * Classifies a caught provider exception into a neutral {@link ProviderWarning}. Ordering matters:
 * `instanceof` is checked most-specific-first so a rate-limit isn't mislabeled as a generic error and
 * a 404 isn't mislabeled as auth.
 */
export function toProviderWarning(
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	ex: unknown,
): ProviderWarning {
	let kind: ProviderWarning['kind'];
	if (ex instanceof AuthenticationError) {
		kind = 'auth';
	} else if (ex instanceof RequestRateLimitError) {
		kind = 'rate-limit';
	} else if (ex instanceof RequestNotFoundError) {
		kind = 'not-found';
	} else {
		kind = 'other';
	}

	return {
		providerId: providerId,
		domain: domain,
		connectionId: connectionId,
		message: ex instanceof Error ? ex.message : String(ex),
		kind: kind,
		isAuth: kind === 'auth',
	};
}

/**
 * Whether an exception is one a consumer should act on (re-auth, back off) rather than shrug off as a
 * transient blip. A fan-out (`Promise.allSettled`) that swallows every rejection into a generic "truncated"
 * signal hides these: a 401/429 on one project/workspace becomes indistinguishable from a page-backstop hit,
 * so Kepler never triggers recovery. Providers use this to re-throw such a rejection (preserving its kind)
 * instead of degrading it, while still tolerating transient 5xx/network errors as partial data.
 */
export function isRecoverableReadError(ex: unknown): boolean {
	return ex instanceof AuthenticationError || ex instanceof RequestRateLimitError;
}

/** Returns the first auth/rate-limit rejection in a settled fan-out, or undefined if none is recoverable. */
export function firstRecoverableRejection(settled: PromiseSettledResult<unknown>[]): Error | undefined {
	for (const outcome of settled) {
		// `isRecoverableReadError` only matches AuthenticationError/RequestRateLimitError, both `Error`s.
		if (outcome.status === 'rejected' && isRecoverableReadError(outcome.reason)) {
			return outcome.reason as Error;
		}
	}
	return undefined;
}

/** Maps a structured SDK failure kind to the neutral {@link ProviderWarning} discriminant. */
function collectionFailureKindToWarningKind(kind: CollectionScopeFailure['kind']): ProviderWarning['kind'] {
	switch (kind) {
		case 'authentication':
			return 'auth';
		case 'rate-limit':
			return 'rate-limit';
		case 'not-found':
			return 'not-found';
		// `network`, `provider`, and `unknown` are non-actionable-by-kind; surface them as a generic warning.
		default:
			return 'other';
	}
}

/** Builds a scope-aware warning message so a partial fan-out identifies which resource/project/repo failed. */
function collectionFailureMessage(failure: CollectionScopeFailure): string {
	const scope = failure.scope;
	const parts: string[] = [];
	if (scope?.resourceId != null) {
		parts.push(`resource ${scope.resourceId}`);
	}
	if (scope?.projectId != null) {
		parts.push(`project ${scope.projectId}`);
	}
	if (scope?.repositoryId != null) {
		parts.push(`repository ${scope.repositoryId}`);
	}

	const scopeText = parts.length ? ` (${parts.join(', ')})` : '';
	const detail = failure.message != null ? `: ${failure.message}` : '';
	return `Failed to read ${failure.kind} scope${scopeText}${detail}`;
}

/** A stable key for deduplicating warnings accumulated across drained pages / fan-out scopes. */
function providerWarningKey(warning: ProviderWarning): string {
	return [warning.providerId, warning.connectionId ?? '', warning.domain ?? '', warning.kind, warning.message].join(
		' ',
	);
}

/** Appends `warning` to `into` only when an equal warning (by provider/connection/domain/kind/message) is absent. */
export function appendDedupedWarning(into: ProviderWarning[], warning: ProviderWarning): void {
	const key = providerWarningKey(warning);
	if (into.some(existing => providerWarningKey(existing) === key)) return;

	into.push(warning);
}

/**
 * Converts SDK collection {@link CollectionMetadata} into neutral ProviderBackend signals, without discarding
 * any successful items the caller already holds:
 *
 * - Each structured `failure` becomes a scope-aware {@link ProviderWarning} classified by kind.
 * - `failures.length > 0` sets `fetchFailed` (the collection is incomplete because part of the read failed).
 * - `partial`/`unknown` completeness sets `truncated`. When there is no structured failure to explain the
 *   incompleteness, a single generic warning is added; when failures exist, no duplicate generic warning is.
 *
 * Warnings are built with the caller's GitLens `providerId` (never `failure.scope.providerId`, which reports
 * `azure` for both cloud and server) and deduplicated so repeated failures across drain pages collapse.
 */
export function assessCollectionMetadata(
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	metadata: CollectionMetadata | undefined,
): { warnings: ProviderWarning[]; fetchFailed: boolean; truncated: boolean } {
	if (metadata == null) return { warnings: [], fetchFailed: false, truncated: false };

	const warnings: ProviderWarning[] = [];
	const failures = metadata.failures ?? [];
	for (const failure of failures) {
		const kind = collectionFailureKindToWarningKind(failure.kind);
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message: collectionFailureMessage(failure),
			kind: kind,
			isAuth: kind === 'auth',
		});
	}

	const incomplete = metadata.completeness !== 'complete';
	// Incompleteness with no structured failure to explain it still needs one warning so the caller can surface
	// truncation; when failures already explain it, avoid a redundant second warning.
	if (incomplete && failures.length === 0) {
		appendDedupedWarning(warnings, {
			providerId: providerId,
			domain: domain,
			connectionId: connectionId,
			message:
				metadata.completeness === 'partial'
					? 'Some results were omitted; the read is incomplete'
					: 'Result completeness could not be confirmed',
			kind: 'other',
			isAuth: false,
		});
	}

	return { warnings: warnings, fetchFailed: failures.length > 0, truncated: incomplete };
}

/**
 * Convenience wrapper around {@link assessCollectionMetadata} for the common call-site pattern: assess the
 * metadata, append its warnings (deduped) into an existing `warnings` accumulator, and return the
 * `fetchFailed`/`truncated` flags for the caller to OR into its own. Keeps the four ProviderBackend read
 * paths that consume metadata from each re-implementing the same append-and-flag dance.
 */
export function mergeAssessmentInto(
	warnings: ProviderWarning[],
	providerId: IntegrationIds,
	domain: string | undefined,
	connectionId: string | undefined,
	metadata: CollectionMetadata | undefined,
): { fetchFailed: boolean; truncated: boolean } {
	const assessment = assessCollectionMetadata(providerId, domain, connectionId, metadata);
	for (const warning of assessment.warnings) {
		appendDedupedWarning(warnings, warning);
	}
	return { fetchFailed: assessment.fetchFailed, truncated: assessment.truncated };
}
