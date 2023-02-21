import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import type { Subscription } from '../../../subscription';
import { IpcNotificationType } from '../../../webviews/protocol';

export type State = {
	isPlus: boolean;
	subscription: Subscription;
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	repos?: RepoWithRichProvider[];
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

export interface RepoWithRichProvider {
	repo: string;
	isGitHub: boolean;
	isConnected: boolean;
}

export interface DidChangeStateNotificationParams {
	state: State;
}

export const DidChangeStateNotificationType = new IpcNotificationType<DidChangeStateNotificationParams>(
	'focus/state/didChange',
	true,
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	isPlus: boolean;
}
export const DidChangeSubscriptionNotificationType = new IpcNotificationType<DidChangeSubscriptionParams>(
	'graph/subscription/didChange',
	true,
);
