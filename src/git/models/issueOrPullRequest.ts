import type { ProviderReference } from './remoteProvider';

export interface IssueOrPullRequest {
	readonly type: IssueOrPullRequestType;
	readonly provider: ProviderReference;
	readonly id: string;
	readonly nodeId: string | undefined;
	readonly title: string;
	readonly url: string;
	readonly createdDate: Date;
	readonly updatedDate: Date;
	readonly closedDate?: Date;
	readonly closed: boolean;
	readonly state: IssueOrPullRequestState;
	readonly commentsCount?: number;
	readonly thumbsUpCount?: number;
}

export type IssueOrPullRequestType = 'issue' | 'pullrequest';
export type IssueOrPullRequestState = 'opened' | 'closed' | 'merged';
