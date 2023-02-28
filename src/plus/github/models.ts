import type { Endpoints } from '@octokit/types';
import { GitFileIndexStatus } from '../../git/models/file';
import type { IssueLabel, IssueMember, IssueOrPullRequestType } from '../../git/models/issue';
import { Issue } from '../../git/models/issue';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestState,
} from '../../git/models/pullRequest';
import type { RichRemoteProvider } from '../../git/remotes/richRemoteProvider';

export interface GitHubBlame {
	ranges: GitHubBlameRange[];
	viewer?: string;
}

export interface GitHubBlameRange {
	startingLine: number;
	endingLine: number;
	commit: GitHubCommit;
}

export interface GitHubBranch {
	name: string;
	target: {
		oid: string;
		commitUrl: string;
		authoredDate: string;
		committedDate: string;
	};
}

export interface GitHubCommit {
	oid: string;
	parents: { nodes: { oid: string }[] };
	message: string;
	additions?: number | undefined;
	changedFiles?: number | undefined;
	deletions?: number | undefined;
	author: { avatarUrl: string | undefined; date: string; email: string | undefined; name: string };
	committer: { date: string; email: string | undefined; name: string };

	files?: Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files'];
}

export interface GitHubCommitRef {
	oid: string;
}

export type GitHubContributor = Endpoints['GET /repos/{owner}/{repo}/contributors']['response']['data'][0];
export interface GitHubIssueOrPullRequest {
	type: IssueOrPullRequestType;
	number: number;
	createdAt: string;
	closed: boolean;
	closedAt: string | null;
	title: string;
	url: string;
}

export interface GitHubPagedResult<T> {
	pageInfo: GitHubPageInfo;
	totalCount: number;
	values: T[];
}
export interface GitHubPageInfo {
	startCursor?: string | null;
	endCursor?: string | null;
	hasNextPage: boolean;
	hasPreviousPage: boolean;
}

export type GitHubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export interface GitHubPullRequest {
	author: {
		login: string;
		avatarUrl: string;
		url: string;
	};
	permalink: string;
	number: number;
	title: string;
	state: GitHubPullRequestState;
	updatedAt: string;
	closedAt: string | null;
	mergedAt: string | null;
	repository: {
		isFork: boolean;
		owner: {
			login: string;
		};
	};
}

export interface GitHubIssueDetailed extends GitHubIssueOrPullRequest {
	date: Date;
	updatedAt: Date;
	author: {
		login: string;
		avatarUrl: string;
		url: string;
	};
	assignees: { nodes: IssueMember[] };
	repository: {
		name: string;
		owner: {
			login: string;
		};
	};
	labels?: { nodes: IssueLabel[] };
	reactions?: {
		totalCount: number;
	};
	comments?: {
		totalCount: number;
	};
}

export type GitHubPullRequestReviewDecision = 'CHANGES_REQUESTED' | 'APPROVED' | 'REVIEW_REQUIRED';
export type GitHubPullRequestMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';

export interface GitHubDetailedPullRequest extends GitHubPullRequest {
	baseRefName: string;
	baseRefOid: string;
	baseRepository: {
		name: string;
		owner: {
			login: string;
		};
	};
	headRefName: string;
	headRefOid: string;
	headRepository: {
		name: string;
		owner: {
			login: string;
		};
	};
	reviewDecision: GitHubPullRequestReviewDecision;
	isReadByViewer: boolean;
	isDraft: boolean;
	isCrossRepository: boolean;
	checksUrl: string;
	totalCommentsCount: number;
	mergeable: GitHubPullRequestMergeableState;
	additions: number;
	deletions: number;
	reviewRequests: {
		nodes: {
			asCodeOwner: boolean;
			requestedReviewer: {
				login: string;
				avatarUrl: string;
				url: string;
			};
		}[];
	};
	assignees: {
		nodes: {
			login: string;
			avatarUrl: string;
			url: string;
		}[];
	};
}

export function fromGitHubPullRequest(pr: GitHubPullRequest, provider: RichRemoteProvider): PullRequest {
	return new PullRequest(
		provider,
		{
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.title,
		pr.permalink,
		fromGitHubPullRequestState(pr.state),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
	);
}

export function fromGitHubPullRequestState(state: GitHubPullRequestState): PullRequestState {
	return state === 'MERGED'
		? PullRequestState.Merged
		: state === 'CLOSED'
		? PullRequestState.Closed
		: PullRequestState.Open;
}

export function toGitHubPullRequestState(state: PullRequestState): GitHubPullRequestState {
	return state === PullRequestState.Merged ? 'MERGED' : state === PullRequestState.Closed ? 'CLOSED' : 'OPEN';
}

export function fromGitHubPullRequestReviewDecision(
	reviewDecision: GitHubPullRequestReviewDecision,
): PullRequestReviewDecision {
	switch (reviewDecision) {
		case 'APPROVED':
			return PullRequestReviewDecision.Approved;
		case 'CHANGES_REQUESTED':
			return PullRequestReviewDecision.ChangesRequested;
		case 'REVIEW_REQUIRED':
			return PullRequestReviewDecision.ReviewRequired;
	}
}

export function toGitHubPullRequestReviewDecision(
	reviewDecision: PullRequestReviewDecision,
): GitHubPullRequestReviewDecision {
	switch (reviewDecision) {
		case PullRequestReviewDecision.Approved:
			return 'APPROVED';
		case PullRequestReviewDecision.ChangesRequested:
			return 'CHANGES_REQUESTED';
		case PullRequestReviewDecision.ReviewRequired:
			return 'REVIEW_REQUIRED';
	}
}

export function fromGitHubPullRequestMergeableState(
	mergeableState: GitHubPullRequestMergeableState,
): PullRequestMergeableState {
	switch (mergeableState) {
		case 'MERGEABLE':
			return PullRequestMergeableState.Mergeable;
		case 'CONFLICTING':
			return PullRequestMergeableState.Conflicting;
		case 'UNKNOWN':
			return PullRequestMergeableState.Unknown;
	}
}

export function toGitHubPullRequestMergeableState(
	mergeableState: PullRequestMergeableState,
): GitHubPullRequestMergeableState {
	switch (mergeableState) {
		case PullRequestMergeableState.Mergeable:
			return 'MERGEABLE';
		case PullRequestMergeableState.Conflicting:
			return 'CONFLICTING';
		case PullRequestMergeableState.Unknown:
			return 'UNKNOWN';
	}
}

export function fromGitHubPullRequestDetailed(
	pr: GitHubDetailedPullRequest,
	provider: RichRemoteProvider,
): PullRequest {
	return new PullRequest(
		provider,
		{
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.title,
		pr.permalink,
		fromGitHubPullRequestState(pr.state),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		fromGitHubPullRequestMergeableState(pr.mergeable),
		{
			head: {
				exists: pr.headRepository != null,
				owner: pr.headRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.headRefOid,
				branch: pr.headRefName,
			},
			base: {
				exists: pr.baseRepository != null,
				owner: pr.baseRepository?.owner.login,
				repo: pr.baseRepository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
		pr.additions,
		pr.deletions,
		pr.totalCommentsCount,
		fromGitHubPullRequestReviewDecision(pr.reviewDecision),
		pr.reviewRequests.nodes.map(r => ({
			isCodeOwner: r.asCodeOwner,
			reviewer: {
				name: r.requestedReviewer.login,
				avatarUrl: r.requestedReviewer.avatarUrl,
				url: r.requestedReviewer.url,
			},
		})),
		pr.assignees.nodes.map(r => ({
			name: r.login,
			avatarUrl: r.avatarUrl,
			url: r.url,
		})),
	);
}

export function fromGitHubIssueDetailed(value: GitHubIssueDetailed, provider: RichRemoteProvider): Issue {
	return new Issue(
		{
			id: provider.id,
			name: provider.name,
			domain: provider.domain,
			icon: provider.icon,
		},
		String(value.number),
		value.title,
		value.url,
		new Date(value.createdAt),
		value.closed,
		new Date(value.updatedAt),
		{
			name: value.author.login,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		{
			owner: value.repository.owner.login,
			repo: value.repository.name,
		},
		value.assignees.nodes.map(assignee => ({
			name: assignee.name,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		value.closedAt == null ? undefined : new Date(value.closedAt),
		value.labels?.nodes == null
			? undefined
			: value.labels.nodes.map(label => ({
					color: label.color,
					name: label.name,
			  })),
		value.comments?.totalCount,
		value.reactions?.totalCount,
	);
}

export interface GitHubTag {
	name: string;
	target: {
		oid: string;
		commitUrl: string;
		authoredDate: string;
		committedDate: string;
		message?: string | null;
		tagger?: {
			date: string;
		} | null;
	};
}

export function fromCommitFileStatus(
	status: NonNullable<Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files']>[0]['status'],
): GitFileIndexStatus | undefined {
	switch (status) {
		case 'added':
			return GitFileIndexStatus.Added;
		case 'changed':
		case 'modified':
			return GitFileIndexStatus.Modified;
		case 'removed':
			return GitFileIndexStatus.Deleted;
		case 'renamed':
			return GitFileIndexStatus.Renamed;
		case 'copied':
			return GitFileIndexStatus.Copied;
	}
	return undefined;
}
