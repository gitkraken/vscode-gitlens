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
import { Signal } from '@lit-labs/signals';
import type { GitCommitStats } from '@gitlens/git/models/commit.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import type { Autolink } from '../../../../../autolinks/models/autolinks.js';
import type { LaunchpadSummaryResult } from '../../../../../plus/launchpad/launchpadIndicator.js';
import type { CommitDetails, CommitSignatureShape, Preferences, Wip } from '../../../../plus/graph/detailsProtocol.js';
import type {
	BranchCommitEntry,
	BranchComparisonCommit,
	BranchComparisonContributor,
	BranchComparisonContributorsScope,
	BranchComparisonFile,
	ComposeResult,
	ResolveResult,
	ReviewResult,
	ScopeSelection,
} from '../../../../plus/graph/graphService.js';
import type { BranchMergeTargetStatus } from '../../../../rpc/services/branches.js';
import type { AiModelInfo } from '../../../../rpc/services/types.js';
import type { OverviewBranchIssue, OverviewBranchPullRequest } from '../../../../shared/overviewBranches.js';
import { createSignalGroup } from '../../../shared/state/signals.js';

/** Selection-shape vocabulary. Identifies which kind of selection the details panel is showing. */
export type DetailsContext = 'wip' | 'commit' | 'multicommit';

export interface ExplainState {
	cancelled?: boolean;
	error?: { message: string };
	result?: { summary: string; body: string };
}

/** Execution state of a running compose/review operation on a specific anchor.
 *  Invariants:
 *  - `'generating'` ⇒ `result == null && abortController != null && promise != null`
 *  - `'complete' | 'backed' | 'error'` ⇒ `result != null`
 *  - `'orphaned'` ⇒ `result` may be absent (orphan can hit a still-generating entry)
 *  `'backed'` means the user clicked Back from `'complete'` — the result is preserved in the
 *  controller's `_*BackSnapshot` for `forward()`, and Close from this state destroys the entry
 *  (the Back-then-close destroy gate). Forward flips `'backed'` → `'complete'`. */
export type RunningOperationExecState = 'generating' | 'complete' | 'backed' | 'error' | 'orphaned';

/** Identifies the selection a running operation is anchored to. */
export interface RunningOperationAnchor {
	kind: DetailsContext;
	/** For secondary WIP rows, this is the worktree's path. */
	repoPath: string;
	sha?: string;
	shas?: string[];
}

interface RunningOperationBase {
	anchor: RunningOperationAnchor;
	execState: RunningOperationExecState;
	/** Live run handle — aborting kills the host-side AI call (signal is threaded through the
	 *  RPC). Present while `execState === 'generating'`; absent after the run settles. */
	abortController?: AbortController;
	/** In-flight RPC promise — lets a re-engage re-attach rendering without re-running the AI. */
	promise?: Promise<ReviewResult | ComposeResult | ResolveResult | GenerateMessageResult>;
	/** The user-submitted prompt that initiated this run. Set at `dispatchOperation` time and
	 *  preserved through every entry transition (success, error, backed, retry-update) via the
	 *  spread pattern. Drives the AI-input seed on Restart / Go Back: the panel reads it off the
	 *  engaged entry so each anchor remembers its own run's prompt across mode toggles and anchor
	 *  switches. Empty/undefined for runs that don't carry a prompt. */
	prompt?: string;
}

/** Generate-commit-message result — just the composed message; the panel routes it to the WIP input/draft
 *  rather than rendering it (no in-webview result). */
export interface GenerateMessageResult {
	message: string;
}

/** A started AI operation, keyed in a {@link RunningOperationBucket} so review/compose/generateMessage can
 *  coexist on one anchor. Webview-local; the entry owns the in-flight run and survives anchor switches.
 *  `generateMessage` is tracking-only: lives only as `'generating'`, removed on settle, carries no `result`/
 *  `prompt`/`'backed'`/`'orphaned'`. `kind` matches the bucket slot so `bucket[op.kind]` indexing holds. */
export type RunningOperation =
	| (RunningOperationBase & { kind: 'review'; result?: ReviewResult })
	| (RunningOperationBase & { kind: 'compose'; result?: ComposeResult })
	| (RunningOperationBase & { kind: 'resolve'; result?: ResolveResult })
	| (RunningOperationBase & { kind: 'generateMessage' });

/** Per-anchor running-operation slot. An anchor may hold one of each kind concurrently. */
export interface RunningOperationBucket {
	review?: Extract<RunningOperation, { kind: 'review' }>;
	compose?: Extract<RunningOperation, { kind: 'compose' }>;
	resolve?: Extract<RunningOperation, { kind: 'resolve' }>;
	generateMessage?: Extract<RunningOperation, { kind: 'generateMessage' }>;
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
	const wipPullRequest = signal<OverviewBranchPullRequest | undefined>(undefined);
	const wipPullRequestLoading = signal(false);

	// Compare (2-commit) fetched data
	const commitFrom = signal<CommitDetails | undefined>(undefined);
	const commitTo = signal<CommitDetails | undefined>(undefined);
	const compareStats = signal<GitCommitStats | undefined>(undefined);
	const compareFiles = signal<readonly GitFileChangeShape[] | undefined>(undefined);
	const compareBetweenCount = signal<number | undefined>(undefined);
	const compareAutolinks = signal<Autolink[] | undefined>(undefined);
	const compareAutolinksLoading = signal(false);
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
	const compareGenerateChangelogBusy = signal(false);

	// Branch commits (scope-picker source of truth)
	const branchCommits = signal<BranchCommitEntry[] | undefined>(undefined);
	const branchMergeBase = signal<
		{ sha: string; message: string; author?: string; avatarUrl?: string; date?: string } | undefined
	>(undefined);
	const branchCommitsFetching = signal(false);
	const branchCommitsHasMore = signal(false);
	const branchCommitsLoadingMore = signal(false);

	// Branch comparison results — split across the two phases of the progressive load.
	// Phase 1 (Summary): counts + the All Files diff. Lands on refs/wip change.
	const branchCompareAheadCount = signal(0);
	const branchCompareBehindCount = signal(0);
	const branchCompareAllFiles = signal<BranchComparisonFile[]>([]);
	const branchCompareAllFilesCount = signal(0);
	// Phase 2 (Side): per-side commits, each carrying its `files` inline. Loaded lazily on
	// first activation of Ahead or Behind. Per-commit selection scoping is then a pure
	// client-side filter — no fetch.
	const branchCompareAheadCommits = signal<BranchComparisonCommit[]>([]);
	const branchCompareBehindCommits = signal<BranchComparisonCommit[]>([]);
	const branchCompareAheadFiles = signal<BranchComparisonFile[]>([]);
	const branchCompareBehindFiles = signal<BranchComparisonFile[]>([]);
	// Per-side "loaded for the current refs/wip" flag. Drives the per-tab loading state in the
	// panel. Cleared whenever the comparison identity changes.
	const branchCompareAheadLoaded = signal(false);
	const branchCompareBehindLoaded = signal(false);
	// Per-side "has more commits beyond the current limit" — drives the "Load More" affordance
	// at the bottom of each commit list. Cleared on identity changes alongside the loaded flags.
	const branchCompareAheadHasMore = signal(false);
	const branchCompareBehindHasMore = signal(false);
	// Per-side current commit-limit. Bumped by `loadMoreCompareCommits` (limit-replace pattern
	// matching `loadMoreBranchCommits`): we re-fetch with a larger limit and the resource value
	// idempotently supersedes the smaller one. Reset to the default page size on identity change.
	const branchCompareAheadLimit = signal(100);
	const branchCompareBehindLimit = signal(100);
	// Per-side "load-more in flight" flag. Drives the spinner inside the load-more row so the
	// button visually indicates the fetch is happening and is disabled to prevent double-fires.
	const branchCompareAheadLoadingMore = signal(false);
	const branchCompareBehindLoadingMore = signal(false);

	// Branch-comparison enrichment caches keyed by scope (active tab). Switching tabs
	// reads from these maps; only newly-visited scopes trigger a fetch. Caches reset only
	// when the comparison refs change (see `resetBranchCompareCaches` action).
	// (Per-commit attribution isn't possible here: getAutolinksForCommits joins messages
	// into one parse pass on the server. Cross-scope overlap is deduped one layer down by
	// AutolinksProvider's in-flight PromiseMap.)
	const branchCompareAutolinksByScope = signal<Map<BranchComparisonContributorsScope, Autolink[]>>(new Map());
	const branchCompareEnrichedAutolinksByScope = signal<Map<BranchComparisonContributorsScope, IssueOrPullRequest[]>>(
		new Map(),
	);
	const branchCompareContributorsByScope = signal<
		Map<BranchComparisonContributorsScope, BranchComparisonContributor[]>
	>(new Map());
	const branchCompareEnrichmentLoading = signal<Map<BranchComparisonContributorsScope, boolean>>(new Map());
	const branchCompareContributorsLoading = signal<Map<BranchComparisonContributorsScope, boolean>>(new Map());
	/** Per-sha pending state for lazy commit-file fetches in branch-compare. Set while a fetch is
	 *  in flight; cleared on success/abort/dispose. The compare panel reads this to show a loading
	 *  indicator instead of the empty "No changes" message during the fetch. */
	const branchCompareCommitFilesLoading = signal<Map<string, boolean>>(new Map());

	// Capabilities
	const preferences = signal<Preferences | undefined>(undefined);
	const orgSettings = signal<{ ai: boolean; drafts: boolean } | undefined>(undefined);
	const autolinksEnabled = signal(false);
	const hasAccount = signal(false);
	const hasIntegrationsConnected = signal(false);
	const hasRemotes = signal(false);
	const aiModel = signal<AiModelInfo | undefined>(undefined);

	const launchpadSummary = signal<LaunchpadSummaryResult | { error: Error } | undefined>(undefined);
	const launchpadSummaryLoading = signal(false);

	return {
		commit: commit,
		wip: wip,
		searchContext: searchContext,

		wipAutolinks: wipAutolinks,
		wipIssues: wipIssues,
		wipMergeTarget: wipMergeTarget,
		wipMergeTargetLoading: wipMergeTargetLoading,
		wipPullRequest: wipPullRequest,
		wipPullRequestLoading: wipPullRequestLoading,

		commitFrom: commitFrom,
		commitTo: commitTo,
		compareStats: compareStats,
		compareFiles: compareFiles,
		compareBetweenCount: compareBetweenCount,
		compareAutolinks: compareAutolinks,
		compareAutolinksLoading: compareAutolinksLoading,
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
		compareGenerateChangelogBusy: compareGenerateChangelogBusy,

		branchCommits: branchCommits,
		branchMergeBase: branchMergeBase,
		branchCommitsFetching: branchCommitsFetching,
		branchCommitsHasMore: branchCommitsHasMore,
		branchCommitsLoadingMore: branchCommitsLoadingMore,

		branchCompareAheadCount: branchCompareAheadCount,
		branchCompareBehindCount: branchCompareBehindCount,
		branchCompareAllFiles: branchCompareAllFiles,
		branchCompareAllFilesCount: branchCompareAllFilesCount,
		branchCompareAheadCommits: branchCompareAheadCommits,
		branchCompareBehindCommits: branchCompareBehindCommits,
		branchCompareAheadFiles: branchCompareAheadFiles,
		branchCompareBehindFiles: branchCompareBehindFiles,
		branchCompareAheadLoaded: branchCompareAheadLoaded,
		branchCompareBehindLoaded: branchCompareBehindLoaded,
		branchCompareAheadHasMore: branchCompareAheadHasMore,
		branchCompareBehindHasMore: branchCompareBehindHasMore,
		branchCompareAheadLimit: branchCompareAheadLimit,
		branchCompareBehindLimit: branchCompareBehindLimit,
		branchCompareAheadLoadingMore: branchCompareAheadLoadingMore,
		branchCompareBehindLoadingMore: branchCompareBehindLoadingMore,

		branchCompareAutolinksByScope: branchCompareAutolinksByScope,
		branchCompareEnrichedAutolinksByScope: branchCompareEnrichedAutolinksByScope,
		branchCompareContributorsByScope: branchCompareContributorsByScope,
		branchCompareEnrichmentLoading: branchCompareEnrichmentLoading,
		branchCompareContributorsLoading: branchCompareContributorsLoading,
		branchCompareCommitFilesLoading: branchCompareCommitFilesLoading,

		preferences: preferences,
		orgSettings: orgSettings,
		autolinksEnabled: autolinksEnabled,
		hasAccount: hasAccount,
		hasIntegrationsConnected: hasIntegrationsConnected,
		hasRemotes: hasRemotes,
		aiModel: aiModel,

		launchpadSummary: launchpadSummary,
		launchpadSummaryLoading: launchpadSummaryLoading,

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

	// Workflow state machine — compose/review only. Compare is no longer a `mode`; it has its
	// own lifecycle via `compareSheetOpen` + workflow `openCompare`/`closeCompare`.
	const activeMode = signal<'review' | 'compose' | 'resolve' | null>(null);
	const activeModeContext = signal<DetailsContext | null>(null);
	const activeModeRepoPath = signal<string | undefined>(undefined);
	const activeModeSha = signal<string | undefined>(undefined);
	const activeModeShas = signal<string[] | undefined>(undefined);

	// Compare sheet visibility. Independent of `activeMode` — compare can coexist with an
	// active compose/review (the sheet sits over the panel, the panel is inert beneath).
	const compareSheetOpen = signal(false);

	// Compare in panel form — a dedicated nested split inside the details panel instead of the
	// floating sheet. Mutually exclusive with `compareSheetOpen` at any given moment, but each
	// can be flipped independently — the user can promote (sheet → panel), restore (panel →
	// sheet), or close from either form.
	const compareAsPanel = signal(false);
	const compareSplitPosition = signal(50);
	const compareSplitOrientation = signal<'horizontal' | 'vertical'>('horizontal');

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

	// Preview metadata for the resume bar shown above the idle panel — derived from the
	// orchestrator's back-snapshot so the bar can show counts (commits/files, focus areas)
	// without re-deriving them from data the panel doesn't own. Cleared in lockstep with
	// the *ForwardAvailable signals above.
	const composeBackPreview = signal<{ commitCount: number; fileCount: number } | undefined>(undefined);
	const reviewBackPreview = signal<{ findingCount: number; fileCount: number } | undefined>(undefined);

	// Compose progress + apply state. `composeProgressMessage` mirrors the latest phase label
	// streamed by the library while compose is running (cleared to undefined when the run ends).
	// `composeApplying` is true between an apply-plan click and the IPC's resolution — drives
	// the panel's uncancellable "applying" overlay.
	const composeProgressMessage = signal<string | undefined>(undefined);
	const composeApplying = signal(false);

	// Resolve (AI conflict resolution) progress + apply + scope state. `resolveProgressMessage`
	// mirrors the latest phase label streamed while resolving (cleared to undefined when the run
	// ends). `resolveApplying` is true between an apply click and the IPC's resolution — drives the
	// uncancellable "applying" overlay. `resolveFocusedFilePaths` scopes a run to specific conflicted
	// files (set on per-file/multi-select entry; undefined means resolve all conflicts) — it scopes
	// the run input, not the anchor (the anchor is always the WIP).
	const resolveProgressMessage = signal<string | undefined>(undefined);
	const resolveApplying = signal(false);
	const resolveFocusedFilePaths = signal<readonly string[] | undefined>(undefined);
	const resolvePreErrorValue = signal<ResolveResult | undefined>(undefined);
	// Paths currently being re-resolved with per-file feedback — drives the per-row busy spinner in
	// the resolve results while a retry is in flight (multiple rows can retry concurrently).
	const resolveRetryingFiles = signal<ReadonlySet<string>>(new Set());

	// Error-recovery snapshot — `*PreErrorValue` is captured BEFORE an action that could mutate
	// the resource into an error sentinel (runReview / runCompose / composeCommitAll). The error
	// pane's "Go Back" feeds this snapshot into the `'backed'` transition so a Resume bar can
	// restore the prior plan/findings without re-running. Cleared by `*.invalidateErrorRecovery()`
	// on mode entry/exit/selection change, or overwritten by the next attempt.
	//
	// The submitted prompt is NOT stored here — it lives on the per-anchor `RunningOperation`
	// entry's `prompt` field (see `detailsState.ts:RunningOperationBase`). Reading it off the
	// engaged entry means each anchor remembers its own run's prompt across mode toggles and
	// anchor switches, and `retryFromError` / the AI-input seed both read the same source of truth.
	const composePreErrorValue = signal<ComposeResult | undefined>(undefined);
	const reviewPreErrorValue = signal<ReviewResult | undefined>(undefined);
	const composeLastFailedAction = signal<'generate' | 'commit-all' | undefined>(undefined);
	const composeLastCommitAllIncludedIds = signal<readonly string[] | undefined>(undefined);

	// Compare-mode UI settings (not fetched data — user's interactive choices while in
	// compare mode)
	const branchCompareLeftRef = signal<string | undefined>(undefined);
	const branchCompareLeftRefType = signal<'branch' | 'tag' | 'commit' | undefined>(undefined);
	const branchCompareRightRef = signal<string | undefined>(undefined);
	const branchCompareRightRefType = signal<'branch' | 'tag' | 'commit' | undefined>(undefined);
	const branchCompareIncludeWorkingTree = signal(false);
	// Worktree path currently checked out at `branchCompareRightRef` (the Compare side), populated
	// by each summary fetch. Drives IWT-toggle visibility and routes WT-touching file ops to the
	// correct repo path. Cleared synchronously on rightRef changes so the toggle hides during
	// in-flight fetches. The left ref's (Base) worktree is intentionally not resolved — IWT only
	// reads the Compare side's working tree, so exposing the Base side's would invite asymmetric
	// comparisons we don't support.
	const branchCompareRightRefWorktreePath = signal<string | undefined>(undefined);
	// Merge base of leftRef and rightRef, populated by each summary fetch. Anchors the per-side file
	// list and per-tab diff/file-action direction so Ahead/Behind reflect each side's divergence
	// instead of the symmetric 2-dot diff. Cleared synchronously on identity changes.
	const branchCompareMergeBase = signal<string | undefined>(undefined);
	const branchCompareStale = signal(false);
	const branchCompareActiveTab = signal<'all' | 'ahead' | 'behind'>('ahead');
	// Per-tab "scope to this commit" selection. Persisted across tab switches so that returning
	// to e.g. Ahead with a previously-selected commit X restores the scoped file view (alongside
	// the cached scroll/expand state). The 'all' tab has no commit list so isn't keyed here.
	const branchCompareSelectedCommitShaByTab = signal<Map<'ahead' | 'behind', string>>(new Map());
	// Active-tab convenience: derived from the per-tab map and the active tab. Read-only — to
	// mutate, write to `branchCompareSelectedCommitShaByTab` directly via `selectCompareCommit`.
	const branchCompareSelectedCommitSha = new Signal.Computed<string | undefined>(() => {
		const tab = branchCompareActiveTab.get();
		if (tab === 'all') return undefined;
		return branchCompareSelectedCommitShaByTab.get().get(tab);
	});
	const branchCompareActiveView = signal<'files' | 'contributors'>('files');
	const branchCompareEnrichmentRequested = signal(false);

	// Commit input form
	const commitMessage = signal('');
	// Tracks whether `commitMessage` is user-authored work-in-progress (typed or generated by
	// the user) versus an auto-loaded snapshot of HEAD's message. Set true on user input or AI
	// generation; left false after `loadLastCommitMessage` writes. Lets the HEAD-move auto-clear
	// in `gl-graph-details-panel.ts` drop a now-stale auto-loaded message without trampling the
	// user's actual typing.
	const commitMessageDirty = signal(false);
	const amend = signal(false);
	const amendBaseSha = signal<string | undefined>(undefined);
	const generating = signal(false);
	const commitError = signal<string | undefined>(undefined);
	// True while a commit RPC is in flight; drives the commit box's spinner + input lock.
	const committing = signal(false);

	return {
		swapped: swapped,

		activeMode: activeMode,
		activeModeContext: activeModeContext,
		activeModeRepoPath: activeModeRepoPath,
		activeModeSha: activeModeSha,
		activeModeShas: activeModeShas,

		compareSheetOpen: compareSheetOpen,
		compareAsPanel: compareAsPanel,
		compareSplitPosition: compareSplitPosition,
		compareSplitOrientation: compareSplitOrientation,

		scope: scope,
		aiExcludedFiles: aiExcludedFiles,
		wipStale: wipStale,
		reviewForwardAvailable: reviewForwardAvailable,
		composeForwardAvailable: composeForwardAvailable,
		composeBackPreview: composeBackPreview,
		reviewBackPreview: reviewBackPreview,
		composeProgressMessage: composeProgressMessage,
		composeApplying: composeApplying,

		resolveProgressMessage: resolveProgressMessage,
		resolveApplying: resolveApplying,
		resolveFocusedFilePaths: resolveFocusedFilePaths,
		resolvePreErrorValue: resolvePreErrorValue,
		resolveRetryingFiles: resolveRetryingFiles,

		composePreErrorValue: composePreErrorValue,
		reviewPreErrorValue: reviewPreErrorValue,
		composeLastFailedAction: composeLastFailedAction,
		composeLastCommitAllIncludedIds: composeLastCommitAllIncludedIds,

		branchCompareLeftRef: branchCompareLeftRef,
		branchCompareLeftRefType: branchCompareLeftRefType,
		branchCompareRightRef: branchCompareRightRef,
		branchCompareRightRefType: branchCompareRightRefType,
		branchCompareIncludeWorkingTree: branchCompareIncludeWorkingTree,
		branchCompareRightRefWorktreePath: branchCompareRightRefWorktreePath,
		branchCompareMergeBase: branchCompareMergeBase,
		branchCompareStale: branchCompareStale,
		branchCompareActiveTab: branchCompareActiveTab,
		branchCompareSelectedCommitShaByTab: branchCompareSelectedCommitShaByTab,
		branchCompareSelectedCommitSha: branchCompareSelectedCommitSha,
		branchCompareActiveView: branchCompareActiveView,
		branchCompareEnrichmentRequested: branchCompareEnrichmentRequested,

		commitMessage: commitMessage,
		commitMessageDirty: commitMessageDirty,
		amend: amend,
		amendBaseSha: amendBaseSha,
		generating: generating,
		commitError: commitError,
		committing: committing,

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
