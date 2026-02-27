/**
 * Home webview RPC service interfaces.
 *
 * Only contains Home-specific concerns. Generic services (subscription,
 * integrations, repositories, config, ai, commands) come from CommonWebviewServices.
 * Launchpad is a standalone service composed in from the RPC layer.
 */

import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { LaunchpadService } from '../rpc/launchpadService.js';
import type { CommonWebviewServices } from '../rpc/services/common.js';
import type { EventSubscriber, OrgSettings, RepositoriesState } from '../rpc/services/types.js';
import type {
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
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
 * Preview feature state.
 */
export interface PreviewState {
	readonly previewEnabled: boolean;
	readonly aiEnabled: boolean;
	readonly experimentalComposerEnabled: boolean;
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
	readonly integrationBannerCollapsed: boolean;
	readonly amaBannerCollapsed: boolean;
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
 * - Preview mode
 * - Home-specific banners (AI all-access)
 * - MCP installation/enablement state
 * - UI actions (collapse sections, open in graph)
 *
 * Generic concerns (AI model, command execution, org settings) are
 * provided by CommonWebviewServices (ai, commands, config).
 */
export interface HomeViewService {
	// --- Overview ---

	/** Get the active branch overview (current branch + WIP). */
	getActiveOverview(signal?: AbortSignal): Promise<GetActiveOverviewResponse>;

	/** Get the inactive branches overview (recent + stale). */
	getInactiveOverview(signal?: AbortSignal): Promise<GetInactiveOverviewResponse>;

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
	onOverviewRepositoryChanged: EventSubscriber<{ repoPath: string | undefined }>;

	/** Fired when the overview filter changes. */
	onOverviewFilterChanged: EventSubscriber<{ filter: OverviewFilters }>;

	// --- Walkthrough ---

	/** Get current walkthrough progress, or undefined if dismissed. */
	getWalkthroughProgress(): Promise<WalkthroughProgressState | undefined>;

	/** Dismiss the walkthrough section. */
	dismissWalkthrough(): Promise<void>;

	/** Fired when walkthrough progress changes. */
	onWalkthroughProgressChanged: EventSubscriber<WalkthroughProgressState>;

	// --- Preview ---

	/** Get the current preview feature state. */
	getPreviewState(): Promise<PreviewState>;

	/** Toggle the preview feature on/off. */
	togglePreviewEnabled(): Promise<void>;

	/** Fired when preview state changes. */
	onPreviewChanged: EventSubscriber<PreviewState>;

	// --- AI All-Access Banner ---

	/** Check if the AI all-access banner is collapsed. */
	isAiAllAccessBannerCollapsed(): Promise<boolean>;

	/** Dismiss the AI all-access banner. */
	dismissAiAllAccessBanner(): Promise<void>;

	/** Fired when the AI all-access banner state changes. */
	onAiAllAccessBannerChanged: EventSubscriber<boolean>;

	// --- UI Actions ---

	/** Collapse or expand a named section. */
	collapseSection(section: string, collapsed: boolean): void;

	/** Open a branch or repo in the Commit Graph. */
	openInGraph(params: OpenInGraphParams): void;

	/** Fired when the extension requests account focus. */
	onFocusAccount: EventSubscriber<undefined>;

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
 * Composes generic CommonWebviewServices with Home-specific and standalone services.
 */
export interface HomeServices extends CommonWebviewServices {
	readonly home: HomeViewService;
	readonly launchpad: LaunchpadService;
}
