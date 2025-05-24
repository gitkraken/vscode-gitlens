import type { PullRequestRefs, PullRequestState } from '../../../../git/models/pullRequest';
import { PullRequest, PullRequestMergeableState } from '../../../../git/models/pullRequest';
import type { Provider } from '../../../../git/models/remoteProvider';
import type { Integration } from '../../models/integration';
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
): PullRequest {
	return new PullRequest(
		provider,
		{
			id: pr.author?.id ?? '',
			name: pr.author?.name ?? 'Unknown',
			avatarUrl: pr.author?.avatar_url ?? '',
			url: pr.author?.web_url ?? '',
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

export function fromGitLabMergeRequest(pr: GitLabMergeRequestFull, provider: Provider): PullRequest {
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
			name: pr.author?.name ?? 'Unknown',
			avatarUrl: avatarUrl,
			url: pr.author?.webUrl ?? '',
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
		PullRequestMergeableState.Unknown,
		undefined, // viewerCanUpdate
		fromGitLabMergeRequestRefs(pr), // PullRequestRefs
	);
}

function fromGitLabMergeRequestRefs(pr: GitLabMergeRequestFull): PullRequestRefs | undefined {
	if (pr.sourceProject == null) {
		return undefined;
	}
	return {
		base: {
			owner: getRepoNamespace(pr.sourceProject.fullPath),
			branch: pr.sourceBranch,
			exists: true,
			url: pr.sourceProject.webUrl,
			repo: pr.sourceProject.fullPath,
			sha: pr.diffRefs?.baseSha || '',
		},
		head: {
			owner: getRepoNamespace(pr.project.fullPath),
			branch: pr.targetBranch,
			exists: true,
			url: pr.project.webUrl,
			repo: pr.project.fullPath,
			sha: pr.diffRefs?.headSha || '',
		},
		isCrossRepository: pr.sourceProject.id !== pr.project.id,
	};
}

function getRepoNamespace(projectFullPath: string) {
	return projectFullPath.split('/').slice(0, -1).join('/');
}
