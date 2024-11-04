import type { GitBranchStatus, GitTrackingState } from '../../git/models/branch';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../protocol';

export const scope: IpcScope = 'home';

export interface State extends WebviewState {
	repositories: DidChangeRepositoriesParams;
	webroot?: string;
	subscription: Subscription;
	orgSettings: {
		drafts: boolean;
	};
	walkthroughCollapsed: boolean;
	integrationBannerCollapsed: boolean;
	hasAnyIntegrationConnected: boolean;
	avatar?: string;
	organizationsCount?: number;
	walkthroughProgress: {
		doneCount: number;
		allCount: number;
		progress: number;
	};
	showWalkthroughProgress?: boolean;
	previewEnabled?: boolean;
}

// REQUESTS

export interface GetLaunchpadSummaryRequest {
	[key: string]: unknown;
}
export type GetLaunchpadSummaryResponse = LaunchpadSummaryResult | undefined;
export const GetLaunchpadSummary = new IpcRequest<GetLaunchpadSummaryRequest, GetLaunchpadSummaryResponse>(
	scope,
	'launchpad/summary',
);

export interface GetOverviewRequest {
	[key: string]: unknown;
}

export interface GetOverviewBranch {
	id: string;
	name: string;
	opened: boolean;
	timestamp?: number;
	state: GitTrackingState;
	workingTreeState?: {
		added: number;
		changed: number;
		deleted: number;
	};
	status: GitBranchStatus;
	upstream: { name: string; missing: boolean } | undefined;

	owner?: {
		name: string;
		email: string;
		avatarUrl: string;
		current: boolean;
		timestamp?: number;
		count: number;
		stats?: {
			files: number;
			additions: number;
			deletions: number;
		};
	};
	contributors?: {
		name: string;
		email: string;
		avatarUrl: string;
		current: boolean;
		timestamp?: number;
		count: number;
		stats?: {
			files: number;
			additions: number;
			deletions: number;
		};
	}[];
	pr?: {
		id: string;
		title: string;
		state: string;
		url: string;
	};
	worktree?: {
		name: string;
		uri: string;
	};
}
export interface GetOverviewBranches {
	active: GetOverviewBranch[];
	recent: GetOverviewBranch[];
	stale: GetOverviewBranch[];
}

export type GetOverviewResponse =
	| {
			repository: {
				name: string;
				branches: GetOverviewBranches;
			};
	  }
	| undefined;
export const GetOverview = new IpcRequest<GetOverviewRequest, GetOverviewResponse>(scope, 'overview');

// COMMANDS

export interface CollapseSectionParams {
	section: string;
	collapsed: boolean;
}
export const CollapseSectionCommand = new IpcCommand<CollapseSectionParams>(scope, 'section/collapse');

export const DismissWalkthroughSection = new IpcCommand<void>(scope, 'walkthrough/dismiss');

// NOTIFICATIONS

export const DidChangePreviewEnabled = new IpcNotification<boolean>(scope, 'previewEnabled/didChange');

export const DidChangeRepositoryWip = new IpcNotification<undefined>(scope, 'repository/wip/didChange');

export interface DidChangeRepositoriesParams {
	count: number;
	openCount: number;
	hasUnsafe: boolean;
	trusted: boolean;
}
export const DidChangeRepositories = new IpcNotification<DidChangeRepositoriesParams>(scope, 'repositories/didChange');

export interface DidChangeProgressParams {
	progress: number;
	doneCount: number;
	allCount: number;
}
export const DidChangeWalkthroughProgress = new IpcNotification<DidChangeProgressParams>(
	scope,
	'walkthroughProgress/didChange',
);

export interface DidChangeIntegrationsParams {
	hasAnyIntegrationConnected: boolean;
}
export const DidChangeIntegrationsConnections = new IpcNotification<DidChangeIntegrationsParams>(
	scope,
	'integrations/didChange',
);

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar: string;
	organizationsCount: number;
}
export const DidChangeSubscription = new IpcNotification<DidChangeSubscriptionParams>(scope, 'subscription/didChange');

export interface DidChangeOrgSettingsParams {
	orgSettings: State['orgSettings'];
}
export const DidChangeOrgSettings = new IpcNotification<DidChangeOrgSettingsParams>(scope, 'org/settings/didChange');

export const DidFocusAccount = new IpcNotification<undefined>(scope, 'account/didFocus');
