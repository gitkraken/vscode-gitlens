import { SUPPORTED_ISSUE_SORTS } from '@gitkraken/provider-apis';
import { getIssueComparator } from '@gitlens/git/utils/issue.utils.js';
import type { IssueSorting } from '../providerFilters.js';

/**
 * The per-provider ordering vocabulary of the issue reads: which neutral `field:direction` keys each provider
 * surface can express SERVER-SIDE.
 *
 * DERIVED from `@gitkraken/provider-apis`, not transcribed from it. The SDK is where a neutral key becomes a
 * provider query, so it is the only place that can say what a provider accepts; a copy kept here would be a
 * second hand-maintained table on a second release cadence, and the symptom of drift is not a failed build but a
 * read this facade promised and the SDK then rejects at runtime — which is exactly what happened while these were
 * transcribed, on the one key (`reactions`) whose meaning is narrower than its name.
 *
 * Why the asymmetries between surfaces exist (GitHub cannot order by close date, GitLab's two reads are different
 * APIs with different vocabularies, Azure has no `dueDate` outside the Agile process, Linear is descending-only,
 * Jira has votes rather than reactions) is documented on the SDK's own maps. This module adds exactly one rule of
 * its own — {@link mergeableSorts} — and everything else is a rename from the SDK's surface names to the two
 * fields `ProviderMetadata` publishes.
 */

/** One SDK read surface, widened to the union this package uses (structurally the same `field:direction` type). */
const surface = (name: keyof typeof SUPPORTED_ISSUE_SORTS): IssueSorting[] => [...SUPPORTED_ISSUE_SORTS[name]];

/**
 * The subset a MERGED page can honor: the keys a normalized issue carries.
 *
 * Applied to the account-wide surfaces because every account-wide read is a union of several provider queries
 * merged in this facade — GitHub's three `@me` searches, GitLab's one REST call per relationship, Azure's
 * (project × relationship) drains — and the caller has no scope count to reduce, so it ALWAYS merges. GitLab's
 * REST endpoint really does order by `priority` and `dueDate`, and Azure's WIQL by `resolved` and `priority`;
 * none of them survive a merge, so the surface cannot honor them and must not advertise them.
 *
 * Expressed as the rule rather than as a hand-removed list, so a key the SDK adds later is classified by the same
 * predicate that will decide at read time whether the merge can order by it, instead of by whoever last edited a
 * literal here. The repo-scoped surfaces are NOT filtered: those merge only when the caller passes several
 * scopes, which is a property of the call rather than of the provider (see `mergesProviderQueries`).
 */
const mergeableSorts = (sorts: readonly IssueSorting[]): IssueSorting[] =>
	sorts.filter(sort => getIssueComparator(sort) != null);

/** GitHub and GHE: one `search` channel serves all three issue reads, so all three order the same way. */
export const githubIssueSorts: IssueSorting[] = surface('github');

/**
 * The same `search` channel, narrowed to what the three `@me` searches can order once this facade has merged them.
 *
 * Identical to {@link githubIssueSorts} today — every qualifier the SDK's GitHub surface carries is a field an
 * `IssueShape` models — so this exists for the drift, not for a difference: `readAccountWideIssuesPage`
 * deliberately runs no `unmergeable` check, on the stated grounds that an account-wide table only lists keys a
 * merge can honor. Left as the raw surface, one qualifier added upstream (a `closed` or `interactions` sort) would
 * make that assumption false for GitHub alone and publish three concatenated alias runs under it, unwarned.
 */
export const githubAccountWideIssueSorts: IssueSorting[] = mergeableSorts(surface('github'));

/** GitLab's repository-scoped read, which goes through GraphQL `IssueSort`. */
export const gitlabIssueSorts: IssueSorting[] = surface('gitlabRepository');

/** GitLab's account-wide read: the REST `order_by`/`sort` pair, narrowed to what its merge can order. */
export const gitlabAccountWideIssueSorts: IssueSorting[] = mergeableSorts(surface('gitlabAccountWide'));

/** Azure DevOps, as WIQL `ORDER BY` columns. */
export const azureIssueSorts: IssueSorting[] = surface('azureDevOps');

/** The same WIQL, narrowed to what the per-project fan-out can order once it has merged. */
export const azureAccountWideIssueSorts: IssueSorting[] = mergeableSorts(surface('azureDevOps'));

/** Jira Cloud and Server, as JQL `ORDER BY` fields — one JQL builder, so one surface. */
export const jiraIssueSorts: IssueSorting[] = surface('jira');

/** Linear's `PaginationOrderBy`, which has no ascending member at all. */
export const linearIssueSorts: IssueSorting[] = surface('linear');

/** Trello's search modifiers: `sort:edited` / `sort:-edited`, and nothing else usable for issues. */
export const trelloIssueSorts: IssueSorting[] = surface('trello');
