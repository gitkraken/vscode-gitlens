import type { IssueProjection, IssueRepository } from '@gitlens/git/models/issue.js';
import { Issue } from '@gitlens/git/models/issue.js';
import type { IssueOrPullRequestState } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestMember, PullRequestProjection, PullRequestReviewer } from '@gitlens/git/models/pullRequest.js';
import { PullRequest, PullRequestReviewDecision, PullRequestReviewState } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { PullRequestEtagFields, PullRequestEtagInclude } from '../../models/integration.js';

export interface BitbucketRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export interface BitbucketWorkspaceDescriptor extends ResourceDescriptor {
	id: string;
	name: string;
	slug: string;
}

export type BitbucketPullRequestState = 'OPEN' | 'DECLINED' | 'MERGED' | 'SUPERSEDED';

interface BitbucketLink {
	href: string;
	name?: string;
}

// Bitbucket's `account` schema: a person (`user`) or an app/bot (`app_user`, e.g. a review bot on a PR).
// An `app_user` has no `links.html` and no `nickname`, and the schema requires none of the links.
interface BitbucketUser {
	type: 'user' | 'app_user';
	uuid: string;
	display_name: string;
	account_id?: string;
	nickname?: string;
	links?: {
		self?: BitbucketLink;
		avatar?: BitbucketLink;
		html?: BitbucketLink;
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

interface BitbucketCommitAuthor {
	type: 'author';
	raw: string;
	user: BitbucketUser;
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

// It parses a raw author sitring like "Sergei Shmakov GK <sergei.shmakov@gitkraken.com>" to name and email
const parseRawBitbucketAuthorRegex = /^(.*) <(.*)>$/;
export function parseRawBitbucketAuthor(raw: string): { name: string; email: string } {
	const match = raw.match(parseRawBitbucketAuthorRegex);
	if (match) {
		return { name: match[1], email: match[2] };
	}
	return { name: raw, email: '' };
}

export interface BitbucketCommit extends BitbucketBriefCommit {
	author: BitbucketCommitAuthor;
	date: string;
	links: {
		approve: BitbucketLink;
		comments: BitbucketLink;
		diff: BitbucketLink;
		html: BitbucketLink;
		self: BitbucketLink;
		statuses: BitbucketLink;
	};
	message: string;
	parents: BitbucketBriefCommit[];
	participants: BitbucketPullRequestParticipant[];
	rendered: {
		message: string;
	};
	repository: BitbucketRepository;
	summary: {
		type: 'rendered';
		raw: string;
		markup: string;
		html: string;
	};
}

interface BitbucketBriefCommit {
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
	draft?: boolean;
	merge_commit: null | BitbucketBriefCommit;
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
		commit: BitbucketBriefCommit;
		repository: BitbucketRepository;
	};
	source: {
		branch: BitbucketBranch;
		commit: BitbucketBriefCommit;
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
	votes?: number;
	content: {
		raw: string;
		markup: string;
		html: string;
	};
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

export function isClosedBitbucketIssueState(state: BitbucketIssueState): boolean {
	return bitbucketIssueStateToState(state) !== 'opened';
}

export function fromBitbucketUser(user: BitbucketUser): PullRequestMember {
	return {
		avatarUrl: user.links?.avatar?.href,
		name: user.display_name,
		username: user.nickname,
		url: user.links?.html?.href,
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
						: PullRequestReviewState.ReviewRequested,
	};
}

/**
 * The review decision a Bitbucket Cloud row carries, derived from its participants and reviewers. Reads only the
 * participants' `participated_on`, `approved` and `state` and whether there are reviewers, which is what the cheap etag
 * read selects for it.
 */
export function getBitbucketReviewDecision(pr: {
	participants?: readonly Pick<BitbucketPullRequestParticipant, 'approved' | 'state' | 'participated_on'>[];
	reviewers?: readonly unknown[];
}): PullRequestReviewDecision | undefined {
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

function fromBitbucketRepository(repo: BitbucketRepository): IssueRepository {
	return {
		owner: repo.full_name.split('/')[0],
		repo: repo.name,
		id: repo.uuid,
	};
}

export function fromBitbucketIssue(issue: BitbucketIssue, provider: Provider, projection?: IssueProjection): Issue {
	return new Issue(
		provider,
		issue.id.toString(),
		issue.id.toString(),
		issue.title,
		issue.links.html.href,
		new Date(issue.created_on),
		new Date(issue.updated_on),
		isClosedBitbucketIssueState(issue.state),
		bitbucketIssueStateToState(issue.state),
		fromBitbucketUser(issue.reporter),
		issue.assignee ? [fromBitbucketUser(issue.assignee)] : [],
		fromBitbucketRepository(issue.repository),
		undefined, // closedDate
		undefined, // labels
		undefined, // commentsCount
		issue.votes, // thumbsUpCount
		issue.content.html, // body
		!issue.repository?.project
			? undefined
			: {
					id: issue.repository.project.uuid,
					name: issue.repository.project.name,
					resourceId: issue.repository.project.uuid,
					resourceName: issue.repository.project.name,
				},
		undefined, // number
		undefined, // issueType
		undefined, // providerState
		undefined, // bodyFormat
		undefined, // iterations
		projection,
	);
}

export function fromBitbucketPullRequest(
	pr: BitbucketPullRequest,
	provider: Provider,
	options?: { currentAccount?: { id: string; username?: string }; projection?: PullRequestProjection },
): PullRequest {
	const author = fromBitbucketUser(pr.author);
	return new PullRequest(
		provider,
		author,
		pr.id.toString(),
		pr.id.toString(),
		pr.title,
		pr.links.html.href,
		fromBitbucketRepository(pr.destination.repository),
		bitbucketPullRequestStateToState(pr.state),
		new Date(pr.created_on),
		new Date(pr.updated_on),
		pr.closed_by ? new Date(pr.updated_on) : undefined,
		pr.state === 'MERGED' ? new Date(pr.updated_on) : undefined,
		undefined, // mergeableState: not read
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
		pr.draft,
		undefined, // additions
		undefined, // deletions
		undefined, // commentsCount
		undefined, // thumbsCount
		getBitbucketReviewDecision(pr),
		pr.participants // reviewRequests:PullRequestReviewer[]
			?.filter(prt => prt.role === 'REVIEWER')
			.map(prt => fromBitbucketParticipantToReviewer(prt, pr.closed_by, pr.state))
			.filter(rv => rv.state === PullRequestReviewState.ReviewRequested),
		pr.participants // latestReviews:PullRequestReviewer[]
			?.filter(prt => prt.participated_on != null)
			.map(prt => fromBitbucketParticipantToReviewer(prt, pr.closed_by, pr.state)),
		undefined, // assignees:PullRequestMember[] -- it looks like there is no such thing as assignees on Bitbucket
		undefined, // PullRequestStatusCheckRollupState
		undefined, // IssueProject
		undefined, // version
		undefined, // commitCount
		undefined, // stack
		undefined, // filesChanged
		pr.description ?? undefined,
		pr.id,
		options?.currentAccount != null ? author.id === options.currentAccount.id : undefined,
		options?.projection,
		options?.currentAccount,
	);
}

/** The most pull request ids one etag read asks for: Bitbucket Cloud's largest page of pull requests. */
export const bitbucketEtagFieldsMaxIds = 50;

/**
 * A pull request as the cheap etag read selects it (`BitbucketApi.getPullRequestsEtagFields`): only the fields
 * {@link fromBitbucketPullRequest} maps into a full row's etag inputs. `participants` and `reviewers` are selected
 * only for the `reviewDecision` include.
 */
export interface BitbucketPullRequestEtagNode {
	id: number;
	state: BitbucketPullRequestState;
	updated_on: string;
	draft?: boolean;
	source: { commit: { hash: string } };
	participants?: Pick<BitbucketPullRequestParticipant, 'approved' | 'state' | 'participated_on'>[];
	reviewers?: unknown[];
}

/**
 * A cheap etag read's pull request in the vocabulary {@link fromBitbucketPullRequest}'s row ends in, so both reads
 * compute the same etag. That row reads neither a mergeability nor a check rollup, so neither does this.
 */
export function toBitbucketPullRequestEtagFields(
	node: BitbucketPullRequestEtagNode,
	etagIncludes: readonly PullRequestEtagInclude[],
): PullRequestEtagFields {
	const fields: PullRequestEtagFields = {
		state: bitbucketPullRequestStateToState(node.state),
		isDraft: node.draft,
		updatedDate: new Date(node.updated_on),
		headSha: node.source.commit.hash,
	};

	if (etagIncludes.includes('reviewDecision')) {
		// The full read always has both lists, and the decision tells a missing list from an empty one, so a row
		// without them can't be compared: it rejects, and the full read answers instead.
		if (node.participants == null || node.reviewers == null) {
			throw new Error(`Bitbucket returned pull request ${node.id} without its participants or reviewers`);
		}

		fields.reviewDecision = getBitbucketReviewDecision(node);
	}

	return fields;
}
