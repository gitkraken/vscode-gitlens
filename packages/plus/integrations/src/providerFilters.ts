import type { IssueStateFilter } from '@gitlens/git/models/issue.js';

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
 * One relationship a filtered issue search can constrain on. A superset of {@link IssueFilter}, which describes
 * only the user-relative relationships the "my issues" reads narrow to.
 *
 * The last two are USER-INDEPENDENT — they say something about the issue, not about the caller — which is why
 * they can't be `IssueFilter` members and why they are not a scope: `unassigned` alone matches every unassigned
 * issue on the host. A search using either still needs a `repos`/`org` scope.
 */
export type IssueSearchRelationship =
	/** `author:@me` */
	| 'authored'
	/** `assignee:@me` */
	| 'assigned'
	/** `mentions:@me` */
	| 'mentioned'
	/** `assignee:*` — assigned to ANYONE. Excludes unassigned issues; see {@link IssueSearchCriteria.relationships}. */
	| 'any-assignee'
	/** `no:assignee` — assigned to nobody. The complement of `any-assignee`, not a broadening of it. */
	| 'unassigned';

/**
 * What a filtered issue search (`IntegrationManager.searchIssuesPage`) narrows on, and what
 * `IntegrationManager.countIssues` counts.
 *
 * Structured rather than a provider query string so a consumer can render filter chips and hide the ones a
 * provider can't express (`getSupportedFilters().issueSearch`) instead of having a read refused, and so the same
 * criteria mean the same thing on a provider whose query language is nothing like GitHub's search syntax.
 *
 * Every field is validated against the provider's declared capability BEFORE the read runs, all-or-nothing: a
 * criterion the provider can't express server-side refuses the whole read rather than serving a list that was
 * never narrowed. Client-side narrowing is not an option — the dropped items still counted toward the page and
 * cursor the provider produced, so a post-filter leaves `items` describing a different result set than `hasMore`.
 */
export interface IssueSearchCriteria {
	/**
	 * Relationships to constrain on, OR-ed together (each becomes its own provider query, unioned and deduped).
	 * Omitted means NO relationship constraint at all — every issue in scope, assigned or not — which requires a
	 * `repos`/`org` scope.
	 *
	 * `any-assignee` and `unassigned` partition the scope between them and are mutually exclusive; passing both is
	 * refused rather than silently dropping one. Note that "all visible issues" is the OMITTED case, NOT
	 * `any-assignee`: `assignee:*` excludes unassigned issues.
	 */
	relationships?: IssueSearchRelationship[];
	/**
	 * Free text, matched by the provider's own relevance rules — NOT a substring match, and not a way to smuggle
	 * qualifiers: tokens that would read as one (anything containing `:`) are dropped, as are quotes and control
	 * characters, so text can never re-scope the search. Structured criteria are the qualifier channel.
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
}

/**
 * Which {@link IssueSearchCriteria} fields a provider's filtered issue search can express server-side, as
 * `IntegrationManager.getSupportedFilters().issueSearch` reports them.
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
}
