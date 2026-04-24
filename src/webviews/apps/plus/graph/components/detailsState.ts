/**
 * Signal-based state management for the Graph Details panel.
 *
 * State is split into two layers so consumers can reason about lifecycle:
 *
 * - **Durable data state** — results of RPC fetches / capability queries. Survives mode
 *   transitions; only reset when a new fetch supersedes the previous result or the panel
 *   tears down. `resetDurable()` clears the whole layer.
 * - **Transient interaction state** — mode transitions, scope-picker selection, forward
 *   chip availability, commit-input form state, compare-mode UI settings. Intentionally
 *   ephemeral — `resetTransient()` returns the panel to its "just-opened" interaction
 *   baseline without discarding fetched data.
 *
 * State is instance-owned: the orchestrator creates a `DetailsState` via
 * `createDetailsState()` and provides it to children via Lit context. No module-level
 * singletons.
 *
 * The returned shape is flat for call-site convenience (`state.commit.get()` rather than
 * `state.durable.commit.get()`); the two layers are visible only via the targeted reset
 * methods (`resetDurable`, `resetTransient`) and the comments below.
 */
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import type {
	CommitDetails,
	CommitFileChange,
	CommitSignatureShape,
	Preferences,
	Wip,
} from '../../../../plus/graph/detailsProtocol.js';
import type { BranchCommitEntry, BranchComparisonCommit, ScopeSelection } from '../../../../plus/graph/graphService.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { OverviewBranchIssue } from '../../../../shared/overviewBranches.js';
import { createSignalGroup } from '../../../shared/state/signals.js';

export interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

/**
 * Durable layer — results of fetches and capability queries. These signals only change
 * when a new fetch completes (or when the panel explicitly invalidates them via a fresh
 * fetch). Should NOT be cleared on mode transitions.
 */
function createDurableState() {
	const { signal, resetAll } = createSignalGroup();

	// Core
	const commit = signal<CommitDetails | undefined>(undefined);
	const wip = signal<Wip | undefined>(undefined);
	const searchContext = signal<GitCommitSearchContext | undefined>(undefined);

	// WIP enrichment
	const wipAutolinks = signal<OverviewBranchIssue[] | undefined>(undefined);
	const wipIssues = signal<OverviewBranchIssue[] | undefined>(undefined);
	const wipMergeTarget = signal<BranchMergeTargetStatus | undefined>(undefined);
	const wipMergeTargetLoading = signal(false);

	// Compare (2-commit) fetched data
	const commitFrom = signal<CommitDetails | undefined>(undefined);
	const commitTo = signal<CommitDetails | undefined>(undefined);
	const compareStats = signal<GitCommitStats | undefined>(undefined);
	const compareFiles = signal<readonly GitFileChangeShape[] | undefined>(undefined);
	const compareBetweenCount = signal<number | undefined>(undefined);
	const compareAutolinks = signal<Autolink[] | undefined>(undefined);
	const signatureFrom = signal<CommitSignatureShape | undefined>(undefined);
	const signatureTo = signal<CommitSignatureShape | undefined>(undefined);
	const compareEnrichedItems = signal<IssueOrPullRequest[] | undefined>(undefined);
	const compareEnrichmentLoading = signal(false);

	// Commit enrichment
	const autolinks = signal<Autolink[] | undefined>(undefined);
	const formattedMessage = signal<string | undefined>(undefined);
	const autolinkedIssues = signal<IssueOrPullRequest[] | undefined>(undefined);
	const pullRequest = signal<PullRequestShape | undefined>(undefined);
	const signature = signal<CommitSignatureShape | undefined>(undefined);

	// Reachability
	const reachability = signal<GitCommitReachability | undefined>(undefined);
	const reachabilityState = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');

	// AI explain result (mode-adjacent but fetched)
	const explain = signal<ExplainState | undefined>(undefined);
	const compareExplainBusy = signal(false);

	// Branch commits (scope-picker source of truth)
	const branchCommits = signal<BranchCommitEntry[] | undefined>(undefined);
	const branchMergeBase = signal<
		{ sha: string; message: string; author?: string; avatarUrl?: string; date?: string } | undefined
	>(undefined);
	const branchCommitsFetching = signal(false);

	// Branch comparison results (the fetched ahead/behind/files data)
	const branchCompareAheadCount = signal(0);
	const branchCompareBehindCount = signal(0);
	const branchCompareAheadCommits = signal<BranchComparisonCommit[]>([]);
	const branchCompareBehindCommits = signal<BranchComparisonCommit[]>([]);
	const branchCompareAheadFiles = signal<CommitFileChange[]>([]);
	const branchCompareBehindFiles = signal<CommitFileChange[]>([]);

	// Capabilities
	const preferences = signal<Preferences | undefined>(undefined);
	const orgSettings = signal<{ ai: boolean; drafts: boolean } | undefined>(undefined);
	const autolinksEnabled = signal(false);
	const hasAccount = signal(false);
	const hasIntegrationsConnected = signal(false);
	const hasRemotes = signal(false);
	const aiModel = signal<AiModelInfo | undefined>(undefined);

	return {
		commit: commit,
		wip: wip,
		searchContext: searchContext,

		wipAutolinks: wipAutolinks,
		wipIssues: wipIssues,
		wipMergeTarget: wipMergeTarget,
		wipMergeTargetLoading: wipMergeTargetLoading,

		commitFrom: commitFrom,
		commitTo: commitTo,
		compareStats: compareStats,
		compareFiles: compareFiles,
		compareBetweenCount: compareBetweenCount,
		compareAutolinks: compareAutolinks,
		signatureFrom: signatureFrom,
		signatureTo: signatureTo,
		compareEnrichedItems: compareEnrichedItems,
		compareEnrichmentLoading: compareEnrichmentLoading,

		autolinks: autolinks,
		formattedMessage: formattedMessage,
		autolinkedIssues: autolinkedIssues,
		pullRequest: pullRequest,
		signature: signature,

		reachability: reachability,
		reachabilityState: reachabilityState,

		explain: explain,
		compareExplainBusy: compareExplainBusy,

		branchCommits: branchCommits,
		branchMergeBase: branchMergeBase,
		branchCommitsFetching: branchCommitsFetching,

		branchCompareAheadCount: branchCompareAheadCount,
		branchCompareBehindCount: branchCompareBehindCount,
		branchCompareAheadCommits: branchCompareAheadCommits,
		branchCompareBehindCommits: branchCompareBehindCommits,
		branchCompareAheadFiles: branchCompareAheadFiles,
		branchCompareBehindFiles: branchCompareBehindFiles,

		preferences: preferences,
		orgSettings: orgSettings,
		autolinksEnabled: autolinksEnabled,
		hasAccount: hasAccount,
		hasIntegrationsConnected: hasIntegrationsConnected,
		hasRemotes: hasRemotes,
		aiModel: aiModel,

		resetAll: resetAll,
	};
}

/**
 * Transient layer — interaction / UI / workflow state. Scoped to the current mode and
 * current selection; may be cleared independently of the durable layer (e.g. when a mode
 * exits, the workflow controller clears the active-mode signals without discarding the
 * commit/WIP/compare data the user might return to).
 */
function createTransientState() {
	const { signal, resetAll } = createSignalGroup();

	// Compare UI toggle
	const swapped = signal(false);

	// Workflow state machine
	const activeMode = signal<'review' | 'compose' | 'compare' | null>(null);
	const activeModeContext = signal<'wip' | 'commit' | 'compare' | null>(null);
	const activeModeRepoPath = signal<string | undefined>(undefined);
	const activeModeSha = signal<string | undefined>(undefined);
	const activeModeShas = signal<string[] | undefined>(undefined);

	// Scope picker + AI exclusions + stale indicator
	const scope = signal<ScopeSelection | undefined>(undefined);
	const aiExcludedFiles = signal<string[] | undefined>(undefined);
	const wipStale = signal(false);

	// Forward-chip availability: true after the user clicks Back on a successfully-resolved
	// review/compose result. Click "Forward" on the chip restores that result via mutate
	// (no AI re-run). Cleared on selection/scope change, file-checked, AI input typing, or
	// successful Forward.
	const reviewForwardAvailable = signal(false);
	const composeForwardAvailable = signal(false);

	// Compare-mode UI settings (not fetched data — user's interactive choices while in
	// compare mode)
	const branchCompareLeftRef = signal<string | undefined>(undefined);
	const branchCompareLeftRefType = signal<'branch' | 'tag' | 'commit' | undefined>(undefined);
	const branchCompareRightRef = signal<string | undefined>(undefined);
	const branchCompareRightRefType = signal<'branch' | 'tag' | 'commit' | undefined>(undefined);
	const branchCompareIncludeWorkingTree = signal(false);
	const branchCompareActiveTab = signal<'ahead' | 'behind'>('ahead');
	const branchCompareSelectedCommitSha = signal<string | undefined>(undefined);

	// Commit input form
	const commitMessage = signal('');
	const amend = signal(false);
	const generating = signal(false);
	const commitError = signal<string | undefined>(undefined);

	return {
		swapped: swapped,

		activeMode: activeMode,
		activeModeContext: activeModeContext,
		activeModeRepoPath: activeModeRepoPath,
		activeModeSha: activeModeSha,
		activeModeShas: activeModeShas,

		scope: scope,
		aiExcludedFiles: aiExcludedFiles,
		wipStale: wipStale,
		reviewForwardAvailable: reviewForwardAvailable,
		composeForwardAvailable: composeForwardAvailable,

		branchCompareLeftRef: branchCompareLeftRef,
		branchCompareLeftRefType: branchCompareLeftRefType,
		branchCompareRightRef: branchCompareRightRef,
		branchCompareRightRefType: branchCompareRightRefType,
		branchCompareIncludeWorkingTree: branchCompareIncludeWorkingTree,
		branchCompareActiveTab: branchCompareActiveTab,
		branchCompareSelectedCommitSha: branchCompareSelectedCommitSha,

		commitMessage: commitMessage,
		amend: amend,
		generating: generating,
		commitError: commitError,

		resetAll: resetAll,
	};
}

/**
 * Creates a new Graph Details state instance. The returned object flat-spreads both the
 * durable and transient signal groups so callers keep reading `state.commit.get()` and
 * `state.activeMode.get()` directly, but the two groups can be reset independently via
 * `resetDurable()` and `resetTransient()`.
 */
export function createDetailsState() {
	const durable = createDurableState();
	const transient = createTransientState();

	const { resetAll: resetDurable, ...durableSignals } = durable;
	const { resetAll: resetTransient, ...transientSignals } = transient;

	return {
		...durableSignals,
		...transientSignals,

		/** Reset the durable (fetched) layer. Primarily used on panel teardown. */
		resetDurable: resetDurable,

		/**
		 * Reset the transient (interaction / workflow / UI) layer without discarding fetched
		 * data. Use when returning the panel to its "just-opened" baseline without making the
		 * user see a data-loading flash.
		 */
		resetTransient: resetTransient,

		/** Reset everything. Called on panel disconnect. */
		resetAll: (): void => {
			resetDurable();
			resetTransient();
		},
	};
}

/** Graph Details state type — the return value of `createDetailsState()`. */
export type DetailsState = ReturnType<typeof createDetailsState>;
