import type { IntegrationDescriptor } from '../../constants.integrations.js';
import type { Source } from '../../constants.telemetry.js';
import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { GitBranchMergedStatus } from '../../git/gitProvider.js';
import type { GitBranchStatus, GitTrackingState, GitTrackingUpstream } from '../../git/models/branch.js';
import type { GitDiffFileStats } from '../../git/models/diff.js';
import type { Issue } from '../../git/models/issue.js';
import type { ConflictDetectionResult } from '../../git/models/mergeConflicts.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import type { GitBranchReference } from '../../git/models/reference.js';
import type { RepositoryShape } from '../../git/models/repositoryShape.js';
import type { RemoteProviderSupportedFeatures } from '../../git/remotes/remoteProvider.js';
import type { AIModel } from '../../plus/ai/models/model.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator.js';
import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider.js';
import type { LaunchpadGroup } from '../../plus/launchpad/models/launchpad.js';
import type { OpenWorkspaceLocation } from '../../system/-webview/vscode/workspaces.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcNotification } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'home';

// ============================================================
// Bootstrap State (used by includeBootstrap / legacy getState)
// ============================================================

export interface State extends WebviewState<'gitlens.views.home'> {
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
	integrationBannerCollapsed: boolean;
	aiAllAccessBannerCollapsed: boolean;
	mcpBannerCollapsed: boolean;
	mcpCanAutoRegister: boolean;
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
		state: Record<WalkthroughContextKeys, boolean>;
	};
	previewEnabled: boolean;
	newInstall: boolean;
	amaBannerCollapsed: boolean;
	hostAppName: string;
}

export interface SubscriptionState {
	subscription: Subscription;
	avatar: string;
	organizationsCount: number;
}

export interface IntegrationState extends IntegrationDescriptor {
	connected: boolean;
}

// ============================================================
// Shared Data Types (used by components, services, backend)
// ============================================================

export interface DidChangeRepositoriesParams {
	count: number;
	openCount: number;
	hasUnsafe: boolean;
	trusted: boolean;
}

export type OverviewRecentThreshold = 'OneDay' | 'OneWeek' | 'OneMonth';
export type OverviewStaleThreshold = 'OneYear';

export interface OverviewFilters {
	recent: {
		threshold: OverviewRecentThreshold;
	};
	stale: { threshold: OverviewStaleThreshold; show: boolean; limit: number };
}

export type GetLaunchpadSummaryResponse = LaunchpadSummaryResult | { error: Error } | undefined;

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
				potentialConflicts?: ConflictDetectionResult;

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

// TODO: look at splitting off selected repo
export type GetInactiveOverviewResponse =
	| {
			repository: OverviewRepository;
			recent: GetOverviewBranch[];
			stale?: GetOverviewBranch[];
	  }
	| undefined;

export interface CollapseSectionParams {
	section: string;
	collapsed: boolean;
}

export type OpenInGraphParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;

export type OpenInTimelineParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;

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

// ============================================================
// Legacy IPC (kept for shared contexts like promos.ts)
// ============================================================

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar: string;
	organizationsCount: number;
}
export const DidChangeSubscription = new IpcNotification<DidChangeSubscriptionParams>(scope, 'subscription/didChange');
