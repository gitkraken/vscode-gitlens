import type { FeatureAccess } from '../../../features';
import type { IssueShape } from '../../../git/models/issue';
import type { PullRequestShape } from '../../../git/models/pullRequest';
import type { IpcScope, WebviewState } from '../../../webviews/protocol';
import { IpcCommand, IpcNotification } from '../../../webviews/protocol';
import type { EnrichedItem } from '../../focus/enrichmentService';

export const scope: IpcScope = 'focus';

export interface State extends WebviewState {
	access: FeatureAccess;
	pullRequests?: PullRequestResult[];
	issues?: IssueResult[];
	repos?: RepoWithIntegration[];
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

export interface RepoWithIntegration {
	repo: string;
	isGitHub: boolean;
	isConnected: boolean;
}

// COMMANDS

export interface OpenWorktreeParams {
	pullRequest: PullRequestShape;
}
export const OpenWorktreeCommand = new IpcCommand<OpenWorktreeParams>(scope, 'pr/openWorktree');

export interface OpenBranchParams {
	pullRequest: PullRequestShape;
}
export const OpenBranchCommand = new IpcCommand<OpenBranchParams>(scope, 'pr/openBranch');

export interface SwitchToBranchParams {
	pullRequest: PullRequestShape;
}
export const SwitchToBranchCommand = new IpcCommand<SwitchToBranchParams>(scope, 'pr/switchToBranch');

export interface SnoozePrParams {
	pullRequest: PullRequestShape;
	expiresAt?: string;
	snooze?: string;
}
export const SnoozePRCommand = new IpcCommand<SnoozePrParams>(scope, 'pr/snooze');

export interface PinPrParams {
	pullRequest: PullRequestShape;
	pin?: string;
}
export const PinPRCommand = new IpcCommand<PinPrParams>(scope, 'pr/pin');

export interface SnoozeIssueParams {
	issue: IssueShape;
	expiresAt?: string;
	snooze?: string;
}
export const SnoozeIssueCommand = new IpcCommand<SnoozeIssueParams>(scope, 'issue/snooze');

export interface PinIssueParams {
	issue: IssueShape;
	pin?: string;
}
export const PinIssueCommand = new IpcCommand<PinIssueParams>(scope, 'issue/pin');

// NOTIFICATIONS

export interface DidChangeParams {
	state: State;
}
export const DidChangeNotification = new IpcNotification<DidChangeParams>(scope, 'didChange', true);
