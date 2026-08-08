import { loggable } from '@gitlens/utils/decorators/log.js';
import type { RequireSome, RequireSomeWithProps } from '@gitlens/utils/types.js';
import type { IssueOrPullRequest, IssueOrPullRequestState } from './issueOrPullRequest.js';
import type { ProviderReference } from './remoteProvider.js';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities.js';

/** Selects which issue states a read should include. `all` covers open + closed. */
export type IssueStateFilter = 'open' | 'closed' | 'all';

/**
 * One relationship a filtered issue search can constrain on.
 *
 * The last two are USER-INDEPENDENT — they describe the issue, not the caller — and neither is a SCOPE: either
 * one alone matches every such issue on the host, so a search using one still needs a repository/org scope.
 */
export type IssueSearchRelationship =
	/** Authored by the current user. */
	| 'authored'
	/** Assigned to the current user. */
	| 'assigned'
	/** Mentions the current user. */
	| 'mentioned'
	/** Assigned to ANYONE. Excludes unassigned issues — see {@link IssueSearchCriteria.relationships}. */
	| 'any-assignee'
	/** Assigned to nobody. The complement of `any-assignee`, not a broadening of it. */
	| 'unassigned';

/**
 * A field an issue read can be ordered by, provider-neutral. No provider expresses all of them: each read
 * validates the requested key against the capability its provider declares and refuses one it can't express
 * server-side, rather than serving a differently-ordered list under the name of the one that was asked for.
 *
 * `closed` and `resolved` are deliberately SEPARATE, not two names for the same date. Azure DevOps tracks both
 * and they differ (an issue can be closed without being resolved and resolved without being closed), and Jira
 * has no close date at all — it models the equivalent as `resolutiondate`. Collapsing them would force one of
 * those two providers to lie about which date it ordered by.
 */
export type IssueSortField =
	/** Creation date. */
	| 'created'
	/** Last activity. */
	| 'updated'
	/** Close date. Only where the provider orders by it server-side — notably NOT GitHub. */
	| 'closed'
	/** Resolution date (Jira `resolutiondate`, Azure `ResolvedDate`). Distinct from `closed`. */
	| 'resolved'
	/** Number of comments. */
	| 'comments'
	/** Reactions/upvotes. */
	| 'reactions'
	/** The provider's own priority field. */
	| 'priority'
	/** Due date. */
	| 'dueDate'
	/** Alphabetical by title. */
	| 'title';

/**
 * How an issue read is ordered, as `field:direction` — the same shape `BranchSorting`/`TagSorting` already use,
 * so it is one serializable string a consumer can persist, compare, or bind straight to a setting or a dropdown.
 */
export type IssueSorting = `${IssueSortField}:asc` | `${IssueSortField}:desc`;

/**
 * The order every issue read that HAS a default applies when the caller asks for none: most recently updated
 * first, which is what those reads served before ordering was an option.
 *
 * One definition rather than one per layer, because it is a promise made in several places at once — the criteria
 * model documents it, the GitHub query emits it, and the result-ceiling warning quotes it — and three copies would
 * be free to disagree about what "the default" is.
 *
 * Note it is not a default every read has, and the two layers differ. The API client's account-wide "my issues"
 * search (`GitHubApi.searchMyIssues`) never requested an order, so a direct caller omitting `sort` still gets
 * GitHub's relevance order — the default is opt-in there, to keep that read's already-shipped results unchanged.
 * The FACADE does apply it: GitHub declares `updated:desc` among its account-wide keys, so
 * `readAccountWideIssuesPage` resolves the omission to this default and forwards it, and that read's emitted query
 * gained a `sort:updated` qualifier it did not have before. A read whose surface cannot express even this key is
 * the only one the facade leaves in the provider's own order.
 */
export const defaultIssueSort: IssueSorting = 'updated:desc';

/**
 * What a filtered issue search narrows on: a provider-neutral criteria set, translated to each provider's own
 * query language by its integration.
 *
 * Structured rather than a provider query string so a consumer can render filter chips and hide the ones a
 * provider can't express, and so the same criteria mean the same thing on a provider whose query language looks
 * nothing like GitHub's search syntax. Every field is validated against the provider's declared capability
 * BEFORE the read runs, all-or-nothing: a criterion the provider can't express server-side refuses the whole
 * read rather than serving a list that was never narrowed. Client-side narrowing is not an option — the dropped
 * items still counted toward the page and cursor the provider produced, so a post-filter would leave the items
 * describing a different result set than the paging that came with them.
 */
export interface IssueSearchCriteria {
	/**
	 * Relationships to constrain on, OR-ed together (each becomes its own provider query, unioned and deduped).
	 * Omitted means NO relationship constraint at all — every issue in scope, assigned or not — which requires a
	 * repository/org scope.
	 *
	 * `any-assignee` and `unassigned` partition the scope between them and are mutually exclusive; passing both is
	 * refused rather than silently dropping one. Note that "all visible issues" is the OMITTED case, NOT
	 * `any-assignee`, which excludes unassigned issues.
	 */
	relationships?: IssueSearchRelationship[];
	/**
	 * Free text, matched by the provider's own relevance rules — NOT a substring match, and not a way to smuggle
	 * qualifiers: a token that would read as one is dropped, as are quotes and control characters, so text can
	 * never re-scope the search. The structured criteria are the qualifier channel.
	 */
	text?: string;
	/** Issue states to include. Omitted reads open issues only. */
	state?: IssueStateFilter;
	/** Labels the issue must carry — AND-ed, matching GitHub's own `label:` semantics. */
	labels?: string[];
	milestone?: string;
	/** ISO date (`YYYY-MM-DD`). The most effective narrowing criterion by far on a large scope. */
	updatedAfter?: string;
	/** ISO date (`YYYY-MM-DD`). */
	createdAfter?: string;
	/** Issues with no linked pull request. */
	withoutLinkedPullRequest?: boolean;
	/** Includes issues in archived repositories, which are excluded by default. */
	includeArchived?: boolean;
	/**
	 * How to order the results. Omitted means `updated:desc`, which is what this search has always served.
	 *
	 * Validated like every other criterion — all-or-nothing against {@link IssueSearchCapabilities.sorts}: a key
	 * the provider can't express server-side refuses the WHOLE read rather than falling back to the default.
	 * Serving another order is not a smaller error than serving a wider result: combined with the provider's
	 * result ceiling it returns a different subset than was asked for, and the paging that comes with it describes
	 * that other subset.
	 *
	 * Do not change it mid-pagination. A cursor carries the sort it was produced under, and threading it under a
	 * different key is refused rather than serving a sequence with gaps and repeats: drop the cursor instead.
	 */
	sort?: IssueSorting;
}

/**
 * Which {@link IssueSearchCriteria} fields a provider's filtered issue search can express server-side.
 *
 * An empty `relationships` with every flag false means the provider has NO filtered issue search — the read is
 * refused outright, so a consumer should offer neither the surface nor its chips.
 */
export interface IssueSearchCapabilities {
	/** Relationships the search can constrain on. Empty means the search itself is unsupported. */
	relationships: IssueSearchRelationship[];
	text: boolean;
	labels: boolean;
	milestone: boolean;
	updatedAfter: boolean;
	createdAfter: boolean;
	withoutLinkedPullRequest: boolean;
	/** Whether {@link IssueSearchCriteria.state} can select anything other than the provider's default (open). */
	states: boolean;
	/**
	 * Sort keys the search can express IN SERVER. Always contains at least `updated:desc` — the historical default
	 * — when the search exists at all, so it is never empty for a usable surface; a provider without a filtered
	 * search reports an empty `relationships`, which is already the signal that there is no surface to order.
	 */
	sorts: IssueSorting[];
}

export interface IssueShape extends IssueOrPullRequest {
	/** `undefined` when the provider can't resolve the author, e.g. a deleted GitHub account */
	author: IssueMember | undefined;
	assignees: IssueMember[];
	repository?: IssueRepository;
	labels?: IssueLabel[];
	body?: string;
	project?: IssueProject;
	issueType?: string;
}

@loggable(i => i.id)
export class Issue implements IssueShape {
	readonly type = 'issue';

	constructor(
		public readonly provider: ProviderReference,
		public readonly id: string,
		public readonly nodeId: string | undefined,
		public readonly title: string,
		public readonly url: string,
		public readonly createdDate: Date,
		public readonly updatedDate: Date,
		public readonly closed: boolean,
		public readonly state: IssueOrPullRequestState,
		public readonly author: IssueMember | undefined,
		public readonly assignees: IssueMember[],
		public readonly repository?: IssueRepository,
		public readonly closedDate?: Date,
		public readonly labels?: IssueLabel[],
		public readonly commentsCount?: number,
		public readonly thumbsUpCount?: number,
		public readonly body?: string,
		public readonly project?: IssueProject,
		public readonly number?: string,
		public readonly issueType?: string,
	) {}

	static is(issue: unknown): issue is Issue {
		return issue instanceof Issue;
	}
}

export const enum RepositoryAccessLevel {
	Admin = 100,
	Maintain = 40,
	Write = 30,
	Triage = 20,
	Read = 10,
	None = 0,
}

export interface IssueLabel {
	color?: string;
	name: string;
}

export interface IssueMember {
	id: string;
	/**
	 * Absent when the provider exposes no display name for the member. Optional on purpose: a fallback string
	 * invented here (`'unknown'`, `''`) can't be told apart from a real name downstream, so it can't be undone by a
	 * consumer that needs to render something else — or nothing at all, as when the member feeds an AI prompt.
	 * Each consumer picks its own presentation.
	 */
	name?: string;
	/** The provider's handle for this person, when it has one — GitHub's login, Azure's `uniqueName` (a UPN,
	 *  so an email), Bitbucket's mutable `nickname`. Display/labelling only: it is neither guaranteed present
	 *  (GitLab's native mapper has none) nor a stable identity, so never key a match off it. */
	username?: string;
	avatarUrl?: string;
	url?: string;
}

export interface IssueProject {
	id: string;
	name: string;
	resourceId: string;
	resourceName: string;
}

export interface IssueRepository {
	owner: string;
	repo: string;
	accessLevel?: RepositoryAccessLevel;
	url?: string;
	id?: string;
}

export type IssueRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;
