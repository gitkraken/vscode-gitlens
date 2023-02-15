import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import { IpcNotificationType } from '../../../webviews/protocol';

export type State = {
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	repos?: IssueResult[];
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

export interface DidChangeStateNotificationParams {
	state: State;
}

export const DidChangeStateNotificationType = new IpcNotificationType<DidChangeStateNotificationParams>(
	'focus/state/didChange',
	true,
);
