import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { IssueSorting } from '@gitlens/git/models/issue.js';
import type { PullRequestSorting } from '@gitlens/git/models/pullRequest.js';
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
 * needs re-connection unless {@link ProviderWarning.scope} confines it); `isAuth` is retained as a
 * convenience mirror of `kind === 'auth'`.
 */
export type ProviderWarningKind = 'auth' | 'rate-limit' | 'not-found' | 'no-connection' | 'other';

/**
 * Why a read that SUCCEEDED still withheld results:
 * - `provider-limit`: the provider refuses to serve past a cap it enforces (GitHub search's 1,000-result
 *   ceiling, Trello's `cards_limit`), so the excess is unreachable through that query.
 * - `recovery-budget`: the internal partitioned recovery stopped spending upstream requests before it ran
 *   out of partitions to visit.
 * - `pagination-incomplete`: pages were left unread — a sub-scope of a multi-scope read that was not drained,
 *   a drain that stopped at its own page backstop, or a provider that advertised another page and gave no way
 *   to reach it. These have DIFFERENT remedies, so the kind alone does not say whether more can be fetched;
 *   read {@link ProviderWarningOmission.recovery} for that.
 *
 * Mirrors the vocabulary the SDK reports. Declared here rather than imported so this module stays free of
 * `@gitkraken/provider-apis` types (see the export block in `index.ts`); `collectionMetadata.ts` holds the
 * compile-time link, so an SDK bump that adds a kind fails the build at that boundary.
 */
export type ProviderWarningOmissionKind = 'provider-limit' | 'recovery-budget' | 'pagination-incomplete';

/**
 * How a consumer can recover omitted results. `page-budget` reruns with a larger budget; `narrow-scope`
 * requests a smaller server-side scope; `none` promises neither. Switch on the exact value because only
 * `page-budget` is a fetch-more action.
 */
export type ProviderWarningOmissionRecovery = 'none' | 'page-budget' | 'narrow-scope';

/**
 * The part of a provider a warning is confined to: one resource (organization, workspace, site), project or
 * repository. All fields optional; see {@link ProviderWarning.scope} for when one is forwarded.
 */
export interface ProviderWarningScope {
	/**
	 * The resource as the read addressed it: its id on most reads, its name on the few that address it by name
	 * (Azure DevOps' repo-scoped reads, Bitbucket's workspace reads). Match it against both
	 * `ProviderOrganization.id` and `name`.
	 */
	resourceId?: string;
	projectId?: string;
	repositoryId?: string;
}

/**
 * Why a provider refused a credential it otherwise accepts, when the refusal itself says so:
 * - `oauth-app-not-allowed`: the organization does not let third-party OAuth apps in. On Azure DevOps this is the
 *   organization policy "Third-party application access via OAuth", off by default for new organizations. An
 *   organization admin enables it, or the user connects with a personal access token instead, which the policy
 *   does not govern.
 * - `access-denied`: the account has no access to that organization or project (not a member, or lacking the
 *   permission). Someone who administers it has to grant access.
 * - `conditional-access`: a Microsoft Entra Conditional Access policy blocked the request (Azure DevOps
 *   `VS403463`). Its admin has to exempt the request, e.g. by location or device.
 *
 * None of these is healed by reconnecting, which is the point of naming them.
 */
export type ProviderWarningCauseReason = 'oauth-app-not-allowed' | 'access-denied' | 'conditional-access';

/** See {@link ProviderWarning.cause}. */
export interface ProviderWarningCause {
	reason: ProviderWarningCauseReason;
	/** The provider's own error code, when it reports one (Azure DevOps `TF400813`, `VS403463`). */
	code?: string;
	/** Where the setting behind the refusal is changed, when this layer can address it. */
	remedyUrl?: string;
}

/** Which repository / project / resource an omission is attributed to. All fields optional; a scope may name none. */
export interface ProviderWarningOmissionScope extends ProviderWarningScope {
	providerId?: string;
}

export interface ProviderWarningOmission {
	kind: ProviderWarningOmissionKind;
	/**
	 * Whether anything would fetch the missing items, and what. Gate a "load more" affordance on this rather
	 * than on `kind` — see {@link ProviderWarningOmissionRecovery}.
	 */
	recovery: ProviderWarningOmissionRecovery;
	/**
	 * The cap the provider enforces, when it reports one. NOT a result count for every kind: on
	 * `recovery-budget` this is a REQUEST budget and must not be shown to a user as a number of results.
	 */
	limit?: number;
	/** Total matches the provider reported, when it reports one. Only GitHub's search cap does today. */
	totalCount?: number;
	/**
	 * The order the reachable window was selected under, as `field:direction`, when the omission is a result
	 * ceiling.
	 *
	 * Present so a consumer can word its own "N matched, showing the first M" without assuming WHICH M: the
	 * provider serves the top M under this key, so the sentence is only true if it names it. Absent for every
	 * omission that isn't a ceiling, where no window was selected by an order.
	 *
	 * A union of both vocabularies rather than the issue one alone: `PullRequestSorting` happens to be a subset
	 * today, so narrowing this to {@link IssueSorting} would still compile while describing only half the reads
	 * that set it — and would break the day the PR search gains a key the issue search has no name for.
	 */
	sort?: IssueSorting | PullRequestSorting;
	/** Which repository / project / resource was affected, when one is attributed. */
	scope?: ProviderWarningOmissionScope;
}

export interface ProviderWarning {
	providerId: IntegrationIds;
	/** Disambiguates connections on self-managed hosts (where one provider id spans multiple domains). */
	domain?: string;
	/** The specific token/connection the read was pinned to, when a `connectionId` was supplied. */
	connectionId?: string;
	message: string;
	kind: ProviderWarningKind;
	/** Convenience mirror of `kind === 'auth'`, scoped or not; read {@link scope} before prompting to reconnect. */
	isAuth: boolean;
	/**
	 * Present when the failure was recorded against one sub-scope of the read (an organization, project or
	 * repository) rather than against the connection. A scoped `auth` failure is that one scope refusing this
	 * credential, e.g. an Azure DevOps organization that disallows third-party OAuth apps, one in another Entra
	 * tenant, or a Conditional Access policy. Reconnecting cannot fix those, so this warning alone is no reason
	 * to prompt for it.
	 *
	 * `kind` and `isAuth` are unaffected: a scoped 401 is still an authentication failure, and this field says
	 * how far it reaches. It names at least one of its IDs, and is never set on an omission (which carries its
	 * own {@link ProviderWarningOmission.scope}) or on a warning derived from a caught exception (see
	 * {@link toProviderWarning}), even when that call targeted a single organization.
	 *
	 * Its ABSENCE means account-wide or unattributed, so existing handling stays correct without it.
	 *
	 * A scoped `auth` failure also means the credential itself was accepted. A dead token can come back as nothing
	 * but scoped refusals wherever a read reaches its scopes without an uncached request to the connection first:
	 * discovery served from a per-token cache (Azure DevOps, Bitbucket, Jira Cloud) or an SDK fan-out across the
	 * requested repositories (Bitbucket Data Center). So when a read's only auth failures are scoped, those providers
	 * confirm the credential with one uncached request first, and a refused credential fails the whole read with an
	 * unscoped `auth` warning. So does a refusal the provider attributes to the credential itself, like Bitbucket's
	 * for a token missing the OAuth scopes a read needs, which a reconnect fixes.
	 *
	 * Two exceptions stay scoped. A check that could not complete (a network error, a throttle) proves nothing, so
	 * the warnings are published unconfirmed, with no {@link cause}. And a credential confirmed within the last
	 * minute is not probed again, so a revocation can take up to a minute to surface.
	 */
	scope?: ProviderWarningScope;
	/**
	 * Why the provider refused, when the refusal itself says so: see {@link ProviderWarningCauseReason}. Switch on
	 * `reason` to recommend a fix instead of a reconnect; `message` then carries the same explanation as prose.
	 *
	 * Set only on a scoped `auth` warning whose credential was confirmed first (see {@link scope}), because the
	 * refusals it names are indistinguishable from a dead credential until then: Azure DevOps answers a
	 * third-party OAuth app its organization disallows exactly as it answers an expired token. Only Azure DevOps
	 * reports one today. Its absence proves nothing about the cause.
	 */
	cause?: ProviderWarningCause;
	/**
	 * Present when this warning describes results the read could not return even though the request itself
	 * SUCCEEDED — a provider-enforced cap, an exhausted recovery budget, a page budget, or a sub-scope the read
	 * did not drain.
	 *
	 * Its presence is the signal: an omission is not a failure. Message it as incompleteness rather than as a
	 * failed read, and do NOT derive that from `message`, which is English prose and subject to rewording.
	 * `kind` stays `'other'` for these, so the failure discriminant keeps meaning exactly what it meant before
	 * this field existed.
	 *
	 * Whether anything would fetch the rest is a SEPARATE question — read {@link ProviderWarningOmission.recovery},
	 * not `kind`, and never assume a retry of the same request returns more.
	 *
	 * `limit` / `totalCount` / `scope` are forwarded only when they are reported; most omissions carry none of
	 * the three, so render correctly without them — and see {@link ProviderWarningOmission.limit} before
	 * showing that figure as a result count.
	 *
	 * Its ABSENCE proves nothing. It is never set on a warning derived from a caught exception (see
	 * {@link toProviderWarning}) or from a structured scope failure — those are failures, and the field would
	 * be a lie there. But it is also absent whenever incompleteness was reported without naming what was left
	 * out, so treat a bare `kind: 'other'` warning as unclassified rather than as a proven failure.
	 */
	omission?: ProviderWarningOmission;
}

export interface ProviderPageInfo {
	/**
	 * The 1-based POSITION of the returned page. One convention across every paged read, page-number and
	 * cursor paging alike, so a `getNextPageParam`-style consumer can key off it uniformly:
	 * - the page number the provider itself reported, when it reports one (authoritative);
	 * - else the position the caller addressed: the page encoded in a threaded page cursor, or the `page`
	 *   supplied alongside an opaque cursor (1 when the caller supplied no `page`);
	 * - else, for a read that can be advanced by page number, the requested `page` — the provider either
	 *   honored it or the internal drain reached it (see the paging contract on `IntegrationManager`);
	 * - else 1: a cursor-only read with no cursor threaded back ignores a requested page number and answers
	 *   with its first page, so echoing the request would mislabel page 1 as page N.
	 *
	 * A page past the provider's terminal cursor still reports the requested `page` with empty `items` — an
	 * empty page N, never page N-1 relabeled.
	 *
	 * Continue a cursor-paged read from `cursor`, NOT from `currentPage + 1`: a cursor-only host can't be
	 * addressed by number, so this is a position label and not always a resumable request parameter.
	 */
	currentPage: number;
	/**
	 * The page size IN EFFECT, which is not always the one requested — it is whichever of these the read can
	 * actually vouch for:
	 * - the size the provider reported for the page it served (numbered-page hosts), else
	 * - the `itemsPerPage` that was applied to the request (repo-scoped reads, which forward it), else
	 * - `items.length`, for a read that takes no page size at all: the account-wide PR/issue reads, `listRepos`
	 *   (cursor-only), and `listIssueTrackerIssuesPage`, whose `itemsPerPage` counts PROJECTS rather than issues.
	 *
	 * So it is a description of the page, not an echo of the request: don't derive a total from
	 * `currentPage * itemsPerPage`, and don't read `items.length < itemsPerPage` as "last page" — `hasMore` /
	 * `cursor` are the only continuation signals.
	 */
	itemsPerPage: number;
	/**
	 * A COMPLETENESS assertion, not a mode flag: `true` only when a sweep drained every page of every target
	 * without truncating or failing (`!truncated && !fetchFailed`). Set exclusively by `sweepPullRequests` /
	 * `sweepClosedPullRequests` and absent on every paged read, so `allPages !== true` does NOT by itself mean
	 * "this was a single page".
	 *
	 * This is the signal to gate on before caching a sweep as authoritative: unlike `truncated` it is `false`
	 * for BOTH kinds of incompleteness, so it can't be misread as a benign cap.
	 */
	allPages?: boolean;
	/**
	 * True when the read stopped before it could confirm it had everything. Deliberately does NOT distinguish
	 * WHY, and a consumer must not assume it means a provider ceiling — a sweep sets it from three different
	 * origins:
	 * - a provider-side ceiling or per-scope backstop propagated from below (e.g. GitHub Search's 1000-result
	 *   cap): the missing items are NOT reachable, so this really is "complete to the provider's limit";
	 * - the sweep's OWN `maxPages` cap (default 100) with a usable cursor still in hand: the missing items ARE
	 *   reachable and were simply not fetched — raise `maxPages` to get them;
	 * - the provider reporting another page but handing back no usable cursor: not reachable.
	 *
	 * Only the second is recoverable, and a sweep exposes no continuation cursor, so treating a truncated sweep
	 * as a complete set silently drops reachable data in that case. Prefer `allPages` for the cache decision.
	 */
	truncated?: boolean;
}

export interface ProviderResult<T> {
	items: T[];
	warnings: ProviderWarning[];
	/**
	 * True when `items` is incomplete — distinguishes a failed or truncated flat read from a genuinely empty
	 * result. Paged results additionally use `page.truncated` when a completed page could not confirm it
	 * drained everything.
	 */
	fetchFailed?: boolean;
}

export interface ProviderPagedResult<T> extends ProviderResult<T> {
	page: ProviderPageInfo;
	hasMore: boolean;
	/**
	 * Opaque cursor for cursor-based paging (GraphQL, per-repo/per-project cursors, etc.). For hosts that
	 * require the previous page's cursor, consumers should pass this value back to the next `cursor` option.
	 * A retry-only cursor may remain when `hasMore` is false: `hasMore` means automatic forward progress,
	 * while explicitly reusing such a cursor retries failed work without creating an infinite paging loop.
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
	/**
	 * Providers whose read started successfully but could not produce an authoritative complete slice (for
	 * example, a later page failed, collection metadata reported a partial scope, or a paging backstop was hit).
	 * Kept separate from
	 * `failedProviderIds` so consumers can accept healthy sibling providers while preserving an older snapshot
	 * for a provider whose returned slice has a gap.
	 */
	incompleteProviderIds: IntegrationIds[];
}

export interface ProviderBroadenResult<T> extends ProviderPagedResult<T> {
	broadenedProviderIds: IntegrationIds[];
	/** Providers for which no requested org produced a usable issue result. */
	failedProviderIds: IntegrationIds[];
	/** Providers with both a usable org result and at least one failed or truncated org slice. */
	incompleteProviderIds: IntegrationIds[];
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
}

const maxProviderWarningMessageLength = 500;

function providerWarningMessage(ex: unknown): string {
	const raw = (ex instanceof Error ? ex.message : String(ex)).trim();
	const carrier = ex as { status?: unknown; response?: { status?: unknown } } | null | undefined;
	const status =
		typeof carrier?.status === 'number'
			? carrier.status
			: typeof carrier?.response?.status === 'number'
				? carrier.response.status
				: undefined;

	// Gateways commonly answer API requests with a complete HTML error page. That payload is neither actionable
	// nor suitable for a warning DTO consumed by UIs and logs; preserve the status without leaking the document.
	if (/<(?:!doctype\s+html|html|head|body)\b/i.test(raw)) {
		return status != null ? `Provider request failed with status ${status}.` : 'Provider request failed.';
	}

	if (!raw) {
		return status != null ? `Provider request failed with status ${status}.` : 'Provider request failed.';
	}
	return raw.length > maxProviderWarningMessageLength
		? `${raw.slice(0, maxProviderWarningMessageLength - 3)}...`
		: raw;
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
		message: providerWarningMessage(ex),
		kind: kind,
		isAuth: kind === 'auth',
	};
}

/**
 * A scope's identity, as the stable string that keys it.
 *
 * The single definition of what "the same scope" means, shared by the failure and omission dedup keys in
 * `providerPaging.ts` and by {@link providerWarningKey} below, so a scope gaining a field is one edit rather
 * than three. `providerId` is included: the same repository ID under two providers is two scopes.
 *
 * The parameter is structural rather than the SDK's `CollectionScope` so this module keeps naming no
 * `@gitkraken/provider-apis` types (see the export block in `index.ts`) while still serving its SDK-facing
 * callers, which pass that type in unchanged.
 */
export function collectionScopeKey(scope: ProviderWarningOmissionScope | undefined): string {
	return [scope?.providerId ?? '', scope?.resourceId ?? '', scope?.projectId ?? '', scope?.repositoryId ?? ''].join(
		' ',
	);
}

/**
 * The omission's contribution to a warning's identity — empty when there is none, so a warning without an
 * omission keeps deduping exactly as it did before the field existed.
 *
 * Two omissions of different kinds do produce different `message` values today, so message alone would still
 * separate them. That is incidental: the premise of `omission` is that consumers must not depend on prose
 * carrying the distinguishing fact, and this key must not either.
 */
function providerWarningOmissionKey(omission: ProviderWarningOmission | undefined): string {
	if (omission == null) return '';

	return [
		omission.kind,
		omission.recovery,
		omission.limit ?? '',
		omission.totalCount ?? '',
		collectionScopeKey(omission.scope),
	].join(' ');
}

/**
 * Strips the omission from every warning in `warnings` when the read as a whole failed.
 *
 * An omission asserts the request SUCCEEDED, and a drain only learns it failed AFTER it may have emitted one:
 * an early page can report its own truncation and then a later page can die. Deciding per warning, at the
 * moment each is built, cannot see that future — so the aggregate is reconciled once, here, where
 * `fetchFailed` is final. Call it at the point a read returns its `fetchFailed`.
 *
 * Re-dedupes as it goes: the omission is part of a warning's identity, so two warnings that differed only
 * there become identical once it is gone, and the array's contract is that no two entries are equal.
 *
 * Mutates in place: the warning array is the one being returned, and callers accumulate into it across pages.
 */
export function reconcileOmissionsWithFailure(warnings: ProviderWarning[], fetchFailed: boolean): void {
	if (!fetchFailed || !warnings.some(w => w.omission != null)) return;

	const reconciled: ProviderWarning[] = [];
	for (const warning of warnings) {
		if (warning.omission == null) {
			appendDedupedWarning(reconciled, warning);
			continue;
		}

		const { omission: _omission, ...rest } = warning;
		appendDedupedWarning(reconciled, rest);
	}

	warnings.splice(0, warnings.length, ...reconciled);
}

/**
 * A stable key for deduplicating warnings accumulated across drained pages / fan-out scopes.
 *
 * The scope and the cause are keyed for the reason the omission is (see {@link providerWarningOmissionKey}): today's
 * failure messages happen to spell them out, but two failures that differ in either must stay two warnings even if
 * they don't.
 *
 * `message` stays LAST. It is the only free-form segment — provider prose, spaces and all — so anything
 * appended after it could be impersonated by a message that happens to end in the same text.
 */
function providerWarningKey(warning: ProviderWarning): string {
	return [
		warning.providerId,
		warning.connectionId ?? '',
		warning.domain ?? '',
		warning.kind,
		collectionScopeKey(warning.scope),
		warning.cause?.reason ?? '',
		providerWarningOmissionKey(warning.omission),
		warning.message,
	].join(' ');
}

/**
 * Appends `warning` to `into` only when an equal warning (by provider/connection/domain/kind/message, plus the
 * structured scope, cause and omission when present) is absent.
 */
export function appendDedupedWarning(into: ProviderWarning[], warning: ProviderWarning): void {
	const key = providerWarningKey(warning);
	if (into.some(existing => providerWarningKey(existing) === key)) return;

	into.push(warning);
}
