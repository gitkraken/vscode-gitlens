import type { AIModel } from '@gitlens/ai/models/model.js';
import type { GitBranchStatus, GitTrackingState, GitTrackingUpstream } from '@gitlens/git/models/branch.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ConflictDetectionResult } from '@gitlens/git/models/mergeConflicts.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { RemoteProviderSupportedFeatures } from '@gitlens/git/models/remoteProvider.js';
import type { GitBranchMergedStatus } from '@gitlens/git/providers/branches.js';
import type { AgentSessionState } from '../../agents/models/agentSessionState.js';
import type { IntegrationDescriptor } from '../../constants.integrations.js';
import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { RepositoryShape } from '../../git/models/repositoryShape.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator.js';
import type { LaunchpadItem } from '../../plus/launchpad/launchpadProvider.js';
import type { LaunchpadGroup } from '../../plus/launchpad/models/launchpad.js';
import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcNotification } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';
import type { OverviewBranch, OverviewRecentThreshold, OverviewStaleThreshold } from '../shared/overviewBranches.js';

export type { OverviewRecentThreshold, OverviewStaleThreshold } from '../shared/overviewBranches.js';
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
	dateFormat: string | null;
	previewEnabled: boolean;
	newInstall: boolean;
	hostAppName: string;
	agentSessions?: AgentSessionState[];
}

export type { AgentSessionState };

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
	timestamps?: {
		lastCommit?: number;
		lastAccessed?: number;
		lastModified?: number;
	};
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
		| {
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
		| undefined
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
		| {
				id: string;
				title: string;
				url: string;
				state: Omit<Issue['state'], 'merged'>;
		  }[]
		| undefined
	>;

	issues?: Promise<
		| {
				id: string;
				title: string;
				url: string;
				state: Omit<Issue['state'], 'merged'>;
		  }[]
		| undefined
	>;

	worktree?: {
		name: string;
		path: string;
		uri: string;
		isDefault: boolean;
	};
}

export type OverviewRepository = RepositoryShape;

// ============================================================
// Overview Branch (sync fields only — no enrichment)
// ============================================================

// Re-export shared overview types for convenience
export type {
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OverviewBranch,
	OverviewBranchContributor,
	OverviewBranchEnrichment,
	OverviewBranchIssue,
	OverviewBranchLaunchpadItem,
	OverviewBranchMergeTarget,
	OverviewBranchPullRequest,
	OverviewBranchRemote,
	OverviewBranchWip,
} from '../shared/overviewBranches.js';

export type GetOverviewBranchesResponse =
	| {
			repository: OverviewRepository;
			active: OverviewBranch[];
			recent: OverviewBranch[];
			stale?: OverviewBranch[];
	  }
	| undefined;

// ============================================================
// Legacy monolithic responses (consumed by UI — built by webview from skeleton + wip + enrichment)
// ============================================================

export type GetActiveOverviewResponse =
	| {
			repository: OverviewRepository;
			active: GetOverviewBranch[];
	  }
	| undefined;

export type GetInactiveOverviewResponse =
	| {
			repository: OverviewRepository;
			recent: GetOverviewBranch[];
			stale?: GetOverviewBranch[];
	  }
	| undefined;

export type OpenInGraphParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;

export type OpenInTimelineParams =
	| { type: 'repo'; repoPath: string; branchId?: never }
	| { type: 'branch'; repoPath: string; branchId: string }
	| undefined;

export type {
	BranchAndTargetRefs,
	BranchRef,
	CreatePullRequestCommandArgs,
	OpenWorktreeCommandArgs,
} from '../shared/branchRefs.js';

// ============================================================
// Legacy IPC (kept for shared contexts like promos.ts)
// ============================================================

export interface DidChangeSubscriptionParams {
	subscription: Subscription;
	avatar: string;
	organizationsCount: number;
}
export const DidChangeSubscription = new IpcNotification<DidChangeSubscriptionParams>(scope, 'subscription/didChange');
