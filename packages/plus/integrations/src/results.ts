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
