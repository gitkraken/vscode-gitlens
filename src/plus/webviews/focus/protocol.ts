import type { WebviewIds, WebviewViewIds } from '../../../constants';
import type { FeatureAccess } from '../../../features';
import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';

export interface State {
	webviewId: WebviewIds | WebviewViewIds;
	timestamp: number;

	access: FeatureAccess;
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	repos?: RepoWithRichProvider[];
}

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

export interface OpenBranchParams {
	pullRequest: PullRequestShape;
}
export const OpenBranchCommandType = new IpcCommandType<OpenBranchParams>('focus/pr/openBranch');

export interface SwitchToBranchParams {
	pullRequest: PullRequestShape;
}
export const SwitchToBranchCommandType = new IpcCommandType<SwitchToBranchParams>('focus/pr/switchToBranch');

// Notifications

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('focus/didChange', true);
