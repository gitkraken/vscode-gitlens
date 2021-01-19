'use strict';
import { RemoteProviderReference } from './remoteProvider';

export interface IssueOrPullRequest {
	type: 'Issue' | 'PullRequest';
	provider: RemoteProviderReference;
	id: number;
	date: Date;
	title: string;
	closed: boolean;
	closedDate?: Date;
}
