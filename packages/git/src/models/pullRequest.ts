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
	readonly assignees?: PullRequestMember[];
	readonly project?: IssueProject;
	readonly stack?: PullRequestStackInfo;
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
	name: string;
	/** The provider's handle for this person, when it has one — GitHub's login, Azure's `uniqueName` (a UPN,
	 *  so an email), Bitbucket's mutable `nickname`. Display/labelling only: it is neither guaranteed present
	 *  (GitLab's native mapper has none) nor a stable identity, so never key a match off it. */
	username?: string;
	avatarUrl?: string;
	url?: string;
}

/** Selects which pull request states a read should include. `all` covers open + closed + merged. */
export type PullRequestStateFilter = 'open' | 'closed' | 'merged' | 'all';

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

/**
 * A pull request's membership in a stack — an ordered chain of dependent pull requests where each
 * targets the branch of the one below it.
 *
 * `baseRef` is the stack's ultimate target (its trunk) and is NOT the same as `refs.base`, which for
 * anything above the bottom layer names the layer below. Use `refs.base` to diff a single layer; use
 * `baseRef` to answer where the work ultimately lands.
 */
export interface PullRequestStackInfo {
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
