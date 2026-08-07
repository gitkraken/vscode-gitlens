import type { IssueSearchCriteria, IssueShape } from '@gitlens/git/models/issue.js';
import type {
	PullRequestSearchCriteria,
	PullRequestShape,
	PullRequestStateFilter,
} from '@gitlens/git/models/pullRequest.js';
import type { Event } from '@gitlens/utils/event.js';
import type { ConfiguredIntegrationsChangeEvent } from './authentication/configuredIntegrationService.js';
import type { ConfiguredIntegrationDescriptor } from './authentication/models.js';
import type { IntegrationIds } from './constants.js';
import type {
	IssueFilter,
	IssueSearchCapabilities,
	PullRequestFilter,
	PullRequestSearchCapabilities,
} from './providerFilters.js';
import type { IssueCountResult, IssueCountScope } from './reads/counts.js';
import type {
	ConnectionStateChangeEvent,
	ProviderBroadenResult,
	ProviderOrganization,
	ProviderPagedResult,
	ProviderRepositoryShape,
	ProviderResult,
	ProviderSweepResult,
	ResolveRepositoryResult,
} from './results.js';

/** Neutral repository input accepted by repo-scoped provider reads. */
export interface ProviderRepositoryInput {
	namespace: string;
	name: string;
	project?: string;
	id?: string;
}

export type ProviderRepositoriesInput = (string | number)[] | ProviderRepositoryInput[];

/**
 * One provider slice in a pull-request sweep.
 *
 * A sweep accepts at most one target per provider because its failure attribution is provider-scoped.
 * `domain` is a fallback for self-managed hosts whose authentication provider doesn't persist a configured
 * connection; a configured `connectionId` domain takes precedence when both are supplied. It must come from
 * the trusted authentication configuration, not repository or remote data.
 */
export interface ProviderSweepTarget {
	providerId: IntegrationIds;
	connectionId?: string;
	domain?: string;
	/**
	 * Relationship filters for this provider slice. With sweep-level `repos`, members are provider query
	 * constraints; without `repos`, they form an exact OR union. The whole set is validated against the
	 * selected path's capabilities.
	 *
	 * This per-target form lets a cross-provider sweep preserve provider-specific semantics without leaking
	 * provider query details into the consumer. It overrides the sweep-level `filters` for this target.
	 */
	filters?: PullRequestFilter[];
}

/**
 * One target's contribution to a pull-request sweep, reported as it settles.
 *
 * A sweep makes a single call and distributes its targets internally, so its aggregate result carries no
 * per-target timing at all and only derivable per-target counts. This is the boundary that exposes them, for a
 * host attributing a slow or failing sweep to the provider responsible.
 *
 * `outcome` is reported as one value rather than the underlying booleans because a consumer buckets by it, and
 * because "the whole target is unusable" and "the target returned a slice with a gap" are different facts:
 * a `failed-provider` target contributes nothing, a `fetch-failed` one contributes `count` rows that are
 * incomplete. `skipped` is a target that resolved to no reachable connection and is deliberately not
 * attributed in the aggregate result — reported anyway so a consumer counting targets never loses one.
 *
 * A target that produced no slice at all reports `count: 0` and `truncated: false` — always for `skipped`, and
 * for `failed-provider` as `drainPullRequests` reports it today. Read those fields rather than deriving them
 * from `outcome`: they are the target's own values, not constants the outcome guarantees.
 */
export interface ProviderSweepTargetEvent {
	providerId: IntegrationIds;
	/**
	 * The self-managed host this target selects, resolved from its configured connection, its explicit domain,
	 * or the provider's primary configured host — the same rule the read itself uses, and the same one whether
	 * the target drained fully or was rejected by the first guard.
	 *
	 * Always `undefined` for a cloud provider: it has a single host, so there is nothing to disambiguate. Group
	 * by `providerId` and treat this as a label, not part of the key.
	 */
	domain: string | undefined;
	connectionId: string | undefined;
	/**
	 * Rows this target contributed to the aggregate result. The sweep concatenates target slices without a
	 * cross-target pass — duplicates are collapsed per target, across its own pages — so these sum to exactly
	 * `items.length`, and a sum that disagrees means a target went unreported.
	 */
	count: number;
	/**
	 * Wall time from this target's worker picking it up to its slice being ready.
	 *
	 * Targets in the same sweep run concurrently, so these intervals OVERLAP and are not additive: summing them
	 * across a sweep exceeds the sweep's own duration. Compare them against each other, not against a total.
	 */
	durationMs: number;
	/**
	 * Wall time between the fan-out starting and this target's worker picking the target up.
	 *
	 * Structurally 0 only while the target count fits the fan-out's concurrency limit, which a selection of a
	 * few providers does and the default sweep does NOT: with no `targets`/`providerIds` it opens one target per
	 * supported git host, more than the limit, so the last ones genuinely wait. A non-zero value there is the
	 * normal case, not an anomaly — it is the cost of the bound, and only worth acting on if it rivals
	 * `durationMs`.
	 */
	queueWaitMs: number;
	outcome: 'ok' | 'failed-provider' | 'fetch-failed' | 'skipped';
	/** Whether this target left pages unread. */
	truncated: boolean;
}

type ProviderSweepSelection =
	| {
			targets: readonly ProviderSweepTarget[];
			providerIds?: never;
			connectionId?: never;
	  }
	| {
			targets?: never;
			providerIds?: IntegrationIds[];
			/**
			 * Legacy single-provider selector. It is ignored when `providerIds` contains more than one provider;
			 * use `targets` to select connections independently in a multi-provider sweep.
			 */
			connectionId?: string;
	  };

/**
 * One org slice in an issue-broadening fan-out. `domain` is a fallback for self-managed hosts whose
 * authentication provider doesn't persist a configured connection; a configured `connectionId` domain takes
 * precedence when both are supplied. It must come from the trusted authentication configuration, not
 * repository or remote data.
 */
export interface ProviderBroadenOrg {
	providerId: IntegrationIds;
	name: string;
	connectionId?: string;
	domain?: string;
}

type PullRequestSweepCommonOptions = {
	repos?: ProviderRepositoriesInput;
	/** Named `states` to match {@link IntegrationManager.listPullRequestsPage}; a mismatch here read as silently ignored. */
	states?: PullRequestStateFilter[];
	/**
	 * Relationship filters applied to every target. Repo-scoped reads combine them as provider query
	 * constraints (normally an intersection); account-wide reads form an exact OR union. The set is validated
	 * against `pullRequests` or `pullRequestsAccountWide`, respectively. A target's own `filters` overrides this.
	 */
	filters?: PullRequestFilter[];
	/**
	 * Account-wide only: include review-requested PRs when the provider's native "my PRs" query omits them.
	 * This extends the provider-native result; it is not a narrowing filter.
	 */
	includeReviewRequested?: boolean;
	forceSync?: boolean;
	maxPages?: number;
	/**
	 * Fired once per target as it settles, for host-side per-provider attribution.
	 *
	 * Observation only: it cannot influence the sweep, and a SYNCHRONOUS throw is swallowed rather than allowed
	 * to turn a successful target into a failed one. Return nothing and do no async work: the `void` return type
	 * admits an `async` callback, but nothing awaits it, so a rejection from one escapes that guarantee as an
	 * unhandled rejection. It is also invoked synchronously in the middle of the fan-out — do not re-enter the
	 * manager from it.
	 *
	 * Omitting it costs nothing at all, not even a clock read, so a host that only measures behind a gate can
	 * leave the gate off without paying for the option.
	 *
	 * It reports how a target SETTLED, not every way one can end, and **delivery does not stop when the sweep
	 * fails**: if a target's read throws instead of reporting failure through its slice, the sweep rejects with
	 * that error, but its sibling targets are already in flight and are not cancelled, so their events still
	 * arrive — after the returned promise has rejected. Key the accumulator to the call rather than closing it
	 * on rejection, or a late event lands in whatever bucket is current by then.
	 */
	onTargetSettled?: (event: ProviderSweepTargetEvent) => void;
};

export type PullRequestSweepOptions = PullRequestSweepCommonOptions & ProviderSweepSelection;

export type ClosedPullRequestSweepOptions = Omit<PullRequestSweepCommonOptions, 'states'> & ProviderSweepSelection;

/**
 * Organization discovery either fans out without a provider-specific target, or pins every scoped selector
 * to one provider. A `connectionId`/`domain` without `providerId` is ambiguous and therefore unrepresentable.
 */
export type ListOrgsOptions =
	| {
			providerId: IntegrationIds;
			connectionId?: string;
			domain?: string;
	  }
	| {
			providerId?: never;
			connectionId?: never;
			domain?: never;
	  };

/**
 * Project discovery follows the same provider-targeting rule as {@link ListOrgsOptions}; `org` may still
 * narrow either a single-provider read or the unscoped fan-out.
 */
export type ListProjectsOptions =
	| {
			providerId: IntegrationIds;
			org?: string;
			connectionId?: string;
			domain?: string;
	  }
	| {
			providerId?: never;
			org?: string;
			connectionId?: never;
			domain?: never;
	  };

/**
 * Public, provider-neutral integration facade. Provider clients and integration model instances remain private
 * implementation details so SDK changes don't expand this contract.
 *
 * ## Paging contract
 *
 * Every paged read (`listRepos`, `listPullRequestsPage`, `searchPullRequestsPage`, `listIssuesPage`,
 * `listIssueTrackerIssuesPage`, `broadenIssues`) takes both `page` and `cursor`, and the two are NOT
 * interchangeable:
 *
 * - **Supplying `cursor` guarantees a single upstream round trip per provider scope.** A threaded continuation
 *   is handed to the provider as-is; the facade never walks the pages before it. This is a guarantee, not an
 *   optimization: a consumer that threads `cursor` back pays O(1) requests per page.
 * - **Supplying only `page` (> 1) may cost O(page) upstream requests.** Cursor-backed reads such as GitHub
 *   searches and broaden fan-outs can't be addressed by number, so the facade drains the pages before the
 *   requested one internally and returns just page N. Providers whose account-wide reads aggregate into one
 *   terminal page do not incur that drain. The fallback for cursor-backed reads MUST be kept: it supports the
 *   first page-number-only read after a refresh, where no cursor was persisted.
 * - Prefer `cursor` when both are available. Pass `page` alongside it so the result's positional
 *   `page.currentPage` reflects where the caller is (the convention is documented on `ProviderPageInfo`); the
 *   cursor, not the page number, is what actually advances the read.
 * - `hasMore` is only ever true with a `cursor` the caller can act on. A provider that reports another page
 *   but hands back no usable continuation is reported as terminal-but-incomplete (`hasMore: false` +
 *   `page.truncated`), never as a page that can't be requested.
 */
export interface IntegrationManager {
	readonly onDidChange: Event<ConfiguredIntegrationsChangeEvent>;
	readonly onDidChangeConnectionState: Event<ConnectionStateChangeEvent>;

	dispose(): void;

	getConfigured(
		id?: IntegrationIds,
		options?: { cloud?: boolean; domain?: string },
	): ConfiguredIntegrationDescriptor[];
	/**
	 * The `filters` a provider accepts on `listPullRequestsPage`/`listIssuesPage` and the sweeps.
	 *
	 * The filter contract is all-or-nothing: a set containing even one unsupported filter is refused (empty
	 * `items` + a warning + `fetchFailed`) rather than narrowed, because falling through to an unfiltered read
	 * would return every pull request instead of the user's. Intersect against this before the read so a
	 * cross-provider filter set never turns into a failed page. Static per provider — no connection required.
	 *
	 * Empty means no filter of that kind is expressible (issue trackers have no pull requests; Bitbucket exposes
	 * no issues), which means "pass no filters", not "error".
	 *
	 * `pullRequests` covers repo-scoped PR reads; `pullRequestsAccountWide` covers account-wide PR reads.
	 * `issues` covers the repo-scoped issue read; `issuesAccountWide` covers the account-wide one (no `repos`).
	 * They differ because they are different provider queries — GitLab can express `Assignee` and `Author`
	 * account-wide, but not `Mention` — and `listIssuesPage` validates against whichever the read uses.
	 *
	 * An ISSUE TRACKER (Jira/Linear/Trello) reports its filters under `issues`, and
	 * {@link IntegrationManager.listIssueTrackerIssuesPage} validates against that field. Its
	 * `issuesAccountWide` is empty — those two fields split the git-host reads, and a tracker has neither of
	 * them (its issues live under resource → project) — so intersecting a tracker's filters against
	 * `issuesAccountWide` would read "cannot filter" for a provider that filters fine.
	 *
	 * This is a capability table, not a recommendation: a consumer matching another tool's behavior may pass fewer
	 * filters than are listed, or none where the underlying read is already scoped.
	 */
	getSupportedFilters(providerId: IntegrationIds): {
		pullRequests: PullRequestFilter[];
		/** Optional for structural compatibility; missing means no account-wide narrowing filters are supported. */
		pullRequestsAccountWide?: PullRequestFilter[];
		/**
		 * Criteria and scopes {@link searchPullRequestsPage} can express. Always present; an empty relationship list
		 * means the provider exposes no filtered pull-request search.
		 */
		pullRequestSearch: PullRequestSearchCapabilities;
		issues: IssueFilter[];
		issuesAccountWide: IssueFilter[];
		/**
		 * What {@link searchIssuesPage} (and {@link countIssues}, over the same criteria) can express for this
		 * provider. Always present: a provider with no filtered issue search reports an empty `relationships` and
		 * all-false flags, which is the signal to hide that surface rather than to hide individual chips.
		 */
		issueSearch: IssueSearchCapabilities;
	};
	/** Forces an authoritative cloud connection refresh. Rejects if the backend connection list cannot be read. */
	refreshConnections(): Promise<void>;
	/** Rejects unless `connectionId` is a configured cloud connection for `id`. */
	setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<void>;
	/** Rejects unless `connectionId` is a configured cloud connection for `id`. */
	deleteConnection(id: IntegrationIds, connectionId: string): Promise<void>;

	listOrgs(options?: ListOrgsOptions): Promise<ProviderResult<ProviderOrganization>>;
	listProjects(options?: ListProjectsOptions): Promise<ProviderResult<ProviderOrganization>>;
	listRepos(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		/**
		 * Requested 1-based page. Cursor-only providers are advanced internally when no `cursor` is supplied,
		 * so a direct page-N request can cost O(page) upstream calls.
		 */
		page?: number;
		/** Continuation from a prior page's `cursor`; supplying it costs exactly one upstream request per scope. */
		cursor?: string;
		/**
		 * Requested page size. Advisory: the repos read core is cursor-only and takes no page size, so the
		 * provider's own size is what applies — `page.itemsPerPage` reports what was actually returned.
		 */
		itemsPerPage?: number;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. */
		domain?: string;
	}): Promise<ProviderPagedResult<ProviderRepositoryShape>>;
	listPullRequestsPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderRepositoriesInput;
		states?: PullRequestStateFilter[];
		/**
		 * Relationship filters. Repo-scoped reads combine members as provider query constraints (normally an
		 * intersection), so issue separate reads when the desired result is a union. Account-wide members form an
		 * exact OR union. Each path validates the whole set against its corresponding capability.
		 */
		filters?: PullRequestFilter[];
		/**
		 * Account-wide only: include review-requested PRs when the provider's native "my PRs" query omits them.
		 * This extends the provider-native result; it is not a narrowing filter.
		 */
		includeReviewRequested?: boolean;
		/**
		 * Requested 1-based page. Without a `cursor` this may cost O(page) upstream requests on a cursor-only
		 * read (repo-scoped GitHub/GHE and account-wide providers that return continuations), which the facade
		 * drains internally.
		 */
		page?: number;
		/** Continuation from a prior page's `cursor`; supplying it costs exactly one upstream request per scope. */
		cursor?: string;
		/**
		 * Requested page size, honored on the repo-scoped path. The provider-defined account-wide read (no
		 * `repos`) takes no page size, so it is ignored there — `page.itemsPerPage` reports what was actually
		 * returned rather than echoing the request.
		 */
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain. Used only when the requested connection has no configured domain;
		 * it must come from the trusted authentication configuration, not repository or remote data.
		 */
		domain?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>>;
	/**
	 * Pull requests matching structured criteria over a repository/organization or current-user relationship
	 * scope.
	 *
	 * This is a separate read from {@link listPullRequestsPage}: free text reaches the provider instead of filtering
	 * whichever rows happened to be loaded, and every cursor-threaded page costs exactly one upstream request.
	 * `criteria.relationships` and `criteria.states` are OR sets, so `[closed, merged]` expresses the complete
	 * terminal set and `[Author, Assignee, ReviewRequested]` matches the visible PR list without falling back to
	 * GitHub's mismatched `involves:@me`. Omit relationships only with a repository/organization scope to search
	 * every PR there.
	 *
	 * Results are always ordered most-recently-updated-first. If the provider's result ceiling is reached, the
	 * request still succeeds and carries a warning omission with `totalCount`, `limit`, and `recovery: 'none'`.
	 * `totalCount` is the largest provider-reported pre-ceiling facet count, not the reachable or returned row
	 * count; this mirrors the per-search ceiling's own unit.
	 *
	 * Check `getSupportedFilters().pullRequestSearch` before calling. A provider that reports no relationships
	 * refuses the read rather than returning a page that never honored the criteria or scope.
	 */
	searchPullRequestsPage(options: {
		providerId: IntegrationIds;
		/** Repository descriptors that bound the search; ids cannot name provider search qualifiers. */
		repos?: ProviderRepositoriesInput;
		/** Organization/account that bounds the search. */
		org?: string;
		criteria?: PullRequestSearchCriteria;
		/** Cursor-only: without a cursor, reaching page N costs O(N) upstream requests. */
		page?: number;
		cursor?: string;
		/** Page size per relationship × state facet; the deduped union can contain more rows. */
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. */
		domain?: string;
	}): Promise<ProviderPagedResult<PullRequestShape>>;
	listIssuesPage(options: {
		providerId: IntegrationIds;
		repos?: ProviderRepositoriesInput;
		/**
		 * Narrows the account-wide read (no `repos`) to one org/account, and `project` to one project within it.
		 * Only a git host with a project tier (Azure DevOps) can scope this server-side; for any other provider
		 * either option is rejected with a warning + `fetchFailed` rather than silently returning an unscoped
		 * list. Ignored when `repos` is supplied, since those repos are already the scope.
		 */
		org?: string;
		project?: string;
		/**
		 * Narrows to the requested relationship(s), validated against `getSupportedFilters().issues` on the
		 * repo-scoped path and `.issuesAccountWide` on the account-wide one.
		 *
		 * On the account-wide path this REPLACES the provider's own definition of "my issues" — GitHub/GHE
		 * authored + assigned + mentioned, Azure assigned + authored, and GitLab assigned-to-me — so
		 * `[Assignee]` gets `assignee:@me` semantics wherever it's expressible. Narrowing must happen here rather
		 * than on the returned page: the excluded items still counted toward the provider's paging, so filtering
		 * afterward leaves `items` describing a different result set than `hasMore`/`cursor`.
		 *
		 * A set the provider can't express server-side is refused whole (warning + `fetchFailed`), never widened.
		 */
		filters?: IssueFilter[];
		/** Broadens to every assignee. On account-wide reads it contradicts `filters`, so passing both is refused. */
		includeAllAssignees?: boolean;
		/**
		 * Requested 1-based page. Without a `cursor` this may cost O(page) upstream requests on cursor-backed
		 * reads such as repo-scoped GitHub/GHE; aggregate single-page account-wide reads remain O(1).
		 */
		page?: number;
		/** Continuation from a prior page's `cursor`; supplying it costs exactly one upstream request per scope. */
		cursor?: string;
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. */
		domain?: string;
	}): Promise<ProviderPagedResult<IssueShape>>;
	/**
	 * Issues matching structured criteria over a repository/org scope, with NO forced relationship to the current
	 * user — the issue counterpart of the PR search, and the read to use for "every issue in these repos matching
	 * X" rather than "my issues".
	 *
	 * Why this and not {@link listIssuesPage}: that read is either bound to the user's own relationships
	 * (account-wide) or routed through the SDK's repo-scoped read, whose over-limit recovery walk can spend up to
	 * 128 sequential requests and still return an incomplete set. This one is a single request per page.
	 *
	 * Three parts of the contract worth reading before calling:
	 *
	 * - **Scope is mandatory.** Pass `repos`, `org`, or a user relationship (`authored`/`assigned`/`mentioned`).
	 *   `any-assignee`/`unassigned` do NOT scope anything — either alone matches every such issue on the host —
	 *   so a call carrying only those is refused (warning + `fetchFailed`).
	 * - **Ordering is always most-recently-updated-first**, not an option. A "show the N most recent" policy at
	 *   the provider's result ceiling is only correct under a guaranteed order.
	 * - **At the result ceiling the read SUCCEEDS.** It reports an omission carrying `totalCount` (how many
	 *   matched) and `limit` (how many are reachable) with `recovery: 'none'`, so a consumer can say "19.240
	 *   matched, showing the 1.000 most recent" and know not to offer a "load more". It never falls back to a
	 *   per-repository recovery walk.
	 *
	 * Check `getSupportedFilters().issueSearch` first: a provider with no filtered issue search reports empty
	 * relationships (and this read refuses), and a criterion it can't express refuses the whole read rather than
	 * serving a wider result than asked for.
	 */
	searchIssuesPage(options: {
		providerId: IntegrationIds;
		/** Repositories to search. Combines with `org`; both constrain the same query. */
		repos?: ProviderRepositoriesInput;
		/** Organization/account to search. Combines with `repos`. */
		org?: string;
		criteria?: IssueSearchCriteria;
		/**
		 * Requested 1-based page. This read is cursor-only, so without a `cursor` reaching page N costs O(N)
		 * upstream requests; pass the previous page's cursor to make it exactly one.
		 */
		page?: number;
		cursor?: string;
		/**
		 * Page size PER RELATIONSHIP, not per page. Each requested relationship is its own provider query, so a
		 * page of a 2-relationship search returns up to `2 × itemsPerPage` items before deduplication — and fewer
		 * than that when the two overlap. `page.itemsPerPage` reports what actually came back, so size the UI off
		 * that rather than off this. A provider may also cap it below what is asked for.
		 */
		itemsPerPage?: number;
		forceSync?: boolean;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. */
		domain?: string;
	}): Promise<ProviderPagedResult<IssueShape>>;
	/**
	 * How many issues MATCH each scope, without fetching any of them — the probe behind a "this will fetch ~N
	 * issues" preview, and behind a live count next to a filter the user hasn't applied yet.
	 *
	 * Cheap by design: every scope that can share a request does, and no issue data crosses the wire (measured
	 * against GitHub, 30 counts are a single rate-limit point). Still a network request per batch, so debounce and
	 * cache it if it's driven from UI state.
	 *
	 * A separate method rather than a flag on {@link searchIssuesPage} because transferring zero issues is the
	 * whole point: a `countOnly` read would hand back a paged result whose `items`/`cursor`/`hasMore` are all
	 * meaningless.
	 *
	 * Results are echoed under the caller's own `key`, so no positional matching is needed. Per-scope isolation is
	 * the rule: a scope refused for its own reasons, or a batch that failed upstream, warns and drops only its own
	 * scopes (with `fetchFailed` set) while every other count still comes back.
	 *
	 * `count: undefined` means the provider didn't report one — NOT zero, which is a real answer. Render the
	 * difference: showing an unknown count as 0 tells the user a filter matches nothing when it may match
	 * thousands. A provider that can't count at all (only GitHub/GHE can today) refuses the probe outright rather
	 * than returning fabricated numbers.
	 */
	countIssues(options: {
		providerId: IntegrationIds;
		/** Each needs its own scope, and each requested relationship its own entry — see {@link IssueCountScope}. */
		scopes: readonly IssueCountScope[];
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. */
		domain?: string;
	}): Promise<ProviderResult<IssueCountResult>>;
	/** Issue trackers are cloud-only, so this read takes no `domain`. */
	listIssueTrackerIssuesPage(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		forceSync?: boolean;
		page?: number;
		/**
		 * Opaque continuation from a prior result. It can bundle the next untouched project window with failed
		 * discovery/project retries and already-emitted project identities, so it is not equivalent to `page`.
		 * Thread it back verbatim. A retry-only cursor can remain when `hasMore` is false; reusing that cursor is
		 * an explicit manual retry, while `hasMore` represents automatic forward progress only.
		 */
		cursor?: string;
		/**
		 * Page size in PROJECTS, not issues (default 20): these providers have no cross-project issue cursor, so
		 * a page is a window of projects, each drained in full. Supplying it (or `page`/`cursor`) opts into
		 * pagination; omitting all three aggregates every matched project in one page.
		 */
		itemsPerPage?: number;
		connectionId?: string;
	}): Promise<ProviderPagedResult<IssueShape>>;
	sweepPullRequests(options?: PullRequestSweepOptions): Promise<ProviderSweepResult<PullRequestShape>>;
	sweepClosedPullRequests(options?: ClosedPullRequestSweepOptions): Promise<ProviderSweepResult<PullRequestShape>>;
	broadenIssues(options: {
		orgs: ProviderBroadenOrg[];
		/**
		 * Requested 1-based page. Without a `cursor` the fan-out is re-run once per prior page (O(page) rounds),
		 * since a per-org cursor bundle is the only way to address a later page.
		 */
		page?: number;
		/** Continuation from a prior page's `cursor`; supplying it runs exactly one fan-out round. */
		cursor?: string;
		forceSync?: boolean;
	}): Promise<ProviderBroadenResult<IssueShape>>;
	resolveRepository(options: {
		providerId?: IntegrationIds;
		remoteUrl: string;
		host?: string;
		connectionId?: string;
		/**
		 * Explicit self-managed host domain used to select the integration instance. It must come from trusted
		 * authentication configuration. Without it, the host parsed from `remoteUrl` is only a resolution
		 * candidate: the facade proceeds only when that host matches a configured integration, so repository
		 * data cannot select credentials for an arbitrary host.
		 */
		domain?: string;
	}): Promise<ResolveRepositoryResult>;
}
