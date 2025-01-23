/* eslint-disable @typescript-eslint/no-restricted-imports */ /* TODO need to deal with sharing rich class shapes to webviews */
import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/-webview/memoize';
import type { IssueRepository } from './issue';
import type { IssueOrPullRequest, IssueOrPullRequestState as PullRequestState } from './issueOrPullRequest';
import type { ProviderReference } from './remoteProvider';
import type { RepositoryIdentityDescriptor } from './repositoryIdentities';

export type { PullRequestState };

export function isPullRequest(pr: unknown): pr is PullRequest {
	return pr instanceof PullRequest;
}

export interface PullRequestShape extends IssueOrPullRequest {
	readonly author: PullRequestMember;
	readonly mergedDate?: Date;
	readonly refs?: PullRequestRefs;
	readonly isDraft?: boolean;
	readonly additions?: number;
	readonly deletions?: number;
	readonly mergeableState?: PullRequestMergeableState;
	readonly reviewDecision?: PullRequestReviewDecision;
	readonly reviewRequests?: PullRequestReviewer[];
	readonly assignees?: PullRequestMember[];
}

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
	) {}

	get closed(): boolean {
		return this.state === 'closed';
	}

	get formattedDate(): string {
		return Container.instance.PullRequestDateFormatting.dateStyle === 'absolute'
			? this.formatDate(Container.instance.PullRequestDateFormatting.dateFormat)
			: this.formatDateFromNow();
	}

	@memoize<PullRequest['formatDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatDate(format?: string | null) {
		return formatDate(this.mergedDate ?? this.closedDate ?? this.updatedDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatDateFromNow() {
		return fromNow(this.mergedDate ?? this.closedDate ?? this.updatedDate);
	}

	@memoize<PullRequest['formatClosedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatClosedDate(format?: string | null) {
		if (this.closedDate == null) return '';
		return formatDate(this.closedDate, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatClosedDateFromNow() {
		if (this.closedDate == null) return '';
		return fromNow(this.closedDate);
	}

	@memoize<PullRequest['formatMergedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatMergedDate(format?: string | null) {
		if (this.mergedDate == null) return '';
		return formatDate(this.mergedDate, format ?? 'MMMM Do, YYYY h:mma') ?? '';
	}

	formatMergedDateFromNow() {
		if (this.mergedDate == null) return '';
		return fromNow(this.mergedDate);
	}

	@memoize<PullRequest['formatUpdatedDate']>(format => format ?? 'MMMM Do, YYYY h:mma')
	formatUpdatedDate(format?: string | null) {
		return formatDate(this.updatedDate, format ?? 'MMMM Do, YYYY h:mma') ?? '';
	}

	formatUpdatedDateFromNow() {
		return fromNow(this.updatedDate);
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
	avatarUrl?: string;
	url?: string;
}

export interface PullRequestRef {
	owner: string;
	repo: string;
	branch: string;
	sha: string;
	exists: boolean;
	url: string;
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

export interface SearchedPullRequest {
	pullRequest: PullRequest;
	reasons: string[];
}
