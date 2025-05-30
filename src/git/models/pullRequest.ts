import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import type { IssueOrPullRequest, IssueRepository, IssueOrPullRequestState as PullRequestState } from './issue';
import { shortenRevision } from './reference';
import type { ProviderReference } from './remoteProvider';

export type { PullRequestState };

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

export interface PullRequestMember {
	name: string;
	avatarUrl: string;
	url: string;
}

export interface PullRequestReviewer {
	isCodeOwner?: boolean;
	reviewer: PullRequestMember;
	state: PullRequestReviewState;
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

export interface SearchedPullRequest {
	pullRequest: PullRequest;
	reasons: string[];
}

export function serializePullRequest(value: PullRequest): PullRequestShape {
	const serialized: PullRequestShape = {
		type: value.type,
		provider: {
			id: value.provider.id,
			name: value.provider.name,
			domain: value.provider.domain,
			icon: value.provider.icon,
		},
		id: value.id,
		nodeId: value.nodeId,
		title: value.title,
		url: value.url,
		createdDate: value.createdDate,
		updatedDate: value.updatedDate,
		closedDate: value.closedDate,
		closed: value.closed,
		author: {
			name: value.author.name,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		state: value.state,
		mergedDate: value.mergedDate,
		mergeableState: value.mergeableState,
		refs: value.refs
			? {
					head: {
						exists: value.refs.head.exists,
						owner: value.refs.head.owner,
						repo: value.refs.head.repo,
						sha: value.refs.head.sha,
						branch: value.refs.head.branch,
						url: value.refs.head.url,
					},
					base: {
						exists: value.refs.base.exists,
						owner: value.refs.base.owner,
						repo: value.refs.base.repo,
						sha: value.refs.base.sha,
						branch: value.refs.base.branch,
						url: value.refs.base.url,
					},
					isCrossRepository: value.refs.isCrossRepository,
			  }
			: undefined,
		isDraft: value.isDraft,
		additions: value.additions,
		deletions: value.deletions,
		commentsCount: value.commentsCount,
		thumbsUpCount: value.thumbsUpCount,
		reviewDecision: value.reviewDecision,
		reviewRequests: value.reviewRequests,
		assignees: value.assignees,
	};
	return serialized;
}

export class PullRequest implements PullRequestShape {
	readonly type = 'pullrequest';

	constructor(
		public readonly provider: ProviderReference,
		public readonly author: {
			readonly name: string;
			readonly avatarUrl: string;
			readonly url: string;
		},
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

export function isPullRequest(pr: any): pr is PullRequest {
	return pr instanceof PullRequest;
}

export interface PullRequestComparisonRefs {
	repoPath: string;
	base: { ref: string; label: string };
	head: { ref: string; label: string };
}

export async function getComparisonRefsForPullRequest(
	container: Container,
	repoPath: string,
	prRefs: PullRequestRefs,
): Promise<PullRequestComparisonRefs> {
	const refs: PullRequestComparisonRefs = {
		repoPath: repoPath,
		base: { ref: prRefs.base.sha, label: `${prRefs.base.branch} (${shortenRevision(prRefs.base.sha)})` },
		head: { ref: prRefs.head.sha, label: prRefs.head.branch },
	};

	// Find the merge base to show a more accurate comparison for the PR
	const mergeBase =
		(await container.git.getMergeBase(refs.repoPath, refs.base.ref, refs.head.ref, { forkPoint: true })) ??
		(await container.git.getMergeBase(refs.repoPath, refs.base.ref, refs.head.ref));
	if (mergeBase != null) {
		refs.base = { ref: mergeBase, label: `${prRefs.base.branch} (${shortenRevision(mergeBase)})` };
	}

	return refs;
}
