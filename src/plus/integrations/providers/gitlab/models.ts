import { HostingIntegrationId } from '../../../../constants.integrations';
import type { PullRequestState } from '../../../../git/models/pullRequest';
import { PullRequest } from '../../../../git/models/pullRequest';
import type { PullRequestUrlIdentity } from '../../../../git/models/pullRequest.utils';
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

const prUrlRegex = /^(?:https?:\/\/)?(?:gitlab\.com\/)?(.+?)\/-\/merge_requests\/(\d+)/i;

export function isMaybeGitLabPullRequestUrl(url: string): boolean {
	return prUrlRegex.test(url);
}

export function getGitLabPullRequestIdentityFromMaybeUrl(url: string): RequireSome<PullRequestUrlIdentity, 'provider'> {
	if (url == null) return { prNumber: undefined, ownerAndRepo: undefined, provider: HostingIntegrationId.GitLab };

	const match = prUrlRegex.exec(url);
	if (match == null) return { prNumber: undefined, ownerAndRepo: undefined, provider: HostingIntegrationId.GitLab };

	return { prNumber: match[2], ownerAndRepo: match[1], provider: HostingIntegrationId.GitLab };
}
