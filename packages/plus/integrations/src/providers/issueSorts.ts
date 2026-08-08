import type { IssueSorting } from '../providerFilters.js';

/**
 * The per-provider ordering vocabulary of the issue reads: which neutral `field:direction` keys each provider
 * surface can express SERVER-SIDE, one constant per surface.
 *
 * A module of its own rather than more of `models.ts`, which already carries every provider's whole metadata
 * record: this is one cohesive concern with four asymmetries that need explaining side by side, and explaining them
 * next to scopes, icons and paging modes buries them. `providersMetadata` reads these; nothing else should need to.
 *
 * These are transcriptions of the translation tables in `@gitkraken/provider-apis` (`GITHUB_ISSUE_SORT_QUALIFIERS`,
 * `GITLAB_GRAPHQL_ISSUE_SORTS`, `GITLAB_REST_ISSUE_SORTS`, `AZURE_ISSUE_SORT_FIELDS`, `JIRA_ISSUE_SORT_FIELDS`,
 * `LINEAR_ISSUE_SORT_ORDER_BY`, `TRELLO_ISSUE_SORT_MODIFIERS`), which are the only place the neutral key becomes a
 * provider query. Declaring a key the SDK doesn't translate doesn't produce a differently-ordered read — it
 * produces an `UnsupportedSortError` after this facade already promised the key, so the parity test that pins
 * these against those tables is what keeps the promise honest.
 *
 * Four asymmetries are load-bearing and easy to "fix" by mistake:
 * - **GitHub does not order by close date.** `closed` is absent no matter that `IssueShape.closedDate` exists; a
 *   client-side sort over a page truncated at the result ceiling is exactly the error the ordering contract avoids.
 * - **GitLab's two surfaces genuinely differ.** The repository-scoped read is GraphQL (`IssueSort`, which has
 *   `TITLE_*` and `CLOSED_AT_*`) and the account-wide read is REST (`order_by`, which has neither), so the two are
 *   written out separately and neither is derived from the other.
 * - **Azure declares no `dueDate`.** `Microsoft.VSTS.Scheduling.DueDate` is an Agile-process field, absent under
 *   Scrum/Basic, so a read that ordered by it would fail on some organizations and not others.
 * - **`reactions` means THUMBS-UP**, not the total across every reaction type: it is the only reaction count an
 *   `IssueShape` carries, so it is also what the merge comparator reads, and both sides emit the per-emoji
 *   qualifier so a single-scope and a merged read agree.
 * - **Linear orders DESCENDING ONLY**, and **Jira declares no `reactions`**: it has votes, and a vote is not a
 *   reaction, so mapping them would break what the neutral key means everywhere else.
 */
export const githubIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'comments:asc',
	'comments:desc',
	'reactions:asc',
	'reactions:desc',
];

/** GitLab's repository-scoped read, which goes through GraphQL `IssueSort`. */
export const gitlabIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'closed:asc',
	'closed:desc',
	'reactions:asc',
	'reactions:desc',
	'priority:asc',
	'priority:desc',
	'dueDate:asc',
	'dueDate:desc',
	'title:asc',
	'title:desc',
];

/**
 * GitLab's account-wide read, which goes through the REST `order_by`/`sort` pair — not a subset of the above.
 *
 * REST also accepts `priority` and `due_date`, and they are deliberately NOT declared. This read is a UNION of one
 * REST call per requested relationship, merged here by url, so it can only honor a key a normalized issue carries
 * — and unlike the repo-scoped read, the caller has no scope count to make single-query: it always merges. A key
 * the read can never honor doesn't belong in a table whose whole purpose is that a consumer intersecting against
 * it never gets refused.
 */
export const gitlabAccountWideIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'reactions:asc',
	'reactions:desc',
];

/** Azure DevOps, as WIQL `ORDER BY` columns. */
export const azureIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'closed:asc',
	'closed:desc',
	'resolved:asc',
	'resolved:desc',
	'comments:asc',
	'comments:desc',
	'priority:asc',
	'priority:desc',
	'title:asc',
	'title:desc',
];

/** What Azure's account-wide fan-out can honor: `azureIssueSorts` minus the keys a merge can't order by. */
export const azureAccountWideIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'closed:asc',
	'closed:desc',
	'comments:asc',
	'comments:desc',
	'title:asc',
	'title:desc',
];

/** Jira, as JQL `ORDER BY` fields. */
export const jiraIssueSorts: IssueSorting[] = [
	'created:asc',
	'created:desc',
	'updated:asc',
	'updated:desc',
	'resolved:asc',
	'resolved:desc',
	'priority:asc',
	'priority:desc',
	'dueDate:asc',
	'dueDate:desc',
	'title:asc',
	'title:desc',
];

/** Linear's `PaginationOrderBy`, which has no ascending member at all. */
export const linearIssueSorts: IssueSorting[] = ['created:desc', 'updated:desc'];

/** Trello's search modifiers: `sort:edited` / `sort:-edited`, and nothing else usable for issues. */
export const trelloIssueSorts: IssueSorting[] = ['updated:asc', 'updated:desc'];
