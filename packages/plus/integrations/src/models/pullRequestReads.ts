import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';

/**
 * One provider page of the filtered pull-request search, before the facade turns it into a neutral
 * paged result with warnings.
 *
 * `totalCount` is the provider-reported pre-ceiling facet count, not the number of rows that remain reachable
 * after a provider limit. It stays optional because absence means "not reported", never zero. Together with
 * `truncated` it lets the facade distinguish GitHub's quantified ceiling from another unusable continuation.
 */
export type ProviderPullRequestSearchPage = {
	values: PullRequestShape[];
	truncated: boolean;
	cursor?: string;
	hasMore: boolean;
	page: number;
	totalCount?: number;
};
