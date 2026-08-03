import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { IssueShape } from '@gitlens/git/models/issue.js';
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
};
