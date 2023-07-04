import { PullRequest, PullRequestState } from '../git/git';
import { RichRemoteProvider } from '../git/remotes/provider';

export interface GitLabMergeRequest {
	id: number;
	iid: number;
	project_id: number;
	title: string;
	description: string;
	state: GitLabMergeRequestState;
	merged_at: string;
	closed_by: string | null;
	closed_at: string | null;
	created_at: string;
	updated_at: string;
	target_branch: string;
	source_branch: string;
	author: {
		id: number;
		name: string;
		username: string;
		state: string;
		avatar_url: string;
		web_url: string;
	};
	web_url: string;
}

export enum GitLabMergeRequestState {
	OPEN = 'open',
	CLOSED = 'closed',
	MERGED = 'merged',
	LOCKED = 'locked',
}

export namespace GitLabMergeRequest {
	export function from(pr: GitLabMergeRequest, provider: RichRemoteProvider): PullRequest {
		return new PullRequest(
			provider,
			{
				name: pr?.author.name,
				avatarUrl: pr?.author.avatar_url,
				url: pr?.author.web_url,
			},
			String(pr.iid),
			pr.title,
			pr.web_url,
			fromState(pr.state),
			new Date(pr.updated_at),
			pr.closed_at == null ? undefined : new Date(pr.closed_at),
			pr.merged_at == null ? undefined : new Date(pr.merged_at),
		);
	}

	export function fromState(state: GitLabMergeRequestState): PullRequestState {
		return state === GitLabMergeRequestState.MERGED
			? PullRequestState.Merged
			: state === GitLabMergeRequestState.CLOSED || state === GitLabMergeRequestState.LOCKED
			? PullRequestState.Closed
			: PullRequestState.Open;
	}

	export function toState(state: PullRequestState): GitLabMergeRequestState {
		return state === PullRequestState.Merged
			? GitLabMergeRequestState.MERGED
			: state === PullRequestState.Closed
			? GitLabMergeRequestState.CLOSED
			: GitLabMergeRequestState.OPEN;
	}
}
