export { PullRequestFilter } from '@gitlens/git/models/pullRequest.js';

export enum IssueFilter {
	Author = 'author',
	Assignee = 'assignee',
	Mention = 'mention',
}

/**
 * The filtered issue search's criteria model, re-exported from the git models so it can be reached from here
 * alongside the two filter enums above.
 *
 * It lives in `@gitlens/git` rather than in this package because the provider implementations that translate it
 * to a query — the GitHub API client among them — sit BELOW this package in the dependency graph and can't import
 * from it. {@link IssueSearchRelationship} is a superset of {@link IssueFilter}: it adds the two user-independent
 * relationships (`any-assignee`, `unassigned`) that the user-relative "my issues" filters have no way to name.
 */
export type {
	IssueSearchCapabilities,
	IssueSearchCriteria,
	IssueSearchRelationship,
	IssueSortField,
	IssueSorting,
} from '@gitlens/git/models/issue.js';

/**
 * The filtered pull-request search criteria and its capability table. These live in `@gitlens/git` for the
 * same dependency-direction reason as the issue-search model above: provider API clients translate them below
 * this package and cannot import this facade.
 */
export type {
	PullRequestSearchCapabilities,
	PullRequestSearchCriteria,
	PullRequestSortField,
	PullRequestSorting,
} from '@gitlens/git/models/pullRequest.js';
