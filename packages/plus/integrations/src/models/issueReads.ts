import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { IssueShape, IssueSorting, IssueStateFilter } from '@gitlens/git/models/issue.js';
import type { IssueFilter } from '../providerFilters.js';

/**
 * The result and option contracts of the integration layer's issue reads — the shapes a PROVIDER returns to the
 * facade, before the facade turns them into the paged/warning results a consumer sees.
 *
 * They live together, and apart from `IntegrationBase`, because they are pure data with one job: pinning what
 * each issue read promises. Reading them side by side is also the point — `ProviderIssueSearchPage` is
 * deliberately `AccountWideIssuesResult` plus a count, and that relationship is invisible when they sit at
 * opposite ends of a 1000-line class module.
 */

/**
 * Account-wide issue read result. `truncated` is a provider-native incompleteness signal (GitHub's search
 * ceiling, an Azure per-project backstop); cursor-capable providers also expose `cursor`/`hasMore`/`page`.
 * `metadata` optionally carries structured per-scope failures from a fan-out (Azure across projects).
 */
export type AccountWideIssuesResult = {
	values: IssueShape[];
	truncated: boolean;
	metadata?: CollectionMetadata;
	cursor?: string;
	hasMore?: boolean;
	page?: number;
};

/**
 * One page of the FILTERED issue search (`GitHostIntegration.searchIssuesPageResult`).
 *
 * Carries what {@link AccountWideIssuesResult} does, plus `totalCount`: the number of matches the provider
 * reported, which is what makes the result ceiling reportable as a figure ("N matched, at most M can be read")
 * rather than as a bare `truncated` flag. `undefined` means the provider reported no count, never zero matches.
 */
export type ProviderIssueSearchPage = {
	values: IssueShape[];
	truncated: boolean;
	cursor?: string;
	hasMore: boolean;
	page: number;
	totalCount?: number;
};

/**
 * Options for an issue tracker's PROJECT-scoped read (`IssuesIntegration.getIssuesForProject*`), which is the
 * only issue surface a tracker has — its issues live under resource -> project, so there is no account-wide read
 * to pair this with.
 *
 * Named rather than repeated inline at each of the six declarations this shape appears in (the two public
 * `Result` methods, the two protected provider cores, and their Jira/Linear/Trello overrides), so a field added
 * here can't reach five of them and be forgotten in the sixth.
 */
export type IssuesForProjectOptions = {
	/** The account handle to scope to, resolved per resource by the caller. Omitted reads every assignee. */
	user?: string;
	/** Validated by the caller against `ProviderMetadata.supportedIssueFilters`; unsupported refuses the read. */
	filters?: IssueFilter[];
	/**
	 * How the provider should order the project's issues, as `field:direction`.
	 *
	 * Validated against `ProviderMetadata.supportedIssueSorts` — a tracker reports there, not under the
	 * account-wide table. Note the caller reads MANY projects and merges them, so it additionally refuses a key
	 * no normalized issue carries; this option orders one project's query.
	 */
	sort?: IssueSorting;
};

export type ProjectIssuesDrain = {
	values: IssueShape[];
	metadata?: CollectionMetadata;
} & (
	| { truncated: false }
	| {
			truncated: true;
			/**
			 * `narrow-scope` means a smaller server-side scope avoids this truncation. `none` covers incomplete
			 * results without that guarantee, including Linear's client-side assignee filtering.
			 */
			recovery: 'narrow-scope' | 'none';
	  }
);

/**
 * Options for the REPO-scoped issue read (`GitHostIntegration.getMyIssuesForRepos*`), the git-host counterpart of
 * {@link IssuesForProjectOptions}.
 *
 * Named for the same reason that one is: the shape appears at three declarations — the public method, its
 * result-returning core, and the shapes-returning core that maps it — and was previously spelled out inline at
 * each, so `sort` had to be added three times and two of the copies grew a `See {@link getMyIssuesForRepos}`
 * breadcrumb to admit they were the same contract. One name means a field added here reaches all three.
 */
export type MyIssuesForReposOptions = {
	/** Validated by the caller against `ProviderMetadata.supportedIssueFilters`; unsupported refuses the read. */
	filters?: IssueFilter[];
	cursor?: string;
	customUrl?: string;
	page?: number;
	pageSize?: number;
	/** When true, don't constrain to the current user's assigned issues even if the Assignee filter is set. */
	includeAllAssignees?: boolean;
	/** Issue states to include; when omitted the provider returns its default (open only). */
	state?: IssueStateFilter;
	/**
	 * How the provider should order the read. Forwarded to every query this read issues, so the ORDER WITHIN each
	 * scope is the provider's; the union across scopes is not ordered here — the facade (`listIssuesPage`) owns
	 * that, because it is also the layer that can refuse a key no merge can honor.
	 */
	sort?: IssueSorting;
};

/**
 * Options for the account-wide issue read. `includeAllAssignees` drops the "assigned to me" scoping so the
 * read broadens to issues assigned to anyone (the account-wide equivalent of the repo-scoped
 * `GitHostIntegration.getMyIssuesForReposResult`'s toggle). Authored/mentioned categories, where a
 * provider has them, stay user-relative — they're meaningless without a user.
 */
export type SearchMyIssuesOptions = {
	includeAllAssignees?: boolean;
	/**
	 * Narrows the account-wide read to the requested relationship(s) instead of the provider's own definition of
	 * "my issues" (GitHub/GHE: authored ∪ assigned ∪ mentioned; Azure: assigned ∪ authored; GitLab:
	 * assigned-to-me). Narrowing has to happen HERE, not on the returned page: the excluded items still counted
	 * toward the provider's page/cursor, so a client-side filter desynchronizes `items` from `hasMore`.
	 *
	 * Only filters the provider can express server-side are accepted; the facade validates the set against
	 * `ProviderMetadata.supportedAccountWideIssueFilters` (all-or-nothing) and refuses the read rather than
	 * serving the unnarrowed union as if it had been filtered. Omitted keeps the provider's definition.
	 */
	filters?: IssueFilter[];
	cursor?: string;
	/**
	 * Narrows the account-wide read to one org/account (Azure: the organization) and/or one project within it.
	 * Only honored by a host with a project layer (Azure), whose account-wide read otherwise fans out over every
	 * project of every org; the caller checks `supportsProjectDiscovery` before asking, so a host without a
	 * project layer never silently returns an unscoped list as if it had been narrowed.
	 */
	org?: string;
	project?: string;
	/**
	 * How the provider should order the read, as `field:direction`.
	 *
	 * Validated by the facade against `ProviderMetadata.supportedAccountWideIssueSorts` — a DIFFERENT table from
	 * the repo-scoped one, because for GitLab the two reads are different APIs with different sort vocabularies —
	 * and refused rather than downgraded when the provider can't express it.
	 *
	 * Supplied on every facade read, never omitted: an omitted sort leaves each provider's own default, which is
	 * exactly the cross-provider incoherence this layer exists to remove. A provider that reaches this with
	 * `undefined` was called directly, not through the facade, and keeps whatever order it had.
	 */
	sort?: IssueSorting;
};
