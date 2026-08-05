import { exhaustiveArray } from '@gitlens/utils/array.js';
import { raceWithSignal } from '@gitlens/utils/cancellation.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { invalidateMemoized } from '@gitlens/utils/decorators/memoize.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { PromiseOrValue } from '@gitlens/utils/promise.js';
import type { CacheController } from '@gitlens/utils/promiseCache.js';
import { PromiseCache, PromiseMap, RepoPromiseCacheMap } from '@gitlens/utils/promiseCache.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { ProgressiveGitBlame } from './models/blame.js';
import type { BranchMetadata, GitBranch } from './models/branch.js';
import type { GitCommit, GitStashCommit } from './models/commit.js';
import type { GitContributor, GitContributorsStats } from './models/contributor.js';
import type { ParsedGitDiffHunks } from './models/diff.js';
import type { GitLog } from './models/log.js';
import type { ConflictDetectionResult } from './models/mergeConflicts.js';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus.js';
import type { GitBranchReference, GitRefTip, RefRecord } from './models/reference.js';
import type { GitRemote } from './models/remote.js';
import type { RemoteProvider } from './models/remoteProvider.js';
import type { GitDir, RepositoryChange } from './models/repository.js';
import type { GitStash } from './models/stash.js';
import type { GitTag } from './models/tag.js';
import type { GitUser } from './models/user.js';
import type { GitWorktree } from './models/worktree.js';
import type { BranchContributionsOverview, GitBranchMergedStatus } from './providers/branches.js';
import type { GitCommitReachability, LeftRightCommitCountResult } from './providers/commits.js';
import type { GitContributorsResult } from './providers/contributors.js';
import type { ResolvedRevision } from './providers/revision.js';
import type { GitResult } from './run.types.js';
import { getBranchId } from './utils/branch.utils.js';
import { createReference } from './utils/reference.utils.js';
import { getCommonRepositoryPath, getRepositoryOrWorktreePath } from './utils/repository.utils.js';
import type { GitIgnoreFilter } from './watching/gitIgnoreFilter.js';

type RepoPath = string;

/** Cache types that are keyed by file path within a repo — support per-file clearing */
export type UriScopedCachedGitTypes = 'blame' | 'diff' | 'fileLog';

const uriScopedCachedGitTypes: UriScopedCachedGitTypes[] = ['blame', 'diff', 'fileLog'];
export function areUriScopedCachedGitTypes(types: string[]): types is UriScopedCachedGitTypes[] {
	return types.every(t => uriScopedCachedGitTypes.includes(t as UriScopedCachedGitTypes));
}

export type CachedGitTypes =
	| UriScopedCachedGitTypes
	| 'branch'
	| 'branches'
	| 'config'
	| 'contributors'
	| 'gitignore'
	| 'gkConfig'
	| 'lastFetched'
	| 'providers'
	| 'remotes'
	| 'stashes'
	| 'status'
	| 'tags'
	| 'tracking'
	| 'worktrees';

/**
 * What a gk-config reconcile did, so `Cache` knows whether the coarse fallback is still owed.
 *
 * `'deferred'` is NOT a failure — a pass already in flight folds the change into its trailing pass — and
 * must not trigger the fallback, or a burst of gk writes would coarse-clear on every one, which is exactly
 * the churn the key-aware reconcile replaced.
 */
export type GkReconcileOutcome = 'reconciled' | 'deferred' | 'failed';

export type ConflictDetectionCacheKey =
	| `apply:${string}:${string}:${string}`
	| `merge:${string}:${string}`
	| `reapply:${string}:${string}`;

/**
 * Ceiling on how long a derived branch base is trusted. Long enough that repeated reads during normal use
 * are served from cache, short enough that a base that changed by a route with no eviction signal (an
 * external delete-and-recreate of a branch that is never checked out) self-heals without a reload.
 */
const baseBranchNameTTL = 5 * 60 * 1000; // 5 minutes

/**
 * gkConfig keys that participate in the `branchOverviews` cache's mergeTarget/mergeBase lineage.
 * Capture group 1 is the ref name (which may itself contain `.`/`/`).
 */
const branchOverviewGkConfigKeysRegex = /^branch\.(.+)\.(?:gk-merge-(?:base|target(?:-user)?)|gk-target-base)$/;

/**
 * Downstream caches that `deleteGkConfig` may invalidate when a `branch.<ref>.gk-...` key changes.
 * Callers performing a "self-write" (where the value being written matches what they just resolved,
 * so the about-to-be-evicted entry is exactly the entry they want to preserve) can opt out by
 * naming the targets to skip via `skipInvalidation`.
 */
export type GkConfigInvalidationTarget = 'branchOverviews' | 'baseBranchName';

/** Per-worktree caches — cleared by repoPath directly */
interface Caches {
	bestRemotes: PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> | undefined;
	blame: RepoPromiseCacheMap<string, ProgressiveGitBlame | undefined> | undefined;
	branch: PromiseMap<RepoPath, GitBranch | undefined> | undefined;
	commit: RepoPromiseCacheMap<string, GitCommit | undefined> | undefined;
	commitCount: RepoPromiseCacheMap<string, number | undefined> | undefined;
	conflictDetection: RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult> | undefined;
	currentBranchReference: PromiseCache<RepoPath, GitBranchReference | undefined> | undefined;
	currentUser: Map<RepoPath, GitUser | null> | undefined;
	diff: RepoPromiseCacheMap<string, ParsedGitDiffHunks | undefined> | undefined;
	fileExistence: RepoPromiseCacheMap<string, boolean> | undefined;
	fileLog: RepoPromiseCacheMap<string, GitLog | undefined> | undefined;
	gitDir: Map<RepoPath, GitDir> | undefined;
	gitIgnore: Map<RepoPath, GitIgnoreFilter> | undefined;
	ignoreRevsFile: PromiseCache<string, boolean> | undefined;
	leftRightCommitCount: RepoPromiseCacheMap<string, LeftRightCommitCountResult | undefined> | undefined;
	mergeBase: RepoPromiseCacheMap<string, string | undefined> | undefined;
	pausedOperationStatus: PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined;
	reachability: RepoPromiseCacheMap<string, GitCommitReachability | undefined> | undefined;
	resolvedRevisions: RepoPromiseCacheMap<string, ResolvedRevision> | undefined;
	trackedPaths: RepoPromiseCacheMap<string, [string, string] | false> | undefined;
}

/** Shared caches — cleared via commonPath + all worktree paths */
interface SharedCaches {
	baseBranchName: RepoPromiseCacheMap<string, string | undefined> | undefined;
	branchMergedStatus: RepoPromiseCacheMap<string, GitBranchMergedStatus> | undefined;
	branchMetadataMap: PromiseMap<RepoPath, Map<string, BranchMetadata>> | undefined;
	branchOverviews: RepoPromiseCacheMap<string, BranchContributionsOverview | undefined> | undefined;
	branches: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	configKeys: RepoPromiseCacheMap<string, string | undefined> | undefined;
	configPatterns: RepoPromiseCacheMap<string, Map<string, string>> | undefined;
	contributors: RepoPromiseCacheMap<string, GitContributorsResult> | undefined;
	contributorsLite: RepoPromiseCacheMap<string, GitContributor[]> | undefined;
	contributorsStats: RepoPromiseCacheMap<string, GitContributorsStats | undefined> | undefined;
	defaultBranchName: RepoPromiseCacheMap<string, string | undefined> | undefined;
	gitResults: RepoPromiseCacheMap<string, GitResult> | undefined;
	gkConfigMap: PromiseMap<RepoPath, Map<string, string>> | undefined;
	initialCommitSha: PromiseMap<RepoPath, string | undefined> | undefined;
	/** Keyed by commonPath — `FETCH_HEAD` lives in the common git dir, shared across worktrees. */
	lastFetched: PromiseCache<RepoPath, number | undefined> | undefined;
	logShas: RepoPromiseCacheMap<string, string[]> | undefined;
	refs: PromiseMap<RepoPath, RefRecord[]> | undefined;
	refTips: PromiseMap<RepoPath, GitRefTip[]> | undefined;
	remotes: PromiseMap<RepoPath, GitRemote[]> | undefined;
	sharedBranches: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	stashes: RepoPromiseCacheMap<string, GitStash> | undefined;
	tags: PromiseMap<RepoPath, PagedResult<GitTag>> | undefined;
	worktrees: PromiseMap<RepoPath, GitWorktree[]> | undefined;
}

type AllCaches = Caches & SharedCaches;

/** Compile-time enforced: adding a key to SharedCaches without listing it here is a type error */
const sharedCacheKeys: ReadonlySet<keyof AllCaches> = new Set(
	exhaustiveArray<keyof SharedCaches>()([
		'baseBranchName',
		'branchMergedStatus',
		'branchMetadataMap',
		'branchOverviews',
		'branches',
		'configKeys',
		'configPatterns',
		'contributors',
		'contributorsLite',
		'contributorsStats',
		'defaultBranchName',
		'gitResults',
		'gkConfigMap',
		'initialCommitSha',
		'lastFetched',
		'logShas',
		'refs',
		'refTips',
		'remotes',
		'sharedBranches',
		'stashes',
		'tags',
		'worktrees',
	]),
);

function createEmptyCaches(): AllCaches {
	return {
		baseBranchName: undefined,
		bestRemotes: undefined,
		blame: undefined,
		branch: undefined,
		branchMergedStatus: undefined,
		branchMetadataMap: undefined,
		branchOverviews: undefined,
		branches: undefined,
		commit: undefined,
		commitCount: undefined,
		fileExistence: undefined,
		ignoreRevsFile: undefined,
		leftRightCommitCount: undefined,
		mergeBase: undefined,
		configKeys: undefined,
		configPatterns: undefined,
		conflictDetection: undefined,
		diff: undefined,
		fileLog: undefined,
		contributors: undefined,
		contributorsLite: undefined,
		contributorsStats: undefined,
		currentBranchReference: undefined,
		currentUser: undefined,
		defaultBranchName: undefined,
		gitDir: undefined,
		gitIgnore: undefined,
		gitResults: undefined,
		gkConfigMap: undefined,
		initialCommitSha: undefined,
		lastFetched: undefined,
		logShas: undefined,
		pausedOperationStatus: undefined,
		resolvedRevisions: undefined,
		reachability: undefined,
		refs: undefined,
		refTips: undefined,
		remotes: undefined,
		sharedBranches: undefined,
		stashes: undefined,
		tags: undefined,
		trackedPaths: undefined,
		worktrees: undefined,
	};
}

export class Cache implements Disposable {
	private _caches: AllCaches = createEmptyCaches();
	private _commonPathRegistry = new Map<RepoPath, string>();
	/** Reverse index: commonPath → set of worktree repoPaths that share it */
	private _worktreesByCommonPath = new Map<string, Set<RepoPath>>();
	/** Monotonic per-worktree "status clock" — see {@link getStatusGeneration}. */
	private _statusGenerations = new Map<RepoPath, number>();
	/** Monotonic per-path "close clock" — see {@link getCloseGeneration}. */
	private _closeGenerations = new Map<RepoPath, number>();

	/**
	 * Per-commonPath snapshot of the merge-relevant subset of `.git/gk/config` (keys matching
	 * {@link branchOverviewGkConfigKeysRegex}), used by {@link reconcileGkConfigMap} to diff a watcher
	 * `'gkConfig'` event down to only the keys that actually changed, instead of coarsely re-deriving
	 * `baseBranchName`/`branchOverviews` on every gk write. Absent means "never observed".
	 */
	private _gkConfigMergeSnapshots = new Map<string, Map<string, string>>();

	/**
	 * Reconciler registered by the CLI config sub-provider (see {@link setGkConfigReconciler}),
	 * invoked on a watcher-observed `'gkConfig'` change instead of the coarse `clearCaches(repoPath,
	 * 'gkConfig')` cascade. `undefined` (e.g. the GitHub provider, which has no `.git/gk/config`)
	 * falls back to the coarse clear.
	 */
	private _gkConfigReconciler:
		| ((
				repoPath: string,
				priorSnapshot: ReadonlyMap<string, string> | undefined,
		  ) => PromiseOrValue<GkReconcileOutcome>)
		| undefined;

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		this.reset();
	}

	get bestRemotes(): PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> {
		return (this._caches.bestRemotes ??= new PromiseMap<RepoPath, GitRemote<RemoteProvider>[]>());
	}

	get blame(): RepoPromiseCacheMap<string, ProgressiveGitBlame | undefined> {
		return (this._caches.blame ??= new RepoPromiseCacheMap<string, ProgressiveGitBlame | undefined>({
			createTTL: 1000 * 60 * 10, // 10 minutes
			capacity: 50,
		}));
	}

	get diff(): RepoPromiseCacheMap<string, ParsedGitDiffHunks | undefined> {
		return (this._caches.diff ??= new RepoPromiseCacheMap<string, ParsedGitDiffHunks | undefined>({
			createTTL: 1000 * 60 * 10, // 10 minutes
			capacity: 50,
		}));
	}

	get fileLog(): RepoPromiseCacheMap<string, GitLog | undefined> {
		return (this._caches.fileLog ??= new RepoPromiseCacheMap<string, GitLog | undefined>({
			createTTL: 1000 * 60 * 10, // 10 minutes
			capacity: 50,
		}));
	}

	private get baseBranchName(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._caches.baseBranchName ??= new RepoPromiseCacheMap<string, string | undefined>());
	}

	get branch(): PromiseMap<RepoPath, GitBranch | undefined> {
		return (this._caches.branch ??= new PromiseMap<RepoPath, GitBranch | undefined>());
	}

	get branchMergedStatus(): RepoPromiseCacheMap<string, GitBranchMergedStatus> {
		return (this._caches.branchMergedStatus ??= new RepoPromiseCacheMap<string, GitBranchMergedStatus>({
			createTTL: 1000 * 60 * 30, // 30 minutes — content-keyed on tip shas, so this is just a backstop
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 100, // Limit to 100 branch-pairs per repo
		}));
	}

	private get branchMetadataMap(): PromiseMap<RepoPath, Map<string, BranchMetadata>> {
		return (this._caches.branchMetadataMap ??= new PromiseMap<RepoPath, Map<string, BranchMetadata>>());
	}

	private get branchOverviews(): RepoPromiseCacheMap<string, BranchContributionsOverview | undefined> {
		return (this._caches.branchOverviews ??= new RepoPromiseCacheMap<
			string,
			BranchContributionsOverview | undefined
		>(
			{ accessTTL: 1000 * 60 * 60 }, // 60 minutes
		));
	}

	get branches(): PromiseMap<RepoPath, PagedResult<GitBranch>> {
		return (this._caches.branches ??= new PromiseMap<RepoPath, PagedResult<GitBranch>>());
	}

	/**
	 * Internal cache for raw shared branch data (keyed by commonPath)
	 * Separate from branches cache because branches need to be mapped for each worktree
	 */
	private get sharedBranches(): PromiseMap<RepoPath, PagedResult<GitBranch>> {
		return (this._caches.sharedBranches ??= new PromiseMap<RepoPath, PagedResult<GitBranch>>());
	}

	private get configKeys(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._caches.configKeys ??= new RepoPromiseCacheMap<string, string | undefined>({
			createTTL: 1000 * 30, // 30 seconds - ensures global config changes are picked up
		}));
	}

	private get configPatterns(): RepoPromiseCacheMap<string, Map<string, string>> {
		return (this._caches.configPatterns ??= new RepoPromiseCacheMap<string, Map<string, string>>({
			createTTL: 1000 * 30, // 30 seconds - ensures global config changes are picked up
		}));
	}

	private get gkConfigMap(): PromiseMap<RepoPath, Map<string, string>> {
		return (this._caches.gkConfigMap ??= new PromiseMap<RepoPath, Map<string, string>>());
	}

	get currentBranchReference(): PromiseCache<RepoPath, GitBranchReference | undefined> {
		return (this._caches.currentBranchReference ??= new PromiseCache<RepoPath, GitBranchReference | undefined>());
	}

	setCurrentBranchReferenceIfAbsent(worktreePath: string, reference: GitBranchReference | undefined): void {
		if (this.currentBranchReference.get(worktreePath) == null) {
			this.currentBranchReference.set(worktreePath, Promise.resolve(reference));
		}
	}

	get conflictDetection(): RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult> {
		return (this._caches.conflictDetection ??= new RepoPromiseCacheMap<
			ConflictDetectionCacheKey,
			ConflictDetectionResult
		>({
			createTTL: 1000 * 30, // 30 seconds
		}));
	}

	get contributors(): RepoPromiseCacheMap<string, GitContributorsResult> {
		return (this._caches.contributors ??= new RepoPromiseCacheMap<string, GitContributorsResult>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	get contributorsLite(): RepoPromiseCacheMap<string, GitContributor[]> {
		return (this._caches.contributorsLite ??= new RepoPromiseCacheMap<string, GitContributor[]>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	get contributorsStats(): RepoPromiseCacheMap<string, GitContributorsStats | undefined> {
		return (this._caches.contributorsStats ??= new RepoPromiseCacheMap<string, GitContributorsStats | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	get currentUser(): Map<RepoPath, GitUser | null> {
		return (this._caches.currentUser ??= new Map<RepoPath, GitUser | null>());
	}

	get defaultBranchName(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._caches.defaultBranchName ??= new RepoPromiseCacheMap<string, string | undefined>());
	}

	get gitDir(): Map<RepoPath, GitDir> {
		return (this._caches.gitDir ??= new Map<RepoPath, GitDir>());
	}

	get gitIgnore(): Map<RepoPath, GitIgnoreFilter> {
		return (this._caches.gitIgnore ??= new Map<RepoPath, GitIgnoreFilter>());
	}

	get gitResults(): RepoPromiseCacheMap<RepoPath, GitResult> {
		return (this._caches.gitResults ??= new RepoPromiseCacheMap<RepoPath, GitResult>({ capacity: 200 }));
	}

	get initialCommitSha(): PromiseMap<RepoPath, string | undefined> {
		return (this._caches.initialCommitSha ??= new PromiseMap<RepoPath, string | undefined>());
	}

	get lastFetched(): PromiseCache<RepoPath, number | undefined> {
		return (this._caches.lastFetched ??= new PromiseCache<RepoPath, number | undefined>({
			createTTL: 1000 * 30, // 30 seconds
		}));
	}

	get leftRightCommitCount(): RepoPromiseCacheMap<string, LeftRightCommitCountResult | undefined> {
		return (this._caches.leftRightCommitCount ??= new RepoPromiseCacheMap<
			string,
			LeftRightCommitCountResult | undefined
		>({
			createTTL: 1000 * 60 * 5, // 5 minutes max age — invalidated sooner on branch/remote changes
			capacity: 50, // Limit to 50 ref-pairs per repo
		}));
	}

	get commit(): RepoPromiseCacheMap<string, GitCommit | undefined> {
		return (this._caches.commit ??= new RepoPromiseCacheMap<string, GitCommit | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 100, // Limit to 100 commits per repo
		}));
	}

	get commitCount(): RepoPromiseCacheMap<string, number | undefined> {
		return (this._caches.commitCount ??= new RepoPromiseCacheMap<string, number | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 50,
		}));
	}

	get mergeBase(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._caches.mergeBase ??= new RepoPromiseCacheMap<string, string | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 50,
		}));
	}

	get logShas(): RepoPromiseCacheMap<string, string[]> {
		return (this._caches.logShas ??= new RepoPromiseCacheMap<string, string[]>({
			createTTL: 1000 * 60 * 5, // 5 minutes max age
			accessTTL: 1000 * 30, // 30 seconds if not accessed
			capacity: 5, // Limit to 5 different ranges per repo
		}));
	}

	get pausedOperationStatus(): PromiseMap<RepoPath, GitPausedOperationStatus | undefined> {
		return (this._caches.pausedOperationStatus ??= new PromiseMap<
			RepoPath,
			GitPausedOperationStatus | undefined
		>());
	}

	get resolvedRevisions(): RepoPromiseCacheMap<string, ResolvedRevision> {
		return (this._caches.resolvedRevisions ??= new RepoPromiseCacheMap<string, ResolvedRevision>({
			capacity: 100,
		}));
	}

	get refs(): PromiseMap<RepoPath, RefRecord[]> {
		return (this._caches.refs ??= new PromiseMap<RepoPath, RefRecord[]>());
	}

	get refTips(): PromiseMap<RepoPath, GitRefTip[]> {
		return (this._caches.refTips ??= new PromiseMap<RepoPath, GitRefTip[]>());
	}

	get reachability(): RepoPromiseCacheMap<string, GitCommitReachability | undefined> {
		return (this._caches.reachability ??= new RepoPromiseCacheMap<string, GitCommitReachability | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 25, // Limit to 25 commits per repo
		}));
	}

	get remotes(): PromiseMap<RepoPath, GitRemote[]> {
		return (this._caches.remotes ??= new PromiseMap<RepoPath, GitRemote[]>());
	}

	get stashes(): RepoPromiseCacheMap<string, GitStash> {
		return (this._caches.stashes ??= new RepoPromiseCacheMap<string, GitStash>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	get tags(): PromiseMap<RepoPath, PagedResult<GitTag>> {
		return (this._caches.tags ??= new PromiseMap<RepoPath, PagedResult<GitTag>>());
	}

	get fileExistence(): RepoPromiseCacheMap<string, boolean> {
		return (this._caches.fileExistence ??= new RepoPromiseCacheMap<string, boolean>({
			createTTL: 1000 * 10, // 10 seconds
			capacity: 100,
			expireOnError: true,
		}));
	}

	// Key: repoPath (not the ignoreRevsFile path) so that per-repo cache resets (clearCaches with repoPath)
	// correctly evict the entry. The actual file path is used inside the factory closure in blame.ts.
	get ignoreRevsFile(): PromiseCache<string, boolean> {
		return (this._caches.ignoreRevsFile ??= new PromiseCache<string, boolean>({
			accessTTL: 1000 * 60 * 60 * 2, // 2 hours
			expireOnError: true,
		}));
	}

	get trackedPaths(): RepoPromiseCacheMap<string, [string, string] | false> {
		return (this._caches.trackedPaths ??= new RepoPromiseCacheMap<string, [string, string] | false>({
			createTTL: 1000 * 60, // 60 seconds
			accessTTL: 1000 * 30, // 30 seconds idle
			capacity: 200,
		}));
	}

	get worktrees(): PromiseMap<RepoPath, GitWorktree[]> {
		return (this._caches.worktrees ??= new PromiseMap<RepoPath, GitWorktree[]>());
	}

	@debug({ onlyExit: true })
	clearCaches(repoPath: string | undefined, ...types: CachedGitTypes[]): void {
		const keysToClear = new Set<keyof AllCaches>();

		if (!types.length) {
			// Clear all caches
			for (const key of Object.keys(this._caches)) {
				keysToClear.add(key as keyof AllCaches);
			}

			invalidateMemoized('providers');
			this.incrementStatusGenerations(repoPath);
		} else {
			// Clear specific cache types
			if (types.includes('blame')) {
				keysToClear.add('blame');
			}
			if (types.includes('diff')) {
				keysToClear.add('diff');
			}
			if (types.includes('fileLog')) {
				keysToClear.add('fileLog');
			}

			// Branch caches affected by HEAD/heads changes. `branchMergedStatus` is deliberately NOT
			// cleared here — it's content-keyed on the involved tip shas, so tip movement already
			// self-invalidates (a new key); evicting it here would only discard still-valid answers.
			if (types.includes('branch') || types.includes('branches')) {
				keysToClear.add('branch');
				keysToClear.add('branchOverviews');
				// `commit`/`commitCount` are keyed by symbolic ref or SHA — symbolic-ref entries
				// can drift when branches move; cascade-clear conservatively.
				keysToClear.add('commit');
				keysToClear.add('commitCount');
				keysToClear.add('conflictDetection');
				keysToClear.add('currentBranchReference');
				keysToClear.add('leftRightCommitCount');
				// `mergeBase` keyed by ref-pairs — symbolic refs can move; cascade-clear.
				keysToClear.add('mergeBase');
				keysToClear.add('reachability');
				keysToClear.add('resolvedRevisions');
			}

			// Shared branch caches (branch list, metadata). `baseBranchName` is deliberately NOT cleared
			// here — a branch's base is set at creation and only changes when its stored key changes
			// (`gkConfig`/`config` below) or the branch itself is created/renamed/deleted. Every op that
			// does one of those calls `deleteBaseBranchName` and moves or drops the branch's persisted
			// `branch.<ref>.gk-*` keys: `createBranch`/`deleteLocalBranch`/`renameBranch`, plus the two
			// paths that create a branch as a side effect (`checkout -b`, `worktree add -b`). Tip movement
			// can't change a base, so clearing on every commit only forced a `git reflog` re-derivation.
			if (types.includes('branch')) {
				// `'branch'` comes from a HEAD change — a checkout — which appends `checkout: moving from X
				// to Y` to the reflog, exactly the entry `getBaseBranchName` greps for when nothing is
				// stored. A base derived as "none" BEFORE that entry existed is cached with no TTL, so
				// without this it stays "none" for the session even though the answer now exists.
				//
				// Deliberately not under `'branches'`: a tip move can't change a branch's base, so re-deriving
				// on every commit would be pure cost. Checkouts are user-driven and rare by comparison.
				keysToClear.add('baseBranchName');
			}

			if (types.includes('branches')) {
				keysToClear.add('branchMetadataMap');
				keysToClear.add('branches');
				keysToClear.add('sharedBranches');
				keysToClear.add('defaultBranchName');
				keysToClear.add('initialCommitSha');
				keysToClear.add('logShas');
				keysToClear.add('refs');
				keysToClear.add('refTips');
			}

			if (types.includes('config')) {
				// `getBaseBranchName` falls back to `branch.<ref>.vscode-merge-base` (written by VS Code's
				// built-in Git), which lives in `.git/config` — so a config change is the only signal that
				// source changed. Cheap: config events are rare.
				keysToClear.add('baseBranchName');
				keysToClear.add('configKeys');
				keysToClear.add('configPatterns');
				keysToClear.add('currentBranchReference');
				keysToClear.add('currentUser');
				// `gitDir` is immutable repo topology (toplevel/git-dir/common-dir/superproject) — a
				// `.git/config` content change never relocates it, and it's owned by the repo lifecycle
				// (registerRepoPath/unregisterRepoPath). Clearing it here forced a redundant `git rev-parse`
				// re-spawn (gitDir is read by getGkConfigPath→getGitDir on every gk op), so leave it warm.
			}

			if (types.includes('contributors')) {
				keysToClear.add('branchOverviews');
				keysToClear.add('contributors');
				keysToClear.add('contributorsLite');
				keysToClear.add('contributorsStats');
			}

			if (types.includes('gitignore')) {
				keysToClear.add('gitIgnore');
			}

			if (types.includes('gkConfig')) {
				keysToClear.add('gkConfigMap');
				// Derived from `branch.<ref>.gk-merge-base`/`vscode-merge-base`; clear so external
				// gkConfig mutations don't leave stale base-branch resolutions cached.
				keysToClear.add('baseBranchName');
				// Cached overviews are keyed by `${ref}|${mergeTarget}`; bulk gkConfig changes can
				// affect any of the merge-target sources (stored, base, default), so clear all.
				keysToClear.add('branchOverviews');
			}

			if (types.includes('lastFetched')) {
				keysToClear.add('lastFetched');
			}

			if (types.includes('providers')) {
				keysToClear.add('remotes');
				keysToClear.add('bestRemotes');
				invalidateMemoized('providers');
			}

			if (types.includes('remotes')) {
				keysToClear.add('remotes');
				keysToClear.add('bestRemotes');
				keysToClear.add('defaultBranchName');
			}

			if (types.includes('stashes')) {
				keysToClear.add('stashes');
			}
			if (types.includes('status')) {
				keysToClear.add('pausedOperationStatus');
				// A caller asserting "status changed" (the post-op hooks in `operations.ts`, a user-initiated
				// refresh) has to advance the clock too — otherwise a `git status` still in flight from before
				// the operation can satisfy the read that follows it.
				this.incrementStatusGenerations(repoPath);
			}
			if (types.includes('tags')) {
				keysToClear.add('tags');
				keysToClear.add('refs');
				keysToClear.add('refTips');
				// `commit`/`commitCount` can be keyed by a tag name (e.g. the tag node's load-more count),
				// which re-points on a force-moved or deleted-and-recreated tag — same drift the
				// `branch`/`branches` cascade above clears for.
				keysToClear.add('commit');
				keysToClear.add('commitCount');
			}

			if (types.includes('tracking')) {
				keysToClear.add('fileExistence');
				keysToClear.add('trackedPaths');
			}

			if (types.includes('worktrees')) {
				keysToClear.add('worktrees');
			}

			// Git results: cleared for any meaningful type change
			if (types.some(t => t !== 'gitignore' && t !== 'gkConfig' && t !== 'providers')) {
				keysToClear.add('gitResults');
			}
		}

		for (const key of keysToClear) {
			const cache = this._caches[key];
			if (cache == null) continue;

			if (repoPath == null) {
				cache.clear();
			} else if (sharedCacheKeys.has(key)) {
				this.evictShared(key, repoPath);
			} else {
				cache.delete(repoPath);
			}
		}
	}

	/**
	 * Evicts a single shared (commonPath-keyed) cache entry for `repoPath` and its sibling worktrees.
	 * Prefers `invalidate` where supported so in-flight work is shared across new callers and
	 * self-evicts on settle rather than spawning a duplicate factory. `invalidate` does the right
	 * thing per-entry: entries with a `CacheController` (created via `getOrCreate`) are marked
	 * invalidated; entries without one (created via plain `.set()`, e.g. per-worktree mapper results)
	 * are hard-deleted. Caches that don't support `invalidate` fall back to `delete`.
	 */
	private evictShared(key: keyof AllCaches, repoPath: string): void {
		const cache = this._caches[key];
		if (cache == null) return;

		const commonPath = this.getCommonPath(repoPath);
		const invalidate = (cache as { invalidate?: (k: string) => void }).invalidate;
		if (typeof invalidate === 'function') {
			invalidate.call(cache, commonPath);
			for (const worktreePath of this.getWorktreePaths(commonPath)) {
				if (worktreePath === commonPath) continue;

				invalidate.call(cache, worktreePath);
			}
		} else {
			cache.delete(commonPath);
			for (const worktreePath of this.getWorktreePaths(commonPath)) {
				if (worktreePath === commonPath) continue;

				cache.delete(worktreePath);
			}
		}
	}

	/**
	 * Monotonic per-worktree counter, advanced whenever anything that can change `git status` output is
	 * observed. `git status` and its siblings are point-in-time reads of mutable state, so deduplicating them
	 * on repoPath alone is unsound — a run that started before a commit would satisfy a caller that arrived
	 * after it. Callers stamp their in-flight run with the generation it started in and refuse older joins.
	 * Kept per exact worktree path (never spread to the common path) and advanced on `unregisterRepoPath` so a
	 * read in flight from a prior registration can't be joined after a reopen.
	 *
	 * Note: a run that never settles wedges only its own generation's callers (a newer generation gets a fresh
	 * key). `git.run` recovers via its per-command timeout (default 60s); a hung `git.stream` is caught by the
	 * status provider's `raceWithTimeout` backstop (scaled to `advanced.git.timeout`; see
	 * `dedupeByStatusGeneration`), which rejects a wedged read so waiters unblock and a later caller retries.
	 */
	getStatusGeneration(repoPath: string): number {
		return this._statusGenerations.get(repoPath) ?? 0;
	}

	/** Advances the status clock — see {@link getStatusGeneration}. */
	incrementStatusGeneration(repoPath: string): void {
		this._statusGenerations.set(repoPath, this.getStatusGeneration(repoPath) + 1);
	}

	/**
	 * Working-tree changes ride their own channel (`Repository.onDidChangeWorkingTree`), not
	 * `onRepositoryChanged` — an external `git restore <file>` may touch no `.git` path we classify — so
	 * they have to advance the status clock separately or a discard would never invalidate an in-flight read.
	 */
	onWorkingTreeChanged(repoPath: string): void {
		this.incrementStatusGeneration(repoPath);
	}

	/** Advances the status clock for one worktree, or for every known worktree when `repoPath` is undefined. */
	private incrementStatusGenerations(repoPath: string | undefined): void {
		if (repoPath != null) {
			this.incrementStatusGeneration(repoPath);
			return;
		}

		// Union of registered repos and any path that already carries a generation — a secondary-worktree
		// path incremented via its own watcher may never have been registered, but still has in-flight reads to fence.
		const paths = new Set([...this._commonPathRegistry.keys(), ...this._statusGenerations.keys()]);
		for (const path of paths) {
			this.incrementStatusGeneration(path);
		}
	}

	getCommonPath(repoPath: string): string {
		return this._commonPathRegistry.get(repoPath) ?? repoPath;
	}

	getWorktreePaths(commonPath: string): string[] {
		const worktrees = this._worktreesByCommonPath.get(commonPath);
		return worktrees != null ? [...worktrees] : [];
	}

	isWorktree(repoPath: string): boolean {
		const commonPath = this._commonPathRegistry.get(repoPath);
		return commonPath != null && commonPath !== repoPath;
	}

	/** Whether `repoPath` is currently registered (via {@link registerRepoPath}, not yet unregistered). */
	isRegistered(repoPath: string): boolean {
		return this._commonPathRegistry.has(repoPath);
	}

	/**
	 * Monotonic per-path counter advanced whenever `repoPath` is unregistered (repo closed, worktree
	 * removed). Lets an async post-read step — e.g. the gk-config reconcile — detect that its target was
	 * closed (and possibly reopened) mid-flight and bail. Unlike an `isRegistered` check it doesn't
	 * require the caller to have registered in the first place, so it stays correct for consumers of
	 * this package that don't wire up the host's repo lifecycle.
	 */
	getCloseGeneration(repoPath: string): number {
		return this._closeGenerations.get(repoPath) ?? 0;
	}

	/** Clears file-scoped caches (blame, diff, fileLog) for a specific path within a repo */
	clearForPath(repoPath: string, path: string, ...types: UriScopedCachedGitTypes[]): void {
		const prefix = `${normalizePath(path)}:`;
		if (!types.length || types.includes('blame')) {
			this._caches.blame?.deleteByKeyPrefix(repoPath, prefix);
		}
		if (!types.length || types.includes('diff')) {
			this._caches.diff?.deleteByKeyPrefix(repoPath, prefix);
		}
		if (!types.length || types.includes('fileLog')) {
			this._caches.fileLog?.deleteByKeyPrefix(repoPath, prefix);
		}
	}

	registerRepoPath(repoPath: Uri, gitDir: GitDir): void {
		const normalizedPath = getRepositoryOrWorktreePath(repoPath);
		const commonPath = gitDir.commonUri != null ? getCommonRepositoryPath(gitDir.commonUri) : normalizedPath;
		this._commonPathRegistry.set(normalizedPath, commonPath);

		let worktrees = this._worktreesByCommonPath.get(commonPath);
		if (worktrees == null) {
			worktrees = new Set();
			this._worktreesByCommonPath.set(commonPath, worktrees);
		}
		worktrees.add(normalizedPath);
	}

	/**
	 * Symmetric companion to `registerRepoPath`. Clears cache entries specific to `repoPath`
	 * and removes the path from the registry.
	 *
	 * Call this when a worktree is deleted or a repo is closed so stale registry entries
	 * and derived cache entries don't persist.
	 *
	 * Targeted — does NOT cascade to sibling worktrees sharing the same commonPath. The
	 * shared commonPath entry in each shared cache is only evicted when unregistering the
	 * last remaining worktree for that commonPath (otherwise siblings still depend on it).
	 *
	 * Uses soft-invalidate where supported so any in-flight factory/mapper keeps its abort
	 * wiring intact — a caller whose signal aborts after unregister can still propagate
	 * cancellation into the underlying work rather than leaving it orphaned. Controller-backed
	 * entries self-evict on settle; plain `.set()`-based entries hard-delete immediately.
	 *
	 * Cache eviction is a no-op if `repoPath` is not registered, but the status clock is advanced
	 * unconditionally (a fresh registration must not let a post-reopen read join a pre-close one).
	 */
	@debug({ onlyExit: true })
	unregisterRepoPath(repoPath: string): void {
		// Advance the status clock on close so a status read still in flight from this registration can't be
		// joined by a read issued after the path is reopened (which would otherwise reuse the same generation).
		this.incrementStatusGeneration(repoPath);
		// Advance the close clock so an async step that captured it before its read (see `getCloseGeneration`)
		// can tell its target went away mid-flight.
		this._closeGenerations.set(repoPath, this.getCloseGeneration(repoPath) + 1);

		const commonPath = this._commonPathRegistry.get(repoPath) ?? repoPath;
		const worktrees = this._worktreesByCommonPath.get(commonPath);
		// After removing repoPath, would the commonPath have any worktrees left?
		const isLastWorktree = worktrees == null || worktrees.size <= 1;

		// Targeted per-repoPath cleanup: for per-worktree caches, clear this repoPath's
		// entries. For shared caches, clear this repoPath's mapper entry (if it's a worktree
		// distinct from commonPath); only evict the shared commonPath entry when this was the
		// last worktree — otherwise siblings still rely on the shared data.
		for (const key of Object.keys(this._caches) as (keyof AllCaches)[]) {
			const cache = this._caches[key];
			if (cache == null) continue;

			// Prefer `invalidate` so in-flight abort wiring survives until the factory settles;
			// fall back to `delete` for plain `Map`-typed caches that don't track promises.
			const invalidate = (cache as { invalidate?: (k: string) => void }).invalidate;
			const evict =
				typeof invalidate === 'function'
					? (k: string) => invalidate.call(cache, k)
					: (k: string) => cache.delete(k);

			if (sharedCacheKeys.has(key)) {
				if (repoPath !== commonPath) {
					evict(repoPath);
				}
				if (isLastWorktree) {
					evict(commonPath);
				}
			} else {
				evict(repoPath);
			}
		}

		// Shared, commonPath-keyed like `gkConfigMap` — only evict once no worktree still depends on it.
		if (isLastWorktree) {
			this._gkConfigMergeSnapshots.delete(commonPath);
		}

		this._commonPathRegistry.delete(repoPath);

		if (worktrees != null) {
			worktrees.delete(repoPath);
			if (worktrees.size === 0) {
				this._worktreesByCommonPath.delete(commonPath);
			}
		}
	}

	@debug({ onlyExit: true })
	reset(): void {
		// Advance the close clock BEFORE dropping the registry it reads from. Advancing rather than
		// clearing is the point: an async step that captured a generation must see a mismatch and bail,
		// where a cleared map would hand it a fresh `0` that matches and let it repopulate what was just
		// torn down. Union of registered paths and any already carrying a generation, mirroring
		// `incrementStatusGenerations`.
		for (const path of new Set([...this._commonPathRegistry.keys(), ...this._closeGenerations.keys()])) {
			this._closeGenerations.set(path, this.getCloseGeneration(path) + 1);
		}

		this._commonPathRegistry.clear();
		this._worktreesByCommonPath.clear();
		this._statusGenerations.clear();
		this._gkConfigMergeSnapshots.clear();
		this._gkConfigReconciler = undefined;
		this._caches = createEmptyCaches();
	}

	@debug({ onlyExit: true })
	onRepositoryChanged(repoPath: string, changes: Iterable<RepositoryChange>): void {
		const changesSet = new Set(changes);

		const hasAny = (...c: RepositoryChange[]) => c.some(ch => changesSet.has(ch));

		if (hasAny('unknown', 'closed')) {
			this.unregisterRepoPath(repoPath);
			return;
		}

		// Advance the status clock (see {@link getStatusGeneration}) for changes that alter `git status` output but
		// aren't mapped to the `'status'` cache type below: files (index/head/heads), untracked set (ignores/config),
		// ahead/behind (remotes). Paused-op changes advance it too, but via `clearCaches('status')` (see below) —
		// listing them here as well would double-increment the clock for a single change.
		if (hasAny('index', 'head', 'heads', 'remotes', 'ignores', 'config')) {
			this.incrementStatusGeneration(repoPath);
		}

		const types = new Set<CachedGitTypes>();

		if (hasAny('head')) {
			types.add('branch');
		}

		if (hasAny('index', 'heads', 'pausedOp')) {
			types.add('blame');
			types.add('diff');
			types.add('fileLog');
		}

		if (hasAny('index')) {
			types.add('tracking');
		}

		if (hasAny('config')) {
			types.add('config');
		}

		if (hasAny('heads')) {
			types.add('branches');
			types.add('contributors');
			types.add('worktrees');
		}

		if (hasAny('remotes')) {
			types.add('branches');
			types.add('contributors');
			types.add('remotes');
			types.add('worktrees');
		}

		if (hasAny('ignores')) {
			types.add('gitignore');
		}

		if (hasAny('gkConfig')) {
			// Handled separately (not folded into `types`/`clearCaches` below) — a gk write is usually a
			// bookkeeping timestamp that can't affect `baseBranchName`/`branchOverviews`, so this reconciles
			// down to only the keys that actually changed instead of coarsely clearing both on every write.
			this.handleGkConfigChanged(repoPath);
		}

		if (hasAny('lastFetched')) {
			types.add('lastFetched');
		}

		if (hasAny('remoteProviders')) {
			types.add('providers');
		}

		if (hasAny('cherryPick', 'merge', 'rebase', 'revert', 'pausedOp')) {
			types.add('branch');
			types.add('status');
		}

		if (hasAny('stash')) {
			types.add('stashes');
		}

		if (hasAny('tags')) {
			types.add('tags');
		}

		if (hasAny('worktrees')) {
			types.add('worktrees');
		}

		if (types.size) {
			this.clearCaches(repoPath, ...types);
		}
	}

	/**
	 * Handles a watcher-observed `'gkConfig'` change. Always evicts the cached bulk map (forcing the
	 * next read to hit disk). If a reconciler is registered (see {@link setGkConfigReconciler}),
	 * defers to it instead of coarsely clearing `baseBranchName`/`branchOverviews` — it re-reads the
	 * map and diffs it against the snapshot captured here (i.e. as it stood right before this change),
	 * cascading only the refs whose merge-relevant keys actually changed. Falls back to the coarse
	 * clear when no reconciler is registered (e.g. the GitHub provider) so nothing can go stale.
	 */
	private handleGkConfigChanged(repoPath: string): void {
		const commonPath = this.getCommonPath(repoPath);
		// Hard-delete rather than `evictShared`'s soft-invalidate: the reconcile below needs a
		// point-in-time read of the post-change file, and a soft-invalidated entry stays joinable — the
		// re-read would ride a bulk read that started before this change and diff it as unchanged.
		// Same reasoning as `refs.ts`'s `force: true` path and `deleteGkConfig`'s own hard delete.
		this._caches.gkConfigMap?.delete(commonPath);

		if (this._gkConfigReconciler == null) {
			this.clearCaches(repoPath, 'gkConfig');
			return;
		}

		const priorSnapshot = this._gkConfigMergeSnapshots.get(commonPath);
		// Fire-and-forget, but the outcome still decides whether the coarse clear is owed: a reconcile that
		// FAILED leaves every derived cache holding pre-change values with nothing else to correct them, so
		// it falls back to the blunt behavior that registering a reconciler replaced. Kept here rather than
		// in the reconciler so a bail path added later can't silently skip it — the return type makes each
		// one say what it did.
		void Promise.resolve(this._gkConfigReconciler(repoPath, priorSnapshot)).then(
			outcome => {
				if (outcome === 'failed') {
					this.clearCaches(repoPath, 'gkConfig');
				}
			},
			// An exception escaping the reconciler is a failure by definition — and one its own `catch`
			// never saw, so nothing else will have cascaded.
			() => this.clearCaches(repoPath, 'gkConfig'),
		);
	}

	/** Hard-evicts the cached bulk `.git/gk/config` map so the next read hits disk. */
	deleteGkConfigMap(repoPath: string): void {
		this._caches.gkConfigMap?.delete(this.getCommonPath(repoPath));
	}

	/** The merge-relevant gk config snapshot currently serving as the reconcile baseline. */
	getGkConfigMergeSnapshot(repoPath: string): ReadonlyMap<string, string> | undefined {
		return this._gkConfigMergeSnapshots.get(this.getCommonPath(repoPath));
	}

	getBranches(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<PagedResult<GitBranch>>,
		mapper: (
			branches: PagedResult<GitBranch>,
			targetRepoPath: string,
			commonPath: string,
			cancellation?: AbortSignal,
		) => PromiseOrValue<PagedResult<GitBranch>>,
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitBranch>> {
		const commonPath = this.getCommonPath(repoPath);

		// Register this caller with the shared factory's aggregate so that invariant 3
		// (factory aborts iff every waiter has aborted) holds for same-`repoPath` cache hits too.
		// The returned wrapped promise is deliberately discarded — we use the raw cached inner
		// below to build the mapped entry. Swallow any rejection on this dangling reference so
		// it doesn't surface as an unhandled rejection; the real caller-facing promise (via
		// `branches.getOrCreate` below) is where caller cancellation flows to.
		const registration = this.sharedBranches.getOrCreate(
			commonPath,
			(cacheable, signal) => {
				const p = Promise.resolve(factory(commonPath, cacheable, signal));
				// On factory invalidation, propagate to the derived per-worktree mapper entries
				// via soft-invalidate — existing waiters on the mapper complete, and the entry
				// self-evicts on mapper settle so the next callers build fresh derived entries.
				void p
					.finally(() => {
						if (cacheable.invalidated) {
							this.branches.invalidate(commonPath);
							for (const worktreePath of this.getWorktreePaths(commonPath)) {
								this.branches.invalidate(worktreePath);
							}
						}
					})
					// Swallow the cleanup chain's rejection so a rejected factory (e.g. cancellation)
					// doesn't surface as an unhandled rejection; the caller-facing promise handles it.
					.catch(() => {});
				return p;
			},
			cancellation,
		);
		void registration.catch(() => {});

		// Build the per-`repoPath` mapped entry through `getOrCreate` so mapper internal git
		// work (e.g. `getCurrentBranchReferenceCore`) runs under a mapper-level aggregate signal
		// separate from the factory's. Subsequent same-`repoPath` cache hits register with this
		// aggregate too — invariant 2/3 hold at the mapper level.
		return this.branches.getOrCreate(
			repoPath,
			(_cacheable, mapperSignal) => {
				// After `getOrCreate` above, `sharedBranches[commonPath]` holds the raw inner
				// factory promise. Fall back to `registration` in the paranoid case where a
				// synchronously-rejected factory got auto-evicted before we retrieve it.
				const rawShared = this.sharedBranches.get(commonPath) ?? registration;
				return Promise.resolve(rawShared).then(shared => mapper(shared, repoPath, commonPath, mapperSignal));
			},
			cancellation,
		);
	}

	private static readonly globalConfigKey = '';

	getConfig(
		repoPath: string | undefined,
		key: string,
		factory: () => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : Cache.globalConfigKey;

		const result = this.configKeys.get(cacheKey, key);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.configKeys.set(cacheKey, key, factoryPromise);
		return factoryPromise;
	}

	getConfigRegex(
		repoPath: string | undefined,
		pattern: string,
		factory: () => PromiseOrValue<Map<string, string>>,
	): Promise<Map<string, string>> {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : Cache.globalConfigKey;

		const result = this.configPatterns.get(cacheKey, pattern);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.configPatterns.set(cacheKey, pattern, factoryPromise);
		return factoryPromise;
	}

	deleteConfig(repoPath: string | undefined, key: string): void {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : Cache.globalConfigKey;
		this._caches.configKeys?.delete(cacheKey, key);
		this._caches.configPatterns?.delete(cacheKey);
	}

	/**
	 * The whole `.git/gk/config` is read once and cached as a single map per commonPath; per-key and
	 * per-namespace gk lookups are served from it in-memory (see `getGkConfigMap` in the CLI config
	 * sub-provider). Invalidated by `deleteGkConfig` (write) and, on a watcher `'gkConfig'` event, by
	 * `handleGkConfigChanged` (reconciled precisely when a reconciler is registered, or the coarse
	 * clear otherwise). The first fresh read seeds the merge-relevant snapshot used by
	 * `reconcileGkConfigMap`; later refreshes of that snapshot are owned by the reconcile itself.
	 */
	getGkConfigMap(
		repoPath: string,
		factory: (cacheable: CacheController) => PromiseOrValue<Map<string, string>>,
	): Promise<Map<string, string>> {
		return this.getSharedSimple(this.gkConfigMap, repoPath, async (commonPath, cacheable) => {
			const map = await factory(cacheable);
			// Seed the reconcile baseline on first observation only. Refreshes belong to
			// `reconcileGkConfigMap` (after it has cascaded) and `recordGkConfigWrite` (our own writes):
			// an incidental read that happens to land between an external write and the watcher event
			// would otherwise advance the baseline to the post-change value, so the reconcile would diff
			// that value against itself and silently drop the change.
			if (!this._gkConfigMergeSnapshots.has(commonPath)) {
				this._gkConfigMergeSnapshots.set(commonPath, this.extractMergeRelevantGkConfig(map));
			}
			return map;
		});
	}

	/** Extracts the subset of a gk config map whose keys participate in the `branchOverviews`/`baseBranchName` lineage. */
	private extractMergeRelevantGkConfig(map: ReadonlyMap<string, string>): Map<string, string> {
		const subset = new Map<string, string>();
		for (const [key, value] of map) {
			if (branchOverviewGkConfigKeysRegex.test(key)) {
				subset.set(key, value);
			}
		}
		return subset;
	}

	/**
	 * Clears the cached `.git/gk/config` map and invalidates the derived caches
	 * (`baseBranchName`/`branchOverviews`) for the written key's ref.
	 *
	 * @param options.skipInvalidation Downstream caches the caller wants preserved despite this
	 * write. Use when the value being written is exactly what was just resolved — e.g. the Tier 2
	 * `storeMergeTargetBranchName` self-write inside `getBranchContributionsOverview` (skip
	 * `'branchOverviews'`) or the Tier 3 `storeBaseBranchName` self-write inside `getBaseBranchName`
	 * (skip both `'baseBranchName'` and `'branchOverviews'`). The bulk `gkConfigMap` map always
	 * invalidates so subsequent reads see the new value.
	 */
	deleteGkConfig(
		repoPath: string,
		key: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): void {
		const commonPath = this.getCommonPath(repoPath);
		this._caches.gkConfigMap?.delete(commonPath);
		this.cascadeGkConfigKeyChange(commonPath, key, options?.skipInvalidation);
	}

	/**
	 * Keeps the merge-relevant gk config snapshot in sync with OUR OWN writes, so the next
	 * watcher-triggered `reconcileGkConfigMap` diffs a self-write as unchanged rather than as an
	 * external change (which would otherwise defeat `skipInvalidation`). No-ops for keys outside the
	 * merge-relevant subset, and if no snapshot exists yet for this repo — nothing to keep in sync;
	 * the next real read (`getGkConfigMap`) populates one from scratch.
	 */
	recordGkConfigWrite(repoPath: string, key: string, value: string | undefined): void {
		if (!branchOverviewGkConfigKeysRegex.test(key)) return;

		const commonPath = this.getCommonPath(repoPath);
		const snapshot = this._gkConfigMergeSnapshots.get(commonPath);
		if (snapshot == null) return;

		// Copy-on-write: a reconcile in flight is holding this map as its `priorSnapshot` baseline, so
		// mutating it in place would silently move that baseline mid-diff.
		const next = new Map(snapshot);
		if (value == null) {
			next.delete(key);
		} else {
			next.set(key, value);
		}
		this._gkConfigMergeSnapshots.set(commonPath, next);
	}

	/**
	 * Registers the reconciler invoked by {@link handleGkConfigChanged} on a watcher-observed
	 * `'gkConfig'` change. Only one reconciler is kept — later registrations replace earlier ones,
	 * which is harmless since every CLI config sub-provider sharing this `Cache` reconciles the same
	 * underlying `.git/gk/config` file identically.
	 */
	setGkConfigReconciler(
		reconciler: (
			repoPath: string,
			priorSnapshot: ReadonlyMap<string, string> | undefined,
		) => PromiseOrValue<GkReconcileOutcome>,
	): void {
		this._gkConfigReconciler = reconciler;
	}

	/**
	 * Diffs a freshly-read gk config map's merge-relevant subset against `priorSnapshot` (captured by
	 * `handleGkConfigChanged` before the reconcile started, so it reflects the pre-change state even
	 * though this call's own re-read already raced ahead and refreshed the live snapshot), cascading
	 * `baseBranchName`/`branchOverviews` for every ref whose merge-relevant key actually changed.
	 * `priorSnapshot` of `undefined` (never observed before this reconcile) is treated as "everything
	 * may have changed" — a full coarse clear, same as the pre-existing watcher behavior. Returns
	 * whether anything changed (i.e. whether a follow-up repository-changed event is warranted).
	 */
	reconcileGkConfigMap(
		repoPath: string,
		priorSnapshot: ReadonlyMap<string, string> | undefined,
		freshMap: ReadonlyMap<string, string>,
	): boolean {
		const commonPath = this.getCommonPath(repoPath);
		const newSubset = this.extractMergeRelevantGkConfig(freshMap);
		this._gkConfigMergeSnapshots.set(commonPath, newSubset);

		if (priorSnapshot == null) {
			this.evictShared('baseBranchName', repoPath);
			this.evictShared('branchOverviews', repoPath);
			return true;
		}

		let changed = false;
		for (const key of new Set([...priorSnapshot.keys(), ...newSubset.keys()])) {
			if (priorSnapshot.get(key) !== newSubset.get(key)) {
				changed = true;
				this.cascadeGkConfigKeyChange(commonPath, key);
			}
		}
		return changed;
	}

	/**
	 * Shared per-ref cascade for a changed `branch.<ref>.gk-...` key: invalidates `baseBranchName` (for
	 * `gk-merge-base`) and `branchOverviews` (for any merge-relevant key), honoring `skipInvalidation`.
	 * Used by both a direct write (`deleteGkConfig`) and a reconciled external change
	 * (`reconcileGkConfigMap`). No-ops for keys outside the merge-relevant subset.
	 */
	private cascadeGkConfigKeyChange(
		commonPath: string,
		key: string,
		skip?: readonly GkConfigInvalidationTarget[],
	): void {
		const refMatch = key.match(branchOverviewGkConfigKeysRegex);
		if (refMatch == null) return;

		const ref = refMatch[1];

		// `getBaseBranchName` reads `branch.<ref>.gk-merge-base` and caches the resolved value
		// per-ref. A change to that key must invalidate the cached base or Tier 3 of
		// `getBranchContributionsOverview` will resolve `mergeTarget` against the pre-change value.
		if (key.endsWith('.gk-merge-base') && !skip?.includes('baseBranchName')) {
			this._caches.baseBranchName?.delete(commonPath, ref);
		}

		if (skip?.includes('branchOverviews')) return;

		// When the change affects a branch's merge-target/base lineage, invalidate that branch's
		// cached overviews so subsequent reads pick up the new stored value rather than stale data.
		// `getBranchContributionsOverview` keys `branchOverviews` by `${ref}|${mergeTarget}`, so
		// invalidate every entry for the affected ref regardless of which target it resolved to.
		// Uses `invalidateByKeyPrefix` (not `deleteByKeyPrefix`) so an in-flight factory is still
		// shared with new callers instead of triggering a duplicate fetch.
		//
		// Sibling worktrees get their own bucket, not just the shared one: `getSharedOrCreateWithKey`
		// stores a per-worktree *mapped* entry under that worktree's own path, and prefix-invalidation
		// only reaches one bucket. The in-flight case self-propagates on settle, but an already-settled
		// overview would otherwise survive here — which the coarse `evictShared` path this replaced did
		// clear, since it iterated the worktrees.
		this._caches.branchOverviews?.invalidateByKeyPrefix(commonPath, `${ref}|`);
		for (const worktreePath of this.getWorktreePaths(commonPath)) {
			if (worktreePath === commonPath) continue;

			this._caches.branchOverviews?.invalidateByKeyPrefix(worktreePath, `${ref}|`);
		}
	}

	async getBranchOverview(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<BranchContributionsOverview | undefined>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<BranchContributionsOverview | undefined> {
		return this.getSharedOrCreateWithKey(
			this.branchOverviews,
			repoPath,
			cacheKey,
			factory,
			(data, newRepoPath) =>
				data == null
					? data
					: {
							...data,
							repoPath: newRepoPath,
							contributors: data.contributors.map(c => c.withRepoPath(newRepoPath)),
						},
			options,
		);
	}

	async getContributors(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitContributorsResult>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitContributorsResult> {
		return this.getSharedOrCreateWithKey(
			this.contributors,
			repoPath,
			cacheKey,
			factory,
			(data, newRepoPath) => ({
				...data,
				contributors: data.contributors.map(c => c.withRepoPath(newRepoPath)),
			}),
			options,
		);
	}

	async getContributorsLite(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitContributor[]>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitContributor[]> {
		return this.getSharedOrCreateWithKey(
			this.contributorsLite,
			repoPath,
			cacheKey,
			factory,
			(data, newRepoPath) => data.map(c => c.withRepoPath(newRepoPath)),
			options,
		);
	}

	getContributorsStats(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitContributorsStats | undefined>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitContributorsStats | undefined> {
		return this.getSharedSimpleWithKey(this.contributorsStats, repoPath, cacheKey, factory, options);
	}

	getBaseBranchName(
		repoPath: string,
		ref: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<string | undefined>,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.baseBranchName, repoPath, ref, factory, {
			// A bounded ceiling, because the eviction signals can't cover every way a base changes. The
			// `'branches'` cascade deliberately doesn't clear this — a tip move can't change a base, and
			// re-deriving per commit is the cost this exists to avoid — but that leaves a hole: a branch
			// deleted and recreated OUTSIDE GitLens, and never checked out, emits only `heads`. A base
			// derived as "none" before that would otherwise stay "none" for the session.
			//
			// `createTTL`, NOT `accessTTL`: the sliding variant resets on every read, so a branch card
			// polling this entry would hold it alive forever and never re-derive — the exact case the
			// ceiling exists for. Absolute from creation bounds staleness regardless of read frequency.
			createTTL: baseBranchNameTTL,
			cancellation: cancellation,
		});
	}

	/**
	 * Clears the cached base branch for `ref`. Call from ops that create/rename/delete a branch — the
	 * `'branches'` cascade no longer clears these, since tip movement can't change a branch's base.
	 *
	 * Only clears the cache. A branch's base is *persisted* as `branch.<ref>.gk-merge-base` and read back
	 * before the reflog fallback, so an op that ends a branch's identity under a name must drop or move
	 * that key too (`removeGkConfigBranchSection`/`renameGkConfigBranchSection`) — otherwise the
	 * re-derivation this triggers just reads the stale value straight back.
	 */
	deleteBaseBranchName(repoPath: string, ref: string): void {
		this._caches.baseBranchName?.delete(this.getCommonPath(repoPath), ref);
	}

	getBranchMergedStatus(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitBranchMergedStatus>,
		cancellation?: AbortSignal,
	): Promise<GitBranchMergedStatus> {
		return this.getSharedOrCreateWithKey(
			this.branchMergedStatus,
			repoPath,
			cacheKey,
			factory,
			(data, newRepoPath) => {
				if (!data.merged) return data;
				if (data.localBranchOnly == null) return data;

				const lbo = data.localBranchOnly;
				return {
					...data,
					localBranchOnly: createReference(lbo.ref, newRepoPath, {
						id: getBranchId(newRepoPath, lbo.remote, lbo.name),
						refType: 'branch',
						name: lbo.name,
						remote: lbo.remote,
						upstream: lbo.upstream,
						sha: lbo.sha,
					}),
				};
			},
			{ cancellation: cancellation },
		);
	}

	getBranchMetadataMap(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<Map<string, BranchMetadata>>,
	): Promise<Map<string, BranchMetadata>> {
		return this.getSharedSimple(this.branchMetadataMap, repoPath, factory);
	}

	getDefaultBranchName(
		repoPath: string,
		remote: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<string | undefined>,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.defaultBranchName, repoPath, remote, factory, {
			cancellation: cancellation,
		});
	}

	/** Clears the cached default branch for one `remote` key (the networked lookup or its `:local` variant). */
	deleteDefaultBranchName(repoPath: string, remote: string): void {
		this._caches.defaultBranchName?.delete(this.getCommonPath(repoPath), remote);
	}

	getInitialCommitSha(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimple(this.initialCommitSha, repoPath, factory);
	}

	getLastFetchedTimestamp(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<number | undefined>,
	): Promise<number | undefined> {
		return this.getSharedSimple(this.lastFetched, repoPath, factory);
	}

	getRefs(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<RefRecord[]>,
		cancellation?: AbortSignal,
	): Promise<RefRecord[]> {
		// Raw ref records are repoPath-agnostic (no per-worktree binding to remap), so we key only
		// by commonPath and skip the per-worktree mapper that `getBranches`/`getTags` need.
		const commonPath = this.getCommonPath(repoPath);
		return this.refs.getOrCreate(
			commonPath,
			(cacheable, signal) => Promise.resolve(factory(commonPath, cacheable, signal)),
			cancellation,
		);
	}

	getRefTips(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitRefTip[]>,
		cancellation?: AbortSignal,
	): Promise<GitRefTip[]> {
		const commonPath = this.getCommonPath(repoPath);
		return this.refTips.getOrCreate(
			commonPath,
			(cacheable, signal) => Promise.resolve(factory(commonPath, cacheable, signal)),
			cancellation,
		);
	}

	async getRemotes(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitRemote[]>,
		cancellation?: AbortSignal,
	): Promise<GitRemote[]> {
		return this.getSharedOrCreate(
			this.remotes,
			repoPath,
			factory,
			(data, newRepoPath) => data.map(r => r.withRepoPath(newRepoPath)),
			cancellation,
		);
	}

	async getStash(
		repoPath: string,
		cacheKey: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitStash>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitStash> {
		return this.getSharedOrCreateWithKey(
			this.stashes,
			repoPath,
			cacheKey,
			factory,
			(data, newRepoPath) => ({
				repoPath: newRepoPath,
				stashes: new Map(
					Array.from(data.stashes.entries(), ([sha, s]) => [
						sha,
						s.withRepoPath<GitStashCommit>(newRepoPath),
					]),
				),
			}),
			options,
		);
	}

	async getTags(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<PagedResult<GitTag>>,
		cancellation?: AbortSignal,
	): Promise<PagedResult<GitTag>> {
		return this.getSharedOrCreate(
			this.tags,
			repoPath,
			factory,
			(data, newRepoPath) => ({ ...data, values: data.values.map(t => t.withRepoPath(newRepoPath)) }),
			cancellation,
		);
	}

	async getWorktrees(
		repoPath: string,
		factory: (
			commonPath: string,
			cacheable: CacheController,
			cancellation?: AbortSignal,
		) => PromiseOrValue<GitWorktree[]>,
		cancellation?: AbortSignal,
	): Promise<GitWorktree[]> {
		return this.getSharedOrCreate(
			this.worktrees,
			repoPath,
			factory,
			(data, newRepoPath) => data.map(w => w.withRepoPath(newRepoPath)),
			cancellation,
		);
	}

	private async getSharedOrCreate<T>(
		cache: PromiseMap<string, T>,
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController, cancellation?: AbortSignal) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
		cancellation?: AbortSignal,
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		// Always register this caller with the shared factory's aggregate so same-`repoPath` and
		// worktree-distinct concurrent callers both contribute — invariant 3 (factory aborts iff
		// every waiter aborts) holds uniformly. The wrapped return is our caller-facing promise
		// for the commonPath-keyed branch; the per-worktree branch uses `raceWithSignal` below.
		const sharedPromise = cache.getOrCreate(
			commonPath,
			(cacheable, signal) => {
				const p = Promise.resolve(factory(commonPath, cacheable, signal));
				// On factory invalidation (without rejection), propagate to the derived per-worktree
				// mapper entries so they don't persist past the shared factory's settle. Mapper
				// entries cached via `cache.set()` have no controller, so `invalidate` hard-deletes.
				void p
					.finally(() => {
						if (cacheable.invalidated) {
							for (const worktreePath of this.getWorktreePaths(commonPath)) {
								if (worktreePath === commonPath) continue;

								cache.invalidate(worktreePath);
							}
						}
					})
					// Swallow the cleanup chain's rejection so a rejected factory (e.g. cancellation)
					// doesn't surface as an unhandled rejection; the caller-facing promise handles it.
					.catch(() => {});
				return p;
			},
			cancellation,
		);
		// Swallow any rejection on the registration wrapper so it isn't surfaced as an unhandled
		// rejection when we discard it below (existing-mapper path). The real caller-facing
		// promise is the returned value.
		void sharedPromise.catch(() => {});

		if (commonPath !== repoPath) {
			// Reuse the cached mapped entry for this worktree if present; otherwise derive it off
			// the raw inner shared promise so subsequent cache hits don't inherit the first
			// caller's signal wrap.
			const existing = cache.get(repoPath);
			if (existing != null) {
				return cancellation != null ? raceWithSignal(existing, cancellation) : existing;
			}

			const rawShared = cache.get(commonPath) ?? sharedPromise;
			const mappedPromise = Promise.resolve(rawShared).then(data => mapper(data, repoPath));
			cache.set(repoPath, mappedPromise);
			return cancellation != null ? raceWithSignal(mappedPromise, cancellation) : mappedPromise;
		}

		return sharedPromise;
	}

	private async getSharedOrCreateWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cacheable: CacheController, cancellation?: AbortSignal) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);
		const cancellation = options?.cancellation;

		// Always register with the shared factory's aggregate (see `getSharedOrCreate` comment).
		const sharedPromise = cache.getOrCreate(
			commonPath,
			cacheKey,
			(cacheable, signal) => {
				const p = Promise.resolve(factory(commonPath, cacheable, signal));
				// On factory invalidation (without rejection), propagate to the derived per-worktree
				// mapper entries for this `cacheKey` so they don't persist past the shared factory's
				// settle. Mapper entries cached via `cache.set()` have no controller, so `invalidate`
				// hard-deletes.
				void p
					.finally(() => {
						if (cacheable.invalidated) {
							for (const worktreePath of this.getWorktreePaths(commonPath)) {
								if (worktreePath === commonPath) continue;

								cache.invalidate(worktreePath, cacheKey);
							}
						}
					})
					// Swallow the cleanup chain's rejection so a rejected factory (e.g. cancellation)
					// doesn't surface as an unhandled rejection; the caller-facing promise handles it.
					.catch(() => {});
				return p;
			},
			options,
		);
		// Swallow any rejection on the registration wrapper so it isn't surfaced as an unhandled
		// rejection when we discard it below (existing-mapper path).
		void sharedPromise.catch(() => {});

		if (commonPath !== repoPath) {
			const existing = cache.get(repoPath, cacheKey);
			if (existing != null) {
				return cancellation != null ? raceWithSignal(existing, cancellation) : existing;
			}

			const rawShared = cache.get(commonPath, cacheKey) ?? sharedPromise;
			const mappedPromise = Promise.resolve(rawShared).then(data => mapper(data, repoPath));
			cache.set(repoPath, cacheKey, mappedPromise, options);
			return cancellation != null ? raceWithSignal(mappedPromise, cancellation) : mappedPromise;
		}

		return sharedPromise;
	}

	private async getSharedSimple<T>(
		cache: PromiseMap<string, T> | PromiseCache<string, T>,
		repoPath: string,
		// `cacheable` is forwarded so a factory can refuse the entry when the read FAILED rather than
		// genuinely produced nothing — see `getSharedSimpleWithKey` for why that distinction matters.
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		// `PromiseMap.getOrCreate(key, factory, cancellation?)` and
		// `PromiseCache.getOrCreate(key, factory, options?)` have different 3rd-argument shapes,
		// so we dispatch on cache type. Both register a `CacheController` so `invalidate` works.
		if (cache instanceof PromiseCache) {
			return cache.getOrCreate(commonPath, cacheable => Promise.resolve(factory(commonPath, cacheable)));
		}
		return cache.getOrCreate(commonPath, cacheable => Promise.resolve(factory(commonPath, cacheable)));
	}

	private async getSharedSimpleWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		// `cacheable` is forwarded so a factory can distinguish "the answer is genuinely nothing" from "the
		// read failed": callers here set no TTL by default, so a failure resolved as `undefined` would
		// otherwise be served as a real answer until something explicitly evicts it.
		factory: (commonPath: string, cacheable: CacheController, cancellation?: AbortSignal) => PromiseOrValue<T>,
		options?: { accessTTL?: number; createTTL?: number; cancellation?: AbortSignal },
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		return cache.getOrCreate(
			commonPath,
			cacheKey,
			(cacheable, signal) => Promise.resolve(factory(commonPath, cacheable, signal)),
			options,
		);
	}
}
