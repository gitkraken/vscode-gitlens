import type { PullRequestRefs, PullRequestState } from '../../../../git/models/pullRequest';
import { PullRequest, PullRequestMergeableState } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { Integration } from '../../integration';
import type { ProviderPullRequest } from '../models';
import { fromProviderPullRequest } from '../models';

export interface GitLabUser {
	id: number;
	name: string;
	username: string;
	publicEmail: string | undefined;
	state: string;
	avatarUrl: string | undefined;
	webUrl: string;
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
	detailed_merge_status: 'conflict' | 'mergeable' | string; // https://docs.gitlab.com/ee/api/merge_requests.html#merge-status
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
	references: {
		full: string;
		short: string;
	};
}

export function fromGitLabMergeRequestREST(
	pr: GitLabMergeRequestREST,
	provider: Provider,
	repo: { owner: string; repo: string },
): PullRequest {
	return new PullRequest(
		provider,
		{
			// author
			id: pr.author?.id ?? '',
			name: pr.author?.name ?? 'Unknown',
			avatarUrl: pr.author?.avatar_url ?? '',
			url: pr.author?.web_url ?? '',
		},
		String(pr.iid), // id
		String(pr.id), // nodeId
		pr.title,
		pr.web_url,
		{
			// IssueRepository
			owner: repo.owner,
			repo: repo.repo,
			url: pr.web_url.replace(/\/-\/merge_requests\/\d+$/, ''),
		},
		fromGitLabMergeRequestState(pr.state), // PullRequestState
		new Date(pr.created_at),
		new Date(pr.updated_at),
		pr.closed_at == null ? undefined : new Date(pr.closed_at),
		pr.merged_at == null ? undefined : new Date(pr.merged_at),
		pr.detailed_merge_status === 'mergeable'
			? PullRequestMergeableState.Mergeable
			: pr.detailed_merge_status === 'conflict'
			  ? PullRequestMergeableState.Conflicting
			  : PullRequestMergeableState.Unknown,
		undefined, // viewerCanUpdate
		fromGitLabMergeRequestRefs(pr, repo), // PullRequestRefs
	);
}

function fromGitLabMergeRequestRefs(
	pr: GitLabMergeRequestREST,
	repo: { owner: string; repo: string },
): PullRequestRefs {
	const repoUrl = pr.web_url.replace(/\/merge_requests\/\d+$/, '');
	return {
		base: {
			owner: repo.owner,
			branch: pr.target_branch,
			exists: true,
			url: `${repoUrl}/tree/${pr.target_branch}`,
			repo: repo.repo,
			sha: pr.diff_refs?.base_sha,
		},
		head: {
			owner: repo.owner,
			branch: pr.source_branch,
			exists: true,
			url: `${repoUrl}/tree/${pr.source_branch}`,
			repo: repo.repo,
			sha: pr.diff_refs?.head_sha,
		},
		isCrossRepository: pr.source_project_id !== pr.target_project_id,
	};
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

export function fromGitLabMergeRequestProvidersApi(pr: ProviderPullRequest, provider: Integration): PullRequest {
	const wrappedPr: ProviderPullRequest = {
		...pr,
		// @gitkraken/providers-api returns global ID as id, while allover GitLens we use internal ID (iid) that is returned as `number`:
		id: String(pr.number),
		// Substitute some defaults that are needed to enable PRs because @gitkraken/providers-api always returns null here:
		// Discussed: https://github.com/gitkraken/provider-apis-package-js/blob/6ee521eb6b46bbb759d9c68646979c3b25681d90/src/providers/gitlab/gitlab.ts#L597
		permissions: pr.permissions ?? {
			canMerge: true,
			canMergeAndBypassProtections: false,
		},
	};
	return fromProviderPullRequest(wrappedPr, provider);
}
