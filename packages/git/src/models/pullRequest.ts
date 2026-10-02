import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { RequireSome, RequireSomeWithProps } from '@gitlens/utils/types.js';
import type { IssueProject, IssueRepository } from './issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestState as PullRequestState } from './issueOrPullRequest.js';
import type { ProviderReference } from './remoteProvider.js';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities.js';

export type { PullRequestState };

/**
 * The read that produced a pull request row, as a key for `getPullRequestFieldPresence` (`@gitlens/integrations`). It
 * names a READ, not a field set: the same tag can carry different fields on different providers.
 */
export type PullRequestProjection =
	/** A single-item read: by number, for a branch, or for a commit. */
	| 'point'
	/** The filtered search with the full projection, and the host's "my pull requests" search. */
	| 'search'
	/** The filtered search with `summary`. */
	| 'search-summary'
	/** The free-text search (`searchPullRequests`). */
	| 'text-search'
	/** An account-wide sweep with the full projection (`includeReviews`). */
	| 'account'
	/** An account-wide list or sweep with the lightweight projection. */
	| 'account-summary'
	/** A repository-scoped list or sweep. */
	| 'repos'
	/** A repository-scoped list with `summary`. */
	| 'repos-summary'
	/** The coordinate and branch batch reads. */
	| 'batch';

export interface PullRequestShape extends IssueOrPullRequest {
	readonly author: PullRequestMember;
	/**
	 * Canonical base-repository identity returned by the provider. Some providers
	 * scope pull-request ids to a repository, so consumers must not have to infer
	 * identity from optional refs or URLs.
	 */
	readonly repository?: IssueRepository;
	readonly mergedDate?: Date;
	readonly refs?: PullRequestRefs;
	readonly isDraft?: boolean;
	readonly additions?: number;
	readonly deletions?: number;
	readonly filesChanged?: number;
	readonly body?: string;
	readonly mergeableState?: PullRequestMergeableState;
	readonly reviewDecision?: PullRequestReviewDecision;
	readonly reviewRequests?: PullRequestReviewer[];
	/**
	 * Reviews already submitted, as opposed to the still-pending {@link reviewRequests}. Absent means the read
	 * didn't fetch reviews; empty means nobody has reviewed — but only where the read actually fetched them, which
	 * is provider- and read-dependent: ask `getPullRequestFieldPresence` (`@gitlens/integrations`) for the row's
	 * `reviews` group rather than trusting an empty array.
	 * {@link PullRequestReviewer.commitOid} is the narrower promise: only the full GitHub/GHE projection has it.
	 */
	readonly latestReviews?: PullRequestReviewer[];
	readonly assignees?: PullRequestMember[];
	readonly project?: IssueProject;
	readonly stack?: PullRequestStackInfo;
	readonly number?: number;
	readonly authoredByMe?: boolean;
	/**
	 * The current account as this pull request's members identify it: the identity {@link authoredByMe} was matched
	 * against, present exactly when that was. A consumer matching {@link reviewRequests} or {@link latestReviews}
	 * entries to the current user compares against this, not the account `getCurrentAccount` returns: Azure DevOps
	 * Server gives one person a different id in each collection than at the server level, and the members carry the
	 * collection's. Core matches `username` too only on GitHub and GitHub Enterprise, whose rows key people by login.
	 */
	readonly viewer?: { readonly id: string; readonly username?: string };
	/** The read that produced this row. Absent means unknown: a legacy row, or a provider or read not yet tagged. */
	readonly projection?: PullRequestProjection;
}

@loggable(i => i.id)
@serializable
export class PullRequest implements PullRequestShape {
	readonly type = 'pullrequest';

	constructor(
		public readonly provider: ProviderReference,
		public readonly author: PullRequestMember,
		public readonly id: string,
		public readonly nodeId: string | undefined,
		public readonly title: string,
		public readonly url: string,
		public readonly repository: IssueRepository,
		public readonly state: PullRequestState,
		public readonly createdDate: Date,
		public readonly updatedDate: Date,
		public readonly closedDate?: Date,
		public readonly mergedDate?: Date,
		public readonly mergeableState?: PullRequestMergeableState,
		public readonly viewerCanUpdate?: boolean,
		public readonly refs?: PullRequestRefs,
		public readonly isDraft?: boolean,
		public readonly additions?: number,
		public readonly deletions?: number,
		public readonly commentsCount?: number,
		public readonly thumbsUpCount?: number,
		public readonly reviewDecision?: PullRequestReviewDecision,
		public readonly reviewRequests?: PullRequestReviewer[],
		public readonly latestReviews?: PullRequestReviewer[],
		public readonly assignees?: PullRequestMember[],
		public readonly statusCheckRollupState?: PullRequestStatusCheckRollupState,
		public readonly project?: IssueProject,
		public readonly version?: number,
		/** Commits on the head that aren't on the base. Appended rather than slotted with the other counts:
		 *  this constructor is positional and every mapper passes through it. */
		public readonly commitCount?: number,
		public readonly stack?: PullRequestStackInfo,
		public readonly filesChanged?: number,
		/** The pull request's description, as markdown. */
		public readonly body?: string,
		public readonly number?: number,
		public readonly authoredByMe?: boolean,
		public readonly projection?: PullRequestProjection,
		public readonly viewer?: { readonly id: string; readonly username?: string },
	) {}

	get closed(): boolean {
		return this.state === 'closed';
	}

	static is(pr: unknown): pr is PullRequest {
		return pr instanceof PullRequest;
	}

	static formatDate(pr: PullRequestShape, format?: string | null): string {
		return formatDate(pr.mergedDate ?? pr.closedDate ?? pr.updatedDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	static formatDateFromNow(pr: PullRequestShape): string {
		return fromNow(pr.mergedDate ?? pr.closedDate ?? pr.updatedDate);
	}

	static formatDateWithStyle(
		pr: PullRequestShape,
		formatting: { dateStyle: string; dateFormat: string | null },
	): string {
		return formatting.dateStyle === 'absolute'
			? PullRequest.formatDate(pr, formatting.dateFormat)
			: PullRequest.formatDateFromNow(pr);
	}
}

export const enum PullRequestReviewDecision {
	Approved = 'Approved',
	ChangesRequested = 'ChangesRequested',
	ReviewRequired = 'ReviewRequired',
}

export const enum PullRequestMergeableState {
	Unknown = 'Unknown',
	Mergeable = 'Mergeable',
	Conflicting = 'Conflicting',
	FailingChecks = 'FailingChecks',
	BlockedByPolicy = 'BlockedByPolicy',
}

export const enum PullRequestStatusCheckRollupState {
	Success = 'success',
	Pending = 'pending',
	Failed = 'failed',
}

export const enum PullRequestMergeMethod {
	Merge = 'merge',
	Squash = 'squash',
	Rebase = 'rebase',
}

export const enum PullRequestReviewState {
	Approved = 'APPROVED',
	ChangesRequested = 'CHANGES_REQUESTED',
	Commented = 'COMMENTED',
	Dismissed = 'DISMISSED',
	Pending = 'PENDING',
	ReviewRequested = 'REVIEW_REQUESTED',
}

export interface PullRequestComparisonRefs {
	repoPath: string;
	base: { ref: string; label: string };
	head: { ref: string; label: string };
}

export interface PullRequestMember {
	id: string;
	/**
	 * Absent when the provider exposes no display name for the member — same contract as `IssueMember.name`: a
	 * fallback invented here can't be told apart from a real name downstream, so each consumer picks its own
	 * presentation.
	 */
	name?: string;
	/** The provider's handle for this person, when it has one — GitHub's login, Azure's `uniqueName` (a UPN,
	 *  so an email), Bitbucket's mutable `nickname`. Display/labelling only: it is neither guaranteed present
	 *  (GitLab's native mapper has none) nor a stable identity, so never key a match off it. */
	username?: string;
	avatarUrl?: string;
	url?: string;
}

/** Provider-neutral relationship facets shared by PR listings and filtered PR search. */
export enum PullRequestFilter {
	Author = 'author',
	Assignee = 'assignee',
	ReviewRequested = 'review-requested',
	/**
	 * PRs the user has already reviewed (GitHub `reviewed-by:@me`), as opposed to `ReviewRequested` (a
	 * still-pending request). Distinguishes "waiting on the author after my review" from "waiting for my
	 * review". Not expressible on the repo-scoped listing — no provider SDK exposes a reviewed-by axis there —
	 * so it is advertised for the account-wide read and for the filtered search (which can still bound itself
	 * to repositories or an org), never under `supportedPullRequestFilters`.
	 */
	Reviewed = 'reviewed-by',
	Mention = 'mention',
}

/** Selects which pull request states a read should include. `all` covers open + closed + merged. */
export type PullRequestStateFilter = 'open' | 'closed' | 'merged' | 'all';

/**
 * A field a pull-request read can be ordered by, provider-neutral.
 *
 * Only two, and deliberately so — unlike {@link IssueSortField} this is the INTERSECTION of what GitHub's PR
 * search can order by server-side and what a {@link PullRequestShape} carries, because the filtered PR search
 * always merges its relationship × state facets in the facade and so must re-order the union itself (see
 * `getPullRequestComparator`). `created` and `updated` are both. A field GitHub cannot order PRs by, or one a
 * merged page can't reproduce, is left out rather than advertised and then approximated: relevance is unstable
 * and has no comparable value on a merge, and priority is not a pull-request concept on any provider that has PRs.
 */
export type PullRequestSortField =
	/** Creation date. */
	| 'created'
	/** Last activity. */
	| 'updated';

/**
 * How a pull-request read is ordered, as `field:direction` — the same serializable shape {@link IssueSorting}
 * and `BranchSorting` use, so a consumer can persist it, compare it, or bind it straight to a setting or dropdown.
 */
export type PullRequestSorting = `${PullRequestSortField}:asc` | `${PullRequestSortField}:desc`;

/**
 * The order the filtered pull-request search applies when the caller asks for none: most recently updated first,
 * which is what it served before ordering was an option. Named once rather than per layer — the criteria model
 * documents it, the GitHub query emits it, and the result-ceiling warning quotes it — so the three cannot
 * disagree about what "the default" is.
 */
export const defaultPullRequestSort: PullRequestSorting = 'updated:desc';

/**
 * What the filtered pull-request search narrows on.
 *
 * Structured rather than a provider query string so callers can send free text without giving it a qualifier
 * channel, and can check {@link PullRequestSearchCapabilities} before issuing a read. Every requested criterion
 * is validated all-or-nothing before the provider runs; unsupported criteria never fall through to a wider
 * result set whose paging would no longer describe the returned items.
 *
 * Relationships are OR-ed, as are states. Omitting `relationships` removes the current-user constraint, which is
 * only safe when the manager call supplies a repository or organization scope. Omitting `states` reads open PRs.
 */
export interface PullRequestSearchCriteria {
	/**
	 * Free text matched by the provider's own relevance rules. Tokens that look like provider qualifiers are
	 * removed before the query is built, so text cannot change the search's scope or state.
	 */
	text?: string;
	/** Current-user relationship facets to union. Empty/omitted means no relationship constraint. */
	relationships?: PullRequestFilter[];
	/** Pull request states to union. Empty/omitted reads open PRs; `all` subsumes every other member. */
	states?: PullRequestStateFilter[];
	/** ISO date (`YYYY-MM-DD`). The most effective narrowing criterion by far on a large scope. */
	updatedAfter?: string;
	/** ISO date (`YYYY-MM-DD`). */
	createdAfter?: string;
	/** Includes PRs from archived repositories. They are excluded by default. */
	includeArchived?: boolean;
	/**
	 * Narrows on draft state: `true` returns only drafts, `false` only ready-for-review PRs. Omitted places no
	 * constraint. A boolean rather than a truthy flag because `false` is a distinct request, not the absence of one.
	 */
	draft?: boolean;
	/**
	 * How to order the results. Omitted means `updated:desc`, which is what this search has always served.
	 *
	 * Validated all-or-nothing against {@link PullRequestSearchCapabilities.sorts} like every other criterion: a
	 * key the provider can't express server-side refuses the WHOLE read rather than falling back to the default,
	 * because combined with the provider's result ceiling another order returns a different subset than was asked
	 * for and the paging that comes with it describes that other subset. Do not change it mid-pagination — a
	 * cursor carries the sort it was produced under; drop the cursor instead of threading it under a new key.
	 */
	sort?: PullRequestSorting;
}

/**
 * Which {@link PullRequestSearchCriteria} fields and manager-level scopes a provider can express server-side.
 * An empty `relationships` means the provider has no filtered PR search at all.
 */
export interface PullRequestSearchCapabilities {
	/** Current-user relationship facets the provider can union. Empty means the search itself is unsupported. */
	relationships: PullRequestFilter[];
	/** Individual state values the provider can union in one logical search. */
	states: PullRequestStateFilter[];
	text: boolean;
	updatedAfter: boolean;
	createdAfter: boolean;
	includeArchived: boolean;
	/** Whether the provider can constrain the search by draft state server-side. */
	draft: boolean;
	/** Whether the manager's repository-descriptor scope is supported. */
	repositoryScope: boolean;
	/** Whether the manager's organization scope is supported. */
	organizationScope: boolean;
	/**
	 * Sort keys the search can express server-side. Always contains at least `updated:desc` — the historical
	 * default — when the search exists at all, so it is never empty for a usable surface; a provider without a
	 * filtered PR search reports an empty `relationships`, which is already the signal there is no surface to order.
	 */
	sorts: PullRequestSorting[];
}

export interface PullRequestRef {
	/**
	 * `undefined` when the ref's repository was deleted (a removed fork): GitHub's rows say so, with `exists` false.
	 * provider-apis' converters fill `''` instead, so test for a value rather than for `undefined`.
	 */
	owner: string | undefined;
	/** `undefined` (or `''`) when the ref's repository was deleted, as {@link owner}. */
	repo: string | undefined;
	branch: string;
	sha: string;
	exists: boolean;
	/**
	 * Web URL of the ref's repository. `undefined` when the provider cannot resolve it — Azure DevOps embeds an
	 * abbreviated repository reference in a pull request, so a fork's URL may need a lookup that can fail.
	 */
	url: string | undefined;
	/** HTTPS clone URL of the ref's repository, when the provider exposes it. */
	cloneHttps?: string;
	/** SSH clone URL of the ref's repository, when the provider exposes it. */
	cloneSsh?: string;
	/** Best-effort flag: whether the ref's repository is a fork. `undefined` when the provider can't tell. */
	isFork?: boolean;
}

export interface PullRequestRefs {
	base: PullRequestRef & { url: string };
	head: PullRequestRef;
	isCrossRepository: boolean;
}

/**
 * A pull request's membership in a stack — an ordered chain of dependent pull requests where each
 * targets the branch of the one below it.
 *
 * `baseRef` is the stack's ultimate target (its trunk) and is NOT the same as `refs.base`, which for
 * anything above the bottom layer names the layer below. Use `refs.base` to diff a single layer; use
 * `baseRef` to answer where the work ultimately lands.
 */
export interface PullRequestStackInfo {
	/**
	 * Opaque, and NOT comparable across read paths: GitHub's GraphQL selection returns a node id
	 * (`PRS_kwDO…`) while its REST stacks endpoint returns a numeric id (`1347135`) that we stringify —
	 * both verified against the same live stack. Use {@link number} to identify a stack; two views of one
	 * stack agree there and will not agree here.
	 */
	id: string;
	/** Identifies the stack within its repository. */
	number: number;
	/** Total pull requests in the stack. */
	size: number;
	/** This pull request's layer, 1-based, where 1 is closest to `baseRef`. */
	position: number;
	/** The branch the bottom of the stack targets. */
	baseRef: string;
}

/**
 * One layer of a stack — the pull request occupying it, and the head ref a rebase or push needs to act
 * on. Unlike {@link PullRequestStackInfo}, which locates a single pull request within a stack, this is
 * the per-layer detail a caller walking the whole stack needs, e.g. to cascade a rebase bottom to top.
 */
export interface PullRequestStackLayer {
	/** The pull request's number. */
	number: number;
	/** The pull request's head branch name, without a remote prefix. */
	headRef: string;
	/** The head branch's tip when the stack was read. */
	headSha: string;
	/** `true` once this layer has landed. */
	merged: boolean;
	/** `true` while this layer is still a draft. */
	draft: boolean;
}

/**
 * A stack's layers, ordered bottom to top. `baseRef` is the stack's ultimate target (its trunk), the
 * same distinction drawn on {@link PullRequestStackInfo} — it is NOT the base of any individual layer
 * above the bottom, which targets the layer below it instead.
 */
export interface PullRequestStackLayers {
	/** Opaque and not comparable across read paths — see {@link PullRequestStackInfo.id}. */
	id: string;
	number: number;
	/** The branch the bottom of the stack targets. */
	baseRef: string;
	/** The stack's layers, ordered bottom (closest to {@link baseRef}) to top. */
	layers: PullRequestStackLayer[];
}

export interface PullRequestReviewer {
	isCodeOwner?: boolean;
	reviewer: PullRequestMember;
	state: PullRequestReviewState;
	/**
	 * The head commit oid this review was submitted against (GitHub). Lets a consumer tell "the PR moved past
	 * my review" (oid !== the PR's current head) from a review still at the tip — without a per-review
	 * timestamp. Only populated where the full GitHub/GHE projection is selected: the filtered search read, and
	 * an account-wide sweep that opts in with `includeReviews`. Undefined elsewhere, including reviews the
	 * repo-scoped read carries natively.
	 */
	commitOid?: string;
	/**
	 * The reviewer is a group the current user is a member of (a team or another group, directly or through a group
	 * nested in it) rather than a person: a request to it is one the user can answer as a member, not one addressed to
	 * them by name. Only the Azure DevOps reads that resolve the user's groups set it; absent elsewhere, including for
	 * groups a read could not tell the user belongs to.
	 */
	isMyGroup?: boolean;
}

export type PullRequestRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;
