import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { RpcEventSubscription } from '../../rpc/services/types.js';
import type {
	ChoosePathParams,
	DidChoosePathParams,
	TimelineConfig,
	TimelineDatasetResult,
	TimelineScopeSerialized,
} from '../timeline/protocol.js';
import type { CommitDetails, CommitFileChange, CompareDiff, Wip } from './detailsProtocol.js';
import type { DidGetCountParams, DidGetSidebarDataParams, GraphSidebarPanel } from './protocol.js';

export type ComposeProgressUpdate = { phase: string; message: string };

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

export type ReviewResult = { result: AIReviewResult } | { error: { message: string } };

export type ReviewDetailResult = { result: AIReviewDetailResult } | { error: { message: string } };

export type AddressReviewFindingsResult =
	| { ok: true }
	| { ok: false; reason: 'no-chat-host' | 'no-ai-model' | 'error'; message?: string };

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

export type ComposeResult =
	| { result: { commits: ProposedCommit[]; baseCommit: ComposeBaseCommit } }
	| { error: { message: string } }
	| { cancelled: true };

export type ComposeCommitPlan = {
	commits: ProposedCommit[];
	base: ComposeBaseCommit;
	/** When provided, only commits whose `id` is in this list are applied. `undefined` means all. */
	includedCommitIds?: readonly string[];
};

export type CommitResult = { success: true } | { success: true; warning: string } | { error: { message: string } };

export type BranchComparisonFile = CommitFileChange & {
	/** Marks files added from the current worktree when compare's worktree toggle is enabled. */
	source?: 'comparison' | 'workingTree';
};

/** Phase 1 of the branch-compare progressive load: counts + the All Files diff. Smallest payload
 *  needed to render the panel meaningfully. Per-side commits + files are fetched lazily on tab
 *  activation via {@link BranchComparisonSide}. */
export type BranchComparisonSummary = {
	aheadCount: number;
	behindCount: number;
	allFilesCount: number;
	/** Files from the unified 2-dot `right..left` diff, plus current worktree files when enabled. */
	allFiles: readonly BranchComparisonFile[];
};

/** Phase 2: a single side's commits, with files for the entire side.
 *  Per-commit files are fetched lazily when a specific commit is selected. */
export type BranchComparisonSide = {
	commits: BranchComparisonCommit[];
	/** Union of all file changes across this side's commits */
	files: BranchComparisonFile[];
};

export type BranchComparisonCommit = {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	authorEmail?: string;
	avatarUrl?: string;
	date: string;
	additions?: number;
	deletions?: number;
	/** This commit's file changes — fetched lazily when the commit is selected in the UI */
	files?: BranchComparisonFile[];
};

export type BranchComparisonOptions = {
	includeWorkingTree?: boolean;
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
	getWip(repoPath: string, signal?: AbortSignal): Promise<Wip | undefined>;
	explainCommit(repoPath: string, sha: string, prompt?: string, signal?: AbortSignal): Promise<ExplainResult>;
	explainCompare(
		repoPath: string,
		fromSha: string,
		toSha: string,
		prompt?: string,
		signal?: AbortSignal,
	): Promise<ExplainResult>;
	generateChangelogCompare(repoPath: string, fromRef: string, toRef: string, signal?: AbortSignal): Promise<void>;
	getScopeFiles(repoPath: string, scope: ScopeSelection, signal?: AbortSignal): Promise<GitFileChangeShape[]>;
	reviewChanges(
		repoPath: string,
		scope: ScopeSelection,
		prompt?: string,
		excludedFiles?: string[],
		signal?: AbortSignal,
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
	generateCommitMessage(repoPath: string): Promise<{ summary: string; body?: string } | undefined>;
	composeChanges(
		repoPath: string,
		scope: ScopeSelection,
		instructions?: string,
		excludedFiles?: string[],
		aiExcludedFiles?: string[],
		signal?: AbortSignal,
	): Promise<ComposeResult>;
	commitCompose(repoPath: string, plan: ComposeCommitPlan): Promise<CommitResult>;
	/** Streams human-readable progress messages while {@link composeChanges} runs. `undefined`
	 *  fires when no compose is in flight (entry/exit clearing). */
	readonly onComposeProgress: RpcEventSubscription<ComposeProgressUpdate | undefined>;
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
	chooseRef(repoPath: string, title: string, picked?: string): Promise<{ name: string; sha: string } | undefined>;
	getMergeTargetComparisonRef(repoPath: string, branchName?: string): Promise<string | undefined>;
	/** Reveals the current compare-mode comparison as a saved node in the Search & Compare view —
	 *  the persistence escape hatch for users who want to keep an ad-hoc graph comparison around. */
	openComparisonInSearchAndCompare(repoPath: string, leftRef: string, rightRef: string): Promise<void>;
}

export interface GraphSidebarService {
	getSidebarData(panel: GraphSidebarPanel, signal?: AbortSignal): Promise<DidGetSidebarDataParams>;
	getSidebarCounts(): Promise<DidGetCountParams>;
	toggleLayout(panel: GraphSidebarPanel): void;
	refresh(panel: GraphSidebarPanel): void;
	executeAction(command: GlCommands, context?: string, args?: unknown[]): void;

	onSidebarInvalidated: RpcEventSubscription<undefined>;
	onWorktreeStateChanged: RpcEventSubscription<{ changes: Record<string, boolean | undefined> }>;
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

export interface GraphServices extends SharedWebviewServices {
	readonly graphInspect: GraphInspectService;
	readonly sidebar: GraphSidebarService;
	readonly graphTimeline: GraphTimelineService;
}
