import type { Endpoints } from '@octokit/types';
import { HostingIntegrationId } from '../../../../constants.integrations';
import { GitFileIndexStatus } from '../../../../git/models/file';
import type { IssueLabel } from '../../../../git/models/issue';
import { Issue, RepositoryAccessLevel } from '../../../../git/models/issue';
import type { PullRequestState } from '../../../../git/models/pullRequest';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '../../../../git/models/pullRequest';
import type { PullRequestUrlIdentity } from '../../../../git/models/pullRequest.utils';
import type { Provider } from '../../../../git/models/remoteProvider';

export interface GitHubBlame {
	ranges: GitHubBlameRange[];
	viewer?: string;
}

export interface GitHubMember {
	login: string;
	avatarUrl: string;
	url: string;
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
	__typename: 'Issue' | 'PullRequest';

	closed: boolean;
	closedAt: string | null;
	createdAt: string;
	id: string;
	number: number;
	state: GitHubIssueOrPullRequestState;
	title: string;
	updatedAt: string;
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

export type GitHubIssueState = 'OPEN' | 'CLOSED';
export type GitHubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type GitHubIssueOrPullRequestState = GitHubIssueState | GitHubPullRequestState;

export interface GitHubPullRequestLite extends Omit<GitHubIssueOrPullRequest, '__typename'> {
	author: GitHubMember;

	baseRefName: string;
	baseRefOid: string;

	headRefName: string;
	headRefOid: string;
	headRepository: {
		name: string;
		owner: {
			login: string;
		};
		url: string;
	};

	isCrossRepository: boolean;
	isDraft: boolean;
	mergedAt: string | null;
	permalink: string;

	repository: {
		isFork: boolean;
		name: string;
		owner: {
			login: string;
		};
		url: string;
		viewerPermission: GitHubViewerPermission;
	};
}

export interface GitHubIssue extends Omit<GitHubIssueOrPullRequest, '__typename'> {
	author: GitHubMember;
	assignees: { nodes: GitHubMember[] };
	comments?: {
		totalCount: number;
	};
	labels?: { nodes: IssueLabel[] };
	reactions?: {
		totalCount: number;
	};
	repository: {
		name: string;
		owner: {
			login: string;
		};
		viewerPermission: GitHubViewerPermission;
		url: string;
	};
	body: string;
}

export type GitHubPullRequestReviewDecision = 'CHANGES_REQUESTED' | 'APPROVED' | 'REVIEW_REQUIRED';
export type GitHubPullRequestMergeableState = 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
export type GitHubPullRequestStatusCheckRollupState = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'EXPECTED' | 'ERROR';
export type GitHubPullRequestReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';

export interface GitHubPullRequest extends GitHubPullRequestLite {
	additions: number;
	assignees: {
		nodes: GitHubMember[];
	};
	checksUrl: string;
	deletions: number;
	mergeable: GitHubPullRequestMergeableState;
	reviewDecision: GitHubPullRequestReviewDecision;
	latestReviews: {
		nodes: {
			author: GitHubMember;
			state: GitHubPullRequestReviewState;
		}[];
	};
	reviewRequests: {
		nodes: {
			asCodeOwner: boolean;
			requestedReviewer: GitHubMember | null;
		}[];
	};
	statusCheckRollup: {
		state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'EXPECTED' | 'ERROR';
	} | null;
	totalCommentsCount: number;
	viewerCanUpdate: boolean;
}

export function fromGitHubPullRequestLite(pr: GitHubPullRequestLite, provider: Provider): PullRequest {
	return new PullRequest(
		provider,
		{
			id: pr.author.login,
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.id,
		pr.title,
		pr.permalink,
		{
			owner: pr.repository.owner.login,
			repo: pr.repository.name,
			accessLevel: fromGitHubViewerPermissionToAccessLevel(pr.repository.viewerPermission),
		},
		fromGitHubIssueOrPullRequestState(pr.state),
		new Date(pr.createdAt),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		undefined,
		undefined,
		{
			head: {
				exists: pr.headRepository != null,
				owner: pr.headRepository?.owner.login,
				repo: pr.headRepository?.name,
				sha: pr.headRefOid,
				branch: pr.headRefName,
				url: pr.headRepository?.url,
			},
			base: {
				exists: pr.repository != null,
				owner: pr.repository?.owner.login,
				repo: pr.repository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.repository?.url,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
	);
}

export function fromGitHubIssueOrPullRequestState(state: GitHubPullRequestState): PullRequestState {
	return state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : 'opened';
}

export function toGitHubPullRequestState(state: PullRequestState): GitHubPullRequestState {
	return state === 'merged' ? 'MERGED' : state === 'closed' ? 'CLOSED' : 'OPEN';
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

export function fromGitHubPullRequestReviewState(state: GitHubPullRequestReviewState): PullRequestReviewState {
	switch (state) {
		case 'APPROVED':
			return PullRequestReviewState.Approved;
		case 'CHANGES_REQUESTED':
			return PullRequestReviewState.ChangesRequested;
		case 'COMMENTED':
			return PullRequestReviewState.Commented;
		case 'DISMISSED':
			return PullRequestReviewState.Dismissed;
		case 'PENDING':
			return PullRequestReviewState.Pending;
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

export function fromGitHubPullRequestStatusCheckRollupState(
	state: GitHubPullRequestStatusCheckRollupState | null | undefined,
): PullRequestStatusCheckRollupState | undefined {
	switch (state) {
		case 'SUCCESS':
		case 'EXPECTED':
			return PullRequestStatusCheckRollupState.Success;
		case 'FAILURE':
		case 'ERROR':
			return PullRequestStatusCheckRollupState.Failed;
		case 'PENDING':
			return PullRequestStatusCheckRollupState.Pending;
		default:
			return undefined;
	}
}

export function fromGitHubPullRequest(pr: GitHubPullRequest, provider: Provider): PullRequest {
	return new PullRequest(
		provider,
		{
			id: pr.author.login,
			name: pr.author.login,
			avatarUrl: pr.author.avatarUrl,
			url: pr.author.url,
		},
		String(pr.number),
		pr.id,
		pr.title,
		pr.permalink,
		{
			owner: pr.repository.owner.login,
			repo: pr.repository.name,
			accessLevel: fromGitHubViewerPermissionToAccessLevel(pr.repository.viewerPermission),
		},
		fromGitHubIssueOrPullRequestState(pr.state),
		new Date(pr.createdAt),
		new Date(pr.updatedAt),
		pr.closedAt == null ? undefined : new Date(pr.closedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		fromGitHubPullRequestMergeableState(pr.mergeable),
		pr.viewerCanUpdate,
		{
			head: {
				exists: pr.headRepository != null,
				owner: pr.headRepository?.owner.login,
				repo: pr.headRepository?.name,
				sha: pr.headRefOid,
				branch: pr.headRefName,
				url: pr.headRepository?.url,
			},
			base: {
				exists: pr.repository != null,
				owner: pr.repository?.owner.login,
				repo: pr.repository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.repository?.url,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
		pr.additions,
		pr.deletions,
		pr.totalCommentsCount,
		0, //pr.reactions.totalCount,
		fromGitHubPullRequestReviewDecision(pr.reviewDecision),
		pr.reviewRequests.nodes
			.map(r =>
				r.requestedReviewer != null
					? {
							isCodeOwner: r.asCodeOwner,
							reviewer: {
								id: r.requestedReviewer.login,
								name: r.requestedReviewer.login,
								avatarUrl: r.requestedReviewer.avatarUrl,
								url: r.requestedReviewer.url,
							},
							state: PullRequestReviewState.ReviewRequested,
					  }
					: undefined,
			)
			.filter(<T>(r?: T): r is T => Boolean(r)),
		pr.latestReviews.nodes.map(r => ({
			reviewer: {
				id: r.author.login,
				name: r.author.login,
				avatarUrl: r.author.avatarUrl,
				url: r.author.url,
			},
			state: fromGitHubPullRequestReviewState(r.state),
		})),
		pr.assignees.nodes.map(r => ({
			id: r.login,
			name: r.login,
			avatarUrl: r.avatarUrl,
			url: r.url,
		})),
		fromGitHubPullRequestStatusCheckRollupState(pr.statusCheckRollup?.state),
	);
}

export function fromGitHubIssue(value: GitHubIssue, provider: Provider): Issue {
	return new Issue(
		{
			id: provider.id,
			name: provider.name,
			domain: provider.domain,
			icon: provider.icon,
		},
		String(value.number),
		value.id,
		value.title,
		value.url,
		new Date(value.createdAt),
		new Date(value.updatedAt),
		value.closed,
		fromGitHubIssueOrPullRequestState(value.state),
		{
			id: value.author.login,
			name: value.author.login,
			avatarUrl: value.author.avatarUrl,
			url: value.author.url,
		},
		value.assignees.nodes.map(assignee => ({
			id: assignee.login,
			name: assignee.login,
			avatarUrl: assignee.avatarUrl,
			url: assignee.url,
		})),
		{
			owner: value.repository.owner.login,
			repo: value.repository.name,
			accessLevel: fromGitHubViewerPermissionToAccessLevel(value.repository.viewerPermission),
			url: value.repository.url,
		},
		value.closedAt == null ? undefined : new Date(value.closedAt),
		value.labels?.nodes == null
			? undefined
			: value.labels.nodes.map(label => ({
					color: label.color,
					name: label.name,
			  })),
		value.comments?.totalCount,
		value.reactions?.totalCount,
		value.body,
	);
}

type GitHubViewerPermission =
	| 'ADMIN' // Can read, clone, and push to this repository. Can also manage issues, pull requests, and repository settings, including adding collaborators
	| 'MAINTAIN' // Can read, clone, and push to this repository. They can also manage issues, pull requests, and some repository settings
	| 'WRITE' // Can read, clone, and push to this repository. Can also manage issues and pull requests
	| 'TRIAGE' // Can read and clone this repository. Can also manage issues and pull requests
	| 'READ' // Can read and clone this repository. Can also open and comment on issues and pull requests
	| 'NONE';

function fromGitHubViewerPermissionToAccessLevel(
	permission: GitHubViewerPermission | null | undefined,
): RepositoryAccessLevel {
	switch (permission) {
		case 'ADMIN':
			return RepositoryAccessLevel.Admin;
		case 'MAINTAIN':
			return RepositoryAccessLevel.Maintain;
		case 'WRITE':
			return RepositoryAccessLevel.Write;
		case 'TRIAGE':
			return RepositoryAccessLevel.Triage;
		case 'READ':
			return RepositoryAccessLevel.Read;
		default:
			return RepositoryAccessLevel.None;
	}
}

export interface GitHubTag {
	name: string;
	target: {
		oid: string;
		authoredDate?: string;
		committedDate?: string;
		message?: string | null;
		tagger?: {
			date: string;
		} | null;

		target?: {
			oid?: string;
			authoredDate?: string;
			committedDate?: string;
			message?: string | null;
		};
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

const prUrlRegex = /^(?:https?:\/\/)?(?:github\.com\/)?([^/]+\/[^/]+)\/pull\/(\d+)/i;

export function isMaybeGitHubPullRequestUrl(url: string): boolean {
	if (url == null) return false;

	return prUrlRegex.test(url);
}

export function getGitHubPullRequestIdentityFromMaybeUrl(url: string): RequireSome<PullRequestUrlIdentity, 'provider'> {
	if (url == null) return { prNumber: undefined, ownerAndRepo: undefined, provider: HostingIntegrationId.GitHub };

	const match = prUrlRegex.exec(url);
	if (match == null) return { prNumber: undefined, ownerAndRepo: undefined, provider: HostingIntegrationId.GitHub };

	return { prNumber: match[2], ownerAndRepo: match[1], provider: HostingIntegrationId.GitHub };
}
