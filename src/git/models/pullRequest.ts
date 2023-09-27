import { Container } from '../../container';
import { formatDate, fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/memoize';
import type { IssueOrPullRequest, IssueOrPullRequestState as PullRequestState } from './issue';
import type { RemoteProviderReference } from './remoteProvider';

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
	isCodeOwner: boolean;
	reviewer: PullRequestMember;
}

export interface PullRequestShape extends IssueOrPullRequest {
	readonly author: PullRequestMember;
	readonly mergedDate?: Date;
	readonly refs?: PullRequestRefs;
	readonly isDraft?: boolean;
	readonly additions?: number;
	readonly deletions?: number;
	readonly comments?: number;
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
		title: value.title,
		url: value.url,
		date: value.date,
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
		comments: value.comments,
		reviewDecision: value.reviewDecision,
		reviewRequests: value.reviewRequests,
		assignees: value.assignees,
	};
	return serialized;
}

export class PullRequest implements PullRequestShape {
	static is(pr: any): pr is PullRequest {
		return pr instanceof PullRequest;
	}

	readonly type = 'pullrequest';

	constructor(
		public readonly provider: RemoteProviderReference,
		public readonly author: {
			readonly name: string;
			readonly avatarUrl: string;
			readonly url: string;
		},
		public readonly id: string,
		public readonly title: string,
		public readonly url: string,
		public readonly state: PullRequestState,
		public readonly date: Date,
		public readonly closedDate?: Date,
		public readonly mergedDate?: Date,
		public readonly mergeableState?: PullRequestMergeableState,
		public readonly refs?: PullRequestRefs,
		public readonly isDraft?: boolean,
		public readonly additions?: number,
		public readonly deletions?: number,
		public readonly comments?: number,
		public readonly reviewDecision?: PullRequestReviewDecision,
		public readonly reviewRequests?: PullRequestReviewer[],
		public readonly assignees?: PullRequestMember[],
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
		return formatDate(this.mergedDate ?? this.closedDate ?? this.date, format ?? 'MMMM Do, YYYY h:mma');
	}

	formatDateFromNow() {
		return fromNow(this.mergedDate ?? this.closedDate ?? this.date);
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
		return formatDate(this.date, format ?? 'MMMM Do, YYYY h:mma') ?? '';
	}

	formatUpdatedDateFromNow() {
		return fromNow(this.date);
	}
}
