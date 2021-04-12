import { IssueOrPullRequest, RichRemoteProvider } from '../git/git';
import { GitLabUser } from './author';

export interface GitLabIssue {
	id: number;
	iid: number;
	author: GitLabUser;
	description: string;
	assignees: GitLabUser[];
	assignee: GitLabUser;
	title: string;
	created_at: string;
	updated_at: string;
	closed_at: string;
	web_url: string;
	state: 'opened' | 'closed';
}

export namespace GitLabIssue {
	export function from(pr: GitLabIssue, provider: RichRemoteProvider): IssueOrPullRequest {
		return {
			type: 'Issue',
			provider: provider,
			id: pr.id,
			date: new Date(pr.created_at),
			title: pr.title,
			closed: pr.state === 'closed',
			closedDate: pr.closed_at == null ? undefined : new Date(pr.closed_at),
		};
	}
}
