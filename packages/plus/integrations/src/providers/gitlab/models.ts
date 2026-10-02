import type { GitBuildStatus } from '@gitkraken/provider-apis';
import type { PullRequestProjection, PullRequestRefs, PullRequestState } from '@gitlens/git/models/pullRequest.js';
import { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import type {
	Integration,
	IssueEtagFields,
	IssueEtagInclude,
	PullRequestEtagFields,
	PullRequestEtagInclude,
} from '../../models/integration.js';
import type { ProviderPullRequest } from '../models.js';
import {
	fromProviderPullRequest,
	fromProviderPullRequestMergeableState,
	fromProviderPullRequestState,
	GitBuildStatusState,
	GitPullRequestMergeableState,
	GitPullRequestReviewState,
	GitPullRequestState,
	toStatusCheckRollupState,
} from '../models.js';
import { decideProviderReviewDecision, fromPullRequestReviewDecision } from '../pullRequestReviews.js';

export interface GitLabUser {
	id: number;
	name: string;
	username: string;
	publicEmail: string | undefined;
	state: string;
	avatarUrl: string | undefined;
	webUrl: string;
}

/** A user's SSH key as returned by `GET /users/:id/keys`. */
export interface GitLabSshKey {
	id: number;
	title: string;
	key: string;
	created_at: string;
	expires_at: string | null;
	/** Whether the key can be used for authentication, signing, or both. */
	usage_type: 'auth' | 'signing' | 'auth_and_signing';
}

export interface GitLabCommit {
	id: string;
	short_id: string;
	created_at: Date;
	parent_ids: string[];
	title: string;
	message: string;
	author_name: string;
	author_email: string;
	authored_date: Date;
	committer_name: string;
	committer_email: string;
	committed_date: Date;
	status: string;
	project_id: number;
}

export interface GitLabIssue {
	iid: string;
	author: {
		name: string;
		avatarUrl: string | null;
		webUrl: string;
	} | null;
	title: string;
	description: string;
	createdAt: string;
	updatedAt: string;
	closedAt: string;
	webUrl: string;
	state: 'opened' | 'closed' | 'locked';
}

export interface GitLabMergeRequest {
	iid: string;
	author: {
		id: string;
		name: string;
		avatarUrl: string | null;
		webUrl: string;
	} | null;
	title: string;
	description: string | null;
	state: GitLabMergeRequestState;
	createdAt: string;
	updatedAt: string;
	mergedAt: string | null;
	webUrl: string;
}

export interface GitLabRepositoryStub {
	id: string;
	fullPath: string;
	webUrl: string;
}

export interface GitLabMergeRequestFull extends GitLabMergeRequest {
	id: string;
	targetBranch: string;
	sourceBranch: string;
	diffRefs: {
		baseSha: string | null;
		headSha: string;
	} | null;
	project: GitLabRepositoryStub;
	sourceProject: GitLabRepositoryStub | null;
}

export type GitLabMergeRequestState = 'opened' | 'closed' | 'locked' | 'merged';

export function fromGitLabMergeRequestState(state: GitLabMergeRequestState): PullRequestState {
	return state === 'locked' ? 'closed' : state;
}

export function toGitLabMergeRequestState(state: PullRequestState): GitLabMergeRequestState {
	return state;
}

export interface GitLabMergeRequestREST {
	id: number;
	iid: number;
	author: {
		id: string;
		name: string;
		avatar_url?: string;
		web_url: string;
	} | null;
	title: string;
	description: string;
	state: GitLabMergeRequestState;
	created_at: string;
	updated_at: string;
	closed_at: string | null;
	merged_at: string | null;
	diff_refs: {
		base_sha: string;
		head_sha: string;
		start_sha: string;
	};
	source_branch: string;
	source_project_id: number;
	target_branch: string;
	target_project_id: number;
	web_url: string;
}

export function fromGitLabMergeRequestREST(
	pr: GitLabMergeRequestREST,
	provider: Provider,
	repo: { owner: string; repo: string },
	projection?: PullRequestProjection,
): PullRequest {
	return new PullRequest(
		provider,
		{
			id: pr.author?.id ?? '',
			// An absent author stays absent — no invented `'Unknown'` name, no `''` url/avatar. See
			// `PullRequestMember.name`.
			name: pr.author?.name ?? undefined,
			avatarUrl: pr.author?.avatar_url ?? undefined,
			url: pr.author?.web_url ?? undefined,
		},
		String(pr.iid),
		undefined,
		pr.title,
		pr.web_url,
		repo,
		fromGitLabMergeRequestState(pr.state),
		new Date(pr.created_at),
		new Date(pr.updated_at),
		pr.closed_at == null ? undefined : new Date(pr.closed_at),
		pr.merged_at == null ? undefined : new Date(pr.merged_at),
		undefined, // mergeableState
		undefined, // viewerCanUpdate
		undefined, // refs
		undefined, // isDraft
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
		undefined, // stack
		undefined, // filesChanged
		undefined, // body
		undefined, // number
		undefined, // authoredByMe
		projection,
	);
}

export interface GitLabProjectREST {
	namespace: {
		path: string;
		full_path: string;
	};
	path: string;

	forked_from_project?: {
		namespace: {
			path: string;
			full_path: string;
		};
		path: string;
	};
}

export function fromGitLabMergeRequestProvidersApi(
	pr: ProviderPullRequest,
	provider: Integration,
	projection?: PullRequestProjection,
): PullRequest {
	const wrappedPr: ProviderPullRequest = {
		...pr,
		// @gitkraken/providers-api returns global ID as id, while allover GitLens we use internal ID (iid) that is returned as `number`:
		id: String(pr.number),
	};
	return fromProviderPullRequest(wrappedPr, provider, { projection: projection });
}

export function fromGitLabMergeRequest(
	pr: GitLabMergeRequestFull,
	provider: Provider,
	projection?: PullRequestProjection,
): PullRequest {
	let avatarUrl: string | undefined;
	try {
		avatarUrl = new URL(pr.author?.avatarUrl ?? '').toString();
	} catch {
		try {
			const authorUrl = new URL(pr.author?.webUrl ?? '');
			authorUrl.pathname = '';
			authorUrl.search = '';
			authorUrl.hash = '';
			avatarUrl = pr.author?.avatarUrl ? authorUrl.toString() + pr.author?.avatarUrl : undefined;
		} catch {
			avatarUrl = undefined;
		}
	}
	const [owner, repo] = pr.project.fullPath.split('/');

	return new PullRequest(
		provider,
		{
			// author
			id: pr.author?.id ?? '',
			// An absent author stays absent — no invented `'Unknown'` name, no `''` url. See `PullRequestMember.name`.
			name: pr.author?.name ?? undefined,
			avatarUrl: avatarUrl,
			url: pr.author?.webUrl ?? undefined,
		},
		pr.iid, // id
		pr.id, // nodeId
		pr.title,
		pr.webUrl || '',
		{
			// IssueRepository
			owner: owner,
			repo: repo,
			url: pr.project.webUrl,
		},
		fromGitLabMergeRequestState(pr.state), // PullRequestState
		new Date(pr.createdAt),
		new Date(pr.updatedAt),
		// TODO@eamodio this isn't right, but GitLab doesn't seem to provide a closedAt on merge requests in GraphQL
		pr.state !== 'closed' ? undefined : new Date(pr.updatedAt),
		pr.mergedAt == null ? undefined : new Date(pr.mergedAt),
		undefined, // mergeableState: not selected
		undefined, // viewerCanUpdate
		fromGitLabMergeRequestRefs(pr), // PullRequestRefs
		undefined, // isDraft
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
		undefined, // stack
		undefined, // filesChanged
		undefined, // body
		undefined, // number
		undefined, // authoredByMe
		projection,
	);
}

function fromGitLabMergeRequestRefs(pr: GitLabMergeRequestFull): PullRequestRefs | undefined {
	if (pr.sourceProject == null) {
		return undefined;
	}
	// GitLab terminology: sourceBranch = branch with changes (head), targetBranch = merge target (base)
	return {
		head: {
			owner: getRepoNamespace(pr.sourceProject.fullPath),
			branch: pr.sourceBranch,
			exists: true,
			url: pr.sourceProject.webUrl,
			repo: pr.sourceProject.fullPath,
			sha: pr.diffRefs?.headSha || '',
		},
		base: {
			owner: getRepoNamespace(pr.project.fullPath),
			branch: pr.targetBranch,
			exists: true,
			url: pr.project.webUrl,
			repo: pr.project.fullPath,
			sha: pr.diffRefs?.baseSha || '',
		},
		isCrossRepository: pr.sourceProject.id !== pr.project.id,
	};
}

export function getRepoNamespace(projectFullPath: string): string {
	return projectFullPath.split('/').slice(0, -1).join('/');
}

/** The most iids one etag read asks for: GitLab's GraphQL page size limit, so every iid's answer fits one page. */
export const gitLabEtagFieldsMaxIids = 100;

/**
 * The most iids one etag read asks for when it selects the check rollup. GitLab resolves every job of each head
 * pipeline server-side, one merge request after another within a request, so a large request is far slower than a
 * few small ones run concurrently, and slower than the full read it replaces.
 */
export const gitLabEtagFieldsWithChecksMaxIids = 10;

/**
 * A merge request as the cheap etag read selects it (`GitLabApi.getMergeRequestsEtagFields`): only the fields
 * provider-apis' `getPullRequestForRepo` maps into a full row's etag inputs. Each include's field is present only
 * when that include was requested.
 */
export interface GitLabMergeRequestEtagNode {
	iid: string;
	state: string;
	draft: boolean;
	updatedAt: string;
	diffRefs: { headSha: string | null } | null;
	mergeStatusEnum?: string | null;
	reviewers?: {
		nodes: { mergeRequestInteraction: { reviewState: string | null } | null }[] | null;
	} | null;
	headPipeline?: {
		stages: {
			nodes: { jobs: { nodes: { status: string | null; allowFailure: boolean }[] | null } | null }[] | null;
		} | null;
	} | null;
}

/**
 * An issue as the cheap etag read selects it (`GitLabApi.getIssuesEtagFields`). `upvotes` is present only when the
 * `reactions` include was requested.
 */
export interface GitLabIssueEtagNode {
	iid: string;
	closedAt: string | null;
	updatedAt: string;
	upvotes?: number | null;
}

type ProviderPullRequestState = Parameters<typeof fromProviderPullRequestState>[0];
type ProviderMergeableState = keyof typeof fromProviderPullRequestMergeableState;
type ProviderReviewState = keyof typeof fromPullRequestReviewDecision;
type ProviderBuildStatusState = NonNullable<GitBuildStatus['state']>;

// The tables below mirror provider-apis' (0.61.0) GitLab merge request mapping behind `getPullRequestForRepo` (`rs`
// and its helpers in the bundle), which it doesn't export. A full batch row takes these values on through
// `fromProviderPullRequest`, so the cheap check composes the same steps to compute the same etag.

/** provider-apis' merge request `state` map (`Oa`). It has no `locked`, which therefore maps to `undefined`. */
const gitLabMergeRequestProviderStates: Partial<Record<string, ProviderPullRequestState>> = {
	opened: GitPullRequestState.Open,
	merged: GitPullRequestState.Merged,
	closed: GitPullRequestState.Closed,
};

/** provider-apis' `mergeStatusEnum` map (`va`). */
const gitLabMergeStatusProviderStates: Partial<Record<string, ProviderMergeableState>> = {
	CAN_BE_MERGED: GitPullRequestMergeableState.Mergeable,
	CANNOT_BE_MERGED: GitPullRequestMergeableState.Conflicts,
	CANNOT_BE_MERGED_RECHECK: GitPullRequestMergeableState.Unknown,
	UNCHECKED: GitPullRequestMergeableState.Unknown,
	CHECKING: GitPullRequestMergeableState.Unknown,
};

/** provider-apis' reviewer `reviewState` map (`ja`); a reviewer without one reads as review requested. */
const gitLabReviewProviderStates: Partial<Record<string, ProviderReviewState>> = {
	APPROVED: GitPullRequestReviewState.Approved,
	REQUESTED_CHANGES: GitPullRequestReviewState.ChangesRequested,
	REVIEWED: GitPullRequestReviewState.Commented,
	UNAPPROVED: GitPullRequestReviewState.ReviewRequested,
	UNREVIEWED: GitPullRequestReviewState.ReviewRequested,
};

/** provider-apis' CI job `status` map (`Ba`); a failed job that may fail reads as a warning. */
const gitLabJobProviderStates: Partial<Record<string, ProviderBuildStatusState>> = {
	CANCELED: GitBuildStatusState.Cancelled,
	CREATED: GitBuildStatusState.Pending,
	FAILED: GitBuildStatusState.Failed,
	MANUAL: GitBuildStatusState.OptionalActionRequired,
	PENDING: GitBuildStatusState.Pending,
	PREPARING: GitBuildStatusState.Running,
	RUNNING: GitBuildStatusState.Running,
	SCHEDULED: GitBuildStatusState.Pending,
	SKIPPED: GitBuildStatusState.Skipped,
	SUCCESS: GitBuildStatusState.Success,
	WAITING_FOR_CALLBACK: GitBuildStatusState.Pending,
	WAITING_FOR_RESOURCE: GitBuildStatusState.Pending,
};

function toGitLabJobBuildStatus(job: { status: string | null; allowFailure: boolean }): GitBuildStatus {
	const state = !job.status
		? null
		: job.status === 'FAILED' && job.allowFailure
			? GitBuildStatusState.Warning
			: (gitLabJobProviderStates[job.status] ?? null);
	// The rollup reads only `state`.
	return { completedAt: null, description: null, name: null, state: state, stage: null, startedAt: null, url: '' };
}

/**
 * A cheap etag read's merge request, as the fields its full batch row's etag reads: provider-apis' mapping (see the
 * tables above), then `fromProviderPullRequest`'s. Neither step is the identity everywhere — a locked merge request
 * reads as merged, a missing head SHA as `''` — so each value takes both rather than a mapping of its own.
 */
export function toGitLabPullRequestEtagFields(
	node: GitLabMergeRequestEtagNode,
	etagIncludes: readonly PullRequestEtagInclude[],
): PullRequestEtagFields {
	const fields: PullRequestEtagFields = {
		// A locked merge request passes `undefined` here, as its full row does.
		state: fromProviderPullRequestState(gitLabMergeRequestProviderStates[node.state] as ProviderPullRequestState),
		isDraft: node.draft,
		updatedDate: new Date(node.updatedAt),
		headSha: node.diffRefs?.headSha ?? '',
	};

	if (etagIncludes.includes('mergeable')) {
		const mergeable =
			node.mergeStatusEnum != null ? gitLabMergeStatusProviderStates[node.mergeStatusEnum] : undefined;
		fields.mergeableState = mergeable ? fromProviderPullRequestMergeableState[mergeable] : undefined;
	}

	if (etagIncludes.includes('reviewDecision')) {
		// A review state provider-apis doesn't know maps to `undefined`, which never outranks the decision so far.
		const decision = decideProviderReviewDecision(
			node.reviewers?.nodes?.map(r =>
				r.mergeRequestInteraction?.reviewState
					? gitLabReviewProviderStates[r.mergeRequestInteraction.reviewState]
					: GitPullRequestReviewState.ReviewRequested,
			),
		);
		fields.reviewDecision = decision ? fromPullRequestReviewDecision[decision] : undefined;
	}

	if (etagIncludes.includes('checks')) {
		const statuses =
			node.headPipeline?.stages?.nodes?.flatMap(stage => stage.jobs?.nodes?.map(toGitLabJobBuildStatus) ?? []) ??
			[];
		fields.statusCheckRollupState = toStatusCheckRollupState(statuses);
	}

	return fields;
}

/**
 * A cheap etag read's issue, as the fields its full batch row's etag reads. provider-apis maps a GitLab issue's
 * state to a name without a category, so `toIssueShape` decides `closed` from `closedAt` alone (`closedDate`, which
 * provider-apis sets only for a truthy `closedAt`); GitLab's own `state` never counts. The thumbs-up count is
 * provider-apis' `upvoteCount: upvotes`, which `toIssueShape` reads with `?? undefined`.
 */
export function toGitLabIssueEtagFields(
	node: GitLabIssueEtagNode,
	etagIncludes: readonly IssueEtagInclude[],
): IssueEtagFields {
	const fields: IssueEtagFields = {
		state: node.closedAt ? 'closed' : 'opened',
		updatedDate: new Date(node.updatedAt),
	};

	if (etagIncludes.includes('reactions')) {
		fields.thumbsUpCount = node.upvotes ?? undefined;
	}

	return fields;
}
