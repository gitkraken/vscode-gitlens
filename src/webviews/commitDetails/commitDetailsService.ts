/**
 * RPC Service interface for the Commit Details webview.
 *
 * This interface extends SharedWebviewServices with view-specific
 * sub-services for inspect operations and drafts.
 *
 * Architecture:
 * - Backend is stateless - it only provides data and forwards events
 * - Webview owns all state (current commit, pinned, navigation, etc.)
 * - Webview subscribes to events and fetches data via RPC
 *
 * Sub-services are nested objects. On the webview side, resolve each
 * sub-service once (e.g., `const inspect = await services.inspect`) then
 * call methods with a single await.
 *
 * Service Layout:
 * - SharedWebviewServices: repositories, repository, config, storage,
 *   subscription, integrations, ai, autolinks, commands, telemetry, files, pullRequests
 * - inspect: view-specific commit queries, navigation, commit actions, AI ops
 */
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { SharedWebviewServices } from '../rpc/services/common.js';
import type { Unsubscribe } from '../rpc/services/types.js';
import type { CommitDetails } from './protocol.js';

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
}

// ============================================================
// Initial Context Types
// ============================================================

/**
 * Minimal context for webview initialization.
 * Contains only what's needed to know what data to fetch.
 */
export interface InitialContext {
	/** Whether the view is pinned */
	pinned: boolean;
	/** Initial commit info */
	initialCommit?: { repoPath: string; sha: string };
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

// ============================================================
// View-Specific Sub-Service: Inspect
// ============================================================

/**
 * Inspect service for Commit Details — the single view-specific sub-service
 * that owns commit queries, navigation, commit actions, and AI operations.
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
	 * Fired when a commit is selected elsewhere (editor line, tree views, etc.).
	 * View-specific: includes search context and passive flag.
	 */
	onCommitSelected(callback: (event: CommitSelectionEvent) => void): Unsubscribe;

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

	/**
	 * Pin or unpin the current view.
	 * When pinned, the view won't follow line tracker changes.
	 */
	setPin(pin: boolean): Promise<void>;

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
	 * @param sha - Commit SHA
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	explainCommit(repoPath: string, sha: string, prompt?: string, signal?: AbortSignal): Promise<ExplainResult>;
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
