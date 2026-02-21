import { GitPullRequestMergeableState, GitPullRequestReviewState, GitPullRequestState } from '@gitkraken/provider-apis';
import type { ProviderAccount, ProviderPullRequest } from '../models.js';

export interface BitbucketServerLink {
	href: string;
}

export interface NamedBitbucketServerLink<T extends string = string> extends BitbucketServerLink {
	name: T;
}

export interface BitbucketServerPagedResponse<T> {
	values: T[];
	size: number;
	limit: number;
	isLastPage: boolean;
	nextPageStart: number;
	start: number;
}

export interface BitbucketServerPullRequestRef {
	id: string;
	displayId: string;
	latestCommit: string;
	type: string;
	repository: {
		slug: string;
		id: number;
		name: string;
		hierarchyId: string;
		scmId: string;
		state: string;
		statusMessage: string;
		forkable: boolean;
		project: {
			key: string;
			id: number;
			name: string;
			public: boolean;
			type: string;
			links: {
				self: BitbucketServerLink[];
			};
		};
		public: boolean;
		archived: boolean;
		links: {
			clone: NamedBitbucketServerLink[];
			self: BitbucketServerLink[];
		};
	};
}

export interface BitbucketAuthor {
	name: string;
	emailAddress: string;
	id: undefined;
}

export interface BitbucketServerUser {
	name: string;
	emailAddress: string;
	active: boolean;
	displayName: string;
	id: number;
	slug: string;
	type: string;
	links: {
		self: BitbucketServerLink[];
	};
	avatarUrl?: string;
}

export interface BitbucketServerPullRequestUser {
	user: BitbucketServerUser;
	lastReviewedCommit?: string;
	role: 'REVIEWER' | 'AUTHOR' | 'PARTICIPANT';
	approved: boolean;
	status: 'UNAPPROVED' | 'NEEDS_WORK' | 'APPROVED';
}

export interface BitbucketServerBriefCommit {
	displayId: string;
	id: string;
}

export interface BitbucketServerCommit extends BitbucketServerBriefCommit {
	author: BitbucketServerUser | BitbucketAuthor;
	authorTimestamp: number;
	committer: BitbucketServerUser | BitbucketAuthor;
	committerTimestamp: number;
	message: string;
	parents: (BitbucketServerCommit | BitbucketServerBriefCommit)[];
}

export interface BitbucketServerPullRequest {
	id: number;
	version: number;
	title: string;
	description: string;
	state: 'OPEN' | 'MERGED' | 'DECLINED';
	open: boolean;
	closed: boolean;
	createdDate: number;
	updatedDate: number;
	closedDate: number | null;
	fromRef: BitbucketServerPullRequestRef;
	toRef: BitbucketServerPullRequestRef;
	locked: boolean;
	author: BitbucketServerPullRequestUser;
	reviewers: BitbucketServerPullRequestUser[];
	participants: BitbucketServerPullRequestUser[];
	properties: {
		mergeResult: {
			outcome: string;
			current: boolean;
		};
		resolvedTaskCount: number;
		commentCount: number;
		openTaskCount: number;
	};
	links: {
		self: BitbucketServerLink[];
	};
}

const normalizeUser = (user: BitbucketServerUser): ProviderAccount => ({
	name: user.displayName,
	email: user.emailAddress,
	avatarUrl: user.avatarUrl ?? null,
	id: user.id.toString(),
	username: user.name,
	url: user.links.self[0].href,
});

const reviewDecisionWeightByReviewState = {
	[GitPullRequestReviewState.Approved]: 0,
	[GitPullRequestReviewState.Commented]: 1,
	[GitPullRequestReviewState.ReviewRequested]: 2,
	[GitPullRequestReviewState.ChangesRequested]: 3,
};

export const summarizeReviewDecision = (
	reviews: { state: GitPullRequestReviewState }[] | null,
): GitPullRequestReviewState | null => {
	if (!reviews || reviews.length === 0) {
		return null;
	}

	return reviews.reduce(
		(prev: GitPullRequestReviewState, review) =>
			reviewDecisionWeightByReviewState[review.state] > reviewDecisionWeightByReviewState[prev]
				? review.state
				: prev,
		GitPullRequestReviewState.Approved,
	);
};

export const normalizeBitbucketServerPullRequest = (pr: BitbucketServerPullRequest): ProviderPullRequest => {
	const bitbucketStateToGitState = {
		OPEN: GitPullRequestState.Open,
		MERGED: GitPullRequestState.Merged,
		DECLINED: GitPullRequestState.Closed,
	};

	const reviewerStatusToGitState = {
		UNAPPROVED: GitPullRequestReviewState.ReviewRequested,
		NEEDS_WORK: GitPullRequestReviewState.ChangesRequested,
		APPROVED: GitPullRequestReviewState.Approved,
	};

	const reviews = pr.reviewers.map(reviewer => ({
		reviewer: normalizeUser(reviewer.user),
		state: reviewerStatusToGitState[reviewer.status],
	}));

	const baseSSHUrl = pr.toRef.repository.links.clone.find(link => link.name === 'ssh')?.href ?? null;
	let baseHTTPSUrl = pr.toRef.repository.links.clone.find(link => link.name === 'https')?.href ?? null;
	if (!baseHTTPSUrl) {
		baseHTTPSUrl = pr.toRef.repository.links.clone.find(link => link.name === 'http')?.href ?? null;
	}

	const headSSHUrl = pr.fromRef.repository.links.clone.find(link => link.name === 'ssh')?.href ?? null;
	let headHTTPSUrl = pr.fromRef.repository.links.clone.find(link => link.name === 'https')?.href ?? null;
	if (!headHTTPSUrl) {
		headHTTPSUrl = pr.fromRef.repository.links.clone.find(link => link.name === 'http')?.href ?? null;
	}

	return {
		id: pr.id.toString(),
		number: pr.id,
		title: pr.title,
		description: pr.description ?? null,
		url: pr.links.self[0].href,
		state: bitbucketStateToGitState[pr.state],
		isDraft: false,
		createdDate: new Date(pr.createdDate),
		updatedDate: new Date(pr.updatedDate),
		closedDate: pr.closedDate ? new Date(pr.closedDate) : null,
		mergedDate: pr.state === 'MERGED' && pr.closedDate ? new Date(pr.closedDate) : null,
		baseRef: {
			name: pr.toRef.displayId,
			oid: pr.toRef.latestCommit,
		},
		headRef: {
			name: pr.fromRef.displayId,
			oid: pr.fromRef.latestCommit,
		},
		commentCount: pr.properties?.commentCount,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: normalizeUser(pr.author.user),
		assignees: null,
		reviews: reviews,
		reviewDecision: summarizeReviewDecision(reviews),
		repository: {
			id: pr.toRef.repository.id.toString(),
			name: pr.toRef.repository.name,
			owner: {
				login: pr.toRef.repository.project.key,
			},
			remoteInfo:
				baseHTTPSUrl && baseSSHUrl
					? {
							cloneUrlHTTPS: baseHTTPSUrl,
							cloneUrlSSH: baseSSHUrl,
						}
					: null,
		},
		headRepository: {
			id: pr.fromRef.repository.id.toString(),
			name: pr.fromRef.repository.name,
			owner: {
				login: pr.fromRef.repository.project.key,
			},
			remoteInfo:
				headHTTPSUrl && headSSHUrl
					? {
							cloneUrlHTTPS: headHTTPSUrl,
							cloneUrlSSH: headSSHUrl,
						}
					: null,
		},
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
		version: pr.version,
	};
};
