import type { IntegrationDescriptor } from '../../constants.integrations';
import type { Source } from '../../constants.telemetry';
import type { GitBranchMergedStatus } from '../../git/gitProvider';
import type { GitBranchStatus, GitTrackingState, GitTrackingUpstream } from '../../git/models/branch';
import type { GitDiffFileStats } from '../../git/models/diff';
import type { Issue } from '../../git/models/issue';
import type { MergeConflict } from '../../git/models/mergeConflict';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import type { GitBranchReference } from '../../git/models/reference';
import type { RepositoryShape } from '../../git/models/repositoryShape';
import type { RemoteProviderSupportedFeatures } from '../../git/remotes/remoteProvider';
import type { AIModel } from '../../plus/ai/models/model';
import type { Subscription } from '../../plus/gk/models/subscription';
import type { LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator';
import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider';
import type { LaunchpadGroup } from '../../plus/launchpad/models/launchpad';
import type { OpenWorkspaceLocation } from '../../system/-webview/vscode/workspaces';
import type { IpcScope, WebviewState } from '../protocol';
import { IpcCommand, IpcNotification, IpcRequest } from '../protocol';

export const scope: IpcScope = 'home';

export interface State extends WebviewState {
	discovering: boolean;
	repositories: DidChangeRepositoriesParams;
	webroot?: string;
	subscription: Subscription;
	orgSettings: {
		drafts: boolean;
		ai: boolean;
	};
	aiEnabled: boolean;
	experimentalComposerEnabled: boolean;
	previewCollapsed: boolean;
	integrationBannerCollapsed: boolean;
	aiAllAccessBannerCollapsed: boolean;
	hasAnyIntegrationConnected: boolean;
	integrations: IntegrationState[];
	ai: { model: AIModel | undefined };
	avatar?: string;
	organizationsCount?: number;
	walkthroughSupported: boolean;
	walkthroughProgress?: {
		doneCount: number;
		allCount: number;
		progress: number;
	};
	previewEnabled: boolean;
	newInstall: boolean;
	amaBannerCollapsed: boolean;
}

export interface IntegrationState extends IntegrationDescriptor {
	connected: boolean;
}

export type OverviewRecentThreshold = 'OneDay' | 'OneWeek' | 'OneMonth';
export type OverviewStaleThreshold = 'OneYear';

export interface OverviewFilters {
	recent: {
		threshold: OverviewRecentThreshold;
	};
	stale: { threshold: OverviewStaleThreshold; show: boolean; limit: number };
}

// REQUESTS

export interface GetLaunchpadSummaryRequest {
	[key: string]: unknown;
}
export type GetLaunchpadSummaryResponse = LaunchpadSummaryResult | { error: Error } | undefined;
export const GetLaunchpadSummary = new IpcRequest<GetLaunchpadSummaryRequest, GetLaunchpadSummaryResponse>(
	scope,
	'launchpad/summary',
);

export interface GetOverviewBranch {
	reference: GitBranchReference;

	repoPath: string;
	id: string;
	name: string;
	opened: boolean;
	timestamp?: number;
	status: GitBranchStatus;
	upstream: GitTrackingUpstream | undefined;

	remote?: Promise<
		| {
				name: string;

				provider?: {
					name: string;
					icon?: string;
					url?: string;
					supportedFeatures: RemoteProviderSupportedFeatures;
				};
		  }
		| undefined
	>;

	wip?: Promise<
		| {
				workingTreeState?: GitDiffFileStats;
				hasConflicts?: boolean;
				conflictsCount?: number;
				pausedOpStatus?: GitPausedOperationStatus;
		  }
		| undefined
	>;

	mergeTarget?: Promise<
		| {
				repoPath: string;
				id: string;
				name: string;
				status?: GitTrackingState;
				mergedStatus?: GitBranchMergedStatus;
				potentialConflicts?: MergeConflict;

				targetBranch: string | undefined;
				baseBranch: string | undefined;
				defaultBranch: string | undefined;
		  }
		| undefined
	>;

	contributors?: Promise<
		{
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
		}[]
	>;

	pr?: Promise<
		| {
				id: string;
				title: string;
				state: string;
				url: string;
				draft?: boolean;

				launchpad?: Promise<
					| {
							uuid: string;
							category: LaunchpadItem['actionableCategory'];
							groups: LaunchpadGroup[];
							suggestedActions: LaunchpadItem['suggestedActions'];

							failingCI: boolean;
							hasConflicts: boolean;

							author: LaunchpadItem['author'];
							createdDate: LaunchpadItem['createdDate'];

							review: {
								decision: LaunchpadItem['reviewDecision'];
								reviews: NonNullable<LaunchpadItem['reviews']>;

								counts: {
									approval: number;
									changeRequest: number;
									comment: number;
									codeSuggest: number;
								};
							};

							viewer: LaunchpadItem['viewer'];
					  }
					| undefined
				>;
		  }
		| undefined
	>;

	autolinks?: Promise<
		{
			id: string;
			title: string;
			url: string;
			state: Omit<Issue['state'], 'merged'>;
		}[]
	>;

	issues?: Promise<
		{
			id: string;
			title: string;
			url: string;
			state: Omit<Issue['state'], 'merged'>;
		}[]
	>;

	worktree?: {
		name: string;
		uri: string;
		isDefault: boolean;
	};
}

export type OverviewRepository = RepositoryShape;

// TODO: look at splitting off selected repo
export type GetActiveOverviewResponse =
	| {
			repository: OverviewRepository;
			active: GetOverviewBranch;
	  }
	| undefined;

export const GetActiveOverview = new IpcRequest<undefined, GetActiveOverviewResponse>(scope, 'overview/active');

// TODO: look at splitting off selected repo
export type GetInactiveOverviewResponse =
	| {
			repository: OverviewRepository;
			recent: GetOverviewBranch[];
			stale?: GetOverviewBranch[];
	  }
	| undefined;

export const GetInactiveOverview = new IpcRequest<undefined, GetInactiveOverviewResponse>(scope, 'overview/inactive');

export type GetOverviewFilterStateResponse = OverviewFilters;
export const GetOverviewFilterState = new IpcRequest<void, GetOverviewFilterStateResponse>(scope, 'overviewFilter');

export const ChangeOverviewRepositoryCommand = new IpcCommand<undefined>(scope, 'overview/repository/change');
export const DidChangeOverviewRepository = new IpcNotification<undefined>(scope, 'overview/repository/didChange');

// COMMANDS

export const TogglePreviewEnabledCommand = new IpcCommand<void>(scope, 'previewEnabled/toggle');

export interface CollapseSectionParams {
	section: string;
	collapsed: boolean;
}
export const CollapseSectionCommand = new IpcCommand<CollapseSectionParams>(scope, 'section/collapse');

export const DismissWalkthroughSection = new IpcCommand<void>(scope, 'walkthrough/dismiss');

export const DidChangeAiAllAccessBanner = new IpcNotification<boolean>(scope, 'ai/allAccess/didChange');
export const DismissAiAllAccessBannerCommand = new IpcCommand<void>(scope, 'ai/allAccess/dismiss');

export const SetOverviewFilter = new IpcCommand<OverviewFilters>(scope, 'overview/filter/set');

export type OpenInGraphParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;
export const OpenInGraphCommand = new IpcCommand<OpenInGraphParams>(scope, 'openInGraph');

export type OpenInTimelineParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;

// NOTIFICATIONS

export interface DidCompleteDiscoveringRepositoriesParams {
	discovering: boolean;
	repositories: DidChangeRepositoriesParams;
}

export const DidCompleteDiscoveringRepositories = new IpcNotification<DidCompleteDiscoveringRepositoriesParams>(
	scope,
	'repositories/didCompleteDiscovering',
);

export interface DidChangePreviewEnabledParams {
	previewEnabled: boolean;
	previewCollapsed: boolean;
	aiEnabled: boolean;
	experimentalComposerEnabled: boolean;
}
export const DidChangePreviewEnabled = new IpcNotification<DidChangePreviewEnabledParams>(
	scope,
	'previewEnabled/didChange',
);

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
	integrations: IntegrationState[];
	ai: { model: AIModel | undefined };
}
export const DidChangeIntegrationsConnections = new IpcNotification<DidChangeIntegrationsParams>(
	scope,
	'integrations/didChange',
);

export const DidChangeLaunchpad = new IpcNotification<undefined>(scope, 'launchpad/didChange');

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

export interface DidChangeOwnerFilterParams {
	filter: OverviewFilters;
}
export const DidChangeOverviewFilter = new IpcNotification<DidChangeOwnerFilterParams>(
	scope,
	'home/ownerFilter/didChange',
);

export const DidFocusAccount = new IpcNotification<undefined>(scope, 'account/didFocus');

export interface BranchRef {
	repoPath: string;
	branchId: string;
	branchName: string;
	branchUpstreamName?: string;
	worktree?: {
		name: string;
		isDefault: boolean;
	};
}

export interface OpenWorktreeCommandArgs extends BranchRef {
	location?: OpenWorkspaceLocation;
}

export interface BranchAndTargetRefs extends BranchRef {
	mergeTargetId: string;
	mergeTargetName: string;
}

export interface CreatePullRequestCommandArgs {
	ref: BranchRef;
	describeWithAI?: boolean;
	source?: Source;
}
