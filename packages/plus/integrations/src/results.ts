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
	kind: 'auth' | 'rate-limit' | 'not-found' | 'other';
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
