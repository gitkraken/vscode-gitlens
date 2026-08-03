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
