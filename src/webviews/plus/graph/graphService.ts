import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { ExplainResult } from '../../commitDetails/commitDetailsService.js';
import type { SharedWebviewServices } from '../../rpc/services/common.js';
import type { RpcEventSubscription } from '../../rpc/services/types.js';
import type { CommitDetails, CommitFileChange, CompareDiff, Wip } from './detailsProtocol.js';
import type { DidGetCountParams, DidGetSidebarDataParams, GraphSidebarPanel } from './protocol.js';

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
	| { error: { message: string } };

export type ComposeCommitPlan = {
	commits: ProposedCommit[];
	base: ComposeBaseCommit;
	mode: 'all' | 'up-to';
	upToIndex?: number;
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

/** Phase 2: a single side's commits, with per-commit files inline so selection scoping is purely
 *  client-side. Cached per `(repoPath, leftRef, rightRef, side, includeWorkingTree)`. */
export type BranchComparisonSide = {
	commits: BranchComparisonCommit[];
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
	/** This commit's file changes — included inline so selecting the commit can filter the file
	 *  list without an additional fetch. */
	files: BranchComparisonFile[];
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
	generateCommitMessage(repoPath: string): Promise<{ summary: string; body?: string } | undefined>;
	composeChanges(
		repoPath: string,
		scope: ScopeSelection,
		instructions?: string,
		excludedFiles?: string[],
		signal?: AbortSignal,
	): Promise<ComposeResult>;
	commitCompose(repoPath: string, plan: ComposeCommitPlan): Promise<CommitResult>;
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
	getDefaultComparisonRef(repoPath: string): Promise<string | undefined>;
}

export interface GraphSidebarService {
	getSidebarData(panel: GraphSidebarPanel, signal?: AbortSignal): Promise<DidGetSidebarDataParams>;
	getSidebarCounts(): Promise<DidGetCountParams>;
	toggleLayout(panel: GraphSidebarPanel): void;
	refresh(panel: GraphSidebarPanel): void;
	executeAction(command: GlCommands, context?: string): void;

	onSidebarInvalidated: RpcEventSubscription<undefined>;
	onWorktreeStateChanged: RpcEventSubscription<{ changes: Record<string, boolean | undefined> }>;
}

export interface GraphServices extends SharedWebviewServices {
	readonly graphInspect: GraphInspectService;
	readonly sidebar: GraphSidebarService;
}
