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

export type ConflictDetectionCacheKey = `apply:${string}:${string}:${string}` | `merge:${string}:${string}`;

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
	gkConfigKeys: RepoPromiseCacheMap<string, string | undefined> | undefined;
	gkConfigPatterns: RepoPromiseCacheMap<string, Map<string, string>> | undefined;
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
		'gkConfigKeys',
		'gkConfigPatterns',
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
		gkConfigKeys: undefined,
		gkConfigPatterns: undefined,
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
			createTTL: 1000 * 60 * 5, // 5 minutes
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

	private get gkConfigKeys(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._caches.gkConfigKeys ??= new RepoPromiseCacheMap<string, string | undefined>());
	}

	private get gkConfigPatterns(): RepoPromiseCacheMap<string, Map<string, string>> {
		return (this._caches.gkConfigPatterns ??= new RepoPromiseCacheMap<string, Map<string, string>>());
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

			// Branch caches affected by HEAD/heads changes — `branchMergedStatus` is shared
			// (the answer is invariant across worktrees of the same common repo) but is invalidated
			// here because branch-tip movement in any worktree can change the merge status; the
			// shared-clear logic below routes shared keys via commonPath.
			if (types.includes('branch') || types.includes('branches')) {
				keysToClear.add('branch');
				keysToClear.add('branchMergedStatus');
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

			// Shared branch caches (branch list, metadata)
			if (types.includes('branches')) {
				keysToClear.add('baseBranchName');
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
				keysToClear.add('configKeys');
				keysToClear.add('configPatterns');
				keysToClear.add('currentBranchReference');
				keysToClear.add('currentUser');
				keysToClear.add('gitDir');
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
				keysToClear.add('gkConfigKeys');
				keysToClear.add('gkConfigPatterns');
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
			}
			if (types.includes('tags')) {
				keysToClear.add('tags');
				keysToClear.add('refs');
				keysToClear.add('refTips');
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
				const commonPath = this.getCommonPath(repoPath);
				// For shared caches, prefer `invalidate` where supported so in-flight work is
				// shared across new callers and self-evicts on settle rather than spawning a
				// duplicate factory. `invalidate` does the right thing per-entry: entries with
				// a `CacheController` (created via `getOrCreate`) are marked invalidated; entries
				// without one (created via plain `.set()`, e.g. per-worktree mapper results) are
				// hard-deleted. Caches that don't support `invalidate` fall back to `delete`.
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
			} else {
				cache.delete(repoPath);
			}
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
	 * No-op if `repoPath` is not registered.
	 */
	@debug({ onlyExit: true })
	unregisterRepoPath(repoPath: string): void {
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
		this._commonPathRegistry.clear();
		this._worktreesByCommonPath.clear();
		this._caches = createEmptyCaches();
	}

	@debug({ onlyExit: true })
	onRepositoryChanged(repoPath: string, changes: RepositoryChange[]): void {
		const changesSet = new Set(changes);

		const hasAny = (...c: RepositoryChange[]) => c.some(ch => changesSet.has(ch));

		if (hasAny('unknown', 'closed')) {
			this.unregisterRepoPath(repoPath);
			return;
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
			types.add('gkConfig');
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
				void p.finally(() => {
					if (cacheable.invalidated) {
						this.branches.invalidate(commonPath);
						for (const worktreePath of this.getWorktreePaths(commonPath)) {
							this.branches.invalidate(worktreePath);
						}
					}
				});
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

	getGkConfig(
		repoPath: string,
		key: string,
		factory: () => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		const cacheKey = this.getCommonPath(repoPath);

		const result = this.gkConfigKeys.get(cacheKey, key);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.gkConfigKeys.set(cacheKey, key, factoryPromise);
		return factoryPromise;
	}

	getGkConfigRegex(
		repoPath: string,
		pattern: string,
		factory: () => PromiseOrValue<Map<string, string>>,
	): Promise<Map<string, string>> {
		const cacheKey = this.getCommonPath(repoPath);

		const result = this.gkConfigPatterns.get(cacheKey, pattern);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.gkConfigPatterns.set(cacheKey, pattern, factoryPromise);
		return factoryPromise;
	}

	/**
	 * @param options.skipInvalidation Downstream caches the caller wants preserved despite this
	 * write. Use when the value being written is exactly what was just resolved — e.g. the Tier 2
	 * `storeMergeTargetBranchName` self-write inside `getBranchContributionsOverview` (skip
	 * `'branchOverviews'`) or the Tier 3 `storeBaseBranchName` self-write inside `getBaseBranchName`
	 * (skip both `'baseBranchName'` and `'branchOverviews'`). The upstream caches (`gkConfigKeys`,
	 * `gkConfigPatterns`) always invalidate so subsequent reads of this key see the new value.
	 */
	deleteGkConfig(
		repoPath: string,
		key: string,
		options?: { skipInvalidation?: readonly GkConfigInvalidationTarget[] },
	): void {
		const cacheKey = this.getCommonPath(repoPath);
		this._caches.gkConfigKeys?.delete(cacheKey, key);
		this._caches.gkConfigPatterns?.delete(cacheKey);

		const refMatch = key.match(branchOverviewGkConfigKeysRegex);
		if (refMatch == null) return;

		const ref = refMatch[1];
		const skip = options?.skipInvalidation;

		// `getBaseBranchName` reads `branch.<ref>.gk-merge-base` and caches the resolved value
		// per-ref. A write to that key must invalidate the cached base or Tier 3 of
		// `getBranchContributionsOverview` will resolve `mergeTarget` against the pre-write value.
		if (key.endsWith('.gk-merge-base') && !skip?.includes('baseBranchName')) {
			this._caches.baseBranchName?.delete(cacheKey, ref);
		}

		if (skip?.includes('branchOverviews')) return;

		// When the change affects a branch's merge-target/base lineage, invalidate that branch's
		// cached overviews so subsequent reads pick up the new stored value rather than stale data.
		// `getBranchContributionsOverview` keys `branchOverviews` by `${ref}|${mergeTarget}`, so
		// invalidate every entry for the affected ref regardless of which target it resolved to.
		// Uses `invalidateByKeyPrefix` (not `deleteByKeyPrefix`) so an in-flight factory is still
		// shared with new callers instead of triggering a duplicate fetch.
		this._caches.branchOverviews?.invalidateByKeyPrefix(cacheKey, `${ref}|`);
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
		factory: (commonPath: string, cancellation?: AbortSignal) => PromiseOrValue<GitContributorsStats | undefined>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<GitContributorsStats | undefined> {
		return this.getSharedSimpleWithKey(this.contributorsStats, repoPath, cacheKey, factory, options);
	}

	getBaseBranchName(
		repoPath: string,
		ref: string,
		factory: (commonPath: string, cancellation?: AbortSignal) => PromiseOrValue<string | undefined>,
		cancellation?: AbortSignal,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.baseBranchName, repoPath, ref, factory, {
			cancellation: cancellation,
		});
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
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.defaultBranchName, repoPath, remote, factory);
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
				void p.finally(() => {
					if (cacheable.invalidated) {
						for (const worktreePath of this.getWorktreePaths(commonPath)) {
							if (worktreePath === commonPath) continue;

							cache.invalidate(worktreePath);
						}
					}
				});
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
				void p.finally(() => {
					if (cacheable.invalidated) {
						for (const worktreePath of this.getWorktreePaths(commonPath)) {
							if (worktreePath === commonPath) continue;

							cache.invalidate(worktreePath, cacheKey);
						}
					}
				});
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
		factory: (commonPath: string) => PromiseOrValue<T>,
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		// `PromiseMap.getOrCreate(key, factory, cancellation?)` and
		// `PromiseCache.getOrCreate(key, factory, options?)` have different 3rd-argument shapes,
		// so we dispatch on cache type. Both register a `CacheController` so `invalidate` works.
		if (cache instanceof PromiseCache) {
			return cache.getOrCreate(commonPath, () => Promise.resolve(factory(commonPath)));
		}
		return cache.getOrCreate(commonPath, () => Promise.resolve(factory(commonPath)));
	}

	private async getSharedSimpleWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cancellation?: AbortSignal) => PromiseOrValue<T>,
		options?: { accessTTL?: number; cancellation?: AbortSignal },
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		return cache.getOrCreate(
			commonPath,
			cacheKey,
			(_cacheable, signal) => Promise.resolve(factory(commonPath, signal)),
			options,
		);
	}
}
