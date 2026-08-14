import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { loggable } from '@gitlens/utils/decorators/log.js';
import { serializable } from '@gitlens/utils/decorators/serializable.js';
import type { RequireSome, RequireSomeWithProps } from '@gitlens/utils/types.js';
import type { IssueProject, IssueRepository } from './issue.js';
import type { IssueOrPullRequest, IssueOrPullRequestState as PullRequestState } from './issueOrPullRequest.js';
import type { ProviderReference } from './remoteProvider.js';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities.js';

export type { PullRequestState };

export interface PullRequestShape extends IssueOrPullRequest {
	readonly author: PullRequestMember;
	readonly body?: string;
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
	readonly mergeableState?: PullRequestMergeableState;
	readonly reviewDecision?: PullRequestReviewDecision;
	readonly reviewRequests?: PullRequestReviewer[];
	readonly assignees?: PullRequestMember[];
	readonly project?: IssueProject;
	readonly number?: number;
	readonly authoredByMe?: boolean;
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
		public readonly body?: string,
		public readonly number?: number,
		public readonly authoredByMe?: boolean,
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
	avatarUrl?: string;
	url?: string;
}

/** Provider-neutral relationship facets shared by PR listings and filtered PR search. */
export enum PullRequestFilter {
	Author = 'author',
	Assignee = 'assignee',
	ReviewRequested = 'review-requested',
	Mention = 'mention',
}

/** Selects which pull request states a read should include. `all` covers open + closed + merged. */
export type PullRequestStateFilter = 'open' | 'closed' | 'merged' | 'all';

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
	/** Includes PRs from archived repositories. They are excluded by default. */
	includeArchived?: boolean;
	/**
	 * Narrows on draft state: `true` returns only drafts, `false` only ready-for-review PRs. Omitted places no
	 * constraint. A boolean rather than a truthy flag because `false` is a distinct request, not the absence of one.
	 */
	draft?: boolean;
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
	includeArchived: boolean;
	/** Whether the provider can constrain the search by draft state server-side. */
	draft: boolean;
	/** Whether the manager's repository-descriptor scope is supported. */
	repositoryScope: boolean;
	/** Whether the manager's organization scope is supported. */
	organizationScope: boolean;
}

export interface PullRequestRef {
	owner: string;
	repo: string;
	branch: string;
	sha: string;
	exists: boolean;
	url: string;
	/** HTTPS clone URL of the ref's repository, when the provider exposes it. */
	cloneHttps?: string;
	/** SSH clone URL of the ref's repository, when the provider exposes it. */
	cloneSsh?: string;
	/** Best-effort flag: whether the ref's repository is a fork. `undefined` when the provider can't tell. */
	isFork?: boolean;
}

export interface PullRequestRefs {
	base: PullRequestRef;
	head: PullRequestRef;
	isCrossRepository: boolean;
}

export interface PullRequestReviewer {
	isCodeOwner?: boolean;
	reviewer: PullRequestMember;
	state: PullRequestReviewState;
}

export type PullRequestRepositoryIdentityDescriptor = RequireSomeWithProps<
	RequireSome<RepositoryIdentityDescriptor<string>, 'provider'>,
	'provider',
	'id' | 'domain' | 'repoDomain' | 'repoName'
> &
	RequireSomeWithProps<RequireSome<RepositoryIdentityDescriptor<string>, 'remote'>, 'remote', 'domain'>;
