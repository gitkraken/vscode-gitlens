import type { Endpoints } from '@octokit/types';
import { GitFileIndexStatus } from '../../git/models/file';
import type { IssueLabel, IssueMember, IssueOrPullRequestType } from '../../git/models/issue';
import { Issue } from '../../git/models/issue';
import { PullRequest, PullRequestState } from '../../git/models/pullRequest';
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

export interface GitHubDetailedIssue extends GitHubIssueOrPullRequest {
	date: Date;
	updatedDate: Date;
	closedDate: Date;
	author: {
		login: string;
		avatarUrl: string;
		url: string;
	};
	assignees: { nodes: IssueMember[] };
	labels?: { nodes: IssueLabel[] };
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
}

export namespace GitHubPullRequest {
	export function from(pr: GitHubPullRequest, provider: RichRemoteProvider): PullRequest {
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
			fromState(pr.state),
			new Date(pr.updatedAt),
			pr.closedAt == null ? undefined : new Date(pr.closedAt),
			pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		);
	}

	export function fromState(state: GitHubPullRequestState): PullRequestState {
		return state === 'MERGED'
			? PullRequestState.Merged
			: state === 'CLOSED'
			? PullRequestState.Closed
			: PullRequestState.Open;
	}

	export function toState(state: PullRequestState): GitHubPullRequestState {
		return state === PullRequestState.Merged ? 'MERGED' : state === PullRequestState.Closed ? 'CLOSED' : 'OPEN';
	}

	export function fromDetailed(pr: GitHubDetailedPullRequest, provider: RichRemoteProvider): PullRequest {
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
			fromState(pr.state),
			new Date(pr.updatedAt),
			pr.closedAt == null ? undefined : new Date(pr.closedAt),
			pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
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
		);
	}
}

export namespace GitHubDetailedIssue {
	export function from(value: GitHubDetailedIssue, provider: RichRemoteProvider): Issue {
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
			value.date,
			value.closed,
			value.updatedDate,
			{
				name: value.author.login,
				avatarUrl: value.author.avatarUrl,
				url: value.author.url,
			},
			value.assignees.nodes.map(assignee => ({
				name: assignee.name,
				avatarUrl: assignee.avatarUrl,
				url: assignee.url,
			})),
			value.closedDate,
			value.labels?.nodes == null
				? undefined
				: value.labels.nodes.map(label => ({
						color: label.color,
						name: label.name,
				  })),
		);
	}
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
