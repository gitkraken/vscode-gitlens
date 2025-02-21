import { RepositoryAccessLevel } from '../../../../git/models/issue';
import type { IssueOrPullRequestState } from '../../../../git/models/issueOrPullRequest';
import type { PullRequestMember, PullRequestReviewer } from '../../../../git/models/pullRequest';
import { PullRequest, PullRequestReviewDecision, PullRequestReviewState } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { ResourceDescriptor } from '../../integration';

export interface BitbucketRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export interface BitbucketWorkspaceDescriptor extends ResourceDescriptor {
	id: string;
	name: string;
	slug: string;
}

export interface BitbucketRemoteRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
	cloneUrlHttps?: string;
	cloneUrlSsh?: string;
}

export type BitbucketPullRequestState = 'OPEN' | 'DECLINED' | 'MERGED' | 'SUPERSEDED';

interface BitbucketLink {
	href: string;
	name?: string;
}

interface BitbucketUser {
	type: 'user';
	uuid: string;
	display_name: string;
	account_id?: string;
	nickname?: string;
	links: {
		self: BitbucketLink;
		avatar: BitbucketLink;
		html: BitbucketLink;
	};
}

interface BitbucketWorkspace {
	type: 'workspace';
	uuid: string;
	name: string;
	slug: string;
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
		avatar: BitbucketLink;
	};
}

interface BitbucketProject {
	type: 'project';
	key: string;
	uuid: string;
	name: string;
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
		avatar: BitbucketLink;
	};
}

interface BitbucketPullRequestParticipant {
	type: 'participant';
	user: BitbucketUser;
	role: 'PARTICIPANT' | 'REVIEWER';
	approved: boolean;
	state: null | 'approved' | 'changes_requested';
	participated_on: null | string;
}

export interface BitbucketRepository {
	type: 'repository';
	uuid: string;
	full_name: string;
	name: string;
	slug: string;
	description?: string;
	is_private: boolean;
	parent: null | BitbucketRepository;
	scm: 'git';
	owner: BitbucketUser;
	workspace: BitbucketWorkspace;
	project: BitbucketProject;
	created_on: string;
	updated_on: string;
	size: number;
	language: string;
	has_issues: boolean;
	has_wiki: boolean;
	fork_policy: 'allow_forks' | 'no_public_forks' | 'no_forks';
	website: string;
	mainbranch?: BitbucketBranch;
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
		avatar: BitbucketLink;
	};
}

type BitbucketMergeStrategy =
	| 'merge_commit'
	| 'squash'
	| 'fast_forward'
	| 'squash_fast_forward'
	| 'rebase_fast_forward'
	| 'rebase_merge';

interface BitbucketBranch {
	name: string;
	merge_strategies?: BitbucketMergeStrategy[];
	default_merge_strategy?: BitbucketMergeStrategy;
}

interface BitbucketPullRequestCommit {
	type: 'commit';
	hash: string;
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
	};
}

export type BitbucketIssueState =
	| 'submitted'
	| 'new'
	| 'open'
	| 'resolved'
	| 'on hold'
	| 'invalid'
	| 'duplicate'
	| 'wontfix'
	| 'closed';

export interface BitbucketPullRequest {
	type: 'pullrequest';
	id: number;
	title: string;
	description: string;
	state: BitbucketPullRequestState;
	merge_commit: null | BitbucketPullRequestCommit;
	comment_count: number;
	task_count: number;
	close_source_branch: boolean;
	closed_by: BitbucketUser | null;
	author: BitbucketUser;
	reason: string;
	created_on: string;
	updated_on: string;
	destination: {
		branch: BitbucketBranch;
		commit: BitbucketPullRequestCommit;
		repository: BitbucketRepository;
	};
	source: {
		branch: BitbucketBranch;
		commit: BitbucketPullRequestCommit;
		repository: BitbucketRepository;
	};
	summary: {
		type: 'rendered';
		raw: string;
		markup: string;
		html: string;
	};
	reviewers?: BitbucketUser[];
	participants?: BitbucketPullRequestParticipant[];
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
		commits: BitbucketLink;
		approve: BitbucketLink;
		'request-changes': BitbucketLink;
		diff: BitbucketLink;
		diffstat: BitbucketLink;
		comments: BitbucketLink;
		activity: BitbucketLink;
		merge: BitbucketLink;
		decline: BitbucketLink;
		statuses: BitbucketLink;
	};
}

export interface BitbucketIssue {
	type: string;
	id: number;
	title: string;
	reporter: BitbucketUser;
	assignee?: BitbucketUser;
	state: BitbucketIssueState;
	created_on: string;
	updated_on: string;
	repository: BitbucketRepository;
	links: {
		self: BitbucketLink;
		html: BitbucketLink;
		comments: BitbucketLink;
		attachments: BitbucketLink;
		watch: BitbucketLink;
		vote: BitbucketLink;
	};
}

export function bitbucketPullRequestStateToState(state: BitbucketPullRequestState): IssueOrPullRequestState {
	switch (state) {
		case 'DECLINED':
		case 'SUPERSEDED':
			return 'closed';
		case 'MERGED':
			return 'merged';
		case 'OPEN':
		default:
			return 'opened';
	}
}

export function bitbucketIssueStateToState(state: BitbucketIssueState): IssueOrPullRequestState {
	switch (state) {
		case 'resolved':
		case 'invalid':
		case 'duplicate':
		case 'wontfix':
		case 'closed':
			return 'closed';
		case 'submitted':
		case 'new':
		case 'open':
		case 'on hold':
		default:
			return 'opened';
	}
}

export function isClosedBitbucketPullRequestState(state: BitbucketPullRequestState): boolean {
	return bitbucketPullRequestStateToState(state) !== 'opened';
}

export function fromBitbucketUser(user: BitbucketUser): PullRequestMember {
	return {
		avatarUrl: user.links.avatar.href,
		name: user.display_name,
		url: user.links.html.href,
		id: user.uuid,
	};
}

export function fromBitbucketParticipantToReviewer(
	prt: BitbucketPullRequestParticipant,
	closedBy: BitbucketUser | null,
	prState: BitbucketPullRequestState,
): PullRequestReviewer {
	return {
		reviewer: fromBitbucketUser(prt.user),
		state: prt.approved
			? PullRequestReviewState.Approved
			: prt.state === 'changes_requested'
			  ? PullRequestReviewState.ChangesRequested
			  : prt.participated_on != null
			    ? PullRequestReviewState.Commented
			    : prt.user.uuid === closedBy?.uuid && prState === 'DECLINED'
			      ? PullRequestReviewState.Dismissed
			      : PullRequestReviewState.Pending,
	};
}

function getBitbucketReviewDecision(pr: BitbucketPullRequest): PullRequestReviewDecision | undefined {
	if (!pr.participants?.length && pr.reviewers?.length) {
		return PullRequestReviewDecision.ReviewRequired;
	}
	if (!pr.participants) {
		return undefined;
	}
	let hasReviews = false;
	let hasChangeRequests = false;
	let hasApprovals = false;
	for (const prt of pr.participants) {
		if (prt.participated_on != null) {
			hasReviews = true;
		}
		if (prt.approved) {
			hasApprovals = true;
		}
		if (prt.state === 'changes_requested') {
			hasChangeRequests = true;
		}
	}
	if (hasChangeRequests) return PullRequestReviewDecision.ChangesRequested;
	if (hasApprovals) return PullRequestReviewDecision.Approved;
	if (hasReviews) return undefined; // not approved, not rejected, but reviewed
	return PullRequestReviewDecision.ReviewRequired; // nobody has reviewed yet.
}

export function fromBitbucketPullRequest(pr: BitbucketPullRequest, provider: Provider): PullRequest {
	return new PullRequest(
		provider,
		fromBitbucketUser(pr.author),
		pr.id.toString(),
		pr.id.toString(),
		pr.title,
		pr.links.html.href,
		{
			owner: pr.destination.repository.full_name.split('/')[0],
			repo: pr.destination.repository.name,
			id: pr.destination.repository.uuid,
			// TODO: Remove this assumption once actual access level is available
			accessLevel: RepositoryAccessLevel.Write,
		},
		bitbucketPullRequestStateToState(pr.state),
		new Date(pr.created_on),
		new Date(pr.updated_on),
		pr.closed_by ? new Date(pr.updated_on) : undefined,
		pr.state === 'MERGED' ? new Date(pr.updated_on) : undefined,
		undefined, // mergeableState
		undefined, // viewerCanUpdate
		{
			base: {
				branch: pr.destination.branch.name,
				sha: pr.destination.commit.hash,
				repo: pr.destination.repository.name,
				owner: pr.destination.repository.full_name.split('/')[0],
				exists: true,
				url: pr.destination.repository.links.html.href,
			},
			head: {
				branch: pr.source.branch.name,
				sha: pr.source.commit.hash,
				repo: pr.source.repository.name,
				owner: pr.source.repository.full_name.split('/')[0],
				exists: true,
				url: pr.source.repository.links.html.href,
			},
			isCrossRepository: pr.source.repository.uuid !== pr.destination.repository.uuid,
		},
		undefined, // isDraft
		undefined, // additions
		undefined, // deletions
		undefined, // commentsCount
		undefined, // thumbsCount
		getBitbucketReviewDecision(pr),
		pr.participants // reviewRequests:PullRequestReviewer[]
			?.filter(prt => prt.role === 'REVIEWER')
			.map(prt => fromBitbucketParticipantToReviewer(prt, pr.closed_by, pr.state))
			.filter(rv => rv.state === PullRequestReviewState.Pending),
		pr.participants // latestReviews:PullRequestReviewer[]
			?.filter(prt => prt.participated_on != null)
			.map(prt => fromBitbucketParticipantToReviewer(prt, pr.closed_by, pr.state)),
		undefined, // assignees:PullRequestMember[] -- it looks like there is no such thing as assignees on Bitbucket
		undefined, // PullRequestStatusCheckRollupState
		undefined, // IssueProject
	);
}
