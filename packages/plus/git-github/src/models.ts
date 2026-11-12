import type { Endpoints } from '@octokit/types';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { IssueLabel, IssueProjection } from '@gitlens/git/models/issue.js';
import { Issue, RepositoryAccessLevel } from '@gitlens/git/models/issue.js';
import type { IssueMilestone } from '@gitlens/git/models/issueOrPullRequest.js';
import type {
	PullRequestMember,
	PullRequestMergeQueueEntry,
	PullRequestMergeQueueRemoval,
	PullRequestProjection,
	PullRequestStackInfo,
	PullRequestState,
} from '@gitlens/git/models/pullRequest.js';
import {
	PullRequest,
	PullRequestMergeableState,
	PullRequestMergeQueueState,
	PullRequestReviewDecision,
	PullRequestReviewState,
	PullRequestStatusCheckRollupState,
} from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';

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

export type GitHubSshSigningKey = Endpoints['GET /users/{username}/ssh_signing_keys']['response']['data'][0];

export interface GitHubMember {
	login: string;
	avatarUrl: string;
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

export type GitHubCommitFileStatus = NonNullable<
	Endpoints['GET /repos/{owner}/{repo}/commits/{ref}']['response']['data']['files']
>[0]['status'];

export function fromCommitFileStatus(status: GitHubCommitFileStatus): GitFileIndexStatus | undefined {
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

export type GitHubIssueState = 'OPEN' | 'CLOSED';
export type GitHubPullRequestState = 'OPEN' | 'CLOSED' | 'MERGED';
export type GitHubIssueOrPullRequestState = GitHubIssueState | GitHubPullRequestState;

/** GitHub's `Milestone`, as `gqlMilestoneFragment` selects it. */
export interface GitHubMilestone {
	id: string;
	title: string;
	state: 'OPEN' | 'CLOSED';
	dueOn: string | null;
	url: string;
}

export interface GitHubPullRequestLite extends Omit<GitHubIssueOrPullRequest, '__typename'> {
	/** `Actor` is nullable in GitHub's schema — `null` once the author's account is deleted */
	author: GitHubMember | null;
	body: string | null;

	baseRefName: string;
	baseRefOid: string;

	headRefName: string;
	headRefOid: string;
	headRepository: {
		isFork: boolean;
		name: string;
		owner: {
			login: string;
		};
		sshUrl: string;
		url: string;
	};

	isCrossRepository: boolean;
	isDraft: boolean;
	mergedAt: string | null;
	/** `null` when the pull request has none. */
	milestone: GitHubMilestone | null;
	permalink: string;

	repository: {
		isFork: boolean;
		name: string;
		owner: {
			login: string;
		};
		sshUrl: string;
		url: string;
		viewerPermission: GitHubViewerPermission;
	};

	/** Only selected against github.com — GitHub Enterprise Server schemas lag and reject the field. */
	stack?: GitHubPullRequestStack | null;
	/** Only selected against github.com — see `stack`. */
	stackEntry?: { position: number } | null;
	/** Only selected against github.com, for a read that asks for it (`mergeQueue`) or, when it doesn't say, a host
	 *  that opts in (`GitHubApiConfig.getPullRequestReadOptions`) — see `stack`. `null` when the pull request isn't
	 *  queued. */
	mergeQueueEntry?: GitHubMergeQueueEntry | null;
	/** Selected with `mergeQueueEntry`. True whenever the base branch requires a merge queue, whatever the pull
	 *  request's state. */
	isMergeQueueEnabled?: boolean;
	/** Selected with `mergeQueueEntry`. The latest merge-queue event only (`timelineItems(last: 1)`). */
	mergeQueueEvents?: GitHubMergeQueueEvents | null;
}

/** The `timelineItems` of a pull request filtered to its merge-queue events, as GitLens selects them. */
export interface GitHubMergeQueueEvents {
	nodes: (GitHubMergeQueueEvent | null)[] | null;
}

/** A merge-queue timeline event. Only a removal's fields are selected: the latest event being an addition is all an
 *  addition says. */
export type GitHubMergeQueueEvent =
	| { __typename: 'AddedToMergeQueueEvent' }
	| {
			__typename: 'RemovedFromMergeQueueEvent';
			createdAt: string;
			reason: string | null;
	  };

export type GitHubMergeQueueEntryState = 'QUEUED' | 'AWAITING_CHECKS' | 'MERGEABLE' | 'UNMERGEABLE' | 'LOCKED';

/** GitHub's `MergeQueueEntry`, as GitLens selects it. */
export interface GitHubMergeQueueEntry {
	state: GitHubMergeQueueEntryState;
	enqueuedAt: string;
	/** Seconds from when it was read. */
	estimatedTimeToMerge: number | null;
	mergeQueue: { url: string } | null;
	/** 1-based, in enqueue order. */
	position: number | null;
}

/** GitHub's stacked-pull-request object. Read-only; all stack mutations are REST-only. */
export interface GitHubPullRequestStack {
	id: string;
	number: number;
	size: number;
	/** The branch the bottom of the stack targets — the stack's trunk. */
	baseRefName: string;
}

export interface GitHubIssue extends Omit<GitHubIssueOrPullRequest, '__typename'> {
	/** `Actor` is nullable in GitHub's schema — `null` once the author's account is deleted */
	author: GitHubMember | null;
	assignees: { nodes: GitHubMember[] };
	comments?: {
		totalCount: number;
	};
	labels?: { nodes: IssueLabel[] };
	/** `null` when the issue has none. */
	milestone: GitHubMilestone | null;
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

type GitHubPullRequestReview = {
	id: string;
	author: GitHubMember | null;
	state: GitHubPullRequestReviewState;
	commit?: { oid: string } | null;
};

export interface GitHubPullRequest extends GitHubPullRequestLite {
	additions: number;
	assignees: {
		nodes: GitHubMember[];
	};
	changedFiles: number;
	checksUrl: string;
	deletions: number;
	mergeable: GitHubPullRequestMergeableState;
	reviewDecision: GitHubPullRequestReviewDecision;
	latestReviews: {
		nodes: GitHubPullRequestReview[];
	};
	/**
	 * The current user's own latest review. `latestReviews` is capped, so on a heavily-reviewed pull request
	 * the viewer's own review can fall outside that window — which is exactly the row a "needs my review"
	 * surface is asking about.
	 */
	viewerLatestReview: GitHubPullRequestReview | null;
	reviewRequests: {
		nodes: {
			asCodeOwner: boolean;
			/** Empty for a team (or anything else that isn't a user), which the `... on User` selection doesn't match. */
			requestedReviewer: Partial<GitHubMember> | null;
		}[];
	};
	commits: {
		totalCount: number;
		nodes: {
			commit: {
				statusCheckRollup: {
					state: 'SUCCESS' | 'FAILURE' | 'PENDING' | 'EXPECTED' | 'ERROR';
				} | null;
			};
		}[];
	};
	totalCommentsCount: number;
	viewerCanUpdate: boolean;
}

/**
 * An input beyond a pull request's lifecycle fields that `GitHubApi.getPullRequestsEtagFieldsBatch` can select.
 * Mirrors the integrations package's `PullRequestEtagInclude`, which this package cannot import.
 */
export type GitHubPullRequestEtagInclude = 'mergeable' | 'reviewDecision' | 'checks';

/**
 * The change state `GitHubApi.getPullRequestsEtagFieldsBatch` selects: a pull request's lifecycle fields, plus,
 * for each requested {@link GitHubPullRequestEtagInclude}, what its etag reads. Each selection is the full
 * fragment's own, so a value here is the one a full read would have mapped.
 */
export interface GitHubPullRequestEtagNode extends Pick<
	GitHubPullRequest,
	'id' | 'number' | 'state' | 'isDraft' | 'updatedAt' | 'headRefOid'
> {
	/** Only with `mergeable`. */
	mergeable?: GitHubPullRequestMergeableState | null;
	/** Only with `reviewDecision`. `null` on a repository that requires no review. */
	reviewDecision?: GitHubPullRequestReviewDecision | null;
	/** Only with `checks`. */
	commits?: {
		nodes: { commit: { statusCheckRollup: { state: GitHubPullRequestStatusCheckRollupState } | null } }[];
	};
	/** Selected when the read selects merge-queue data, like the full read's. `null` when the pull request isn't queued. */
	mergeQueueEntry?: Pick<GitHubMergeQueueEntry, 'state' | 'enqueuedAt'> | null;
	/** Selected when the read selects merge-queue data, exactly as the full read selects it. */
	mergeQueueEvents?: GitHubMergeQueueEvents | null;
	/**
	 * Selected with the merge-queue data and nothing else, so its presence says the read selected it. Its value is
	 * never an etag input: only a change to the base branch's rules moves it.
	 */
	isMergeQueueEnabled?: boolean;
}

/**
 * An input beyond an issue's lifecycle fields that `GitHubApi.getIssuesEtagFieldsBatch` can select. Mirrors the
 * integrations package's `IssueEtagInclude`, which this package cannot import.
 */
export type GitHubIssueEtagInclude = 'reactions';

/**
 * The change state `GitHubApi.getIssuesEtagFieldsBatch` selects, plus, for each requested
 * {@link GitHubIssueEtagInclude}, the full fragment's own selection of it.
 */
export interface GitHubIssueEtagNode extends Pick<GitHubIssue, 'id' | 'number' | 'state' | 'updatedAt'> {
	/** Only with `reactions`: the thumbs-up reactions, as the full fragment selects them. */
	reactions?: { totalCount: number };
}

export type GitHubViewerPermission =
	| 'ADMIN' // Can read, clone, and push to this repository. Can also manage issues, pull requests, and repository settings, including adding collaborators
	| 'MAINTAIN' // Can read, clone, and push to this repository. They can also manage issues, pull requests, and some repository settings
	| 'WRITE' // Can read, clone, and push to this repository. Can also manage issues and pull requests
	| 'TRIAGE' // Can read and clone this repository. Can also manage issues and pull requests
	| 'READ' // Can read and clone this repository. Can also open and comment on issues and pull requests
	| 'NONE';

/** `ghost` is how github.com renders an actor whose account was deleted, under the handle `ghost` */
function fromGitHubMemberOrGhost(member: GitHubMember | null | undefined): PullRequestMember {
	if (member == null) return { id: 'ghost', name: 'ghost', username: 'ghost' };

	return {
		id: member.login,
		name: member.login,
		username: member.login,
		avatarUrl: member.avatarUrl,
		url: member.url,
	};
}

export function fromGitHubPullRequestLite(
	pr: GitHubPullRequestLite,
	provider: Provider,
	projection?: PullRequestProjection,
): PullRequest {
	return new PullRequest(
		provider,
		fromGitHubMemberOrGhost(pr.author),
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
				cloneHttps: pr.headRepository != null ? `${pr.headRepository.url}.git` : undefined,
				cloneSsh: pr.headRepository?.sshUrl,
				isFork: pr.headRepository?.isFork,
			},
			base: {
				exists: pr.repository != null,
				owner: pr.repository?.owner.login,
				repo: pr.repository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.repository?.url,
				cloneHttps: pr.repository != null ? `${pr.repository.url}.git` : undefined,
				cloneSsh: pr.repository?.sshUrl,
				isFork: pr.repository?.isFork,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
		// The lite fragment selects nothing between `isDraft` and `stack`.
		undefined, // additions
		undefined, // deletions
		undefined, // commentsCount
		undefined, // thumbsUpCount
		undefined, // reviewDecision
		undefined, // reviewRequests
		undefined, // latestReviews
		undefined, // assignees
		undefined, // statusCheckRollupState
		undefined, // project
		undefined, // version
		undefined, // commitCount
		fromGitHubPullRequestStack(pr),
		undefined, // filesChanged
		pr.body ?? undefined,
		pr.number,
		undefined, // authoredByMe
		projection,
		undefined, // viewer
		undefined, // viewerUnresolved
		fromGitHubMilestone(pr.milestone),
		fromGitHubPullRequestMergeQueueEntry(pr),
		pr.isMergeQueueEnabled,
		fromGitHubMergeQueueRemoval(pr.mergeQueueEvents),
	);
}

/** `undefined` only for a node from a selection that left the milestone out, which no fragment does today. */
function fromGitHubMilestone(milestone: GitHubMilestone | null | undefined): IssueMilestone | null | undefined {
	if (milestone == null) return milestone;

	return {
		id: milestone.id,
		title: milestone.title,
		state: milestone.state === 'CLOSED' ? 'closed' : 'open',
		...(milestone.dueOn != null ? { dueDate: new Date(milestone.dueOn) } : {}),
		...(milestone.url ? { url: milestone.url } : {}),
	};
}

/** Both fields are absent on GitHub Enterprise Server (never selected) and `null` when unstacked. */
function fromGitHubPullRequestStack(pr: GitHubPullRequestLite): PullRequestStackInfo | undefined {
	if (pr.stack == null || pr.stackEntry == null) return undefined;

	return {
		id: pr.stack.id,
		number: pr.stack.number,
		size: pr.stack.size,
		position: pr.stackEntry.position,
		baseRef: pr.stack.baseRefName,
	};
}

/** Absent where never selected (GitHub Enterprise Server, or a host that didn't opt in) and `null` when the pull
 *  request isn't queued. */
function fromGitHubPullRequestMergeQueueEntry(pr: GitHubPullRequestLite): PullRequestMergeQueueEntry | undefined {
	return pr.mergeQueueEntry != null ? fromGitHubMergeQueueEntry(pr.mergeQueueEntry) : undefined;
}

/**
 * The one place a GitHub `MergeQueueEntry` becomes a {@link PullRequestMergeQueueEntry}, whichever read selected it.
 * GitHub's estimate is a duration from the moment it answered, so it's fixed to a date here, at read time, rather
 * than added to the clock at each render, where a held entry would never count down.
 */
export function fromGitHubMergeQueueEntry(entry: GitHubMergeQueueEntry): PullRequestMergeQueueEntry {
	return {
		state: fromGitHubMergeQueueEntryState(entry.state),
		enqueuedAt: new Date(entry.enqueuedAt),
		estimatedMergeAt:
			entry.estimatedTimeToMerge != null ? new Date(Date.now() + entry.estimatedTimeToMerge * 1000) : undefined,
		url: entry.mergeQueue?.url,
		position: entry.position ?? undefined,
	};
}

/**
 * The pull request's latest removal from its merge queue, from its latest merge-queue event: set only when that
 * event is a removal (so it hasn't rejoined since) whose reason isn't `merged` (GitHub removes every merged entry
 * with that reason). Absent where never selected (GitHub Enterprise Server, or a host that didn't opt in). Shared by
 * the full read and the etag's cheap check, so both derive the same removal.
 */
export function fromGitHubMergeQueueRemoval(
	events: GitHubMergeQueueEvents | null | undefined,
): PullRequestMergeQueueRemoval | undefined {
	const latest = events?.nodes?.at(-1);
	if (latest?.__typename !== 'RemovedFromMergeQueueEvent') return undefined;

	const reason = latest.reason ?? '';
	if (reason.toLowerCase() === 'merged') return undefined;

	return { reason: reason, removedAt: new Date(latest.createdAt) };
}

/** A state GitHub adds later still means the pull request is in the queue, so it reads as Queued rather than
 *  dropping the entry, which would report a queued pull request as not queued. */
export function fromGitHubMergeQueueEntryState(state: GitHubMergeQueueEntryState): PullRequestMergeQueueState {
	switch (state) {
		case 'AWAITING_CHECKS':
			return PullRequestMergeQueueState.AwaitingChecks;
		case 'MERGEABLE':
			return PullRequestMergeQueueState.Mergeable;
		case 'UNMERGEABLE':
			return PullRequestMergeQueueState.Unmergeable;
		case 'LOCKED':
			return PullRequestMergeQueueState.Locked;
		default:
			return PullRequestMergeQueueState.Queued;
	}
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
		case PullRequestMergeableState.FailingChecks:
			return 'UNKNOWN';
		case PullRequestMergeableState.BlockedByPolicy:
			return 'UNKNOWN';
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

export function fromGitHubPullRequest(
	pr: GitHubPullRequest,
	provider: Provider,
	projection?: PullRequestProjection,
): PullRequest {
	// `latestReviews` is capped, so keep the viewer's own review even when it falls outside that window, deduped
	// by review id since the two selections overlap. Unsubmitted drafts are dropped from the union rather than
	// from the viewer's side alone: `PENDING` is in GitHub's review-state enum on both selections, and the field
	// this feeds is documented as reviews already SUBMITTED — a draft there tells a "needs my review" consumer
	// the review is done, and a reviewer with a submitted review plus a draft would get two conflicting rows.
	const viewerLatestReview = pr.viewerLatestReview;
	const latestReviews = [
		...pr.latestReviews.nodes,
		...(viewerLatestReview != null && !pr.latestReviews.nodes.some(r => r.id === viewerLatestReview.id)
			? [viewerLatestReview]
			: []),
	].filter(review => review.state !== 'PENDING');

	return new PullRequest(
		provider,
		fromGitHubMemberOrGhost(pr.author),
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
				cloneHttps: pr.headRepository != null ? `${pr.headRepository.url}.git` : undefined,
				cloneSsh: pr.headRepository?.sshUrl,
				isFork: pr.headRepository?.isFork,
			},
			base: {
				exists: pr.repository != null,
				owner: pr.repository?.owner.login,
				repo: pr.repository?.name,
				sha: pr.baseRefOid,
				branch: pr.baseRefName,
				url: pr.repository?.url,
				cloneHttps: pr.repository != null ? `${pr.repository.url}.git` : undefined,
				cloneSsh: pr.repository?.sshUrl,
				isFork: pr.repository?.isFork,
			},
			isCrossRepository: pr.isCrossRepository,
		},
		pr.isDraft,
		pr.additions,
		pr.deletions,
		pr.totalCommentsCount,
		undefined, // thumbsUpCount: the fragment selects no reactions
		fromGitHubPullRequestReviewDecision(pr.reviewDecision),
		pr.reviewRequests.nodes
			.map(r =>
				r.requestedReviewer != null
					? {
							isCodeOwner: r.asCodeOwner,
							reviewer: {
								// A team has no login: an empty id, which matches no one, rather than a missing one.
								id: r.requestedReviewer.login ?? '',
								name: r.requestedReviewer.login,
								username: r.requestedReviewer.login,
								avatarUrl: r.requestedReviewer.avatarUrl,
								url: r.requestedReviewer.url,
							},
							state: PullRequestReviewState.ReviewRequested,
						}
					: undefined,
			)
			.filter(<T>(r?: T): r is T => Boolean(r)),
		latestReviews.map(r => ({
			reviewer: fromGitHubMemberOrGhost(r.author),
			state: fromGitHubPullRequestReviewState(r.state),
			commitOid: r.commit?.oid,
		})),
		pr.assignees.nodes.map(r => ({
			id: r.login,
			name: r.login,
			username: r.login,
			avatarUrl: r.avatarUrl,
			url: r.url,
		})),
		fromGitHubPullRequestStatusCheckRollupState(pr.commits.nodes?.[0]?.commit.statusCheckRollup?.state),
		undefined, // project
		undefined, // version
		pr.commits.totalCount,
		fromGitHubPullRequestStack(pr),
		pr.changedFiles,
		pr.body ?? undefined,
		pr.number,
		undefined, // authoredByMe
		projection,
		undefined, // viewer
		undefined, // viewerUnresolved
		fromGitHubMilestone(pr.milestone),
		fromGitHubPullRequestMergeQueueEntry(pr),
		pr.isMergeQueueEnabled,
		fromGitHubMergeQueueRemoval(pr.mergeQueueEvents),
	);
}

export function fromGitHubIssue(value: GitHubIssue, provider: Provider, projection?: IssueProjection): Issue {
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
		value.author == null
			? undefined
			: {
					id: value.author.login,
					name: value.author.login,
					username: value.author.login,
					avatarUrl: value.author.avatarUrl,
					url: value.author.url,
				},
		value.assignees.nodes.map(assignee => ({
			id: assignee.login,
			name: assignee.login,
			username: assignee.login,
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
		undefined, // project
		undefined, // number
		undefined, // issueType
		undefined, // providerState
		undefined, // bodyFormat
		undefined, // iterations
		projection,
		undefined, // bodyField
		undefined, // viewer
		undefined, // viewerUnresolved
		undefined, // syncedWith
		fromGitHubMilestone(value.milestone),
	);
}

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
