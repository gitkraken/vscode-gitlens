import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import type { Subscription } from '../../../subscription';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

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
	isCurrentBranch: boolean;
	isCurrentWorktree: boolean;
	hasWorktree: boolean;
	hasLocalBranch: boolean;
}

export interface RepoWithRichProvider {
	repo: string;
	isGitHub: boolean;
	isConnected: boolean;
}

// Commands

export interface OpenWorktreeParams {
	pullRequest: PullRequestShape;
}

export const OpenWorktreeCommandType = new IpcCommandType<OpenWorktreeParams>('focus/pr/openWorktree');

export interface SwitchToBranchParams {
	pullRequest: PullRequestShape;
}

export const SwitchToBranchCommandType = new IpcCommandType<SwitchToBranchParams>('focus/pr/switchToBranch');

// Notifications

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
);
