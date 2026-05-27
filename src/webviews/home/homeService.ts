/**
 * Home webview RPC service interfaces.
 *
 * Only contains Home-specific concerns. Generic services (subscription,
 * integrations, repositories, config, ai, commands) come from SharedWebviewServices.
 * Launchpad is a standalone service composed in from the RPC layer.
 */

import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { LaunchpadService } from '../rpc/launchpadService.js';
import type { SharedWebviewServices } from '../rpc/services/common.js';
import type { OrgSettings, RepositoriesState, RpcEventSubscription } from '../rpc/services/types.js';
import type {
	AgentSessionState,
	GetOverviewBranchesResponse,
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	OpenInGraphParams,
	OverviewFilters,
} from './protocol.js';

// ============================================================
// Home-specific types
// ============================================================

/**
 * Walkthrough progress state.
 */
export interface WalkthroughProgressState {
	readonly doneCount: number;
	readonly allCount: number;
	readonly progress: number;
	readonly state: Record<WalkthroughContextKeys, boolean>;
}

/**
 * Initial context provided to the Home webview on first load.
 * Contains static/one-time data that doesn't change frequently.
 */
export interface HomeInitialContext {
	readonly discovering: boolean;
	readonly repositories: RepositoriesState;
	readonly walkthroughSupported: boolean;
	readonly newInstall: boolean;
	readonly hostAppName: string;
	readonly orgSettings: OrgSettings;
}

// ============================================================
// Home view service (Home-specific operations)
// ============================================================

/**
 * Home-specific service for operations unique to the Home webview.
 *
 * This covers:
 * - Branch overview (active/inactive/filter)
 * - Walkthrough progress
 * - UI actions (collapse sections, open in graph)
 *
 * Generic concerns (AI model, command execution, org settings) are
 * provided by SharedWebviewServices (ai, commands, config).
 */
export interface HomeViewService {
	// --- Overview ---

	/** Get branch skeletons (sync fields only) classified as active/recent/stale. Fast — no enrichment.
	 * @param type - If specified, only returns the requested category. Omit for all categories.
	 */
	getOverviewBranches(
		type?: 'active' | 'inactive' | 'agents',
		signal?: AbortSignal,
	): Promise<GetOverviewBranchesResponse>;

	/** Get WIP status for specified branches. Lightweight — local git status only. */
	getOverviewWip(branchIds: string[], signal?: AbortSignal): Promise<GetOverviewWipResponse>;

	/** Get enrichment data (PR, autolinks, issues, contributors, merge target, remote) for specified branches.
	 * Pass `options.skipMergeTarget` to defer merge-target computation to the consumer
	 * (e.g. `gl-branch-card` fetches it lazily on first expand via `BranchesService.getBranchEnrichment`).
	 */
	getOverviewEnrichment(
		branchIds: string[],
		options?: { skipMergeTarget?: boolean },
		signal?: AbortSignal,
	): Promise<GetOverviewEnrichmentResponse>;

	/** Get the current overview filter state. */
	getOverviewFilterState(): Promise<OverviewFilters>;

	/** Update the overview filter. */
	setOverviewFilter(filter: OverviewFilters): Promise<void>;

	/** Get the current selected overview repository path. */
	getOverviewRepositoryState(): Promise<string | undefined>;

	/** Set the selected overview repository and return the normalized path. */
	setOverviewRepository(repoPath: string | undefined): Promise<string | undefined>;

	/** Open the repository picker to change the overview repo. */
	changeOverviewRepository(): Promise<void>;

	/** Fired when the selected overview repository changes. */
	onOverviewRepositoryChanged: RpcEventSubscription<{ repoPath: string | undefined }>;

	/** Fired when the overview filter changes. */
	onOverviewFilterChanged: RpcEventSubscription<{ filter: OverviewFilters }>;

	// --- Walkthrough ---

	/** Get current walkthrough progress, or undefined if dismissed. */
	getWalkthroughProgress(): Promise<WalkthroughProgressState | undefined>;

	/** Dismiss the walkthrough section. */
	dismissWalkthrough(): Promise<void>;

	/** Fired when walkthrough progress changes. */
	onWalkthroughProgressChanged: RpcEventSubscription<WalkthroughProgressState>;

	// --- UI Actions ---

	/** Open a branch or repo in the Commit Graph. */
	openInGraph(params: OpenInGraphParams): void;

	/** Fired when the extension requests account focus. */
	onFocusAccount: RpcEventSubscription<undefined>;

	// --- Agent Sessions ---

	/** Get current agent sessions. */
	getAgentSessions(): Promise<AgentSessionState[]>;

	/** Fired when agent sessions change. */
	onAgentSessionsChanged: RpcEventSubscription<AgentSessionState[]>;

	// --- Initial Context ---

	/** Get the initial context for webview bootstrap. */
	getInitialContext(): Promise<HomeInitialContext>;
}

// ============================================================
// Combined Home Services
// ============================================================

/**
 * Complete Home webview services.
 *
 * Composes SharedWebviewServices with Home-specific and standalone services.
 */
export interface HomeServices extends SharedWebviewServices {
	readonly home: HomeViewService;
	readonly launchpad: LaunchpadService;
}
