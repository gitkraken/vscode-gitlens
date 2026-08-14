import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitHealthLever, GitHealthReport } from '@gitlens/git/gitHealth.js';
import type { GitDiffFileStats } from '@gitlens/git/models/diff.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GitHealthDetails, GitMaintenanceTask, GitOptimizationId } from '@gitlens/git/providers/maintenance.js';
import type { ConflictKind } from '@gitlens/git/utils/conflictResolution.utils.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { ConsultedTool } from '../../../plus/coretools/conflict/consultation.js';
import type { LaunchpadSummaryError, LaunchpadSummaryResult } from '../../../plus/launchpad/launchpadIndicator.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { RpcEventSubscription } from '../../rpc/services/types.js';
import type { WalkthroughProgressPayload } from '../../rpc/walkthroughService.js';
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
	DidGetCountParams,
	DidGetSidebarDataParams,
	GraphSidebarPanel,
	GraphSidebarPullRequest,
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
		scope: ScopeSelection,
		instructions?: string,
		excludedFiles?: string[],
		aiExcludedFiles?: string[],
		signal?: AbortSignal,
		options?: ComposeChangesOptions,
	): Promise<ComposeResult>;
	commitCompose(repoPath: string, plan: ComposeCommitPlan): Promise<CommitResult>;
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
		repoPath: string,
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
		repoPath: string,
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
	 * receives `AgentSessionState[]` via `DidChangeAgentSessionsNotification` and reads
	 * `session.fileActivity` directly. No separate streaming RPC is needed.
	 */
	getData(repoPath: string, mode: TreemapMode, config: TreemapConfig, signal?: AbortSignal): Promise<TreemapData>;
}

export interface GraphWelcomeService {
	/** One message for the whole welcome-continue interaction — persists the dismissals and
	 *  performs the layout move in one causally-ordered handler, so nothing races the webview
	 *  teardown the move triggers. */
	continueToGraph(options: { layoutChoice: 'sidebar' | 'panel' | 'dismissed' }): Promise<void>;
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

	/** Fires with the repo path after any probe, apply, revert, or maintenance pass changes that repo's report. */
	readonly onHealthChanged: RpcEventSubscription<{ repoPath: string }>;
}

export interface GraphServices extends SharedWebviewServices {
	readonly graphInspect: GraphInspectService;
	readonly graphHealth: GraphHealthService;
	readonly launchpad: GraphLaunchpadService;
	readonly walkthrough: GraphWalkthroughService;
	readonly sidebar: GraphSidebarService;
	readonly welcome: GraphWelcomeService;
	readonly graphTimeline: GraphTimelineService;
	readonly graphTreemap: GraphTreemapService;
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
