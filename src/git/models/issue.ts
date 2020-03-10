'use strict';

export interface IssueOrPullRequest {
	type: 'Issue' | 'PullRequest';
	provider: string;
	id: number;
	date: Date;
	title: string;
	closed: boolean;
	closedDate?: Date;
}
