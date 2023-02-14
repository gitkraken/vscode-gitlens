import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';

export type State = {
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	[key: string]: unknown;
};

export interface SearchResultBase {
	reasons: string[];
}

export interface IssueResult extends SearchResultBase {
	issue: IssueShape;
}

export interface PullRequestResult extends SearchResultBase {
	pullRequest: PullRequestShape;
}
