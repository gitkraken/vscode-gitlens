import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import type { BranchDisposition, GitBranch } from '../models/branch.js';
import type { GitCommitStats } from '../models/commit.js';
import type { GitContributor } from '../models/contributor.js';
import type { ConflictDetectionResult } from '../models/mergeConflicts.js';
import type { PullRequest } from '../models/pullRequest.js';
import type { GitBranchReference } from '../models/reference.js';
import type { BranchSortOptions } from '../utils/sorting.js';

export interface BranchContributionsOverview extends GitCommitStats<number> {
	readonly repoPath: string;
	readonly branch: string;
	readonly mergeTarget: string;
	readonly mergeBase: string;
	/** Committer date of the merge-base commit. Lets consumers (e.g. the graph minimap scope window) anchor on the same date semantics as the minimap aggregation without a separate commit fetch. */
	readonly mergeBaseDate: Date | undefined;

	readonly commits: number;
	readonly latestCommitDate: Date | undefined;
	readonly firstCommitDate: Date | undefined;

	readonly contributors: GitContributor[];
}

export type MergeDetectionConfidence = 'highest' | 'high' | 'medium';

export type GitBranchMergedStatus =
	| { merged: false }
	| { merged: true; confidence: MergeDetectionConfidence; localBranchOnly?: GitBranchReference };

export interface GitBranchesSubProvider {
	getBranch(repoPath: string, name?: string, cancellation?: AbortSignal): Promise<GitBranch | undefined>;
	getBranches(
		repoPath: string,
		options?: {
			filter?: ((b: GitBranch) => boolean) | undefined;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			paging?: PagingOptions | undefined;
			sort?: boolean | BranchSortOptions | undefined;
		},
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitBranch>>;
	getBranchContributionsOverview(
		repoPath: string,
		ref: string,
		options?: { associatedPullRequest?: Promise<PullRequest | undefined> },
		cancellation?: AbortSignal,
	): Promise<BranchContributionsOverview | undefined>;
	getBranchesWithCommits(
		repoPath: string,
		shas: string[],
		branch?: string,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
		cancellation?: AbortSignal,
	): Promise<string[]>;
	getDefaultBranchName(
		repoPath: string | undefined,
		remote?: string,
		cancellation?: AbortSignal,
	): Promise<string | undefined>;

	/**
	 * Creates a new local branch.
	 * @param ref SHA or ref (branch, tag, remote-tracking ref) the new branch will point at.
	 */
	createBranch?(repoPath: string, name: string, ref: string, options?: { noTracking?: boolean }): Promise<void>;
	deleteLocalBranch?(repoPath: string, names: string | string[], options?: { force?: boolean }): Promise<void>;
	deleteRemoteBranch?(repoPath: string, names: string | string[], remote: string): Promise<void>;
	getBranchMergedStatus?(
		repoPath: string,
		branch: GitBranchReference,
		into: GitBranchReference,
		cancellation?: AbortSignal,
	): Promise<GitBranchMergedStatus>;
	/** @internal not intended to be used outside of the sub-providers */
	getCurrentBranchReference?(repoPath: string, cancellation?: AbortSignal): Promise<GitBranchReference | undefined>;
	getLocalBranchByUpstream?(
		repoPath: string,
		remoteBranchName: string,
		cancellation?: AbortSignal,
	): Promise<GitBranch | undefined>;
	getPotentialApplyConflicts?(
		repoPath: string,
		targetBranch: string,
		shas: string[],
		options?: { stopOnFirstConflict?: boolean },
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult>;
	getPotentialMergeConflicts?(
		repoPath: string,
		branch: string,
		targetBranch: string,
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult>;
	getBaseBranchName?(repoPath: string, ref: string, cancellation?: AbortSignal): Promise<string | undefined>;
	getStoredMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	getStoredDetectedMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	getStoredUserMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	onCurrentBranchAccessed?(repoPath: string): Promise<void>;
	onCurrentBranchModified?(repoPath: string): Promise<void>;
	onCurrentBranchAgentActivity?(repoPath: string): Promise<void>;
	renameBranch?(repoPath: string, oldName: string, newName: string): Promise<void>;
	setUpstreamBranch?(repoPath: string, name: string, upstream: string | undefined): Promise<void>;
	setBranchDisposition?(
		repoPath: string,
		branchName: string,
		disposition: BranchDisposition | undefined,
	): Promise<void>;
	storeBaseBranchName?(repoPath: string, ref: string, base: string): Promise<void>;
	storeMergeTargetBranchName?(repoPath: string, ref: string, target: string): Promise<void>;
	storeUserMergeTargetBranchName?(repoPath: string, ref: string, target: string | undefined): Promise<void>;
}
