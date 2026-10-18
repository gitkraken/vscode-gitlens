import type { PagedResult, PagingOptions } from '@gitlens/utils/paging.js';
import type { GkConfigInvalidationTarget } from '../cache.js';
import type { BranchDisposition, GitBranch } from '../models/branch.js';
import type { GitCommitStats } from '../models/commit.js';
import type { GitContributor } from '../models/contributor.js';
import type { ConflictDetectionResult } from '../models/mergeConflicts.js';
import type { PullRequest } from '../models/pullRequest.js';
import type { GitBranchReference } from '../models/reference.js';
import type { GitCommandPriority } from '../run.types.js';
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

/** Which source decided a base (see `getAheadOfBase`) */
export type AheadOfBaseTier = 'preferred' | 'user' | 'detected' | 'recorded' | 'created' | 'default' | 'upstream';

export interface AheadOfBase {
	/** The base HEAD was measured against; `undefined` when there is none (see `getAheadOfBase`) */
	readonly base:
		| {
				/** The ref the count was taken against: the chosen base or its tracking ref, whichever forked nearer HEAD */
				readonly ref: string;
				/** Commits on HEAD not on `ref` */
				readonly ahead: number;
				/** The commit `ref` pointed at, from the cached ref list; `undefined` when no listed ref matches it */
				readonly sha: string | undefined;
				/** Where HEAD forked from `ref`: git's `--fork-point` reading of `ref`'s reflog, else the merge base; `undefined` when they share no history */
				readonly forkPoint: string | undefined;
				/** The source the base came from: the `preferredTarget` option, the user's merge target, the detected one, the base recorded against the branch, the branch git's reflog says this branch was created from (unless the default branch forked strictly nearer HEAD), the default branch, or — when the branch is the default branch — the branch's own upstream */
				readonly tier: AheadOfBaseTier;
		  }
		| undefined;
	/** Why there is no base; set exactly when `base` is `undefined`: `'none'` when nothing resolved, `'self'` when the base is the branch itself at HEAD's commit (or the default branch has no upstream to measure against), `'unborn'` when HEAD has no commit yet */
	readonly reason?: 'none' | 'self' | 'unborn';
	/** Full ref names (`refs/heads/main`, `refs/remotes/origin/main`, `refs/remotes/origin/HEAD`) whose movement can change this answer, given with or without a base so a watcher also learns when one appears: the branch, every candidate compared up to the chosen one, their tracking refs, the default-branch symrefs and the `<remote>/main`/`<remote>/master` refs when the default was consulted, the `upstream` remote's copy of the created-from or default branch when it was compared, and the branch's upstream when it is the default branch. Lets a watcher recompute only when one of them moves. */
	readonly dependsOn: readonly string[];
}

export type MergeDetectionConfidence = 'highest' | 'high' | 'medium';

export type GitBranchMergedStatus =
	| { merged: false }
	| { merged: true; confidence: MergeDetectionConfidence; localBranchOnly?: GitBranchReference };

export interface GitBranchesSubProvider {
	getBranch(
		repoPath: string,
		name?: string,
		/** `force`: skips the cached answer and any in-flight read that started before this call, and stores the fresh answer. */
		options?: { force?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitBranch | undefined>;
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
		options?: { associatedPullRequest?: Promise<PullRequest | undefined>; priority?: GitCommandPriority },
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
		/**
		 * `local`: resolve only from the local `refs/remotes/<remote>/HEAD` symref and never contact the
		 * remote (no `remote set-head` / `ls-remote`). Returns `undefined` when it isn't resolved locally
		 * yet. Use on latency-sensitive paths (e.g. the graph) where a network round-trip is unwanted.
		 */
		options?: { priority?: GitCommandPriority; local?: boolean },
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
	/** Detects conflicts when an autostash is reapplied onto the tree an integration produced */
	getPotentialStashReapplyConflicts?(
		repoPath: string,
		ontoTreeOid: string,
		cancellation?: AbortSignal,
	): Promise<ConflictDetectionResult>;
	/**
	 * How far HEAD has moved past the base `branch` (the branch checked out at HEAD, or `undefined` when HEAD is
	 * detached) was cut from. Candidates in trust
	 * order: the user's merge target, the detected one, then the base recorded against the branch — only recorded bases
	 * count, never a reflog guess. Each is measured as itself or its tracking ref, whichever forked nearer HEAD; a stale
	 * target (one naming no ref, a flag-like one, or the branch itself) falls through to the next, and the default branch
	 * is used when none survives: the `HEAD` symref of the `upstream` remote, else `origin`, else the first remote, as its
	 * local branch or else the remote ref; then, in the same remote order, `<remote>/main` or `<remote>/master`, again as
	 * the local branch or else the remote ref; then `init.defaultBranch`, `main`, `master` — from local refs only, never
	 * the network. On the default branch itself the base is its upstream (`upstream/<branch>` when an `upstream` remote has
	 * it, else `<branch>@{u}`), tier `'upstream'`. The count is the right side of `<base>...HEAD`. `base` is `undefined`
	 * when no base resolves, when the base is the branch itself (by name, or as its copy on one of the repo's remotes) at
	 * HEAD's own commit — or the default branch has no upstream — or when HEAD has no commit yet; `reason`
	 * then says which (`'none'`, `'self'` or `'unborn'`) and `dependsOn` is given either way. `base.sha` is the tip of
	 * `ref`, read from the cached ref list; `base.forkPoint` is where HEAD forked from `ref` and `base.tier` the source
	 * that decided the base. On a detached HEAD (`undefined`, or a name `isDetachedHead` recognizes) only the default branch
	 * is tried, as tier `'default'` and with no self check. Rejects when the count can't be read.
	 *
	 * `options.skipUserTarget` leaves the user's merge target out, giving the order a merge-target picker shows as
	 * "automatic". `options.preferredTarget` is tried before every other source, also on a detached HEAD, and measured
	 * like a recorded candidate (tier `'preferred'`); one that is unusable — naming no ref, flag-like, the branch itself,
	 * or the branch's copy on one of the repo's remotes at HEAD's own commit — falls through to the usual order.
	 * Tier `'preferred'` means the preferred target is the base; any other tier, or no base, means it fell through.
	 */
	getAheadOfBase?(
		repoPath: string,
		branch: string | undefined,
		options?: {
			/** Leaves the user's merge target out: the order a merge-target picker shows as "automatic" */
			skipUserTarget?: boolean;
			/** A target to try before every other source */
			preferredTarget?: string;
		},
		cancellation?: AbortSignal,
	): Promise<AheadOfBase>;
	/**
	 * How far each branch has diverged from `base`, keyed by full ref name (`refs/heads/x`, plus `refs/remotes/<remote>/x`
	 * when `options.remotes` is set) so a local and a remote name can't collide. Symbolic refs such as
	 * `refs/remotes/origin/HEAD` are left out. `ahead` is the commits on the branch that `base` lacks and `behind` the
	 * commits on `base` that the branch lacks, i.e. the right and left sides of `base...branch`. `options.refs` limits it to
	 * those full ref names (in place of `remotes`), so a host counts only the branches it shows; an empty list answers
	 * empty without running git. One git run on git 2.41+, a bounded count per distinct tip before that. Rejects when
	 * `base` can't be resolved or the counts can't be read.
	 */
	getAheadBehindCounts?(
		repoPath: string,
		base: string,
		options?: { remotes?: boolean; refs?: readonly string[] },
		cancellation?: AbortSignal,
	): Promise<Map<string, { ahead: number; behind: number }>>;
	/**
	 * The branches whose tips are reachable from `into`, as full ref names (`refs/heads/x`, plus `refs/remotes/<remote>/x`
	 * when `options.remotes` is set). Ancestry only: a branch squash-merged or cherry-picked into `into` is not included,
	 * so use `getBranchMergedStatus` for that heuristic per-branch answer. A branch whose tip equals `into`'s tip (never
	 * diverged) is included, as git reports it. Symbolic refs such as `refs/remotes/origin/HEAD` are left out. One git
	 * run. Not cached. Rejects when `into` can't be resolved or the branches can't be read.
	 */
	getMergedBranches?(
		repoPath: string,
		into: string,
		options?: { remotes?: boolean },
		cancellation?: AbortSignal,
	): Promise<Set<string>>;
	getBaseBranchName?(
		repoPath: string,
		ref: string,
		options?: { priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	getStoredMergeTargetBranchName?(
		repoPath: string,
		ref: string,
		options?: { detectedOnly?: boolean; priority?: GitCommandPriority },
		cancellation?: AbortSignal,
	): Promise<string | undefined>;
	getStoredDetectedMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	getStoredUserMergeTargetBranchName?(repoPath: string, ref: string): Promise<string | undefined>;
	/**
	 * Stamps `branch.<name>.gk-last-accessed` in `.git/gk/config` for the branch checked out at `repoPath`, when the
	 * host checks it out or opens it. A no-op for a detached HEAD or no branch. Each key's write is attempted at most
	 * once per 5 minutes per branch, failed or not, and not when its stored value, from any process, is under 5 minutes
	 * old. Calls for different repositories never drop each other, and the promise settles once the write is done and
	 * never rejects.
	 */
	onCurrentBranchAccessed?(repoPath: string): Promise<void>;
	/**
	 * Stamps `gk-last-modified` and `gk-last-accessed`: the checkout's working tree or index changed while on the
	 * branch — file edits and staging, not only commits. Otherwise as {@link onCurrentBranchAccessed}.
	 */
	onCurrentBranchModified?(repoPath: string): Promise<void>;
	/** Stamps `gk-agent-last-activity`: an AI agent worked in the checkout. Otherwise as {@link onCurrentBranchAccessed} */
	onCurrentBranchAgentActivity?(repoPath: string): Promise<void>;
	renameBranch?(repoPath: string, oldName: string, newName: string): Promise<void>;
	setUpstreamBranch?(repoPath: string, name: string, upstream: string | undefined): Promise<void>;
	setBranchDisposition?(
		repoPath: string,
		branchName: string,
		disposition: BranchDisposition | undefined,
	): Promise<void>;
	storeBaseBranchName?(
		repoPath: string,
		ref: string,
		base: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void>;
	storeMergeTargetBranchName?(
		repoPath: string,
		ref: string,
		target: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): Promise<void>;
	storeUserMergeTargetBranchName?(repoPath: string, ref: string, target: string | undefined): Promise<void>;
}
