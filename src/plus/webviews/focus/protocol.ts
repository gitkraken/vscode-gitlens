import type { FeatureAccess } from '../../../features';
import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import type { WebviewState } from '../../../webviews/protocol';
import { IpcCommandType, IpcNotificationType } from '../../../webviews/protocol';
import type { EnrichedItem } from '../../focus/focusService';

export interface State extends WebviewState {
	access: FeatureAccess;
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	repos?: RepoWithRichProvider[];
}

export interface SearchResultBase {
	reasons: string[];
	rank?: number;
	enriched?: EnrichedItemSummary[];
}

export interface EnrichedItemSummary {
	id: EnrichedItem['id'];
	type: EnrichedItem['type'];
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

export interface SnoozePrParams {
	pullRequest: PullRequestShape;
	snooze?: string;
}
export const SnoozePrCommandType = new IpcCommandType<SnoozePrParams>('focus/pr/snooze');

export interface PinPrParams {
	pullRequest: PullRequestShape;
	pin?: string;
}
export const PinPrCommandType = new IpcCommandType<PinPrParams>('focus/pr/pin');

export interface SnoozeIssueParams {
	issue: IssueShape;
	snooze?: string;
}
export const SnoozeIssueCommandType = new IpcCommandType<SnoozeIssueParams>('focus/issue/snooze');

export interface PinIssueParams {
	issue: IssueShape;
	pin?: string;
}
export const PinIssueCommandType = new IpcCommandType<PinIssueParams>('focus/issue/pin');

// Notifications

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotificationType = new IpcNotificationType<DidChangeParams>('focus/didChange', true);
