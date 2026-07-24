import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IntegrationIds } from './constants.js';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

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
	/**
	 * True when a read failed and `items` is incomplete — distinguishes a failure from a genuinely empty
	 * result. Distinct from `page.truncated`, which marks a completed read that couldn't confirm it drained
	 * everything.
	 */
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
}

export interface ProviderSweepResult<T> extends ProviderResult<T> {
	page: ProviderPageInfo;
	hasMore: boolean;
	/**
	 * Providers whose top-level read failed before returning any usable page. Partial per-scope failures stay
	 * represented by `warnings` + `fetchFailed` and are intentionally excluded.
	 */
	failedProviderIds: IntegrationIds[];
}

export interface ProviderBroadenResult<T> extends ProviderPagedResult<T> {
	broadenedProviderIds: IntegrationIds[];
	fanOutCount: number;
}

export type RepositoryResolutionStatus =
	| 'resolved'
	| 'not-found'
	| 'unauthorized'
	| 'unsupported-provider'
	| 'invalid-remote-url'
	| 'host-mismatch'
	| 'undetermined';

export interface RepositoryIdentity {
	providerId: IntegrationIds;
	domain: string;
	/** The provider's canonical owner/namespace (follows renames), falling back to the parsed remote when omitted. */
	owner: string;
	/** The provider's canonical repo name (follows renames), falling back to the parsed remote when omitted. */
	name: string;
	project?: string;
	/** The original input remote URL, so the caller can key the resolution back to the remote it asked about. */
	remoteUrl: string;
	/**
	 * True when the provider's canonical owner/name differ from what the input remote URL carried — i.e. the
	 * repo was renamed/moved host-side and the local remote is stale. Case-insensitive, mirroring gkcli's
	 * `EqualFold` compare so hosts that echo the input casing (e.g. Bitbucket Server/Azure) aren't flagged.
	 */
	renamed: boolean;
}

export interface RepositoryResolution {
	status: RepositoryResolutionStatus;
	identity?: RepositoryIdentity;
	warning?: ProviderWarning;
}

export interface ResolveRepositoryResult {
	resolution: RepositoryResolution;
	/**
	 * Whether the resolver operation itself is unavailable. Per-request failures and unsupported providers
	 * never set this; consumers may use it as a global capability latch.
	 */
	cliUnsupported: boolean;
}

/**
 * Normalized org/workspace/group shape returned by the provider facade.
 * `name` is the provider identifier to pass to follow-up reads, while `org` is an optional display label.
 */
export interface ProviderOrganization {
	id: string;
	providerId: IntegrationIds;
	name: string;
	org?: string;
	url: string;
}

/** Normalized repository shape returned by the provider facade. */
export interface ProviderRepositoryShape {
	id: string;
	namespace: string;
	name: string;
	/** Azure DevOps project; `undefined` for hosts without a project layer. */
	project?: string;
	/** Web (browser) URL, when the provider exposes it. */
	url?: string;
	/** HTTPS clone URL, when available. */
	cloneUrlHttps?: string;
	/** SSH clone URL, when available. */
	cloneUrlSsh?: string;
	/** Default branch name, when the provider reports it. */
	defaultBranch?: string;
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
