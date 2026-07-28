import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape, PullRequestStateFilter } from '@gitlens/git/models/pullRequest.js';
import type { Event } from '@gitlens/utils/event.js';
import type { ConfiguredIntegrationsChangeEvent } from './authentication/configuredIntegrationService.js';
import type { ConfiguredIntegrationDescriptor } from './authentication/models.js';
import type { IntegrationIds } from './constants.js';
import type { IssueFilter, PullRequestFilter } from './providerFilters.js';
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
	filters?: PullRequestFilter[];
	forceSync?: boolean;
	maxPages?: number;
};

export type PullRequestSweepOptions = PullRequestSweepCommonOptions & ProviderSweepSelection;

export type ClosedPullRequestSweepOptions = Omit<PullRequestSweepCommonOptions, 'states'> & ProviderSweepSelection;

/**
 * Public, provider-neutral integration facade. Provider clients and integration model instances remain private
 * implementation details so SDK changes don't expand this contract.
 *
 * ## Paging contract
 *
 * Every paged read (`listRepos`, `listPullRequestsPage`, `listIssuesPage`, `listIssueTrackerIssuesPage`,
 * `broadenIssues`) takes both `page` and `cursor`, and the two are NOT interchangeable:
 *
 * - **Supplying `cursor` guarantees a single upstream round trip per provider scope.** A threaded continuation
 *   is handed to the provider as-is; the facade never walks the pages before it. This is a guarantee, not an
 *   optimization: a consumer that threads `cursor` back pays O(1) requests per page.
 * - **Supplying only `page` (> 1) may cost O(page) upstream requests.** A cursor-only read (GitHub's
 *   repo-scoped and account-wide searches, the account-wide "my PRs"/issue reads, the broaden fan-out) can't be
 *   addressed by number, so the facade drains the pages before the requested one internally and returns just
 *   page N. That drain is the supported fallback for a page-number-only consumer (e.g. the first read after a
 *   refresh, where no cursor was persisted) and MUST be kept — it is not dead code once a consumer threads
 *   cursors, it is the other half of this contract.
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
	 * `issues` covers the repo-scoped issue read; `issuesAccountWide` covers the account-wide one (no `repos`).
	 * They differ because they are different provider queries — GitLab can express `Assignee` account-wide and
	 * nothing else — and `listIssuesPage` validates against whichever the read uses.
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
		issues: IssueFilter[];
		issuesAccountWide: IssueFilter[];
	};
	refreshConnections(): Promise<void>;
	setPrimaryConnection(id: IntegrationIds, connectionId: string): Promise<void>;
	deleteConnection(id: IntegrationIds, connectionId: string, cloud?: boolean): Promise<void>;

	listOrgs(options?: {
		providerId?: IntegrationIds;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. Requires a single `providerId`. */
		domain?: string;
	}): Promise<ProviderResult<ProviderOrganization>>;
	listProjects(options?: {
		providerId?: IntegrationIds;
		org?: string;
		connectionId?: string;
		/** Self-managed host domain fallback; see {@link ProviderSweepTarget.domain}. Requires a single `providerId`. */
		domain?: string;
	}): Promise<ProviderResult<ProviderOrganization>>;
	listRepos(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
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
		filters?: PullRequestFilter[];
		/**
		 * Requested 1-based page. Without a `cursor` this may cost O(page) upstream requests on a cursor-only
		 * read (the account-wide path, and repo-scoped GitHub/GHE), which the facade drains internally.
		 */
		page?: number;
		/** Continuation from a prior page's `cursor`; supplying it costs exactly one upstream request per scope. */
		cursor?: string;
		/**
		 * Requested page size, honored on the repo-scoped path. The account-wide read (no `repos`) is
		 * cursor-based and takes no page size, so it is ignored there — `page.itemsPerPage` reports what was
		 * actually returned rather than echoing the request.
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
		 * On the account-wide path this REPLACES the provider's own definition of "my issues" — GitHub/GHE union
		 * authored + assigned + mentioned, Azure drains assigned + authored, GitLab reads assigned-to-me — so
		 * `[Assignee]` gets `assignee:@me` semantics wherever it's expressible. Narrowing must happen here rather
		 * than on the returned page: the excluded items still counted toward the provider's paging, so filtering
		 * afterward leaves `items` describing a different result set than `hasMore`/`cursor`.
		 *
		 * A set the provider can't express server-side is refused whole (warning + `fetchFailed`), never widened.
		 */
		filters?: IssueFilter[];
		/** Broadens to every assignee. Contradicts `filters`; passing both is refused. */
		includeAllAssignees?: boolean;
		/**
		 * Requested 1-based page. Without a `cursor` this may cost O(page) upstream requests on a cursor-only
		 * read (the account-wide path, and repo-scoped GitHub/GHE), which the facade drains internally.
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
	/** Issue trackers are cloud-only, so this read takes no `domain`. */
	listIssueTrackerIssuesPage(options: {
		providerId: IntegrationIds;
		org?: string;
		project?: string;
		filters?: IssueFilter[];
		includeAllAssignees?: boolean;
		forceSync?: boolean;
		page?: number;
		/** Continuation from a prior page's `cursor`. Windows of projects are addressable by number, so this is equivalent to `page`. */
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
		 * Explicit self-managed host domain used to select the integration instance. Used only when the requested
		 * connection has no configured domain; it must come from the trusted authentication configuration, not
		 * repository or remote data. Without it, an unpinned self-managed read falls back to the domain parsed
		 * from `remoteUrl`, which is repository-supplied.
		 */
		domain?: string;
	}): Promise<ResolveRepositoryResult>;
}
