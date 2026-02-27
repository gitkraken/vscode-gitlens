/**
 * RPC Service interface for the Commit Details webview.
 *
 * This interface extends CommonWebviewServices with view-specific
 * sub-services for commit details, WIP, navigation, drafts, etc.
 *
 * Architecture:
 * - Backend is stateless - it only provides data and forwards events
 * - Webview owns all state (current commit, mode, pinned, navigation, etc.)
 * - Webview subscribes to events and fetches data via RPC
 *
 * Sub-services are nested objects. On the webview side, resolve each
 * sub-service once (e.g., `const git = await services.git`) then
 * call methods with a single await.
 */
import type { Autolink } from '../../autolinks/models/autolinks.js';
import type { GitCommitReachability } from '../../git/gitProvider.js';
import type { GitFileChangeShape } from '../../git/models/fileChange.js';
import type { IssueOrPullRequest } from '../../git/models/issueOrPullRequest.js';
import type { PullRequestRefs, PullRequestShape } from '../../git/models/pullRequest.js';
import type { GitCommitSearchContext } from '../../git/search.js';
import type { Draft, DraftVisibility } from '../../plus/drafts/models/drafts.js';
import type { Change, DraftUserSelection } from '../plus/patchDetails/protocol.js';
import type { WebviewAIService } from '../rpc/services/ai.js';
import type { CommonWebviewServices } from '../rpc/services/common.js';
import type { WebviewGitService } from '../rpc/services/git.js';
import type { CommitDetails, CommitSignatureShape, FileShowOptions, Mode, Wip, WipChange } from './protocol.js';

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

/**
 * Result type for commit reachability query.
 */
export type ReachabilityResult =
	| { refs: GitCommitReachability['refs']; duration: number; error?: never }
	| { error: { message: string }; duration: number };

/**
 * Result type for commit autolinks query.
 * Includes basic autolinks AND the message formatted with remote-specific autolink patterns.
 */
export interface CommitAutolinksResult {
	autolinks: Autolink[];
	formattedMessage: string;
}

/**
 * Result type for commit enriched data query.
 * Includes enhanced autolinks (resolved issues/PRs), associated PR, and signature.
 */
export interface CommitEnrichedResult {
	autolinkedIssues: IssueOrPullRequest[];
	associatedPullRequest: PullRequestShape | undefined;
	signature?: CommitSignatureShape;
	formattedMessage: string;
}

// ============================================================
// View-Specific Sub-Service Interfaces
// ============================================================

/**
 * Git service for Commit Details.
 *
 * Extends generic git with view-specific data fetching and a view-specific
 * `onCommitSelected` override (different event shape with search context
 * and passive flag).
 *
 * Generic operations (stageFile, unstageFile, fetch, push, pull, publish,
 * switchBranch) are inherited from the base service.
 */
export interface CommitDetailsGitService extends Omit<
	WebviewGitService,
	'onCommitSelected' | 'getCommit' | 'getCommitFiles' | 'getBranch' | 'getCurrentBranch' | 'getPullRequestForCommit'
> {
	/**
	 * Fired when a commit is selected elsewhere (graph, editor line, etc.).
	 * This is the view-specific version that includes search context and
	 * filters based on the view's attachedTo configuration.
	 */
	onCommitSelected(callback: (event: CommitSelectionEvent) => void): () => void;
	/**
	 * Get core commit details (fast path — no autolinks, no enriched data).
	 * Returns commit identity, files, and stats immediately.
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	getCommit(repoPath: string, sha: string, signal?: AbortSignal): Promise<CommitDetails | undefined>;

	/**
	 * Get basic autolinks parsed from the commit message.
	 * Also returns the message formatted with remote-specific autolink patterns.
	 * Fire-and-forget after getCommit — not needed for first paint.
	 */
	getCommitAutolinks(repoPath: string, sha: string, signal?: AbortSignal): Promise<CommitAutolinksResult | undefined>;

	/**
	 * Get enriched commit data: enhanced autolinks (resolved issues), associated PR, and signature.
	 * Fire-and-forget after getCommit — not needed for first paint.
	 */
	getCommitEnriched(repoPath: string, sha: string, signal?: AbortSignal): Promise<CommitEnrichedResult | undefined>;

	/**
	 * Get core WIP state (working changes + branch info, no PR or code suggestions).
	 * @param repoPath - Repository path (optional, uses best repo if not provided)
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	getWipChanges(repoPath?: string, signal?: AbortSignal): Promise<Wip | undefined>;

	/**
	 * Get the pull request associated with the current branch.
	 * Fire-and-forget after getWipChanges — not needed for first paint.
	 */
	getAssociatedPullRequest(repoPath: string, signal?: AbortSignal): Promise<PullRequestShape | undefined>;

	/**
	 * Get branches/tags that contain a commit.
	 * @param signal - Optional AbortSignal for cooperative cancellation
	 */
	getCommitReachability(repoPath: string, sha: string, signal?: AbortSignal): Promise<ReachabilityResult>;
}

/**
 * Actions service for Commit Details (view-specific UI actions).
 *
 * These are view-specific operations that dispatch to VS Code commands,
 * open editors, or show pickers. They are NOT generic command dispatch
 * (that's WebviewCommandsService.execute/executeScoped).
 */
export interface CommitDetailsActionsService {
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
	 * Show file action menu for a file.
	 * @param ref - Commit SHA the file belongs to (from webview state)
	 */
	executeFileAction(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;

	/**
	 * Open a file at its commit revision.
	 * @param ref - Commit SHA the file belongs to (from webview state)
	 */
	openFile(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;

	/**
	 * Open a file on the remote provider (GitHub, etc.).
	 * @param ref - Commit SHA the file belongs to (from webview state)
	 */
	openFileOnRemote(file: GitFileChangeShape, ref?: string): Promise<void>;

	/**
	 * Compare file with working version.
	 * @param ref - Commit SHA the file belongs to (from webview state)
	 */
	openFileCompareWorking(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;

	/**
	 * Compare file with previous revision.
	 * @param ref - Commit SHA the file belongs to (from webview state)
	 */
	openFileComparePrevious(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void>;

	/**
	 * Open autolink settings.
	 */
	openAutolinkSettings(): Promise<void>;

	/**
	 * Open PR changes view.
	 */
	openPullRequestChanges(repoPath: string, prRefs: PullRequestRefs): Promise<void>;

	/**
	 * Open PR comparison view.
	 */
	openPullRequestComparison(repoPath: string, prRefs: PullRequestRefs): Promise<void>;

	/**
	 * Open PR on remote provider.
	 */
	openPullRequestOnRemote(prUrl: string): Promise<void>;

	/**
	 * Open PR details view.
	 */
	openPullRequestDetails(repoPath: string, prId: string, prProvider: string): Promise<void>;
}

/**
 * AI service for Commit Details.
 *
 * Extends generic AI service with view-specific operations.
 * Uses Object.assign on a base instance, so `extends` works (class identity preserved).
 */
export interface CommitDetailsAIService extends WebviewAIService {
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

/**
 * Navigation service for Commit Details (view-specific, no generic equivalent).
 */
/**
 * Event fired when the host requests switching to WIP mode on an already-live webview.
 * (e.g., Launchpad or deep links opening review/WIP in the existing Inspect view)
 */
export interface ShowWipEvent {
	repoPath?: string;
	inReview: boolean;
}

export interface CommitDetailsNavigationService {
	/**
	 * Get initial context for webview initialization.
	 * Returns minimal info needed to determine what data to fetch.
	 */
	getInitialContext(): Promise<InitialContext>;

	/**
	 * Fired when the host opens WIP mode on an already-live webview.
	 * The webview should switch to WIP mode and fetch WIP data.
	 */
	onShowWip(callback: (event: ShowWipEvent) => void): () => void;

	/**
	 * Navigate the commit stack.
	 * Returns updated navigation stack so the webview can update its signal.
	 */
	navigate(direction: 'back' | 'forward'): Promise<{ count: number; position: number; hint?: string }>;

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
}

/**
 * Drafts service for Commit Details (view-specific, no generic equivalent).
 */
export interface CommitDetailsDraftsService {
	/**
	 * Get code suggestions for a repository's current branch PR.
	 * Returns empty array if no PR exists, code suggest isn't supported, or drafts aren't accessible.
	 * Fire-and-forget after getAssociatedPullRequest.
	 */
	getCodeSuggestions(repoPath: string, signal?: AbortSignal): Promise<Omit<Draft, 'changesets'>[]>;

	/**
	 * Create a patch from WIP changes.
	 * @param changes - The WIP changes
	 * @param checked - Which files to include (true=all, false=none, 'staged'=staged only)
	 */
	createPatchFromWip(changes: WipChange, checked: boolean | 'staged'): Promise<void>;

	/**
	 * Suggest changes (create a draft).
	 */
	suggestChanges(params: {
		repoPath: string;
		title: string;
		description?: string;
		visibility: DraftVisibility;
		changesets: Record<string, Change>;
		userSelections: DraftUserSelection[] | undefined;
	}): Promise<void>;

	/**
	 * Show a code suggestion in the patches view.
	 */
	showCodeSuggestion(draft: Draft): Promise<void>;
}

// ============================================================
// Combined Services Interface
// ============================================================

/**
 * RPC service interface for Commit Details webview.
 *
 * Extends CommonWebviewServices, overriding `git` (different event shape and
 * view-specific data methods) and narrowing `ai` with view-specific operations.
 */
export interface CommitDetailsServices extends Omit<CommonWebviewServices, 'git'> {
	readonly git: CommitDetailsGitService;
	readonly ai: CommitDetailsAIService;
	readonly actions: CommitDetailsActionsService;
	readonly navigation: CommitDetailsNavigationService;
	readonly drafts: CommitDetailsDraftsService;
}
