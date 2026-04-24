import type { AIReviewDetailResult, AIReviewResult } from '@gitlens/ai/models/results.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
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

export type BranchComparisonResult = {
	aheadCount: number;
	behindCount: number;
	aheadCommits: BranchComparisonCommit[];
	behindCommits: BranchComparisonCommit[];
	aheadFiles: readonly CommitFileChange[];
	behindFiles: readonly CommitFileChange[];
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
};

export type BranchComparisonOptions = {
	includeWorkingTree?: boolean;
	scopeToCommit?: string;
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
};

export interface GraphInspectService {
	getAiExcludedFiles(repoPath: string, filePaths: string[]): Promise<string[]>;
	getBranchCommits(repoPath: string, signal?: AbortSignal): Promise<BranchCommitsResult>;
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
	getBranchComparison(
		repoPath: string,
		leftRef: string,
		rightRef: string,
		options?: BranchComparisonOptions,
		signal?: AbortSignal,
	): Promise<BranchComparisonResult | undefined>;
	chooseRef(repoPath: string, title: string, picked?: string): Promise<{ name: string; sha: string } | undefined>;
	getDefaultComparisonRef(repoPath: string): Promise<string | undefined>;
}

export interface GraphSidebarService {
	getSidebarData(panel: GraphSidebarPanel, signal?: AbortSignal): Promise<DidGetSidebarDataParams>;
	getSidebarCounts(): Promise<DidGetCountParams>;
	toggleLayout(panel: GraphSidebarPanel): void;
	refresh(panel: GraphSidebarPanel): void;
	executeAction(command: string, context?: string): void;

	onSidebarInvalidated: RpcEventSubscription<undefined>;
	onWorktreeStateChanged: RpcEventSubscription<{ changes: Record<string, boolean | undefined> }>;
}

export interface GraphServices extends SharedWebviewServices {
	readonly graphInspect: GraphInspectService;
	readonly sidebar: GraphSidebarService;
}
