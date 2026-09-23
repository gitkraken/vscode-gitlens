import type { CollectionMetadata } from '@gitkraken/provider-apis';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';

/**
 * One provider page of the filtered pull-request search, before the facade turns it into a neutral
 * paged result with warnings.
 *
 * `totalCount` is the provider-reported pre-ceiling facet count, not the number of rows that remain reachable
 * after a provider limit. It stays optional because absence means "not reported", never zero. Together with
 * `truncated` it lets the facade distinguish GitHub's quantified ceiling from another unusable continuation.
 *
 * `metadata` carries the facets whose rows are missing from the walk so far — Bitbucket Data Center reads every
 * facet as its own request, so one can be refused (a repository the token can't see) without the others. It
 * describes the whole walk rather than one page: a facet that failed on this page is reported here and retried on
 * the next, and one whose retry failed too is dropped and reported on every later page, since its hole is still in
 * the result. A retry that succeeds recovers the rows, so it drops out. The last page read is therefore the one to
 * assess; the facade reports each failure as a warning with `fetchFailed`, and a page where EVERY facet failed
 * throws instead.
 */
export type ProviderPullRequestSearchPage = {
	values: PullRequestShape[];
	truncated: boolean;
	cursor?: string;
	hasMore: boolean;
	page: number;
	totalCount?: number;
	metadata?: CollectionMetadata;
	/** See `ProviderIssueSearchPage.limitReached`. */
	limitReached?: boolean;
};

/**
 * One scope's pull-request count, as the provider reports it.
 *
 * `lowerBound` marks a count that stopped before the scope was exhausted: a provider with no count query
 * (Bitbucket Data Center) counts by reading, within a budget, so past it `count` is how many matched in what was
 * read — a floor, never the total.
 *
 * An `Error` in its place refuses that ONE scope for its own reasons (Azure DevOps Server refusing a scope it can't
 * search): the facade warns and drops only it, as it does for a scope it refuses itself.
 */
export type ProviderPullRequestCount = {
	count: number | undefined;
	lowerBound?: boolean;
};
