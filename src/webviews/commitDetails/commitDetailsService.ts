/**
 * RPC Service interface for the Commit Details webview.
 *
 * This interface extends SharedWebviewServices with view-specific
 * sub-services for inspect operations and drafts.
 *
 * Architecture:
 * - Backend is stateless - it only provides data and forwards events
 * - Webview owns all state (current commit, mode, pinned, navigation, etc.)
 * - Webview subscribes to events and fetches data via RPC
 *
 * Sub-services are nested objects. On the webview side, resolve each
 * sub-service once (e.g., `const inspect = await services.inspect`) then
 * call methods with a single await.
 *
 * Service Layout:
 * - SharedWebviewServices: repositories, repository, config, storage,
 *   subscription, integrations, ai, autolinks, commands, telemetry, files, pullRequests
 * - inspect: view-specific commit/WIP queries, navigation, commit actions, AI ops
 */
import type { GitCommitSearchContext } from '../../git/search.js';
import type { SharedWebviewServices } from '../rpc/services/common.js';
import type { CommitDetails, Mode, Wip } from './protocol.js';

// ============================================================
// Event Types (used by subscription callbacks)
// ============================================================

/**
 * Commit selection event - a commit was selected elsewhere.
 * Named "Selection" (not "Selected") to avoid conflict with eventBus.CommitSelectedEvent.
 */
export interface CommitSelectionEvent {
	repoPath: string;
	sha: string;
	/** Optional search context if commit was found via search */
	searchContext?: GitCommitSearchContext;
	/** Whether this is a passive selection (e.g., from line tracker) */
	passive?: boolean;
	/** Mode the host wants the webview to switch to (graph-attached panels only). */
	requestedMode?: Mode;
}

/**
 * Event fired when the host requests switching to WIP mode on an already-live webview.
 * (e.g., Launchpad or deep links opening review/WIP in the existing Inspect view)
 */
export interface ShowWipEvent {
	repoPath?: string;
	inReview: boolean;
}

// ============================================================
// Initial Context Types
// ============================================================

/**
 * Minimal context for webview initialization.
 * Contains only what's needed to know what data to fetch.
 */
export interface InitialContext {
	/** Current view mode */
	mode: Mode;
	/** Whether the view is pinned */
	pinned: boolean;
	/** Navigation stack state */
	navigationStack: { count: number; position: number; hint?: string };
	/** Whether review mode is active (for WIP) */
	inReview: boolean;
	/** Initial commit info if in commit mode */
	initialCommit?: { repoPath: string; sha: string };
	/** Initial WIP repo path if in WIP mode */
	initialWipRepoPath?: string;
}

export interface NavigateResult {
	navigationStack: { count: number; position: number; hint?: string };
	selectedCommit?: { repoPath: string; sha: string };
}

// ============================================================
// Result Types
// ============================================================

/**
 * Result type for AI explain operation.
 */
export type ExplainResult =
	| { result: { summary: string; body: string }; error?: never }
	| { error: { message: string } };

/**
 * Result type for AI generate title/description operation.
 */
export type GenerateResult =
	| { title: string | undefined; description: string | undefined; error?: undefined }
	| { error: { message: string } };

// ============================================================
// View-Specific Sub-Service: Inspect
// ============================================================

/**
 * Inspect service for Commit Details — the single view-specific sub-service
 * that owns commit/WIP queries, navigation, commit actions, and AI operations.
 *
 * This replaces the old git/actions/navigation/ai sub-services with one
 * cohesive interface. Generic git operations (stage, unstage, fetch, push, pull,
 * publish, switchBranch) live on the shared `repository` service. File operations
 * live on the shared `files` service. PR operations live on the shared
 * `pullRequests` service.
 */
export interface CommitInspectService {
	// ── Events ──

	/**
	 * Fired when a commit is selected elsewhere (graph, editor line, etc.).
	 * View-specific: includes search context and passive flag, and filters
	 * based on the view's attachedTo configuration.
	 */
	onCommitSelected(callback: (event: CommitSelectionEvent) => void): () => void;

	/**
	 * Fired when the host opens WIP mode on an already-live webview.
	 * The webview should switch to WIP mode and fetch WIP data.
	 */
	onShowWip(callback: (event: ShowWipEvent) => void): () => void;

	// ── Initialization ──

	/**
	 * Get initial context for webview initialization.
	 * Returns minimal info needed to determine what data to fetch.
	 */
	getInitialContext(): Promise<InitialContext>;

	// ── Commit Queries ──

	/**
	 * Get core commit details (fast path — no autolinks, no enriched data).
	 * Returns commit identity, files, and stats immediately.
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	getCommit(repoPath: string, sha: string, signal?: AbortSignal): Promise<CommitDetails | undefined>;

	// ── WIP Queries ──

	/**
	 * Get core WIP state (working changes + branch info, no PR or code suggestions).
	 * @param repoPath - Repository path (optional, uses best repo if not provided)
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	getWipChanges(repoPath?: string, signal?: AbortSignal): Promise<Wip | undefined>;

	// ── Navigation ──

	/**
	 * Navigate the commit stack.
	 * Returns updated navigation state and the commit the webview should display.
	 */
	navigate(direction: 'back' | 'forward'): Promise<NavigateResult>;

	/**
	 * Pin or unpin the current view.
	 * When pinned, the view won't follow line tracker changes.
	 */
	setPin(pin: boolean): Promise<void>;

	/**
	 * Switch between commit and WIP modes.
	 */
	switchMode(mode: Mode, repoPath?: string): Promise<void>;

	/**
	 * Toggle code review mode.
	 * @param inReview - Whether to enter review mode
	 * @param repoPath - Repository path (for telemetry)
	 */
	changeReviewMode(inReview: boolean, repoPath?: string): Promise<void>;

	// ── Commit Actions ──

	/**
	 * Execute a commit action (show in graph, copy SHA, etc.).
	 */
	executeCommitAction(
		repoPath: string,
		sha: string,
		action: 'graph' | 'more' | 'scm' | 'sha',
		alt?: boolean,
	): Promise<void>;

	/**
	 * Open commit picker to select a different commit.
	 */
	pickCommit(): Promise<void>;

	/**
	 * Open commit search dialog.
	 */
	searchCommit(): Promise<void>;

	/**
	 * Open autolink settings.
	 */
	openAutolinkSettings(): Promise<void>;

	// ── AI Operations ──

	/**
	 * Generate an AI explanation of a commit.
	 * @param sha - Commit SHA (use 'wip' for uncommitted changes)
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	explainCommit(repoPath: string, sha: string, signal?: AbortSignal): Promise<ExplainResult>;

	/**
	 * Generate AI title and description for WIP changes.
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	generateDescription(repoPath: string, signal?: AbortSignal): Promise<GenerateResult>;
}

// ============================================================
// Combined Services Interface
// ============================================================

/**
 * RPC service interface for Commit Details webview.
 *
 * Extends SharedWebviewServices with one view-specific sub-service:
 * - `inspect`: commit/WIP queries, navigation, commit actions, AI operations
 *
 * Drafts operations are now on the shared `drafts` service (via SharedWebviewServices).
 */
export interface CommitDetailsServices extends SharedWebviewServices {
	readonly inspect: CommitInspectService;
}
