export enum PullRequestFilter {
	Author = 'author',
	Assignee = 'assignee',
	ReviewRequested = 'review-requested',
	Mention = 'mention',
}

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
} from '@gitlens/git/models/issue.js';
