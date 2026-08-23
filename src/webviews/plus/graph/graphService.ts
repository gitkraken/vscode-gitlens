import type { ColumnMode } from '@gitkraken/commit-graph/view.js';
import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitHealthBannerState, GitHealthLever, GitHealthReport } from '@gitlens/git/gitHealth.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitGraphRowKind } from '@gitlens/git/models/graph.js';
import type { GitCommitSearchContext, SearchQuery } from '@gitlens/git/models/search.js';
import type { GitHealthDetails, GitMaintenanceTask, GitOptimizationId } from '@gitlens/git/providers/maintenance.js';
import type { ConflictKind } from '@gitlens/git/utils/conflictResolution.utils.js';
import type { GraphBranchesVisibility } from '../../../config.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { FeaturePreview } from '../../../features.js';
import type { ConsultedTool } from '../../../plus/coretools/conflict/consultation.js';
import type { Subscription } from '../../../plus/gk/models/subscription.js';
import type { LaunchpadSummaryError, LaunchpadSummaryResult } from '../../../plus/launchpad/launchpadIndicator.js';
import type { ReferencesQuickPickOptions2 } from '../../../quickpicks/referencePicker.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { RpcEventSubscription } from '../../rpc/services/types.js';
import type { WalkthroughProgressPayload } from '../../rpc/walkthroughService.js';
import type { GetOverviewEnrichmentResponse, GetOverviewWipResponse } from '../../shared/overviewBranches.js';
import type {
	ChoosePathParams,
	DidChoosePathParams,
	TimelineConfig,
	TimelineDatasetResult,
	TimelineScopeSerialized,
} from '../timeline/protocol.js';
import type { TreemapConfig, TreemapData, TreemapMode } from '../treemap/protocol.js';
import type { CommitDetails, CommitFileChange, CompareDiff, Wip } from './detailsProtocol.js';
import type {
	DidChooseAuthorParams,
	DidChooseComparisonParams,
	DidChooseFileParams,
	DidChooseRefParams,
	DidGetCountParams,
	DidGetRowHoverParams,
	DidGetSidebarDataParams,
	DidRequestSearchParams,
	DidResolveGraphScopeParams,
	DidSearchHistoryGetParams,
	DidSearchRepairParams,
	GetOverviewParams,
	GetWipLineStatsResponse,
	GraphColumnName,
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphDisplayMode,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphExcludeTypes,
	GraphIncludeOnlyRef,
	GraphIncludeOnlyRefs,
	GraphOverviewData,
	GraphPinnedRef,
	GraphScope,
	GraphSearchMode,
	GraphSearchRelaxation,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
	MergePullRequestResult,
	SearchParams,
	SidebarWorktreeChange,
} from './protocol.js';

export type ComposeProgressUpdate = { phase: string; message: string };

export type ResolveProgressUpdate = { phase: string; message: string };

/** How a conflicted file was resolved — mirrors `@gitkraken/conflict-tools`' `ResolutionStrategy`. */
export type ConflictResolutionStrategy = 'ai' | 'take-ours' | 'take-theirs' | 'deleted' | 'skipped';

/** Serializable per-file resolution summary surfaced to the webview. The full resolved content stays
 *  host-side (in the cached resolve session) until the user applies; `virtualRef` points at the
 *  AI-resolved virtual snapshot so "View diff" can show resolved-vs-conflicted without writing. */
export type ResolvedFileSummary = {
	filePath: string;
	strategy: ConflictResolutionStrategy;
	/** The AI's reasoning for this file (conflict-tools `Resolution.description`). */
	reasoning: string;
	confidence: number;
	note?: string;
	/** What AI consulted in the repository before deciding, when the hunk alone was ambiguous — the
	 *  evidence behind `reasoning`. Absent when it resolved from the conflict's own context. */
	consulted?: ConsultedTool[];
	virtualRef?: VirtualRefShape;
};

/** Conflict-type info + which sides can be staged, attached to skipped/errored files so the resolve
 *  panel can label them and offer the right manual take-side fallback actions. Optional throughout —
 *  populated from `getConflictFileInfos`; absent when the file is no longer conflicted. */
export type ConflictFallbackInfo = {
	conflictStatus?: GitFileConflictStatus;
	kind?: ConflictKind;
	canStageCurrent?: boolean;
	canStageIncoming?: boolean;
	/** Original (pre-rename) path, for rename labels. */
	renameOf?: string;
};

export type ResolveFileError = { filePath: string; message: string } & ConflictFallbackInfo;

/** A conflicted file the resolver couldn't auto-resolve (e.g. binary or a marker-less conflict) —
 *  it still needs manual attention, but distinct from a failure: retrying won't help. */
export type ResolveSkippedFile = { filePath: string; message: string } & ConflictFallbackInfo;

/** Side to take when manually resolving a conflict from the resolve panel's fallback actions. */
export type ConflictSide = 'current' | 'incoming' | 'delete';

/** A queued take-side resolution — the file and the strategy it will be applied with on Apply. */
export type QueuedTakeSide = {
	filePath: string;
	strategy: Extract<ConflictResolutionStrategy, 'take-ours' | 'take-theirs' | 'deleted'>;
};

/** Result of queuing a manual take-side resolution. `resolved` lists every file queued (the chosen
 *  file, plus the losing target deleted for a rename/rename) so the panel can promote the matching
 *  rows. Nothing is applied to the working tree until the user clicks Apply. */
export type TakeConflictSideResult = { result: { resolved: QueuedTakeSide[] } } | { error: { message: string } };

export type ResolveResult =
	| {
			result: {
				resolutions: ResolvedFileSummary[];
				errors?: ResolveFileError[];
				skipped?: ResolveSkippedFile[];
				/** Present only when seeded from an automatic-rebase escalation — tells the panel the
				 *  run is mid-rebase so it can offer "Apply & Resume with AI" instead of a plain Apply. */
				autoRebase?: { sessionId: string; stepNumber?: number; totalSteps?: number };
				/** Resolver effort summed over the run, for telemetry only — aggregated host-side because
				 *  the per-file `metrics` never cross the IPC boundary. A count is `undefined` when no
				 *  resolution reported it, so "not measured" stays distinct from "zero". */
				metrics?: { steps?: number; toolCalls?: number };
			};
	  }
	| { error: { message: string } }
	| { cancelled: true };

/** Result of re-resolving a single file with user feedback — the replacement summary for that file. */
export type ReresolveFileResult =
	| { result: ResolvedFileSummary }
	| { error: { message: string } }
	| { cancelled: true };

/** One paused step of an automatic rebase run — the commit it stopped on and how each conflicted
 *  file was resolved. `empty-skipped`: the resolution made the commit empty and it was skipped. */
export type AutoRebaseSummaryStep = {
	step: number;
	totalSteps: number;
	commit: { sha?: string; message?: string };
	kind: 'conflicts' | 'empty-skipped' | 'manual';
	files: ResolvedFileSummary[];
};

/** Serializable summary of an automatic rebase session for the summary sheet. The per-file
 *  before/after contents stay host-side; each file's `virtualRef` points at its step's virtual
 *  diff session (namespace `auto-rebase`). */
export type AutoRebaseSummary = {
	sessionId: string;
	branch?: string;
	upstream?: string;
	preRebaseSha: string;
	postRebaseSha?: string;
	totalSteps: number;
	outcome: 'completed' | 'escalated' | 'aborted' | 'failed' | 'undone';
	/** Undo passes validation right now (branch tip still at `postRebaseSha`, tree clean enough, …) */
	undoable: boolean;
	/** Undo is available but will stash the working tree first (the dirt is the autostash, which
	 *  `undo()` recovers) — the confirm prompt warns about this */
	undoWillStash?: boolean;
	/** Why undo is unavailable — tooltip for the disabled Undo button */
	undoRefusal?: string;
	/** `left-in-stash` must be surfaced before offering undo: the autostash re-apply conflicted
	 *  and the user's changes remain in the stash */
	autostash?: 'none' | 'reapplied' | 'left-in-stash';
	steps: AutoRebaseSummaryStep[];
};

export type AutoRebaseSummaryResult = { summary: AutoRebaseSummary } | { error: { message: string } };

/** Lifecycle phase of an automatic rebase run — mirrors `AutoRebasePhase` (autoRebase.types.ts). */
export type AutoRebaseRunPhase =
	| 'starting'
	| 'resolving'
	| 'applying'
	| 'continuing'
	| 'completed'
	| 'escalated'
	| 'aborted'
	| 'failed'
	| 'undone';

/** Live state of an automatic rebase run, pushed to the Resolve panel so the run shows its own steps and
 *  progress there. Terminal phases are pushed too, so the panel knows to stop rendering the run. */
export type AutoRebaseRunUpdate = {
	sessionId: string;
	repoPath: string;
	branch?: string;
	upstream?: string;
	phase: AutoRebaseRunPhase;
	/** The step the run is at — the one in flight while running, or the one it escalated on. Absent for
	 *  the other terminal phases, and for a run that never paused. */
	step?: { current: number; total: number };
	/** Human-readable progress line, e.g. `Step 3/7 · Resolving 2 conflicts with AI…`. */
	message?: string;
	/** Why automation stopped, when it escalated — lets the panel distinguish a user-requested stop
	 *  (`stopped`) from a genuine escalation. */
	escalation?: { reason: string; message: string };
	/** Steps recorded so far — only paused (conflicted/skipped) steps surface; clean picks never do.
	 *  Files carry no `virtualRef` while running: before/after diffs stay a summary-sheet affordance so
	 *  no virtual sessions are registered per progress tick. */
	steps: AutoRebaseSummaryStep[];
};

export type UndoAutoRebaseResult =
	| { result: { restoredTo: string; warning?: string } }
	| { error: { message: string } };

export type ScopeSelection =
	| { type: 'commit'; sha: string }
	| {
			type: 'wip';
			includeStaged: boolean;
			includeUnstaged: boolean;
			includeShas: string[];
	  }
	| {
			type: 'compare';
			fromSha: string;
			toSha: string;
			includeShas?: string[];
	  };

/** A file in a scope's file list. Files from the scope's committed range (rather than the working
 *  tree) carry an `anchor`, so context-menu handlers resolve them against real commits instead of
 *  misreading them as working-tree changes. */
export type ScopeFile = GitFileChangeShape & {
	/** Present when the file's change comes from the scope's committed range rather than the working tree */
	anchor?: 'committed';
	/** Newest sha of the committed range containing the change */
	anchorSha?: string;
	/** Resolved base (parent of the oldest included sha) of the range diff; absent for root-anchored ranges */
	anchorBaseSha?: string;
};

export type ReviewResult = { result: AIReviewResult } | { error: { message: string } };

/**
 * Continuation knobs for {@link GraphInspectService.reviewChanges}. `mode: 'refine'` means
 * "follow up on the host-cached review conversation" — the prompt becomes a refine turn layered
 * on the prior exchanges instead of a fresh run. Absent (or no cached conversation) means a
 * fresh review.
 */
export type ReviewChangesOptions = {
	mode?: 'refine';
};

export type ReviewDetailResult = { result: AIReviewDetailResult } | { error: { message: string } };

export type AddressReviewFindingsResult =
	| { ok: true }
	| { ok: false; reason: 'no-agents' | 'no-ai-model' | 'error'; message?: string };

export interface AddressReviewFindingsArgs {
	repoPath: string;
	scopeLabel: string;
	reviewMarkdown: string;
	granularity: 'review' | 'focusArea' | 'finding';
	instructions?: string;
}

export type ProposedCommitFile = GitFileChangeShape & {
	/** Topmost layer this file's hunks come from in the AI-grouped commit. */
	anchor: 'unstaged' | 'staged' | 'committed';
	/** When `anchor === 'committed'`, the SHA the file is anchored to (HEAD at compose time). */
	anchorSha?: string;
};

export type ProposedCommit = {
	id: string;
	message: string;
	files: ProposedCommitFile[];
	additions: number;
	deletions: number;
	/** Exact unified diff that creates this commit on top of its predecessor in the plan. */
	patch: string;
	/**
	 * Virtual ref identifying this proposed commit in the `VirtualFileSystemService`. Populated when
	 * the host successfully started a virtual compose session; callers use it to open per-commit diffs
	 * via `FilesService.openVirtualFileComparePrevious`.
	 */
	virtualRef?: VirtualRefShape;
};

/** Plain-object form of a virtual ref, serializable across the host <-> webview IPC boundary. */
export type VirtualRefShape = {
	namespace: string;
	sessionId: string;
	commitId: string;
};

export type ComposeRewriteKind = 'wip-only' | 'wip+commits' | 'commits-only';

export type ComposeBaseCommit = {
	sha: string;
	message: string;
	author?: string;
	date?: string;
	/** Commit to rewrite from — HEAD for `wip-only`, else the parent of the oldest selected commit. */
	rewriteFromSha: string;
	kind: ComposeRewriteKind;
	/** Selected unpushed commits in topological order (child-first), when `kind` involves commits. */
	selectedShas?: string[];
};

/**
 * Identifies one compose session. The webview supplies the key of the anchor the compose is engaged
 * on — the same key it scopes run cancellation by — so the host's per-session state partitions the
 * way the UI does. Opaque to the host: it only ever compares and maps by it.
 *
 * Every compose is WIP-anchored today, so this is currently 1:1 with `repoPath`. Keying by it anyway
 * is what keeps that a webview detail: if compose ever becomes reachable from a second anchor on one
 * repo, two live sessions stay separate here instead of silently sharing a conversation and evicting
 * each other's plan.
 *
 * A repository path travels alongside it only where the handler needs one — to collect changes, to
 * apply a plan, or to re-derive the display commits after mutating one. The rest take the session and
 * cache keys alone.
 *
 * Branded, mirroring the webview's own `AnchorKey`, because it travels beside `repoPath` and
 * `cacheKey` on these RPCs — three bare strings would let a transposition through silently, which is
 * the exact class of mix-up keying by session instead of repo exists to prevent.
 */
export type ComposeSessionKey = string & { readonly __composeSessionKey: unique symbol };

/**
 * Refinement knobs for {@link composeChanges}. Present means "refine the cached plan
 * identified by `priorCacheKey`" — the webview passes back the cache key tracked locally,
 * plus any commits the user has locked in the UI. Absent means cold-start compose.
 */
export type ComposeChangesOptions = {
	priorCacheKey?: string;
	/** Mode marker — currently `'refine'` only. Reserved as a discriminator if other
	 *  continuation flavors are added later. */
	mode?: 'refine';
	/** Commit ids the user has locked in the UI. Forwarded to the library's `refinePlan` as
	 *  `lockedCommits` so the AI preserves them verbatim across the refinement. Ignored on
	 *  cold start. */
	excludedCommitIds?: readonly string[];
};

export type ComposeResult =
	| { result: { commits: ProposedCommit[]; baseCommit: ComposeBaseCommit; cacheKey?: string } }
	| {
			error: {
				message: string;
				/** `invalid-scope` = the selected scope cannot be rewritten (e.g. interior forks);
				 *  retrying identically fails, so the UI offers scope adjustment instead. */
				kind?: 'invalid-scope';
			};
	  }
	| { cancelled: true };

/** Result of {@link GraphInspectService.regenerateProposedCommitMessage}. On success the host has
 *  already mutated its cached plan; the new message is returned for the webview to swap into its
 *  rendered resource. */
export type RegenerateProposedCommitMessageResult =
	| { result: { commitId: string; message: string } }
	| { error: { message: string } }
	| { cancelled: true };

/** Result of {@link GraphInspectService.reorderProposedCommits}. On success the host has already
 *  reordered its cached plan to match; the webview keeps its optimistically-reordered array. */
export type ReorderProposedCommitsResult = { result: true } | { error: { message: string } };

/** Result of {@link GraphInspectService.moveComposeFile}. Unlike reorder, moving a file changes the
 *  affected commits' content (and may drop an emptied commit), so the host returns the re-derived
 *  `ProposedCommit[]` (display order) for the webview to swap in wholesale. */
export type MoveComposeFileResult = { result: { commits: ProposedCommit[] } } | { error: { message: string } };

export type ComposeCommitPlan = {
	commits: ProposedCommit[];
	base: ComposeBaseCommit;
	/** When provided, only commits whose `id` is in this list are applied. Undefined means all.
	 *  Excluded commits' hunks stay in the workdir as uncommitted changes (the library lays them
	 *  back via `git apply` from its leftover-patch path). */
	includedCommitIds?: readonly string[];
};

export type CommitResult = { success: true } | { success: true; warning: string } | { error: { message: string } };

export type BranchComparisonFile = CommitFileChange;

/** Phase 1 of the branch-compare progressive load: counts + the All Files diff. Smallest payload
 *  needed to render the panel meaningfully. Per-side commits + files are fetched lazily on tab
 *  activation via {@link BranchComparisonSide}. */
export type BranchComparisonSummary = {
	/** Commits reachable from rightRef (Compare) but not from leftRef (Base) — `git rev-list leftRef..rightRef`. */
	aheadCount: number;
	/** Commits reachable from leftRef (Base) but not from rightRef (Compare) — `git rev-list rightRef..leftRef`. */
	behindCount: number;
	allFilesCount: number;
	/** Files from the unified 2-dot `leftRef..rightRef` diff (Base → Compare), plus current worktree
	 *  files when enabled. */
	allFiles: readonly BranchComparisonFile[];
	/** Path of the worktree currently checked out at rightRef (the Compare side), if any. The Base
	 *  side's (leftRef) worktree is intentionally not tracked — IWT only reads the Compare side's
	 *  working tree, so exposing the Base side's would invite asymmetric comparisons we don't support. */
	rightRefWorktreePath?: string;
	/** Merge base of leftRef and rightRef, when one exists. Threaded to the panel so per-side file
	 *  lists and file actions anchor on the divergence point (Ahead = `mergeBase..Compare`,
	 *  Behind = `mergeBase..Base`) instead of the symmetric 2-dot diff. Undefined for disjoint refs. */
	mergeBase?: string;
};

/** Phase 2: a single side's commits, with files for the entire side.
 *  Per-commit files are fetched lazily when a specific commit is selected. */
export type BranchComparisonSide = {
	commits: BranchComparisonCommit[];
	/** Union of all file changes across this side's commits */
	files: BranchComparisonFile[];
	/** True when there are more commits beyond the returned slice — drives the panel's "Load
	 *  More" affordance. Falls back to `false` if the underlying log call didn't return a result. */
	hasMore: boolean;
};

export type BranchComparisonCommit = {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	authorEmail?: string;
	avatarUrl?: string;
	/** Committer identity (avatar overlay + hover) — set only when the committer differs from the author. */
	committerAvatarUrl?: string;
	committerName?: string;
	committerEmail?: string;
	committerDate?: string;
	date: string;
	additions?: number;
	deletions?: number;
	/** This commit's file changes — fetched lazily when the commit is selected in the UI */
	files?: BranchComparisonFile[];
};

export type BranchComparisonOptions = {
	includeWorkingTree?: boolean;
	/** Cap on the number of commits returned by `getBranchComparisonSide`. Defaults to 100 when
	 *  unset. Bumped by the panel's "Load More" affordance via the limit-replace pattern: the
	 *  side is re-fetched with a larger limit, idempotently superseding the smaller result. */
	limit?: number;
	/** Optional merge base, reused from the summary fetch to avoid a duplicate `git merge-base`
	 *  call on the side fetch. When omitted, the side fetch resolves its own merge base. */
	mergeBase?: string;
};

export type BranchComparisonContributorsScope = 'all' | 'ahead' | 'behind';

export type BranchComparisonContributor = {
	name: string;
	email?: string;
	avatarUrl?: string;
	commits: number;
	additions: number;
	deletions: number;
	files: number;
	current?: boolean;
};

export type BranchComparisonContributorsResult = {
	contributors: BranchComparisonContributor[];
};

export type BranchCommitEntry = {
	sha: string;
	message: string;
	author: string;
	avatarUrl?: string;
	date: string;
	fileCount: number;
	additions?: number;
	deletions?: number;
	pushed: boolean;
};

export type BranchCommitsResult = {
	commits: BranchCommitEntry[];
	mergeBase?: { sha: string; message: string; author?: string; avatarUrl?: string; date?: string };
	hasMore: boolean;
};

export interface BranchCommitsOptions {
	limit?: number;
	/** When true, allow extending past the merge base into ancestor history if the
	 *  current merge-base scope can't fill the requested page. Set by `Load more` so
	 *  the user can opt into older history even with no unpushed/WIP changes. */
	includePastMergeBase?: boolean;
}

export interface GraphInspectService {
	getAiExcludedFiles(repoPath: string, filePaths: string[]): Promise<string[]>;
	getBranchCommits(
		repoPath: string,
		options?: BranchCommitsOptions,
		signal?: AbortSignal,
	): Promise<BranchCommitsResult>;
	getCommit(repoPath: string, sha: string, signal?: AbortSignal): Promise<CommitDetails | undefined>;
	getCompareDiff(repoPath: string, from: string, to: string, signal?: AbortSignal): Promise<CompareDiff | undefined>;
	/**
	 * Returns the active graph search context for the given commit (or `undefined` when no
	 * file-scoped search is active). Drives match highlighting + the filter button in the
	 * embedded file trees so they reflect the graph's current search state.
	 */
	getSearchContext(sha: string): Promise<GitCommitSearchContext | undefined>;
	getWip(repoPath: string, signal?: AbortSignal, force?: boolean): Promise<{ wip: Wip } | undefined>;
	explainCommit(repoPath: string, sha: string, prompt?: string, signal?: AbortSignal): Promise<ExplainResult>;
	explainCompare(
		repoPath: string,
		fromSha: string,
		toSha: string,
		prompt?: string,
		signal?: AbortSignal,
	): Promise<ExplainResult>;
	generateChangelogCompare(repoPath: string, fromRef: string, toRef: string, signal?: AbortSignal): Promise<void>;
	/** Resolve the newest tag reachable from — and older than — the given tag, for a
	 *  previous-tag → this-tag changelog default. Returns `undefined` when there's no prior tag. */
	getPreviousTag(
		repoPath: string,
		tagName: string,
		tagSha: string,
		signal?: AbortSignal,
	): Promise<string | undefined>;
	getScopeFiles(repoPath: string, scope: ScopeSelection, signal?: AbortSignal): Promise<ScopeFile[]>;
	reviewChanges(
		repoPath: string,
		scope: ScopeSelection,
		prompt?: string,
		excludedFiles?: string[],
		signal?: AbortSignal,
		options?: ReviewChangesOptions,
	): Promise<ReviewResult>;
	reviewFocusArea(
		repoPath: string,
		scope: ScopeSelection,
		focusAreaId: string,
		focusAreaFiles: string[],
		overviewContext: string,
		prompt?: string,
		excludedFiles?: string[],
		signal?: AbortSignal,
	): Promise<ReviewDetailResult>;
	/**
	 * Sends the review findings (entire review, a focus area, or a single finding) to the user's
	 * AI agent chat. The webview pre-renders the markdown so Copy and Send-to-agent produce
	 * byte-identical content. Returns an `ok: false` result when no chat host is available, no
	 * AI model is selected, or the dispatch fails — the webview surfaces these inline.
	 */
	addressReviewFindingsInChat(args: AddressReviewFindingsArgs): Promise<AddressReviewFindingsResult>;
	/**
	 * Fire-and-forget telemetry hop for review-panel actions that happen entirely in the webview
	 * (clipboard copies). Granularity distinguishes review-wide vs per-focus-area vs per-finding
	 * actions so dashboards can compare which scopes users actually copy.
	 */
	trackReviewAction(args: { action: 'copy'; granularity: 'review' | 'focusArea' | 'finding' }): Promise<void>;
	generateCommitMessage(
		repoPath: string,
		currentMessage: string | undefined,
		amend: { sha: string; all: boolean } | undefined,
		signal?: AbortSignal,
	): Promise<{ summary: string; body?: string } | undefined>;
	pickCoauthors(repoPath: string, currentMessage: string | undefined): Promise<string[] | undefined>;
	composeChanges(
		repoPath: string,
		sessionKey: ComposeSessionKey,
		scope: ScopeSelection,
		instructions?: string,
		excludedFiles?: string[],
		aiExcludedFiles?: string[],
		signal?: AbortSignal,
		options?: ComposeChangesOptions,
	): Promise<ComposeResult>;
	commitCompose(repoPath: string, sessionKey: ComposeSessionKey, plan: ComposeCommitPlan): Promise<CommitResult>;
	/**
	 * Ends a compose session the webview has dropped its handle on — Discard, the Restart-then-close
	 * destroy, and the registry clear on a repository switch. Releases the cached plan and closes the
	 * session's conversation, which otherwise linger until the next compose on that session or panel
	 * teardown.
	 *
	 * `cacheKey` is the plan the webview believed the session held. The host acts only while that still
	 * matches what it holds, so a call arriving after the user has started a new compose cannot tear down
	 * the newer plan or its conversation. Passing `undefined` is a no-op for the same reason: a session
	 * still waiting on its first generate also holds no plan, so there is nothing to tell those two
	 * states apart. A session that never produced a plan is continued by a retry or flushed on dispose.
	 */
	discardCompose(sessionKey: ComposeSessionKey, cacheKey: string | undefined): Promise<void>;
	/**
	 * Regenerate the commit message for a single draft commit in the cached plan identified
	 * by `cacheKey`. Uses GitLens's internal `ai.actions.generateCommitMessage` against a patch
	 * rebuilt from the cached hunks (with AI-excluded file content re-masked, matching the
	 * convention of the original compose run). The host mutates the cached plan's
	 * `allOrderedCommits[i].message` in place so subsequent refines pick up the new message
	 * via the locked-commit substitution path, and so apply uses the regenerated message.
	 *
	 * Independent of hunk assignments and other commits' messages — only the targeted commit's
	 * message field changes.
	 */
	regenerateProposedCommitMessage(
		sessionKey: ComposeSessionKey,
		cacheKey: string,
		commitId: string,
		signal?: AbortSignal,
	): Promise<RegenerateProposedCommitMessageResult>;
	/**
	 * Reorder the draft commits in the cached plan identified by `cacheKey`. `orderedCommitIds`
	 * is the full set of the plan's commit ids in the new **library** order (tip last). The host
	 * reorders `allOrderedCommits` and the per-branch id lists in place so apply and any
	 * subsequent refine honor the new sequence. Pure in-memory reorder — no AI, no git.
	 */
	reorderProposedCommits(
		sessionKey: ComposeSessionKey,
		cacheKey: string,
		orderedCommitIds: string[],
	): Promise<ReorderProposedCommitsResult>;
	/**
	 * Move the files in `paths` from the `fromCommitId` draft commit to `toCommitId` in the cached
	 * plan identified by `cacheKey` (reassigns those files' hunks in a single mutation). Emptied
	 * source commits are pruned. The host re-derives and returns the affected plan's `ProposedCommit[]`
	 * in display order.
	 */
	moveComposeFile(
		repoPath: string,
		sessionKey: ComposeSessionKey,
		cacheKey: string,
		fromCommitId: string,
		toCommitId: string,
		paths: string[],
	): Promise<MoveComposeFileResult>;
	/** Streams human-readable progress messages while {@link composeChanges} runs. `undefined`
	 *  fires when no compose is in flight (entry/exit clearing). */
	readonly onComposeProgress: RpcEventSubscription<ComposeProgressUpdate | undefined>;
	/**
	 * Resolves the repo's merge/rebase/cherry-pick conflicts with AI via `@gitkraken/conflict-tools`.
	 * When `focusedFilePaths` is set, only those conflicted files are resolved; otherwise all conflicts.
	 * The resolved content is cached host-side (keyed by repo) for a later {@link applyResolutions}.
	 */
	resolveConflicts(
		repoPath: string,
		focusedFilePaths: readonly string[] | undefined,
		instructions?: string,
		signal?: AbortSignal,
	): Promise<ResolveResult>;
	/** Re-resolves a single cached-session file with user `feedback` (rendered as the resolver's
	 *  `userGuidance`), replacing that file's resolution in place. The other files are untouched. */
	reresolveFile(
		repoPath: string,
		filePath: string,
		feedback: string,
		signal?: AbortSignal,
	): Promise<ReresolveFileResult>;
	/** Writes the cached AI resolutions to the working tree and stages them. When `includedFilePaths`
	 *  is set, only those files are applied; `undefined` applies all (skipped files are never applied). */
	applyResolutions(repoPath: string, includedFilePaths?: readonly string[]): Promise<CommitResult>;
	/** Drops the host-side cached resolve session for the repo without writing anything. */
	discardResolutions(repoPath: string): Promise<void>;
	/** Queues a manual take-side resolution for a single conflicted file — the fallback for files the
	 *  AI resolver skipped or errored on. Like AI resolutions, it's cached as pending and only written
	 *  to the working tree on {@link applyResolutions} (and dropped by {@link discardResolutions}); it
	 *  does NOT touch the working tree immediately. Returns every file queued so the panel can promote
	 *  the matching rows without re-running the AI. */
	takeConflictSide(repoPath: string, filePath: string, side: ConflictSide): Promise<TakeConflictSideResult>;
	/** Streams human-readable progress messages while {@link resolveConflicts} runs. `undefined`
	 *  fires when no resolve is in flight (entry/exit clearing). */
	readonly onResolveProgress: RpcEventSubscription<ResolveProgressUpdate | undefined>;
	/**
	 * One-shot pickup of an automatic rebase's escalation handoff: when automation stopped
	 * mid-step, this seeds the repo's resolve session with the step's already-computed resolutions
	 * (adopting the run's AI conversation) and returns them so the panel opens in its ready state.
	 * `undefined` when there's nothing to hand off.
	 */
	getSeededResolveSession(repoPath: string): Promise<ResolveResult | undefined>;
	/**
	 * Builds the automatic rebase summary for the repo's session (validating undo eligibility at
	 * fetch time) and lazily registers the per-step virtual diff sessions backing each file's
	 * `virtualRef`. `undefined` when the repo has no session.
	 */
	getAutoRebaseSummary(repoPath: string): Promise<AutoRebaseSummaryResult | undefined>;
	/** Rolls the branch back to its pre-rebase tip — validated (refuses if the branch has moved).
	 *  `sessionId` guards against acting on a different run than the summary being shown. */
	undoAutoRebase(repoPath: string, sessionId: string): Promise<UndoAutoRebaseResult>;
	/** Re-engages automatic rebase (takeover) to finish the remaining steps after an escalation was
	 *  resolved manually — resumes the same session in place. Fire-and-forget: returns once triggered,
	 *  not when the resumed rebase finishes. */
	resumeAutoRebase(repoPath: string): Promise<void>;
	/** Streams the live state of an automatic rebase run so the Resolve panel can show its steps and
	 *  progress. `undefined` fires when the repo has no session left (dismissed). */
	readonly onAutoRebaseProgress: RpcEventSubscription<AutoRebaseRunUpdate | undefined>;
	/** Aborts a running automatic rebase, restoring the branch to its pre-rebase state. */
	cancelAutoRebase(repoPath: string): Promise<void>;
	/** Releases the auto-rebase summary's virtual diff sessions when its sheet closes — keeps
	 *  sessions alive for any diff still open in an editor tab. Fire-and-forget. */
	endAutoRebaseSummarySession(): Promise<void>;
	/** Phase 1 of the branch-compare progressive load — counts + All Files only. Triggered on
	 *  refs/wip change. Per-side commit + file data is fetched separately via {@link getBranchComparisonSide}. */
	getBranchComparisonSummary(
		repoPath: string,
		leftRef: string,
		rightRef: string,
		options?: BranchComparisonOptions,
		signal?: AbortSignal,
	): Promise<BranchComparisonSummary | undefined>;
	/** Phase 2 — that side's commits with per-commit files inline. Lazy on first activation of
	 *  Ahead or Behind. Subsequent tab switches and commit selections on that side are pure
	 *  client-side filtering. */
	getBranchComparisonSide(
		repoPath: string,
		leftRef: string,
		rightRef: string,
		side: 'ahead' | 'behind',
		options?: BranchComparisonOptions,
		signal?: AbortSignal,
	): Promise<BranchComparisonSide | undefined>;
	getContributorsForBranchComparison(
		repoPath: string,
		leftRef: string,
		rightRef: string,
		scope: BranchComparisonContributorsScope,
		signal?: AbortSignal,
	): Promise<BranchComparisonContributorsResult | undefined>;
	chooseRef(
		repoPath: string,
		title: string,
		picked?: string,
	): Promise<{ name: string; sha: string; refType: 'branch' | 'tag' | 'commit' } | undefined>;
	getMergeTargetComparisonRef(repoPath: string, branchName?: string): Promise<string | undefined>;
	/** Reveals the current compare-mode comparison as a saved node in the Search & Compare view —
	 *  the persistence escape hatch for users who want to keep an ad-hoc graph comparison around. */
	openComparisonInSearchAndCompare(repoPath: string, leftRef: string, rightRef: string): Promise<void>;
}

export interface GraphSidebarService {
	/** `displayed` reports whether the sidebar is actually on screen. The panel data itself is cheap
	 *  (~7ms, assembled from the loaded graph session) and is ALWAYS returned; the flag only suppresses the
	 *  per-worktree git fan-out the worktrees branch kicks off, which is the expensive part. Omitted/undefined
	 *  fails OPEN (compute), so a caller that doesn't know stays on the old behavior. */
	getSidebarData(
		panel: GraphSidebarPanel,
		options?: { displayed?: boolean },
		signal?: AbortSignal,
	): Promise<DidGetSidebarDataParams>;
	getSidebarCounts(): Promise<DidGetCountParams>;
	/**
	 * On-demand working-tree breakdown for ONE worktree, driven by its row tooltip opening. `null` means
	 * "settled, no data" (no status available) — distinct from a rejection, so the tooltip can land on a
	 * terminal state instead of spinning.
	 *
	 * Deliberately NOT `GetWipStatsRequest`: that handler skips the primary repo path and collapses
	 * config-off into an empty response, neither of which suits a tooltip the user explicitly opened. This
	 * goes straight to the shared 10s status cache instead, so it still joins any concurrent read for the
	 * same worktree. (Those batches no longer cross-cancel — each owns its token — but they still answer a
	 * different question than a single deliberate hover.)
	 */
	getWorktreeWipStats(path: string, signal?: AbortSignal): Promise<GitDiffFileStats | null>;
	/** Looks up one pull request by number, for the Focus pane's search fallback — the panel lists only
	 *  open PRs, so a pasted URL for a merged or closed one isn't in the loaded set. */
	findPullRequest(number: string): Promise<GraphSidebarPullRequest | undefined>;
	toggleLayout(panel: GraphSidebarPanel): void;
	toggleShowRemoteBranches(): void;
	refresh(panel: GraphSidebarPanel): void;
	executeAction(command: GlCommands, context?: string, args?: unknown[]): void;

	onSidebarInvalidated: RpcEventSubscription<undefined>;
	onWorktreeStateChanged: RpcEventSubscription<{ changes: Record<string, SidebarWorktreeChange | undefined> }>;
}

/**
 * Everything the app knows about the active search. Always a COMPLETE snapshot, never a delta —
 * `onDidChange` is `save-last` buffered, so a hidden webview keeps only the newest emission and a
 * delta would silently lose the batches in between. `undefined` means no active search.
 */
export interface GraphSearchState {
	query: SearchQuery;
	results: GraphSearchResults | GraphSearchResultsError | undefined;
	/** Host still producing results — includes background continuations the app never asked for. */
	searching: boolean;
	/** Set when the pattern failed to compile as a regex and the search matched literally instead. */
	fallback?: { matchedAs: 'literal'; detail?: string };
	/** Counted broader alternatives, offered when a natural-language search settles with 0 results. */
	relaxations?: GraphSearchRelaxation[];
}

/**
 * A search's answer to the caller that asked for it. `state` is what the search settled on;
 * `revealSha` is a one-shot instruction to scroll there, deliberately NOT part of {@link GraphSearchState}
 * — state is replayed on reconnect, and replaying a scroll moves the user somewhere they never asked to go.
 */
export interface GraphSearchResponse {
	state: GraphSearchState;
	revealSha?: string;
}

export interface GraphSearchService {
	/**
	 * Runs a search, resolving with its final state — or `undefined` when the caller's `signal` aborted,
	 * which is also how a newer search supersedes an older one (the client owns one signal per search).
	 * Interim states arrive on {@link onDidChange}.
	 */
	search(params: SearchParams, signal?: AbortSignal): Promise<GraphSearchResponse | undefined>;
	/** The active search, for seeding a freshly connected app. Pull-based, so no emission can be lost
	 *  to a teardown race the way a pushed one can. */
	getState(): Promise<GraphSearchState | undefined>;
	/** Stops the active search's WORK — every host-side operation, including background continuations
	 *  the data controller runs under its own signal (which aborting `search`'s request signal cannot
	 *  reach) — while keeping the accumulated results and the resume cursor. The pause behind the search
	 *  box's stop button; emits nothing, since the pausing app settles its own UI. */
	cancel(): void;
	/** Drops the active search and everything accumulated for it. */
	clear(): void;
	/** Persists the sticky search preferences. `searchMode: undefined` leaves the mode untouched (and
	 *  the active search's filter unrewritten) — for an NL-preference change without a mode choice. */
	setMode(searchMode: GraphSearchMode | undefined, useNaturalLanguage: boolean): void;
	openInView(search: SearchQuery): void;
	/** Asks AI to repair a query git refused to compile. */
	repair(query: string, detail?: string): Promise<DidSearchRepairParams>;
	getHistory(): Promise<DidSearchHistoryGetParams>;
	storeHistory(search: SearchQuery): Promise<DidSearchHistoryGetParams>;
	deleteHistory(query: string): Promise<DidSearchHistoryGetParams>;

	/** Authoritative for host-initiated changes (background continuations, repo swap); advisory during a
	 *  client-initiated `search`, whose true answer is that call's return value. Both carry the same
	 *  complete snapshot, so the app applies them identically. */
	onDidChange: RpcEventSubscription<GraphSearchState | undefined>;
	/** An external request to run a search in the graph (deep link, command, another surface). */
	onDidRequestSearch: RpcEventSubscription<DidRequestSearchParams>;
}

export interface GraphTimelineService {
	/**
	 * Fetch the dataset for the Graph webview's Timeline display mode. Delegates to the same
	 * shared `buildTimelineDataset` builder the standalone Visual History webview uses, so the
	 * data is identical across surfaces.
	 */
	getDataset(
		scope: TimelineScopeSerialized,
		config: TimelineConfig,
		signal?: AbortSignal,
	): Promise<TimelineDatasetResult>;
	/**
	 * Return all SHAs (across branches) of commits that touched a given path. One
	 * `git log --all --pretty=%H -- <path>` under the hood — way cheaper than `getDataset` for
	 * the embedded Graph timeline, where the webview already has per-commit reachability and
	 * stats from `graphState.rows` and only needs a SHA filter. Returns SHAs in
	 * topological-newest-first order so callers don't need to re-sort.
	 */
	getShasForPath(repoPath: string, path: string, signal?: AbortSignal): Promise<readonly string[]>;
	/** Show the file/folder revision picker; result is what the user chose (or `undefined` if
	 *  they cancelled). The Graph timeline mode lets users scope the visualization to a path
	 *  the same way the standalone Visual History does. */
	choosePath(params: ChoosePathParams): Promise<DidChoosePathParams>;
}

export interface GraphTreemapService {
	/**
	 * Fetch the per-repo file tree + commit-frequency aggregate for the Graph webview's Treemap
	 * visualization. The host caches per-repo aggregates so toggling between Files/Commits modes
	 * doesn't re-walk the file system. Frequencies are scoped via `config` (branch visibility,
	 * additional refs, window) so the treemap mirrors what the Graph is currently showing.
	 *
	 * Agent activity (used by the Activity mode) is not part of this service — the webview already
	 * receives `AgentSessionState[]` via `AgentsService.onSessionsChanged` and reads
	 * `session.fileActivity` directly. No separate streaming RPC is needed.
	 */
	getData(repoPath: string, mode: TreemapMode, config: TreemapConfig, signal?: AbortSignal): Promise<TreemapData>;
}

/**
 * Everything the Graph's gating reads: the current subscription, the repo-scoped `allowed` verdict,
 * and the active graph feature preview. Always a COMPLETE snapshot, never a delta — `onAccessChanged`
 * is `save-last` buffered, so a hidden webview keeps only the newest emission.
 *
 * The three travel together because the app derives two walls from them (`isAccountGated` from
 * `subscription`, the plan gate from `allowed`) — splitting them across events would let the walls
 * disagree between paints.
 */
export interface GraphAccessState {
	subscription: Subscription;
	allowed: boolean;
	featurePreview: FeaturePreview | undefined;
}

export interface GraphAccessService {
	/** The current access snapshot, for seeding a freshly connected app. Pull-based, so no emission
	 *  can be lost to a subscribe/fetch race. */
	getAccess(): Promise<GraphAccessState>;
	/**
	 * Fires on a subscription change that doesn't warrant a full state rebuild, and on a graph
	 * feature-preview start. Deliberately silent on the account-access and Pro-access flips: those
	 * push a full state instead, so un-gating can't land before `repositories` does.
	 */
	readonly onAccessChanged: RpcEventSubscription<GraphAccessState>;
}

export interface GraphWelcomeService {
	/** One message for the whole welcome-continue interaction — persists the dismissals and
	 *  performs the layout move in one causally-ordered handler, so nothing races the webview
	 *  teardown the move triggers. */
	continueToGraph(options: { layoutChoice: 'sidebar' | 'panel' | 'dismissed' }): Promise<void>;
}

/** The active repo's last-fetched snapshot. `lastFetched` is epoch-ms (0 means never fetched), matching
 *  `Repository.getLastFetched()` — never a `Date`, which would arrive over RPC as an ISO string. */
export interface GraphRepoStatus {
	repoPath: string;
	lastFetched: number;
}

export interface GraphRepoStatusService {
	/** The active repo's last-fetched snapshot, for seeding a freshly connected app. Pull-based, so no
	 *  emission fired between subscribe and fetch is ever lost. `undefined` when there's no active repo. */
	getLastFetched(): Promise<GraphRepoStatus | undefined>;
	/**
	 * Fires whenever the active repo's last-fetched time changes, including the periodic re-fire that
	 * only refreshes the relative-time label (`ensureLastFetchedSubscription` in the host). Carries
	 * `repoPath` so the app can ignore an event for a repo other than the one currently selected —
	 * without it a fetch completing for a background repo could stamp the display of a different one.
	 * `save-last`: latest-wins is correct since only the current repo's fetch matters to the app.
	 */
	readonly onDidFetch: RpcEventSubscription<GraphRepoStatus>;
}

/**
 * Scope-anchor resolution plane: the merge-base/merge-target lookup behind Focus on Branch and the
 * row marker. `error` is set (not thrown) when the resolver fails — callers depend on always getting
 * back a usable `scope`, falling back to the caller-supplied one.
 */
export interface GraphScopeService {
	resolveScope(repoPath: string, scope: GraphScope, signal?: AbortSignal): Promise<DidResolveGraphScopeParams>;
	/**
	 * Fires whenever refs/config move in a way that may stale a resolved anchor (heads/remotes change,
	 * repo swap, force-refresh). Carries the repo the change was detected in, but consumers should treat
	 * an invalidation as repo-agnostic and sweep every cached anchor: like `_sidebarInvalidatedEvent`,
	 * this is buffered as a coalescing `signal` while the webview is hidden — a hidden webview only ever
	 * replays ONE pending wake-up per event key, so a second repo's invalidation arriving while hidden
	 * would otherwise be lost if a consumer scoped its sweep to a single `repoPath`. Over-invalidating is
	 * cheap; losing an invalidation isn't.
	 */
	readonly onScopeAnchorsInvalidated: RpcEventSubscription<{ repoPath: string }>;
}

/**
 * Config/display-mode plane: the graph's persisted settings (minimap, auto-fetch, details
 * location, etc.) and the active Graph/Visualizations/Kanban display mode.
 */
export interface GraphConfigurationService {
	/** The current component config, for seeding a freshly connected app. Pull-based, so no
	 *  emission fired between subscribe and fetch is ever lost. */
	getConfiguration(): Promise<GraphComponentConfig>;
	/**
	 * Persists `changes` to the underlying settings and resolves once every write has landed.
	 * Resolving does NOT itself push the new config — that arrives separately via
	 * {@link onDidChange} once the settings watcher observes the write, matching the value a
	 * `configuration.get` would now return.
	 */
	update(changes: Partial<GraphComponentConfig>): Promise<void>;
	setDisplayMode(mode: GraphDisplayMode): Promise<void>;
	/** Fires with the complete component config snapshot whenever it changes — a settings write
	 *  (including one made through {@link update}, once its watcher echo lands) or a relevant
	 *  workspace/window setting changing out from under the webview. `save-last`: the payload is
	 *  always a complete snapshot, so a hidden webview only ever needs the newest one. */
	readonly onDidChange: RpcEventSubscription<GraphComponentConfig>;
}

/**
 * Everything the columns + scroll-markers plane pushes: the resolved column settings plus the three
 * `vscode-context` JSON strings its menus hang off. Always a COMPLETE snapshot, never a delta —
 * `onDidChange` is `save-last` buffered, so a hidden webview keeps only the newest emission.
 *
 * The four travel together because `settingsContext` (the gear menu's context) is derived from the
 * column settings AND from the scroll-marker settings: two writers, one field. Splitting them across
 * events would let one writer's push stale the other's.
 */
export interface GraphColumnsState {
	columns: GraphColumnsSettings;
	/** Column-header right-click context (`gitlens:graph:columns`). */
	headerContext?: string;
	/** Gear-menu context (`gitlens:graph:settings`) — derived from columns AND scroll markers. */
	settingsContext?: string;
	/** Marker-rail right-click context (`gitlens:graph:scrollMarkers`). */
	scrollMarkersContext?: string;
}

/**
 * Columns + scroll-markers plane: column visibility/width/order/grouping, the Changes column's mode
 * and stats consent, and the contexts backing the column, gear, and marker-rail menus.
 */
export interface GraphColumnsService {
	/** The current columns snapshot, for seeding a freshly connected app. Pull-based, so no emission
	 *  fired between subscribe and fetch is ever lost. */
	getColumns(): Promise<GraphColumnsState>;
	/**
	 * Persists a webview-authored columns write (widths, order, hide/show, grouping), resolving AFTER
	 * the storage write lands and {@link onDidChange} has fired. Callers use that happens-after edge to
	 * know their own write is no longer outstanding. `mode` is host-owned and ignored here.
	 */
	setColumns(config: GraphColumnsConfig): Promise<void>;
	/** The Changes header mode picker's pick — a real setting (`graph.changesColumn.mode`), so the write
	 *  is effective-scoped and its echo arrives via the settings watcher. Other columns are ignored. */
	setColumnMode(name: GraphColumnName, mode: ColumnMode | undefined): Promise<void>;
	/** The dormant Changes column's one-time stats consent (`graph.changesColumn.enabled`). */
	enableChangesColumn(): Promise<void>;
	readonly onDidChange: RpcEventSubscription<GraphColumnsState>;
}

/**
 * Everything the filters plane pushes: branch visibility, the hidden ref/type sets, the resolved
 * include-only refs, and the pinned ref. Always a COMPLETE snapshot, never a delta — `onDidChange` is
 * `save-last` buffered, so a hidden webview keeps only the newest emission.
 *
 * The pinned ref travels with the rest because all five are rebuilt wholesale from the same
 * `graph:filtersByRepo` storage record — splitting them across events would let two paints disagree.
 */
export interface GraphFiltersState {
	branchesVisibility: GraphBranchesVisibility;
	excludeRefs?: GraphExcludeRefs;
	excludeTypes?: GraphExcludeTypes;
	includeOnlyRefs?: GraphIncludeOnlyRefs;
	pinnedRef?: GraphPinnedRef;
}

/**
 * Filters plane: which refs the graph shows (branch visibility, hidden refs, hidden types, include-only
 * refs) plus the pinned ref.
 *
 * Every write resolves AFTER its storage write has landed and {@link onDidChange} has fired, so callers
 * can treat resolution as a happens-after edge. The resulting STATE, however, arrives at the app one
 * transport hop later on that event — a caller that must re-read settled state after a write still has
 * to wait for the push.
 */
export interface GraphFiltersService {
	/** The current filters snapshot, for seeding a freshly connected app. Pull-based, so no emission
	 *  fired between subscribe and fetch is ever lost. */
	getFilters(): Promise<GraphFiltersState>;
	/** Hides (`visible: false`) or un-hides the given refs. Hiding a whole remote (`name: '*'`) replaces
	 *  any existing wildcard for that owner; un-hiding a branch under an active wildcard excepts it. */
	setRefsVisibility(refs: GraphExcludedRef[], visible: boolean): Promise<void>;
	/** Pins a ref to the graph's edge, or clears the pin with `null`. */
	setPinnedRef(ref: GraphPinnedRef | null): Promise<void>;
	setExcludeType(key: keyof GraphExcludeTypes, value: boolean): Promise<void>;
	/** `branchesVisibility: undefined` leaves the mode untouched; `refs: undefined`/empty clears the
	 *  stored include-only set. */
	setIncludedRefs(branchesVisibility?: GraphBranchesVisibility, refs?: GraphIncludeOnlyRef[]): Promise<void>;
	/** Clears every stored filter for the active repo. Fires even when nothing changed — the snapshot is
	 *  complete, so a redundant push is harmless, and the app's deferred scope clear runs off the push. */
	reset(): Promise<void>;
	readonly onDidChange: RpcEventSubscription<GraphFiltersState>;
}

/**
 * Overview panel data plane: the active/recent branch composition plus its WIP and PR/issue
 * enrichment. `getOverview` also accepts an updated `recentThreshold` and older-branches
 * `olderLimit`, mirroring the legacy request's dual role (read + persist the "Recent" timeframe
 * and "Load More" paging).
 */
export interface GraphOverviewService {
	getOverview(params?: GetOverviewParams, signal?: AbortSignal): Promise<GraphOverviewData>;
	/**
	 * Cheap (dirty/clean only) or full WIP breakdown for the given branches, depending on `cheap`.
	 * Cache-backed on the host, so repeat calls for branches with a warm entry cost no extra `git status`.
	 */
	getWip(branchIds: string[], cheap?: boolean, signal?: AbortSignal): Promise<GetOverviewWipResponse>;
	/** On-demand fetch of the full WIP breakdown (add/changed/deleted), driven by the rich hover so the
	 *  eager overview load can stay on the cheap clean/dirty path of {@link getWip}. */
	getWipDetailed(branchIds: string[], signal?: AbortSignal): Promise<GetOverviewWipResponse>;
	getEnrichment(branchIds: string[], signal?: AbortSignal): Promise<GetOverviewEnrichmentResponse>;
	/** Pushed whenever the host recomputes the overview (graph reload, repo/visibility/filter change) —
	 *  deep-equal deduped on the host, so a hidden webview replays only the latest genuine change. */
	readonly onOverviewChanged: RpcEventSubscription<GraphOverviewData>;
}

export interface GraphWipService {
	/** Per-file working-tree line stats for `repoPath`, keyed by repo-relative (normalized) path.
	 *  Fetched lazily via a single `git diff HEAD --numstat` (incl. untracked) only while the WIP file
	 *  list is shown — the every-tick `wip` push carries file status only, never line counts. */
	getLineStats(repoPath: string, signal?: AbortSignal): Promise<GetWipLineStatsResponse | undefined>;
}

/**
 * Row hover markdown for the graph's tooltip/peek card. Single-flight on the host — a newer call
 * (or `signal` aborting) always supersedes an outstanding one; two overlapping calls collapse to the
 * newer one's result. Never rejects: a rejected RPC promise would leave the hover card waiting
 * instead of falling back — see the host implementation's outer catch.
 */
export interface GraphHoverService {
	getRowHover(type: GitGraphRowKind, id: string, signal?: AbortSignal): Promise<DidGetRowHoverParams>;
}

/**
 * Native quick-pick pickers for the search box's `author:`/`ref:`/`compare:`/`file:`/`folder:`
 * operators. No `signal` — VS Code's quick-pick APIs don't take a cancellation token, and a picker
 * is closed by the user, not superseded by another call.
 */
export interface GraphPickersService {
	chooseRef(
		title: string,
		placeholder: string,
		options?: {
			allowedAdditionalInput?: ReferencesQuickPickOptions2['allowedAdditionalInput'];
			include?: ReferencesQuickPickOptions2['include'];
			picked?: string;
		},
	): Promise<DidChooseRefParams>;
	chooseComparison(title: string): Promise<DidChooseComparisonParams>;
	chooseAuthor(title: string, placeholder: string, picked?: string[]): Promise<DidChooseAuthorParams>;
	chooseFile(
		title: string,
		type: 'file' | 'folder',
		options?: { openLabel?: string; picked?: string[] },
	): Promise<DidChooseFileParams>;
}

export interface GraphPullRequestService {
	/** `number` is the user-facing PR number (not a provider-internal id). `confirmed` skips the
	 *  host's own merge-blast-radius quickpick — set when the caller already confirmed in place. */
	merge(
		number: string,
		options?: { confirmed?: boolean; mergeMethod?: 'merge' | 'squash' | 'rebase' },
	): Promise<MergePullRequestResult>;
}

/**
 * Repository Health data plane for the Health visualization. Every method delegates to the
 * container's `GitHealthService`, which the auto tier already drives — this contract is what finally
 * gives those APIs a consumer.
 *
 * Apply and revert deliberately PROPAGATE failures rather than swallowing them: the auto tier catches
 * and logs because nothing is watching, but here a person clicked, so an error has to reach the view.
 */
export interface GraphHealthService {
	getReport(repoPath: string, signal?: AbortSignal): Promise<GitHealthReport | undefined>;
	/** Per-lever rows — status, ownership, and the verbatim reason when a lever can't be used here. */
	getLevers(repoPath: string, signal?: AbortSignal): Promise<GitHealthLever[]>;
	getDetails(repoPath: string, signal?: AbortSignal): Promise<GitHealthDetails>;
	applyFix(repoPath: string, id: GitOptimizationId, signal?: AbortSignal): Promise<boolean>;
	revertFix(repoPath: string, id: GitOptimizationId, signal?: AbortSignal): Promise<void>;
	runMaintenance(repoPath: string, signal?: AbortSignal): Promise<{ task: GitMaintenanceTask; ran: boolean }[]>;
	/** Enables or disables GitLens's automatic commit-graph maintenance for this repo. User-clicked, so failures propagate. */
	setCommitGraphEnabled(repoPath: string, enabled: boolean, signal?: AbortSignal): Promise<void>;
	/** Evidence-gated banner state for the graph's Git Health strip and the Visualizations toggle's evidence dot. */
	getBannerState(repoPath: string, signal?: AbortSignal): Promise<GitHealthBannerState | undefined>;
	/** Dismisses the Git Health banner strip for a repo. */
	dismissBanner(repoPath: string): Promise<void>;
	/** Records a Repository Health view visit for a repo, suppressing the banner and its indicator. */
	markHealthViewVisited(repoPath: string): Promise<void>;

	/** Fires with the repo path after any probe, apply, revert, or maintenance pass changes that repo's report. */
	readonly onHealthChanged: RpcEventSubscription<{ repoPath: string }>;
}

export interface GraphServices extends SharedWebviewServices {
	readonly access: GraphAccessService;
	readonly columns: GraphColumnsService;
	readonly configuration: GraphConfigurationService;
	readonly filters: GraphFiltersService;
	readonly graphInspect: GraphInspectService;
	readonly graphHealth: GraphHealthService;
	readonly launchpad: GraphLaunchpadService;
	readonly walkthrough: GraphWalkthroughService;
	readonly sidebar: GraphSidebarService;
	readonly search: GraphSearchService;
	readonly welcome: GraphWelcomeService;
	readonly graphTimeline: GraphTimelineService;
	readonly graphTreemap: GraphTreemapService;
	readonly repoStatus: GraphRepoStatusService;
	readonly scope: GraphScopeService;
	readonly overview: GraphOverviewService;
	readonly wip: GraphWipService;
	readonly hover: GraphHoverService;
	readonly pickers: GraphPickersService;
	readonly pullRequest: GraphPullRequestService;
}

export interface GraphLaunchpadService {
	/** Fires when Launchpad items change (PR status updates, integration connection changes, etc.).
	 *  The host impl (`LaunchpadService`) already exposes this; consumed by the graph header's
	 *  Launchpad indicator to keep its counts fresh. */
	readonly onLaunchpadChanged: RpcEventSubscription<undefined>;
	getSummary(options?: {
		force?: boolean;
	}): Promise<LaunchpadSummaryResult | { error: LaunchpadSummaryError } | undefined>;
}

export interface GraphWalkthroughService {
	/** Fires when either walkthrough's progress changes — the payload carries both the main
	 *  (7-step) and graph-specific (6-step) walkthroughs. The host impl (`WalkthroughService`)
	 *  already exposes this. */
	readonly onProgressChanged: RpcEventSubscription<WalkthroughProgressPayload>;
	getProgress(): Promise<WalkthroughProgressPayload | undefined>;
}
