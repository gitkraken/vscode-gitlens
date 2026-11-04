import { isUnsupportedSortError } from '@gitkraken/provider-apis';
import { AuthenticationError, RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Account } from '@gitlens/git/models/author.js';
import type { IssueSearchCriteria, IssueShape, IssueSorting } from '@gitlens/git/models/issue.js';
import type {
	PullRequestSearchCriteria,
	PullRequestShape,
	PullRequestSorting,
} from '@gitlens/git/models/pullRequest.js';
import type { IntegrationIds } from './constants.js';
import { isProviderUnreachableError } from './errors.js';
import type { ProviderRepositoriesInput } from './manager.js';
import { UnexpectedResponseError } from './providers/providerErrors.js';

export interface ConnectionStateChangeEvent {
	key: string;
	reason: 'connected' | 'disconnected';
}

/**
 * A per-provider, per-connection warning surfaced alongside (partial) read results. Consumers use
 * these to drive auth recovery, retry, or truncation messaging without the read itself throwing.
 *
 * `kind` is the programmatic discriminant (a rate-limit is retryable, a 404 is not, an unsupported capability
 * never succeeds on retry, an auth failure needs re-connection unless {@link ProviderWarning.scope} confines
 * it); `isAuth` is retained as a convenience mirror of `kind === 'auth'`.
 *
 * `'unsupported'`: the provider — or this integration of it — lacks the capability the request asked for: a
 * surface (issues on Bitbucket, pull requests on an issue tracker, a batch read, org/repo discovery,
 * current-account lookup, project-scoped or account-wide issue reads), or a filter, sort, state, search
 * criterion or option combination it cannot express. Retrying the same request never succeeds; a different
 * provider, scope or request may. NOT unsupported (these stay `'other'`): malformed or contradictory caller
 * input the caller fixes in the request itself (a duplicate batch key, invalid target numbers, an empty owner,
 * an unusable scope), incompleteness or omission warnings, and unclassified errors.
 *
 * `'unreadable-items'`: the provider returned items this read could not read (a Jira issue whose fields the SDK cannot
 * parse), so it left them out and read everything else in the warning's {@link ProviderWarning.scope}. It still fails
 * the read (`fetchFailed`), since those items are missing, but retrying returns the same gap. On the reads that publish
 * it (an issue tracker's project reads) it never hides a read that was cut short: a cut always comes with a warning of
 * another kind. {@link ProviderWarning.unreadableItems} names the items left out.
 */
export type ProviderWarningKind =
	| 'auth'
	| 'rate-limit'
	| 'not-found'
	| 'no-connection'
	| 'unsupported'
	| 'unreadable-items'
	| 'other';

/** The items an `'unreadable-items'` warning left out: see {@link ProviderWarning.unreadableItems}. */
export interface ProviderWarningUnreadableItems {
	/**
	 * The provider's identifiers of the items left out (a Jira issue's key), without duplicates, in reported order. Each
	 * one is an item the provider reported as skipped, so an identifier present is one that was left out, and one absent
	 * was read when {@link complete}.
	 *
	 * Both hold only for the spelling the provider returned, which is also how a published issue's id spells its key: `keys`
	 * doesn't answer a lookup by another spelling, such as a different case or the key an issue had before it moved. A
	 * consumer comparing a key from elsewhere (one parsed from a branch name, say) must normalize the case of both sides,
	 * and can't take an issue under a key it once had as read.
	 */
	keys: string[];
	/**
	 * Whether {@link keys} names every item left out. `false` when an item left out had no key to report, when the
	 * provider's report of them was malformed (no list of keys, or more than keys in it), or when it said items were left
	 * out and named none, so an identifier absent from `keys` may still be one of them.
	 */
	complete: boolean;
}

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
	 * `ProviderOrganization.id` and `name`, and a project's `orgId` where it has one.
	 */
	resourceId?: string;
	/**
	 * The project as the read addressed it. For a Jira project read, the key, on Jira Cloud and Jira Data Center alike
	 * (the project's `name` in `listProjects`).
	 */
	projectId?: string;
	repositoryId?: string;
}

/**
 * The selector of an issue-tracker project read that matched nothing: see {@link ProviderWarning.selector}. `kind`
 * names which one missed, and `value` is that selector exactly as the caller passed it. `linearProject` is one of a
 * Linear read's `linearProjects`, an id the workspace's Projects no longer list.
 */
export interface ProviderWarningSelector {
	kind: 'org' | 'project' | 'linearProject';
	value: string;
}

/**
 * Why a provider request failed, when the failure itself says so:
 * - `unreachable`: a transport failure or server-side error prevented the provider from answering. The connection
 *   still exists; this accompanies `kind: 'other'`, never an authentication warning.
 * - `oauth-app-not-allowed`: the organization does not let third-party OAuth apps in. On Azure DevOps this is the
 *   organization policy "Third-party application access via OAuth", off by default for new organizations. An
 *   organization admin enables it, or the user connects with a personal access token instead, which the policy
 *   does not govern.
 * - `access-denied`: the account has no access to that organization or project (not a member, or lacking the
 *   permission). Someone who administers it has to grant access.
 * - `conditional-access`: a Microsoft Entra Conditional Access policy blocked the request (Azure DevOps
 *   `VS403463`). Its admin has to exempt the request, e.g. by location or device.
 * - `unexpected-response`: the provider answered, but not with data in the shape the read expects (a gateway's JSON
 *   error on a 2xx, an empty object, `null`), so the read could not use it. Accompanies `kind: 'other'`, like
 *   `unreachable`; a retry may succeed once the provider, or whatever answered in front of it, answers properly. A
 *   page served instead of data keeps its own message, without this cause.
 *
 * None of these is healed by reconnecting, which is the point of naming them.
 */
export type ProviderWarningCauseReason =
	| 'oauth-app-not-allowed'
	| 'access-denied'
	| 'conditional-access'
	| 'unreachable'
	| 'unexpected-response';

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
	 * {@link toProviderWarning}), even when that call targeted a single organization. The exception is a batch
	 * read's refused target, which names its scope: the Azure DevOps organization and project, the repository on
	 * other git hosts, or the tracker's resource.
	 *
	 * Its ABSENCE means account-wide or unattributed, so existing handling stays correct without it.
	 *
	 * A scoped `auth` failure also means the credential itself was accepted. A dead token can come back as nothing
	 * but scoped refusals wherever a read reaches its scopes without an uncached request to the connection first:
	 * discovery served from a per-token cache (Azure DevOps, Bitbucket, Jira Cloud) or an SDK fan-out across the
	 * requested repositories (Bitbucket Data Center). So when a read's only auth failures are scoped, those providers
	 * confirm the credential with one uncached check first, and a refused credential fails the whole read with an
	 * unscoped `auth` warning. A batch read checks it only when every target was refused, since a target that
	 * answered already proved it. A refusal the provider attributes to the credential itself, like Bitbucket's or Jira
	 * Cloud's for a token missing the OAuth scopes a read needs, which a reconnect fixes, is published unscoped too,
	 * once for the connection, while the scopes that answered keep their results.
	 *
	 * So the promise holds for a read that carries no unscoped `auth` warning of its own; one that does already asks
	 * for a reconnect, and its other scoped refusals are not checked. Two exceptions stay scoped even then. A check
	 * that could not complete or was denied (a network error, a throttle, a `403`, Bitbucket Data Center refusing a
	 * credential it authenticated, or a Bitbucket Data Center project access token, whose user the check cannot
	 * find) proves nothing, so the warnings are published unconfirmed, with no {@link cause}, and the next read
	 * checks again. And a credential confirmed within the last minute is not probed again, so a revocation can take
	 * up to a minute to surface.
	 */
	scope?: ProviderWarningScope;
	/**
	 * Why the provider request failed, when the failure itself says so: see {@link ProviderWarningCauseReason}. Switch on
	 * `reason` to recommend a fix instead of a reconnect; `message` then carries the same explanation as prose.
	 *
	 * `unreachable` accompanies a transport or server failure with `kind: 'other'`, and `unexpected-response` a response
	 * the read could not use, also with `kind: 'other'`. Credential refusal causes are set only on a scoped `auth`
	 * warning whose credential was confirmed first (see {@link scope}), because the
	 * refusals they name are indistinguishable from a dead credential until then: Azure DevOps answers a
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
	/**
	 * Present exactly when {@link kind} is `'unreadable-items'`: which items the read left out because it could not read
	 * them. A consumer deciding whether an identifier is absent from the provider, rather than merely unread, must find
	 * it in no warning's `keys` and see `complete` on every one.
	 */
	unreadableItems?: ProviderWarningUnreadableItems;
	/**
	 * Present when an issue-tracker project read's `org` or `project` selector matched nothing the connection
	 * discovered: the selection was removed, renamed, or is no longer visible to this connection. `kind` is
	 * `'not-found'`, the page is empty and not `fetchFailed`, and it carries no cursor, since a retry finds the same.
	 * A `linearProject` miss is diagnostic: the requested Project ids still filter the read, preserving issues in
	 * other selected Projects. It therefore does not force an empty page or remove its continuation.
	 *
	 * Set only when discovery was complete. A read whose discovery failed or was truncated cannot tell a missing
	 * selection from one it did not reach, so it keeps reporting that failure instead, without this field. A miss is
	 * confirmed against the connection's lists as the provider holds them now, read without the cache, since a cached
	 * one predates what was created since. A cached project list can still name a project deleted since: the tracker
	 * refuses it (Jira's "does not exist for the field 'project'"), it reads as empty, and the refusal drops that list,
	 * so the next read reports the miss. Jira Data Center's refusal counts only when it names the user it
	 * authenticated: it answers a rejected token the same way, as the anonymous user. The miss waits on an account
	 * lookup on a resource those lists name, which confirms the
	 * connection's credential, and a failed lookup is reported as the read's failure instead; an account that lists no
	 * resource at all has none to look up, and is judged on its lists alone.
	 *
	 * It is the discriminant: a `not-found` without it is a request that failed with a 404, 410 or 422.
	 */
	selector?: ProviderWarningSelector;
	/**
	 * The keys of the batch targets this warning concerns: the target a per-target failure was refused or failed
	 * for, or every target of an integration call that failed as a whole. So a caller that sends several callers'
	 * targets in one call can hand a failure only to the targets it belongs to.
	 *
	 * Its ABSENCE means the whole call. It is absent on every read that is not a batch read, and on a batch read's
	 * refusal of the whole call before any target is read (a duplicate key, an invalid target, an unknown etag
	 * include, no resolvable connection, the wrong surface), which concerns every target alike.
	 *
	 * It is not part of a warning's identity: two warnings that differ only here are one warning, for the union of
	 * their targets (see {@link appendDedupedWarning}).
	 */
	targetKeys?: string[];
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
	/**
	 * True when a request failed. Unlike `fetchFailed`, a collection read successfully that only left some of its items
	 * unreadable doesn't set it; those items are named by their own warnings.
	 */
	requestFailed?: boolean;
	/** True when the provider advertised continuation without a usable cursor or page position, or repeated one. */
	unexpectedGap?: boolean;
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

/**
 * One sweep target, named the way {@link ProviderSweepTargetEvent} names it, so a consumer can join the two.
 * `domain` is the resolved self-managed host (always `undefined` for a cloud provider).
 */
export interface ProviderSweepTargetRef {
	providerId: IntegrationIds;
	connectionId: string | undefined;
	domain: string | undefined;
}

/**
 * A sweep may carry several targets of one provider (one per connection), so the provider arrays below can't say
 * which connection failed: `failedTargets` and `incompleteTargets` are the authoritative attribution, and
 * `failedProviderIds`/`incompleteProviderIds` summarize them. With one target per provider the two agree exactly.
 */
export interface ProviderSweepResult<T> extends ProviderResult<T> {
	page: ProviderPageInfo;
	hasMore: boolean;
	/**
	 * Providers whose top-level read failed before returning any usable page, for EVERY attributed target of the
	 * provider. A provider with a failed target and a surviving sibling is in `incompleteProviderIds` instead.
	 * Partial per-scope failures stay represented by `warnings` + `fetchFailed` and are intentionally excluded.
	 */
	failedProviderIds: IntegrationIds[];
	/**
	 * Providers whose read started successfully but could not produce an authoritative complete slice (for
	 * example, a later page failed, collection metadata reported a partial scope, or a paging backstop was hit),
	 * or that have a failed target beside one that returned something.
	 * Kept separate from
	 * `failedProviderIds` so consumers can accept healthy sibling providers while preserving an older snapshot
	 * for a provider whose returned slice has a gap.
	 */
	incompleteProviderIds: IntegrationIds[];
	/** Targets whose top-level read failed before returning any usable page. A skipped target is in neither list. */
	failedTargets: ProviderSweepTargetRef[];
	/** Targets that returned a slice with a gap: a later page failed, or pages remain unread. Never also in `failedTargets`. */
	incompleteTargets: ProviderSweepTargetRef[];
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
	/**
	 * The provider's canonical owner/namespace (follows renames), falling back to where it was read when omitted. On
	 * GitLab it is the whole group path (`group/subgroup`), not the remote path's first segment.
	 */
	owner: string;
	/** The provider's canonical repo name (follows renames), falling back to where it was read when omitted. */
	name: string;
	project?: string;
	/** The original input remote URL, so the caller can key the resolution back to the remote it asked about. */
	remoteUrl: string;
	/**
	 * True when the provider's canonical owner/name differ from what the input remote URL carried — i.e. the
	 * repo was renamed/moved host-side and the local remote is stale. Owner and name are compared as one path, because
	 * the remote and the provider split a GitLab nested group differently. Case-insensitive, mirroring gkcli's
	 * `EqualFold` compare so hosts that echo the input casing (e.g. Bitbucket Server/Azure) aren't flagged. On Azure
	 * DevOps it compares the repository name and its {@link project} too, against the collection and project the
	 * repository was read at: an Azure DevOps Server remote's path may be read as another collection and project than
	 * the remote parser read, which is no rename. GitLab's lookup doesn't follow a renamed or moved path, so a stale
	 * GitLab remote resolves as `not-found` rather than as `renamed`.
	 */
	renamed: boolean;
	/**
	 * Whether the provider says this repository is a fork: `true` for a fork (including one it reports only by naming
	 * its {@link parent}), `false` for a repository it reports as not one, `undefined` when it didn't say. Only
	 * `false` is proof of "not a fork" — a missing {@link parent} is not.
	 */
	isFork?: boolean;
	/**
	 * The repository this one was forked from, named as the provider names it and living on the same host
	 * ({@link providerId} and {@link domain}), so on GitLab `owner` is the whole group path (`group/subgroup`).
	 * `project` is set only on Azure DevOps, where a repository lives in a project of its organization. Present only
	 * when the provider reports a fork and names its parent; absent means "not a fork" or "the provider didn't say",
	 * which {@link isFork} tells apart. This is the immediate parent, not the root of the fork network: a pull request
	 * from a branch of this repository usually targets this repository or its parent, but GitHub and Azure DevOps let
	 * it target any repository in the network, so a fork of a fork can open one against the root.
	 */
	parent?: { owner: string; name: string; project?: string };
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

/** A caught error's message as a warning can carry it: an HTML page becomes its status, and prose is capped. */
export function providerWarningMessage(ex: unknown): string {
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
 * `name` is the provider identifier to pass to follow-up reads (a Jira project's key), while `org` is an optional
 * display label of the parent. Where that label can't address the parent, `orgId` is the parent's stable id to pass
 * as `org` instead (a Jira site's id, or a Data Center instance's domain).
 *
 * Jira site rows (`listOrgs`) are the exception: their `name` is the site's label, and a Jira read selects a site only
 * by its `id` (or a project row's `orgId`).
 */
export interface ProviderOrganization {
	id: string;
	providerId: IntegrationIds;
	name: string;
	org?: string;
	orgId?: string;
	url: string;
}

/**
 * A Linear Project (Linear's own `Project` entity, which can span several teams), as `listLinearProjects` lists it.
 * Distinct from the teams `listProjects` publishes for Linear: pass its `id` to `listIssueTrackerIssuesPage`'s
 * `linearProjects` to narrow an issue read to it.
 */
export interface ProviderLinearProjectShape {
	id: string;
	providerId: IntegrationIds;
	name: string;
	/** Linear's project state, as Linear names it (e.g. `planned`, `started`, `paused`, `completed`, `canceled`). */
	state: string;
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
	} else if (isUnsupportedSortError(ex)) {
		kind = 'unsupported';
	} else {
		kind = 'other';
	}

	const cause = kind === 'other' ? getRequestFailureCause(ex) : undefined;
	return {
		providerId: providerId,
		domain: domain,
		connectionId: connectionId,
		message: providerWarningMessage(ex),
		kind: kind,
		isAuth: kind === 'auth',
		...(cause != null ? { cause: cause } : {}),
	};
}

/**
 * The cause a failed request's error names by itself, one that isn't the credential's (`unexpected-response` or
 * `unreachable`), for a failure classified as no more specific than that.
 */
export function getRequestFailureCause(ex: unknown): ProviderWarningCause | undefined {
	if (UnexpectedResponseError.is(ex)) return { reason: 'unexpected-response' };
	if (isProviderUnreachableError(ex)) return { reason: 'unreachable' };
	return undefined;
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
		warning.selector != null ? JSON.stringify([warning.selector.kind, warning.selector.value]) : '',
		warning.message,
	].join(' ');
}

/**
 * Appends `warning` to `into` only when an equal warning (by provider/connection/domain/kind/message, plus the
 * structured scope, cause, omission and selector when present) is absent. An equal warning already there merges its
 * {@link ProviderWarning.targetKeys} with the new one's instead: the union of both, or none when either concerns
 * the whole call. Its {@link ProviderWarning.unreadableItems} merge too (see {@link mergeUnreadableItems}): two reads
 * can report the same text for different items. The existing warning is replaced, never mutated, since it may be
 * shared.
 */
export function appendDedupedWarning(into: ProviderWarning[], warning: ProviderWarning): void {
	const key = providerWarningKey(warning);
	const index = into.findIndex(existing => providerWarningKey(existing) === key);
	if (index === -1) {
		into.push(warning);
		return;
	}

	const existing = into[index];
	const targetKeys = mergeTargetKeys(existing.targetKeys, warning.targetKeys);
	const unreadableItems =
		existing.unreadableItems != null && warning.unreadableItems != null
			? mergeUnreadableItems(existing.unreadableItems, warning.unreadableItems)
			: (existing.unreadableItems ?? warning.unreadableItems);
	if (targetKeys === existing.targetKeys && unreadableItems === existing.unreadableItems) return;

	const { targetKeys: _, ...rest } = existing;
	into[index] = {
		...rest,
		...(targetKeys != null ? { targetKeys: targetKeys } : {}),
		...(unreadableItems != null ? { unreadableItems: unreadableItems } : {}),
	};
}

/** The union of two warnings' target keys, or none when either concerns the whole call. `existing` when unchanged. */
function mergeTargetKeys(existing: string[] | undefined, next: string[] | undefined): string[] | undefined {
	// Either concerns the whole call.
	if (existing == null || next == null) return undefined;

	const added = next.filter(k => !existing.includes(k));
	if (!added.length) return existing;

	return [...existing, ...new Set(added)];
}

/**
 * The items two reports of unreadable items left out together: the union of their keys, complete only when both are.
 * `existing` when `next` adds nothing to it.
 */
export function mergeUnreadableItems(
	existing: ProviderWarningUnreadableItems,
	next: ProviderWarningUnreadableItems,
): ProviderWarningUnreadableItems {
	const known = new Set(existing.keys);
	const added = next.keys.filter(k => !known.has(k));
	const complete = existing.complete && next.complete;
	if (!added.length && complete === existing.complete) return existing;

	return { keys: [...existing.keys, ...new Set(added)], complete: complete };
}

// The count, batch, branch and current-account reads' input and result shapes. They live here rather than beside their
// reads (`reads/*`) so the public facade can export them without its declarations reaching the reads' internal context.

/**
 * One scope to count.
 *
 * `key` is caller-owned and echoed back verbatim, so a batch result needs no positional matching by the consumer.
 * It never reaches the provider query — the aliases in the upstream document are generated — so it can be any
 * string the caller finds meaningful.
 */
export interface IssueCountScope {
	key: string;
	/** Repositories to count over. Combines with `org`, exactly as in `searchIssuesPage`. */
	repos?: ProviderRepositoriesInput;
	org?: string;
	/**
	 * Same criteria model as `searchIssuesPage`, validated against the same capability table.
	 *
	 * `criteria.sort` does not affect the count — a total is invariant under ordering — but it is still VALIDATED,
	 * and an unsupported key refuses this scope exactly as it would refuse the read. That is the point of the
	 * count: it previews the constraints the read will apply, so one that accepted what the read refuses would
	 * promise a fetch that can't happen, which is worse than no preview at all.
	 */
	criteria?: IssueSearchCriteria;
}

/** The count for one {@link IssueCountScope}, echoed back under the caller's own `key`. */
export interface IssueCountResult {
	key: string;
	/**
	 * Total matches the provider reports. `undefined` when the provider didn't report one for this scope — NEVER
	 * zero, which is a real answer. Render the difference: an unreported count means "unknown", and showing it as
	 * 0 would tell the user this filter matches nothing.
	 */
	count?: number;
	/**
	 * True when `count` exceeds the provider's own result ceiling, so a full read CANNOT return everything no
	 * matter how it is paged. This is the signal to warn before starting an expensive fetch.
	 */
	exceedsProviderLimit: boolean;
	/** The ceiling itself, when the provider declares one. */
	providerLimit?: number;
}

/**
 * One scope to count pull requests over — the PR twin of {@link IssueCountScope}.
 *
 * `key` is caller-owned and echoed back verbatim, never reaching the provider query (the aliases are generated), so
 * it can be any string the caller finds meaningful.
 */
export interface PullRequestCountScope {
	key: string;
	/** Repositories to count over. Combines with `org`, exactly as in `searchPullRequestsPage`. */
	repos?: ProviderRepositoriesInput;
	org?: string;
	/**
	 * Same criteria model as `searchPullRequestsPage`, validated against the same capability table — so a count
	 * refuses exactly what the read would, and never previews a fetch that can't happen.
	 */
	criteria?: PullRequestSearchCriteria;
}

/** The count for one {@link PullRequestCountScope}, echoed back under the caller's own `key`. */
export interface PullRequestCountResult {
	key: string;
	/**
	 * Total matches the provider reports. `undefined` when the provider didn't report one for this scope — NEVER
	 * zero, which is a real answer.
	 *
	 * For a multi-state scope, GitHub/GHE report the LARGEST of their per-state counts (the same total
	 * `searchPullRequestsPage` surfaces, since each state is its own capped search), not their sum. Bitbucket Data
	 * Center has no ceiling to stay under, so it reports the exact union — the number of rows the search returns —
	 * and so does Azure DevOps Server, which reads every state in one drain.
	 */
	count?: number;
	/**
	 * True when `count` is a FLOOR rather than the total: the provider has no count query (Bitbucket Data Center),
	 * so it counts by reading within a budget, and this scope had more than the budget read. Render it as "N+", and
	 * treat the scope as at least that expensive. Absent means `count` is exact — the provider's own total, or for a
	 * provider that counts by reading, every match it read.
	 */
	lowerBound?: boolean;
	/**
	 * True when `count` exceeds the provider's own per-search result ceiling, so a full read CANNOT return
	 * everything no matter how it is paged. This is the signal to warn before starting an expensive fetch.
	 */
	exceedsProviderLimit: boolean;
	/** The ceiling itself, when the provider declares one. */
	providerLimit?: number;
}

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
			 * than to a repository; there it only names the project of a project-less Azure DevOps Server path read
			 * behind a virtual directory (`{vdir}/{collection}/_git/{repo}` as owner `{vdir}`, project `{collection}`).
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

/** One pull request to resolve, identified by coordinate and echoed back under the caller's own `key`. */
export interface PullRequestBatchTarget {
	/** Caller-owned identifier, echoed on the result so no positional matching is needed. Must be unique. */
	key: string;
	/**
	 * GitHub owner, GitLab namespace path (may be nested), Bitbucket workspace, Bitbucket Data Center project key, or
	 * Azure DevOps organization.
	 */
	owner: string;
	/** Repository name or slug. */
	repo: string;
	/** Pull request number, GitLab merge request iid, or Azure DevOps pull request id. */
	number: number;
	/** Azure DevOps project. Required there, ignored elsewhere. */
	project?: string;
	/**
	 * The {@link PullRequestBatchResult.etag} of the copy the caller holds. When the host can check it cheaply and
	 * it still matches, the pull request isn't read again and comes back `unchanged`.
	 */
	etag?: string;
}

/**
 * The answer for one {@link PullRequestBatchTarget}, in one of four states:
 * - `{ key, pullRequest, etag }` — read in full, whatever its state. Every fully read row carries an `etag`,
 *   whether or not the caller sent one, so a caller can seed its etags from the reads it already makes.
 * - `{ key, unchanged: true, etag }` — the cheap check proved the caller's copy current, and nothing else was
 *   fetched. Only for a target that sent an `etag`, on a host with a cheap check.
 * - `{ key }` — PROVEN ABSENT: it does not exist, or is not visible to this connection.
 * - no row, with `fetchFailed` and a warning — the read could not check. Never treat that as absent.
 */
export interface PullRequestBatchResult {
	key: string;
	/**
	 * The resolved pull request, whatever its state, or `undefined` when it PROVABLY does not exist (or is not
	 * visible to this connection) — or when it is `unchanged`. A target whose read FAILED is not returned at
	 * all and sets `fetchFailed`.
	 */
	pullRequest?: PullRequestShape;
	/**
	 * Opaque: compare for equality only, never parse. Computed by core from the pull request's change state — its
	 * state, draft flag, update time and head commit (on Azure DevOps, also a revision of the fields it changes without
	 * an update time), plus each input the call's `etagIncludes` listed — and NOT the provider's HTTP ETag. Send it
	 * back as {@link PullRequestBatchTarget.etag}. An etag from another scheme or another `etagIncludes` set simply
	 * compares unequal and costs a full read, never a false `unchanged` — and so does one from a read that selected
	 * merge-queue data (see {@link IntegrationManager.getPullRequestsBatch}'s `mergeQueue`) when the other didn't.
	 * Reactions are never an input: a host can add one without moving the update time, so an `unchanged` copy's
	 * `thumbsUpCount` may be stale.
	 */
	etag?: string;
	/** The caller's copy is current (its `etag` matched); `pullRequest` is absent because nothing was read. */
	unchanged?: true;
}

/** One branch whose pull requests to find, echoed back under the caller's own `key`. */
export interface PullRequestBranchTarget {
	/** Caller-owned identifier, echoed on the result so no positional matching is needed. Must be unique. */
	key: string;
	/**
	 * The repository the pull requests are OPENED AGAINST (their base), as in `PullRequestBatchTarget`: GitHub
	 * owner, GitLab namespace path (may be nested), Bitbucket workspace, Bitbucket Data Center project key, or Azure
	 * DevOps organization.
	 */
	owner: string;
	/** Repository name or slug. */
	repo: string;
	/** Azure DevOps project. Required there, ignored elsewhere. */
	project?: string;
	/** The head branch's short name, without `refs/heads/`. */
	branch: string;
	/**
	 * Owner (GitHub user or org, GitLab namespace, Bitbucket workspace) of the repository the branch lives in, when
	 * it's a fork. Omitted, or equal to `owner` (ignoring case), means the branch lives in the base repository itself,
	 * so a caller can pass the owner of whichever remote the branch was pushed to. On GitLab this is the whole
	 * namespace path, as `owner` is, so a remote's first-slash split can't be passed for either.
	 *
	 * A different owner is refused on Bitbucket Data Center and Azure DevOps, where a fork can't be found by its
	 * owner.
	 */
	headOwner?: string;
}

/** The answer for one {@link PullRequestBranchTarget}. */
export interface PullRequestBranchResult {
	key: string;
	/**
	 * Every pull request whose head is this branch, in ANY state — open, closed and merged — most recently updated
	 * first, up to a per-target cap. An empty array is a PROVEN "none" unless `truncated` is set. A target whose
	 * read failed is not returned at all.
	 */
	pullRequests: PullRequestShape[];
	/**
	 * Set when a pull request that wasn't returned could still match: more matched than the cap, or the host held
	 * more pull requests of this branch name than it returned and couldn't rule them out. GitHub/GHE rule them out
	 * with a second request filtered by head owner, so there it means more than the cap truly match. That request
	 * can't see a pull request from a since-deleted fork, so on GitHub/GHE such a pull request outside the first
	 * request's page can be missing even when this is not set.
	 */
	truncated?: boolean;
}

/**
 * "Who am I on this provider / connection" — {@link IntegrationBase.getCurrentAccount}'s own answer, exposed on
 * the manager so a caller can ask for it directly instead of waiting for some other read to warm it as a side
 * effect.
 */
export interface CurrentAccountResult {
	/** The signed-in account, when the provider answered. */
	account?: Account;
	warnings: ProviderWarning[];
	/**
	 * Set whenever `account` is absent. Unlike a list/batch read, this one has no benign empty answer — "who am
	 * I" is either resolved or it couldn't be told, never a legitimately empty result — so `account` is never
	 * missing without a warning explaining why.
	 */
	fetchFailed?: boolean;
}
