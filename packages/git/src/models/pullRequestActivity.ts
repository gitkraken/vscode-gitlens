/** Who wrote a pull request activity item. GitHub reports no author for a deleted account. */
export interface PullRequestActivityAuthor {
	readonly login: string;
	readonly url?: string;
	readonly isBot: boolean;
}

interface PullRequestActivityItemBase {
	readonly id: string;
	readonly url: string;
	readonly author?: PullRequestActivityAuthor;
	/** When it was published: a review's submission, and for an inline comment its review's. */
	readonly publishedAt: Date;
	/** Written by the connection's own account. */
	readonly byViewer: boolean;
	readonly isMinimized: boolean;
}

/** A submitted review. Its inline comments follow it as `review-comment` items. */
export interface PullRequestActivityReview extends PullRequestActivityItemBase {
	readonly kind: 'review';
	readonly state: 'approved' | 'changes-requested' | 'commented' | 'dismissed';
	readonly body: string;
	readonly commitSha?: string;
	/** The review has more inline comments than were returned. */
	readonly commentsTruncated?: true;
}

/** An inline comment of the review named by `reviewId`. `inReplyTo` is the comment it answers in its thread. */
export interface PullRequestActivityReviewComment extends PullRequestActivityItemBase {
	readonly kind: 'review-comment';
	readonly reviewId: string;
	readonly body: string;
	readonly path: string;
	readonly line?: number;
	readonly startLine?: number;
	readonly originalLine?: number;
	readonly outdated: boolean;
	readonly inReplyTo?: string;
	readonly commitSha?: string;
}

/** A comment on the pull request's conversation. */
export interface PullRequestActivityComment extends PullRequestActivityItemBase {
	readonly kind: 'comment';
	readonly body: string;
}

export type PullRequestActivityItem =
	| PullRequestActivityReview
	| PullRequestActivityReviewComment
	| PullRequestActivityComment;

/** One pull request's activity after a cursor, oldest first. */
export interface PullRequestActivityPage {
	readonly items: readonly PullRequestActivityItem[];
	/** Opaque: send it back as the next read's cursor. */
	readonly cursor: string;
	/** More items follow this page. */
	readonly hasMore: boolean;
}
