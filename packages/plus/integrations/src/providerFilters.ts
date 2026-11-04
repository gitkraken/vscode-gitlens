import type { IssueSearchCapabilities, IssueSorting } from '@gitlens/git/models/issue.js';
import type { PullRequestFilter, PullRequestSearchCapabilities } from '@gitlens/git/models/pullRequest.js';

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

/**
 * What `getSupportedFilters` (`reads/filters.ts`) reports: every vocabulary a provider's reads can express, so a consumer can
 * narrow to it BEFORE issuing a read. See that function for the capability table itself and why intersecting
 * against this is what keeps a filtered read from being refused.
 *
 * Named rather than written inline, because the same shape is the declared return type of THREE declarations that
 * all describe one value — this function, `IntegrationService.getSupportedFilters`, which only forwards to it, and
 * `IntegrationManager.getSupportedFilters`, which publishes it. Spelled out three times, a member added here
 * reached one of them and left the others a compile error away from the truth; that is exactly how the two sort
 * members below came to be written out three times.
 */
export type SupportedFilters = {
	pullRequests: PullRequestFilter[];
	pullRequestsAccountWide: PullRequestFilter[];
	/**
	 * Criteria and scopes the filtered pull-request search can express. Always present; an empty relationship list
	 * means the provider exposes no filtered pull-request search.
	 */
	pullRequestSearch: PullRequestSearchCapabilities;
	/**
	 * Filters the repo-scoped issue read accepts — and, for an issue tracker (Jira/Linear/Trello), its
	 * project-scoped read, that being its only issue surface. A tracker therefore reports here and leaves
	 * `issuesAccountWide` empty, so intersecting a tracker against that field would read "cannot filter" for a
	 * provider that filters fine.
	 */
	issues: IssueFilter[];
	issuesAccountWide: IssueFilter[];
	/**
	 * What the filtered issue search (and the count probe over the same criteria) can express. Always present: a
	 * provider with no filtered issue search reports an empty `relationships` and all-false flags, which is the
	 * signal to hide that surface rather than to hide individual chips.
	 */
	issueSearch: IssueSearchCapabilities;
	/**
	 * Sort keys the repo-scoped issue read can express — and, for an issue tracker, its project-scoped read. Empty
	 * means the read can't be ordered, so pass no `sort`.
	 *
	 * A key here is expressible on ONE provider query. A page spanning several repositories or projects is a merge,
	 * and a merge can only order by what a normalized issue carries, so `priority`/`dueDate`/`resolved` are refused
	 * there even where they are listed. Read one scope at a time to use them.
	 */
	issueSorts: IssueSorting[];
	/**
	 * Sort keys the account-wide issue read can express — a different vocabulary, not a subset: for GitLab the two
	 * reads are different APIs. Needs no mergeability caveat, because every account-wide read is a union of several
	 * queries, so only keys a merge can honor are listed at all. Empty for an issue tracker, which reports under
	 * `issueSorts`.
	 */
	issueSortsAccountWide: IssueSorting[];
	/**
	 * Whether issue list reads can be asked for a `state` other than open (`closed`, `all`). False means
	 * only open issues are readable, and the read refuses the other two rather than serving the open list.
	 *
	 * Includes Azure DevOps Services and Server list reads. Filtered search reports its independent state
	 * capability under `issueSearch.states`.
	 */
	issueStates: boolean;
};
