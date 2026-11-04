import { githubSearchResultLimit } from '@gitlens/git-github/api/config.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { IntegrationIds } from '../constants.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import type { IntegrationType } from '../models/publicIntegration.js';
import type {
	IssueSearchCapabilities,
	IssueSorting,
	PullRequestSearchCapabilities,
	PullRequestSorting,
} from '../providerFilters.js';
import { IssueFilter, PullRequestFilter } from '../providerFilters.js';
import {
	azurePullRequestSearchSorts,
	azureWorkItemSearchRelationships,
	azureWorkItemSearchResultLimit,
	azureWorkItemSearchSorts,
} from './azure/search.js';
import {
	asanaIssueSorts,
	azureAccountWideIssueSorts,
	azureIssueSorts,
	githubAccountWideIssueSorts,
	githubIssueSorts,
	gitlabAccountWideIssueSorts,
	gitlabIssueSorts,
	jiraIssueSorts,
	linearIssueSorts,
	trelloIssueSorts,
} from './issueSorts.js';

// Provider metadata (names, domains, icons, scopes, capabilities) and the domain checks built on it. Kept apart from
// `models.ts`, which holds the `@gitkraken/provider-apis` mappings, so the public facade can re-export this without
// its declarations reaching the SDK.

export enum PagingMode {
	Project = 'project',
	Repo = 'repo',
	Repos = 'repos',
}

export interface ProviderMetadata {
	domain: string;
	id: IntegrationIds;
	name: string;
	type: IntegrationType;
	/** Key for the `gl-provider-<iconKey>` glicon. Cloud self-managed variants reuse the base
	 * `'github-enterprise'`/`'gitlab-self-hosted'` icon (no enum member exists for those anymore). */
	iconKey: string;
	issuesPagingMode?: PagingMode;
	pullRequestsPagingMode?: PagingMode;
	scopes: string[];
	supportedPullRequestFilters?: PullRequestFilter[];
	/**
	 * Relationship filters the ACCOUNT-WIDE pull-request read can express as an exact OR union.
	 * This is independent from `supportedPullRequestFilters`, which describes repo-scoped reads.
	 */
	supportedAccountWidePullRequestFilters?: PullRequestFilter[];
	/**
	 * What the filtered pull-request search can express server-side. Absent means the provider has
	 * no such search and the facade refuses it rather than returning an unfiltered page.
	 */
	supportedPullRequestSearch?: PullRequestSearchCapabilities;
	/**
	 * Maximum results the provider will serve for one pull-request search facet. Matches beyond it are unreachable
	 * and are reported as a succeeded omission carrying this limit plus the provider's pre-ceiling facet count.
	 */
	pullRequestSearchResultLimit?: number;
	/** Filters the REPO-scoped issue read can express. */
	supportedIssueFilters?: IssueFilter[];
	/**
	 * Filters the ACCOUNT-WIDE issue read can express, which is NOT the same set as
	 * {@link ProviderMetadata.supportedIssueFilters}: the two reads are different provider queries.
	 *
	 * Unfiltered, each provider's account-wide read is that provider's own definition of "my issues" — GitHub/GHE
	 * union authored + assigned + mentioned, Azure drains assigned + authored, and GitLab reads assigned-to-me.
	 * A consumer replacing a narrower tool (`gk`'s `assignee:@me`) must select the `Assignee` filter wherever the
	 * provider's default is wider.
	 *
	 * A filter listed here narrows that read server-side. Absent/empty means the read can't be narrowed at all,
	 * so the facade refuses a filtered request rather than serving the unnarrowed union as if it had been
	 * filtered. GitLab lists `Assignee` and `Author` because the SDK's account-wide input exposes both username
	 * axes; it omits `Mention` because that REST read has no first-class mention filter.
	 */
	supportedAccountWideIssueFilters?: IssueFilter[];
	/**
	 * Sort keys the REPO-scoped issue read can express server-side — and, for an issue tracker (Jira/Linear/Trello),
	 * its project-scoped read, which is the only issue surface a tracker has.
	 *
	 * Absent/empty means the read can't be ordered at all, so a request carrying `sort` is refused rather than
	 * served in whatever order the provider felt like. Present, it is a promise: every key here reaches the
	 * provider query.
	 *
	 * A key listed here is expressible on ONE provider query, which is what this read is when it is given ONE
	 * scope. Given several (GitLab across repositories, Azure across projects, a tracker across projects) it merges
	 * their results here and can only honor a key a normalized issue carries, so it additionally refuses
	 * `priority`/`dueDate`/`resolved` — see `getIssueComparator`. That depends on the caller's scope count rather
	 * than on the provider, which is why it is a runtime refusal and not a fourth table: encoding it here would
	 * under-report the single-scope read, which really does support those keys.
	 */
	supportedIssueSorts?: IssueSorting[];
	/**
	 * Sort keys the ACCOUNT-WIDE issue read can express server-side, which is NOT the same set as
	 * {@link ProviderMetadata.supportedIssueSorts} — for GitLab the two reads are different APIs (GraphQL vs REST)
	 * with genuinely different vocabularies, not one narrowed twice.
	 *
	 * Absent means the account-wide read can't be ordered (or doesn't exist). An issue tracker leaves this empty
	 * and reports under `supportedIssueSorts`, so reading a tracker's capability from here under-reports it.
	 *
	 * Unlike {@link ProviderMetadata.supportedIssueSorts} this needs no companion runtime refusal, because every
	 * provider's account-wide read is a union of several queries with no scope count for a caller to reduce: it
	 * ALWAYS merges. So the keys a merge can't order by are simply absent here — the table states what the read can
	 * honor, which is what makes intersecting against it sufficient.
	 */
	supportedAccountWideIssueSorts?: IssueSorting[];
	/**
	 * Whether issue list reads (including Azure project/repository and account-wide reads) can be asked for a `state` other than open, and honor it server-side.
	 *
	 * A tracker read is open-only unless asked otherwise, so absent does not mean the read returns every state: it
	 * means only `'open'` is expressible, and `'closed'`/`'all'` are refused rather than served as the open list.
	 * Server-side, because each read drains to a page backstop: dropping states afterwards would let a project full
	 * of done work spend that budget before reaching the open issues.
	 */
	supportsIssueStates?: boolean;
	/**
	 * What the provider's FILTERED issue search (`searchIssuesPage`, and the `countIssues` probe over the same
	 * criteria) can express server-side. A third, wider surface than either filter set above: it is not bound to
	 * the user at all, so it takes relationships those reads have no way to name (`any-assignee`, `unassigned`),
	 * plus free text and issue attributes.
	 *
	 * Absent means the provider has NO filtered issue search and the read is refused. Present, it is a promise:
	 * every field declared here reaches the provider query, so a consumer that intersects against it never has a
	 * read refused, and a criterion is never silently ignored.
	 */
	supportedIssueSearch?: IssueSearchCapabilities;
	/**
	 * The maximum number of results the provider's filtered issue search will serve for ONE query, however it is
	 * paged. Matches past it are UNREACHABLE, not merely unfetched, which is why a read that hits this reports an
	 * omission with `recovery: 'none'` and the total match count rather than offering a "load more".
	 *
	 * Absent means the provider declares no ceiling, in which case a truncated read falls back to generic wording
	 * instead of quoting a limit that was never published.
	 */
	issueSearchResultLimit?: number;
	/**
	 * Whether the filtered searches reach the provider with scope names verbatim — as encoded URL segments, or
	 * matched against the names discovery reported — rather than inside a query string the provider sanitizes.
	 *
	 * Relaxes the scope-name rule (`isUsableSearchScopeName`) for that provider to refuse only blank names and
	 * control characters: a space or a quote can't split or alter a scope that is never parsed as a query, and
	 * refusing them would refuse real names. Absent for a query-string search (GitHub's), where both do.
	 */
	exactSearchScopeNames?: boolean;
}

export type ProvidersMetadata = { [Id in IntegrationIds]: ProviderMetadata & { id: Id } };

/**
 * GitHub and GitHub Enterprise express every criterion as a search qualifier on the same GraphQL `search` field,
 * so the two share one declaration — a GHE instance running the same search syntax has the same capability, and
 * two copies of this table would be free to drift.
 *
 * Every entry is a claim the implementation must keep: `searchIssuesPage` emits a qualifier for each of these,
 * and a test asserts that (see the `issueSearch` capability tests) so the table can't quietly outrun the code.
 */
const githubIssueSearchCapabilities: IssueSearchCapabilities = {
	// `author:@me` / `assignee:@me` / `mentions:@me` / `assignee:*` / `no:assignee`, each its own aliased search.
	relationships: ['authored', 'assigned', 'mentioned', 'any-assignee', 'unassigned'],
	text: true,
	labels: true,
	milestone: true,
	updatedAfter: true,
	createdAfter: true,
	// `-linked:pr`.
	withoutLinkedPullRequest: true,
	// `is:open` / `is:closed`, or neither for all states.
	states: true,
	// `sort:created-desc`, `sort:updated`, `sort:comments-asc`, … — see `githubIssueSorts`.
	sorts: githubIssueSorts,
};

/**
 * The ordering vocabulary of GitHub's filtered PR search: `created` and `updated`, both directions.
 *
 * Hand-declared rather than derived from `@gitkraken/provider-apis` (which has no PR-sort surface), and narrower
 * than the issue set on purpose: the merged relationship × state facets can only be re-ordered by a field a
 * `PullRequestShape` carries (see `getPullRequestComparator`), and GitHub PRs have no priority and no relevance
 * that orders stably under the result ceiling. A parity test pins this to `gitHubPullRequestSortQualifiers`' keys
 * so the capability can't outrun the emitter.
 */
const githubPullRequestSorts: PullRequestSorting[] = ['updated:desc', 'updated:asc', 'created:desc', 'created:asc'];

/** GitHub and GHE use the same filtered pull-request search syntax and result ceiling. */
const githubPullRequestSearchCapabilities: PullRequestSearchCapabilities = {
	relationships: [
		PullRequestFilter.Author,
		PullRequestFilter.Assignee,
		PullRequestFilter.ReviewRequested,
		PullRequestFilter.Reviewed,
		PullRequestFilter.Mention,
	],
	states: ['open', 'closed', 'merged', 'all'],
	text: true,
	updatedAfter: true,
	createdAfter: true,
	includeArchived: true,
	draft: true,
	repositoryScope: true,
	organizationScope: true,
	// `sort:updated`, `sort:updated-asc`, `sort:created-desc`, `sort:created-asc` — see `githubPullRequestSorts`.
	sorts: githubPullRequestSorts,
};

/**
 * Bitbucket Data Center's filtered pull-request search (`bitbucket-server/pullRequestSearch.ts`), declared from what
 * its REST API can express rather than from what a PR shape carries:
 * - relationships: `role=AUTHOR`, and a reviewer's `UNAPPROVED` status for a pending review versus `APPROVED` or
 *   `NEEDS_WORK` for one already given. A Bitbucket pull request has no assignee, and nothing filters by mention.
 * - text is `filterText` (title or description), draft is `draft`, and archived repositories are excluded unless
 *   asked for — all re-checked on each row, since the dashboard read has neither filter.
 * - no date filters and no `created` ordering: `order` is only `NEWEST`/`OLDEST` by last update, and filtering a
 *   date on the rows read would page through everything before it.
 * - no organization scope: there is no project-wide pull-request list, only per repository and the dashboard.
 */
const bitbucketServerPullRequestSearchCapabilities: PullRequestSearchCapabilities = {
	relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested, PullRequestFilter.Reviewed],
	states: ['open', 'closed', 'merged', 'all'],
	text: true,
	updatedAfter: false,
	createdAfter: false,
	includeArchived: true,
	draft: true,
	repositoryScope: true,
	organizationScope: false,
	sorts: ['updated:desc', 'updated:asc'],
};

/**
 * Azure DevOps Server's filtered pull-request search. Azure's pull request query narrows only by creator, reviewer,
 * status and repository, so the provider drains each facet and applies text, draft and dates to the complete facet
 * before merging — so a criterion never narrows a page after its count, and the only sort keys are the two a merged
 * page can be re-ordered by. What text and `updatedAfter` match is bounded by the list endpoint: see
 * `toAzurePullRequestSearchFilter`.
 *
 * `Assignee` and `ReviewRequested` both read by reviewer: Azure has no assignee distinct from its reviewers.
 * `Reviewed` and `Mention` are absent because the pull request query has no axis for either, and `includeArchived`
 * because Azure has no archived repositories to exclude.
 */
const azureServerPullRequestSearchCapabilities: PullRequestSearchCapabilities = {
	relationships: [PullRequestFilter.Author, PullRequestFilter.Assignee, PullRequestFilter.ReviewRequested],
	states: ['open', 'closed', 'merged', 'all'],
	text: true,
	updatedAfter: true,
	createdAfter: true,
	includeArchived: false,
	draft: true,
	repositoryScope: true,
	organizationScope: true,
	sorts: azurePullRequestSearchSorts,
};

/**
 * Azure DevOps Server's filtered work-item search: one WIQL query per collection, every criterion a clause of it.
 * `mentioned` is absent because `@RecentMentions` only reaches back 30 days; `milestone` and
 * `withoutLinkedPullRequest` because WIQL has no flat-query clause for either. See `azure/search.ts`.
 */
const azureServerIssueSearchCapabilities: IssueSearchCapabilities = {
	relationships: azureWorkItemSearchRelationships,
	text: true,
	labels: true,
	milestone: false,
	updatedAfter: true,
	createdAfter: true,
	withoutLinkedPullRequest: false,
	states: true,
	sorts: azureWorkItemSearchSorts,
};

export const providersMetadata: ProvidersMetadata = {
	[GitCloudHostIntegrationId.GitHub]: {
		domain: 'github.com',
		id: GitCloudHostIntegrationId.GitHub,
		name: 'GitHub',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.GitHub,
		issuesPagingMode: PagingMode.Repos,
		pullRequestsPagingMode: PagingMode.Repos,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Mention,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Reviewed,
			PullRequestFilter.Mention,
		],
		supportedPullRequestSearch: githubPullRequestSearchCapabilities,
		pullRequestSearchResultLimit: githubSearchResultLimit,
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// The account-wide read is three independent searches (`author:@me`, `assignee:@me`, `mentions:@me`) behind
		// one composite cursor, so any subset of them is expressible.
		supportedAccountWideIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// One `search` field serves all three issue reads (repo-scoped, account-wide, filtered search), so the same
		// qualifiers are expressible on each — the account-wide one narrowed to what its three-alias merge can order.
		supportedIssueSorts: githubIssueSorts,
		supportedAccountWideIssueSorts: githubAccountWideIssueSorts,
		supportedIssueSearch: githubIssueSearchCapabilities,
		issueSearchResultLimit: githubSearchResultLimit,
		scopes: ['repo', 'read:user', 'user:email'],
	},
	[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
		name: 'GitHub Enterprise',
		type: 'git',
		iconKey: 'github-enterprise',
		issuesPagingMode: PagingMode.Repos,
		pullRequestsPagingMode: PagingMode.Repos,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Mention,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
			PullRequestFilter.Reviewed,
			PullRequestFilter.Mention,
		],
		supportedPullRequestSearch: githubPullRequestSearchCapabilities,
		pullRequestSearchResultLimit: githubSearchResultLimit,
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// The account-wide read is three independent searches (`author:@me`, `assignee:@me`, `mentions:@me`) behind
		// one composite cursor, so any subset of them is expressible.
		supportedAccountWideIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// One `search` field serves all three issue reads (repo-scoped, account-wide, filtered search), so the same
		// qualifiers are expressible on each — the account-wide one narrowed to what its three-alias merge can order.
		supportedIssueSorts: githubIssueSorts,
		supportedAccountWideIssueSorts: githubAccountWideIssueSorts,
		supportedIssueSearch: githubIssueSearchCapabilities,
		issueSearchResultLimit: githubSearchResultLimit,
		scopes: ['repo', 'read:user', 'user:email'],
	},
	[GitCloudHostIntegrationId.GitLab]: {
		domain: 'gitlab.com',
		id: GitCloudHostIntegrationId.GitLab,
		name: 'GitLab',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.GitLab,
		issuesPagingMode: PagingMode.Repo,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		// The account-wide read drains one `scope=assigned_to_me` pass and one `scope=all` + `authorUsername` pass,
		// unioned, so either axis is expressible on its own. Mention is absent because GitLab's REST issue read has
		// no first-class mention filter to narrow with.
		supportedAccountWideIssueFilters: [IssueFilter.Assignee, IssueFilter.Author],
		// Two different surfaces, not one narrowed twice: the repository-scoped read is GraphQL and the
		// account-wide one is REST, and REST has neither `title` nor `closed_at`.
		supportedIssueSorts: gitlabIssueSorts,
		supportedAccountWideIssueSorts: gitlabAccountWideIssueSorts,
		scopes: ['api', 'read_user', 'read_repository'],
	},
	[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		name: 'GitLab Self-Hosted',
		type: 'git',
		iconKey: 'gitlab-self-hosted',
		issuesPagingMode: PagingMode.Repo,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'username' property on account for PR filters
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'username' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		// The account-wide read drains one `scope=assigned_to_me` pass and one `scope=all` + `authorUsername` pass,
		// unioned, so either axis is expressible on its own. Mention is absent because GitLab's REST issue read has
		// no first-class mention filter to narrow with.
		supportedAccountWideIssueFilters: [IssueFilter.Assignee, IssueFilter.Author],
		// Two different surfaces, not one narrowed twice: the repository-scoped read is GraphQL and the
		// account-wide one is REST, and REST has neither `title` nor `closed_at`.
		supportedIssueSorts: gitlabIssueSorts,
		supportedAccountWideIssueSorts: gitlabAccountWideIssueSorts,
		scopes: ['api', 'read_user', 'read_repository'],
	},
	[GitCloudHostIntegrationId.Bitbucket]: {
		domain: 'bitbucket.org',
		id: GitCloudHostIntegrationId.Bitbucket,
		name: 'Bitbucket',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.Bitbucket,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		supportedAccountWidePullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		scopes: ['account:read', 'repository:read', 'pullrequest:read', 'issue:read'],
	},
	[GitSelfManagedHostIntegrationId.BitbucketServer]: {
		domain: '',
		id: GitSelfManagedHostIntegrationId.BitbucketServer,
		name: 'Bitbucket Data Center',
		type: 'git',
		iconKey: GitSelfManagedHostIntegrationId.BitbucketServer,
		pullRequestsPagingMode: PagingMode.Repo,
		supportedPullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		supportedAccountWidePullRequestFilters: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
		supportedPullRequestSearch: bitbucketServerPullRequestSearchCapabilities,
		// No `pullRequestSearchResultLimit`: nothing caps how far a search pages.
		scopes: ['Project (Read)', 'Repository (Write)'],
	},
	[GitCloudHostIntegrationId.AzureDevOps]: {
		supportsIssueStates: true,
		domain: 'dev.azure.com',
		id: GitCloudHostIntegrationId.AzureDevOps,
		name: 'Azure DevOps',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.AzureDevOps,
		issuesPagingMode: PagingMode.Project,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'name' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// The account-wide read drains one (project × assignee) and one (project × author) query per project, so
		// either axis is expressible on its own. There is no mention query to narrow to.
		supportedAccountWideIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		// Both reads emit the same WIQL, but the account-wide one drains every (project x relationship) query and
		// merges the results, so it can only honor keys a normalized issue carries — `resolved` and `priority` are
		// dropped from that surface for the same reason they are dropped from GitLab's.
		supportedIssueSorts: azureIssueSorts,
		supportedAccountWideIssueSorts: azureAccountWideIssueSorts,
		scopes: ['vso.code', 'vso.identity', 'vso.project', 'vso.profile', 'vso.work'],
	},
	[GitSelfManagedHostIntegrationId.AzureDevOpsServer]: {
		supportsIssueStates: true,
		domain: '',
		id: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
		name: 'Azure DevOps Server',
		type: 'git',
		iconKey: GitCloudHostIntegrationId.AzureDevOps,
		issuesPagingMode: PagingMode.Project,
		pullRequestsPagingMode: PagingMode.Repo,
		// Use 'id' property on account for PR filters (reviewer filter keyed by account id / reviewerId)
		supportedPullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		supportedAccountWidePullRequestFilters: [
			PullRequestFilter.Author,
			PullRequestFilter.Assignee,
			PullRequestFilter.ReviewRequested,
		],
		// Use 'name' property on account for issue filters
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// The account-wide read drains one (project × assignee) and one (project × author) query per project, so
		// either axis is expressible on its own. There is no mention query to narrow to.
		supportedAccountWideIssueFilters: [IssueFilter.Author, IssueFilter.Assignee],
		// Both reads emit the same WIQL, but the account-wide one drains every (project x relationship) query and
		// merges the results, so it can only honor keys a normalized issue carries — `resolved` and `priority` are
		// dropped from that surface for the same reason they are dropped from GitLab's.
		supportedIssueSorts: azureIssueSorts,
		supportedAccountWideIssueSorts: azureAccountWideIssueSorts,
		supportedPullRequestSearch: azureServerPullRequestSearchCapabilities,
		supportedIssueSearch: azureServerIssueSearchCapabilities,
		issueSearchResultLimit: azureWorkItemSearchResultLimit,
		exactSearchScopeNames: true,
		scopes: ['vso.code', 'vso.identity', 'vso.project', 'vso.profile', 'vso.work'],
	},
	[IssuesCloudHostIntegrationId.Jira]: {
		domain: 'atlassian.net',
		id: IssuesCloudHostIntegrationId.Jira,
		name: 'Jira',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Jira,
		scopes: [
			'read:status:jira',
			'read:application-role:jira',
			'read:attachment:jira',
			'write:attachment:jira',
			'read:comment:jira',
			'read:project-category:jira',
			'read:project:jira',
			'read:issue.vote:jira',
			'read:field-configuration:jira',
			'write:issue:jira',
			'read:issue-security-level:jira',
			'write:issue.property:jira',
			'read:issue.changelog:jira',
			'read:avatar:jira',
			'read:issue-meta:jira',
			'read:permission:jira',
			'offline_access',
			'read:issue:jira',
			'read:me',
			'read:audit-log:jira',
			'read:project.component:jira',
			'read:group:jira',
			'read:project-role:jira',
			'write:comment:jira',
			'read:label:jira',
			'write:comment.property:jira',
			'read:issue-details:jira',
			'read:issue-type-hierarchy:jira',
			'read:issue.transition:jira',
			'read:user:jira',
			'read:field:jira',
			'read:issue-type:jira',
			'read:project.property:jira',
			'read:comment.property:jira',
			'read:project-version:jira',
		],
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// A tracker's issues live under resource -> project, so it has no account-wide surface to declare: its
		// capability is reported under `issues`, which is what `listIssueTrackerIssuesPage` validates against.
		supportedIssueSorts: jiraIssueSorts,
		// `statusCategory` clauses in the same JQL, shared with Server through `jiraHelpers`.
		supportsIssueStates: true,
	},
	[IssuesSelfManagedHostIntegrationId.JiraServer]: {
		// Self-hosted: there is no canonical domain, so every read is addressed by the connection's own host
		// (see `JiraServerIntegration.apiBaseUrl`), exactly as the self-managed git hosts do.
		domain: '',
		id: IssuesSelfManagedHostIntegrationId.JiraServer,
		name: 'Jira Data Center',
		type: 'issues',
		// Reuses Jira's glicon: it is the same product, and the id only selects an icon.
		iconKey: IssuesCloudHostIntegrationId.Jira,
		// Jira Cloud's entries are Atlassian OAuth scope strings, which a self-hosted instance doesn't issue:
		// its token is a PAT the backend stores as-is, so there is no scope set to request.
		scopes: [],
		// The same JQL clauses Cloud narrows with — `jiraHelpers` builds one query for both.
		supportedIssueFilters: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		// One JQL `ORDER BY` builder serves Cloud and Server, so they share a surface (see `issueSorts.ts`).
		supportedIssueSorts: jiraIssueSorts,
		supportsIssueStates: true,
	},
	[IssuesCloudHostIntegrationId.Linear]: {
		domain: 'linear.app',
		id: IssuesCloudHostIntegrationId.Linear,
		name: 'Linear',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Linear,
		scopes: [],
		// The user-scoped tracker read scopes Linear's "my issues" by the viewer's id: assigned issues, plus the
		// GitHub-synced issues the viewer created unless `Assignee` is asked for by name. Author/mention aren't supported.
		supportedIssueFilters: [IssueFilter.Assignee],
		// Both directions, and one table for both reads: they are the same root `issues` query taking the same
		// `sort` argument, so there is no account-wide narrowing to declare.
		supportedIssueSorts: linearIssueSorts,
		// A workflow-state type clause on both reads (`completed`/`canceled`/`duplicate` are closed), the same types
		// the SDK normalizes to a terminal category (`DONE`, or `CANCELED` for the last two).
		supportsIssueStates: true,
	},
	[IssuesCloudHostIntegrationId.Trello]: {
		domain: 'trello.com',
		id: IssuesCloudHostIntegrationId.Trello,
		name: 'Trello',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Trello,
		scopes: [],
		// Trello cards are filtered by the assignee (member) only; author/mention have no Trello equivalent.
		supportedIssueFilters: [IssueFilter.Assignee],
		// `sort:edited` / `sort:-edited`. Trello's other search sorts (`created`, `due`) have no card-order effect.
		supportedIssueSorts: trelloIssueSorts,
		// No `supportsIssueStates`: a card has no state beyond being archived, and the board read always sends
		// `-is:archived`, so `'closed'`/`'all'` are refused rather than answered with the open cards.
	},
	[IssuesCloudHostIntegrationId.Asana]: {
		domain: 'app.asana.com',
		id: IssuesCloudHostIntegrationId.Asana,
		name: 'Asana',
		type: 'issues',
		iconKey: IssuesCloudHostIntegrationId.Asana,
		scopes: [],
		// A task has a single assignee and no author/mention query; the project read is narrowed to the viewer by
		// assignee id after the drain, since Asana's task list can't scope a project to an assignee.
		supportedIssueFilters: [IssueFilter.Assignee],
		// Empty: Asana's task list has no ordering parameter, so a read carrying `sort` is refused rather than served in
		// whatever order Asana returns.
		supportedIssueSorts: asanaIssueSorts,
		// Completion is the only state Asana has: open reads incomplete tasks, closed the completed ones.
		supportsIssueStates: true,
	},
};

export function isGitHubDotCom(domain: string | null | undefined): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export function isGitLabDotCom(domain: string | null | undefined): boolean {
	return equalsIgnoreCase(domain, 'gitlab.com');
}

// Anchor the `visualstudio.com` alternative on a label boundary (`^` or `.`) rather than `\b`: `\b` treats a
// hyphen as a word boundary, so `\bvisualstudio\.com$` matched attacker-controlled hosts like
// `evil-visualstudio.com` and classified them as Azure cloud, changing their auth/URL handling.
const azureCloudDomainRegex = /^dev\.azure\.com$|(?:^|\.)visualstudio\.com$/i;
export function isAzureCloudDomain(domain: string | undefined): boolean {
	return domain != null && azureCloudDomainRegex.test(domain);
}

const bitbucketCloudDomainRegex = /^bitbucket\.org$/i;
export function isBitbucketCloudDomain(domain: string | undefined): boolean {
	return domain != null && bitbucketCloudDomainRegex.test(domain);
}

export function supportsCodeSuggest(provider: ProviderReference): boolean {
	return isGitHubDotCom(provider.domain);
}
