import type { Uri } from 'vscode';
import { Disposable } from 'vscode';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import { log } from '../system/decorators/log.js';
import type { PromiseOrValue } from '../system/promise.js';
import {
	CacheController,
	PromiseCache,
	PromiseMap,
	RepoPromiseCacheMap,
	RepoPromiseMap,
} from '../system/promiseCache.js';
import { PathTrie } from '../system/trie.js';
import type { GitIgnoreCache } from './gitIgnoreCache.js';
import type {
	CachedGitTypes,
	GitCommitReachability,
	GitContributorsResult,
	GitDir,
	PagedResult,
} from './gitProvider.js';
import type { GitBranch } from './models/branch.js';
import type { GitStashCommit } from './models/commit.js';
import type { GitContributor, GitContributorsStats } from './models/contributor.js';
import type { ConflictDetectionResult } from './models/mergeConflicts.js';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus.js';
import type { GitBranchReference } from './models/reference.js';
import type { GitRemote } from './models/remote.js';
import type { GitStash } from './models/stash.js';
import type { GitTag } from './models/tag.js';
import type { GitUser } from './models/user.js';
import type { GitWorktree } from './models/worktree.js';
import type { RemoteProvider } from './remotes/remoteProvider.js';
import { getCommonRepositoryPath, getRepositoryOrWorktreePath } from './utils/-webview/repository.utils.js';

type RepoPath = string;

export type ConflictDetectionCacheKey = `apply:${string}:${string}:${string}` | `merge:${string}:${string}`;

interface RepositoryInfo {
	gitDir?: GitDir;
	user?: GitUser | null;
}

const emptyArray: readonly any[] = Object.freeze([]);

export class GitCache implements Disposable {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this.clearCaches(undefined, 'remotes');
				}
			}),
			container.events.on('git:cache:reset', e =>
				this.clearCaches(e.data.repoPath, ...(e.data.types ?? emptyArray)),
			),
		);
	}

	dispose(): void {
		this.reset();
		this._disposable.dispose();
	}

	//#region CommonPath Registry - Maps worktree paths to their common repository path

	private _commonPathRegistry = new Map<RepoPath, string>();

	/**
	 * Registers a repository path and computes its common path from the gitDir
	 * For main repositories, commonPath === repoPath.
	 * For worktrees, commonPath is the path of the main repository.
	 */
	registerRepoPath(repoUri: Uri, gitDir: GitDir): void {
		const repoPath = getRepositoryOrWorktreePath(repoUri);
		const commonPath = gitDir.commonUri != null ? getCommonRepositoryPath(gitDir.commonUri) : repoPath;
		this._commonPathRegistry.set(repoPath, commonPath);
	}

	/**
	 * Returns the common repository path for the given repo/worktree path
	 * If not registered, returns the input path (assumes it's a main repo).
	 */
	getCommonPath(repoPath: string): string {
		return this._commonPathRegistry.get(repoPath) ?? repoPath;
	}

	/**
	 * Returns true if the given path is a worktree (has a different commonPath)
	 */
	isWorktree(repoPath: string): boolean {
		const commonPath = this._commonPathRegistry.get(repoPath);
		return commonPath != null && commonPath !== repoPath;
	}

	/**
	 * Returns all registered worktree paths that share the given commonPath
	 * Includes the main repo path if it's registered
	 */
	getWorktreePaths(commonPath: string): string[] {
		return [...this._commonPathRegistry.entries()]
			.filter(([_, cp]) => cp === commonPath)
			.map(([repoPath]) => repoPath);
	}

	//#endregion

	//#region Worktree-aware shared cache accessors
	// These methods hide all the complexity of worktree-aware caching from callers.
	// Data is cached using commonPath (main repo) and cloned for worktrees automatically.

	/**
	 * Gets tags from cache or creates them via factory.
	 * Tags are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that creates tags. Receives `commonPath` and `cacheable` controller.
	 */
	async getTags(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<PagedResult<GitTag>>,
	): Promise<PagedResult<GitTag>> {
		return this.getSharedOrCreate(this.tags, repoPath, factory, (data, newRepoPath) => ({
			...data,
			values: data.values.map(t => t.withRepoPath(newRepoPath)),
		}));
	}

	/**
	 * Gets remotes from cache or creates them via factory.
	 * Remotes are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that creates remotes. Receives `commonPath` and `cacheable` controller.
	 */
	async getRemotes(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitRemote[]>,
	): Promise<GitRemote[]> {
		return this.getSharedOrCreate(this.remotes, repoPath, factory, (data, newRepoPath) =>
			data.map(r => r.withRepoPath(newRepoPath)),
		);
	}

	/**
	 * Gets stash from cache or creates it via factory.
	 * Stashes are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that creates stash. Receives `commonPath` and `cacheable` controller.
	 */
	async getStash(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitStash>,
	): Promise<GitStash> {
		return this.getSharedOrCreate(this.stashes, repoPath, factory, (data, newRepoPath) => ({
			repoPath: newRepoPath,
			stashes: new Map(
				[...data.stashes.entries()].map(([sha, s]) => [sha, s.withRepoPath<GitStashCommit>(newRepoPath)]),
			),
		}));
	}

	/**
	 * Gets worktrees from cache or creates them via factory.
	 * Worktree list is shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that creates worktrees. Receives `commonPath` and `cacheable` controller.
	 */
	async getWorktrees(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitWorktree[]>,
	): Promise<GitWorktree[]> {
		return this.getSharedOrCreate(this.worktrees, repoPath, factory, (data, newRepoPath) =>
			data.map(w => w.withRepoPath(newRepoPath)),
		);
	}

	/**
	 * Gets contributors from cache or creates them via factory.
	 * Contributors are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param cacheKey The cache key for this specific query (e.g., includes ref filter)
	 * @param factory Function that creates contributors. Receives `commonPath` and `cacheable` controller.
	 * @param options Optional TTL options for cache entry
	 */
	async getContributors(
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitContributorsResult>,
		options?: { accessTTL?: number },
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

	/**
	 * Gets contributors lite from cache or creates them via factory.
	 * Contributors are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param cacheKey The cache key for this specific query
	 * @param factory Function that creates contributors. Receives `commonPath` and `cacheable` controller.
	 * @param options Optional TTL options for cache entry
	 */
	async getContributorsLite(
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitContributor[]>,
		options?: { accessTTL?: number },
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

	/**
	 * Gets contributors stats from cache or creates them via factory.
	 * Contributors stats are shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param cacheKey The cache key for this specific query
	 * @param factory Function that fetches contributors stats. Receives `commonPath`.
	 * @param options Optional TTL options for cache entry
	 */
	getContributorsStats(
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string) => PromiseOrValue<GitContributorsStats | undefined>,
		options?: { accessTTL?: number },
	): Promise<GitContributorsStats | undefined> {
		return this.getSharedSimpleWithKey(this.contributorsStats, repoPath, cacheKey, factory, options);
	}

	/**
	 * Gets the default branch name from cache or creates it via factory.
	 * The default branch name is shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param remote The remote name (e.g., 'origin')
	 * @param factory Function that fetches the default branch name. Receives `commonPath`.
	 */
	getDefaultBranchName(
		repoPath: string,
		remote: string,
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.defaultBranchName, repoPath, remote, factory);
	}

	/**
	 * Gets the initial (root) commit SHA from cache or creates it via factory.
	 * The initial commit SHA is shared across all worktrees of the same repository.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that fetches the initial commit SHA. Receives `commonPath`.
	 */
	getInitialCommitSha(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimple(this.initialCommitSha, repoPath, factory);
	}

	/**
	 * Gets the last fetched timestamp from cache or creates it via factory.
	 * The last fetched timestamp is shared across all worktrees of the same repository
	 * because FETCH_HEAD is stored in the common .git directory.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that fetches the last fetched timestamp. Receives `commonPath`.
	 */
	getLastFetchedTimestamp(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<number | undefined>,
	): Promise<number | undefined> {
		return this.getSharedSimple(this.lastFetched, repoPath, factory);
	}

	/**
	 * Gets branches from cache or creates them via factory.
	 * Branches require special handling because the `current` flag is per-worktree.
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that fetches branches. Receives `commonPath`.
	 * @param mapper Function that maps shared branches to worktree-specific branches.
	 *        Receives shared branches and target repoPath, returns branches with correct
	 *        `current` flag and repoPath for the target worktree.
	 */
	async getBranches(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<PagedResult<GitBranch>>,
		mapper: (
			branches: PagedResult<GitBranch>,
			targetRepoPath: string,
			commonPath: string,
		) => PromiseOrValue<PagedResult<GitBranch>>,
	): Promise<PagedResult<GitBranch>> {
		// Check if we have cached mapped data for this specific repoPath
		const cached = this.branches.get(repoPath);
		if (cached != null) return cached;

		const commonPath = this.getCommonPath(repoPath);

		// Check if we have shared (raw) data at commonPath
		// Uses separate cache because raw data has current=false for all branches
		let sharedPromise = this.sharedBranches.get(commonPath);
		if (sharedPromise == null) {
			// No shared data - fetch from factory
			sharedPromise = Promise.resolve(factory(commonPath));
			this.sharedBranches.set(commonPath, sharedPromise);
		}

		// Always map for the requesting repo to set correct `current` flag
		// This applies to both main repo and worktrees since factory sets current=false
		const mappedPromise = sharedPromise.then(shared => mapper(shared, repoPath, commonPath));
		this.branches.set(repoPath, mappedPromise);

		return mappedPromise;
	}

	/**
	 * Internal helper for worktree-aware caching with simple key (repoPath-based caches).
	 */
	private async getSharedOrCreate<T>(
		cache: PromiseMap<string, T>,
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
	): Promise<T> {
		// Check if we have cached data for this specific repoPath
		const result = cache.get(repoPath);
		if (result != null) {
			return result;
		}

		const commonPath = this.getCommonPath(repoPath);

		// If this is a worktree (commonPath differs), check the commonPath cache
		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath);
			if (commonResult != null) {
				// Map the data with the correct repoPath and cache it
				const mappedData = mapper(await commonResult, repoPath);
				cache.set(repoPath, Promise.resolve(mappedData));
				return mappedData;
			}
		}

		// Create CacheController for the factory to signal cache invalidation
		const cacheable = new CacheController();

		// Not cached anywhere - fetch from factory using commonPath for consistent cached objects
		const factoryPromise = Promise.resolve(factory(commonPath, cacheable));
		cache.set(commonPath, factoryPromise);

		// Handle invalidation after promise settles
		void factoryPromise.finally(() => {
			if (cacheable.invalidated) {
				cache.delete(commonPath);
				if (commonPath !== repoPath) {
					cache.delete(repoPath);
				}
			}
		});

		// If this is a worktree, also cache a mapped version for the repoPath
		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, Promise.resolve(mappedData));
			return mappedData;
		}

		return factoryPromise;
	}

	/**
	 * Internal helper for worktree-aware caching with composite key (repoPath + cacheKey caches).
	 */
	private async getSharedOrCreateWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
		options?: { accessTTL?: number },
	): Promise<T> {
		// Check if we have cached data for this specific repoPath
		const result = cache.get(repoPath, cacheKey);
		if (result != null) {
			return result;
		}

		const commonPath = this.getCommonPath(repoPath);

		// If this is a worktree (commonPath differs), check the commonPath cache
		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath, cacheKey);
			if (commonResult != null) {
				// Map the data with the correct repoPath and cache it
				const mappedData = mapper(await commonResult, repoPath);
				cache.set(repoPath, cacheKey, Promise.resolve(mappedData), options);
				return mappedData;
			}
		}

		// Create CacheController for the factory to signal cache invalidation
		const cacheable = new CacheController();

		// Not cached anywhere - fetch from factory using commonPath for consistent cached objects
		const factoryPromise = Promise.resolve(factory(commonPath, cacheable));
		cache.set(commonPath, cacheKey, factoryPromise, options);

		// Handle invalidation after promise settles
		void factoryPromise.finally(() => {
			if (cacheable.invalidated) {
				cache.delete(commonPath, cacheKey);
				if (commonPath !== repoPath) {
					cache.delete(repoPath, cacheKey);
				}
			}
		});

		// If this is a worktree, also cache a mapped version for the repoPath
		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, cacheKey, Promise.resolve(mappedData), options);
			return mappedData;
		}

		return factoryPromise;
	}

	/**
	 * Internal helper for worktree-aware caching of simple values (no mapper needed).
	 * Works with any cache that has get(key) and set(key, promise) methods.
	 */
	private async getSharedSimple<T>(
		cache: { get(key: string): Promise<T> | undefined; set(key: string, promise: Promise<T>): unknown },
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<T>,
	): Promise<T> {
		const result = cache.get(repoPath);
		if (result != null) return result;

		const commonPath = this.getCommonPath(repoPath);
		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath);
			if (commonResult != null) {
				cache.set(repoPath, commonResult);
				return commonResult;
			}
		}

		const factoryPromise = Promise.resolve(factory(commonPath));
		cache.set(commonPath, factoryPromise);
		if (commonPath !== repoPath) {
			cache.set(repoPath, factoryPromise);
		}
		return factoryPromise;
	}

	/**
	 * Internal helper for worktree-aware caching of simple values with composite key (no mapper needed).
	 */
	private async getSharedSimpleWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string) => PromiseOrValue<T>,
		options?: { accessTTL?: number },
	): Promise<T> {
		const result = cache.get(repoPath, cacheKey);
		if (result != null) return result;

		const commonPath = this.getCommonPath(repoPath);
		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath, cacheKey);
			if (commonResult != null) {
				cache.set(repoPath, cacheKey, commonResult, options);
				return commonResult;
			}
		}

		const factoryPromise = Promise.resolve(factory(commonPath));
		cache.set(commonPath, cacheKey, factoryPromise, options);
		if (commonPath !== repoPath) {
			cache.set(repoPath, cacheKey, factoryPromise, options);
		}
		return factoryPromise;
	}

	private _bestRemotesCache: PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> | undefined;
	get bestRemotes(): PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> {
		return (this._bestRemotesCache ??= new PromiseMap<RepoPath, GitRemote<RemoteProvider>[]>());
	}

	private _branchCache: PromiseMap<RepoPath, GitBranch | undefined> | undefined;
	get branch(): PromiseMap<RepoPath, GitBranch | undefined> {
		return (this._branchCache ??= new PromiseMap<RepoPath, GitBranch | undefined>());
	}

	private _branchesCache: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	get branches(): PromiseMap<RepoPath, PagedResult<GitBranch>> {
		return (this._branchesCache ??= new PromiseMap<RepoPath, PagedResult<GitBranch>>());
	}

	// Internal cache for raw shared branch data (keyed by commonPath)
	// Separate from branches cache because branches need reconstruction for each worktree
	private _sharedBranchesCache: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	private get sharedBranches(): PromiseMap<RepoPath, PagedResult<GitBranch>> {
		return (this._sharedBranchesCache ??= new PromiseMap<RepoPath, PagedResult<GitBranch>>());
	}

	/**
	 * Clears the shared branch cache entry for a given commonPath.
	 * Used by factory functions to invalidate on error.
	 */
	clearSharedBranches(commonPath: string): void {
		this._sharedBranchesCache?.delete(commonPath);
	}

	// Short-TTL cache for current branch reference per worktree
	// This avoids running `git rev-parse --abbrev-ref --symbolic-full-name @ @{u}` repeatedly
	// during branch reconstruction for worktrees
	private _currentBranchRefCache: PromiseCache<RepoPath, GitBranchReference | undefined> | undefined;
	get currentBranchRef(): PromiseCache<RepoPath, GitBranchReference | undefined> {
		return (this._currentBranchRefCache ??= new PromiseCache<RepoPath, GitBranchReference | undefined>({
			createTTL: 1000 * 30, // 30 seconds - short enough to stay fresh, long enough to dedupe calls
		}));
	}

	/**
	 * Pre-populates the current branch reference cache for a worktree.
	 * This is called when for-each-ref returns branches with worktreePath info,
	 * allowing us to skip the rev-parse call for current branch detection.
	 *
	 * @param worktreePath The path of the worktree
	 * @param reference The branch reference to cache, or undefined if no current branch
	 */
	setCurrentBranchRef(worktreePath: string, reference: GitBranchReference | undefined): void {
		// Only set if not already cached to avoid overwriting fresher data
		if (this.currentBranchRef.get(worktreePath) == null) {
			this.currentBranchRef.set(worktreePath, Promise.resolve(reference));
		}
	}

	private _conflictDetectionCache:
		| RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult>
		| undefined;
	get conflictDetection(): RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult> {
		return (this._conflictDetectionCache ??= new RepoPromiseCacheMap<
			ConflictDetectionCacheKey,
			ConflictDetectionResult
		>({
			createTTL: 1000 * 30, // 30 seconds
		}));
	}

	private _contributorsCache: RepoPromiseCacheMap<string, GitContributorsResult> | undefined;
	get contributors(): RepoPromiseCacheMap<string, GitContributorsResult> {
		return (this._contributorsCache ??= new RepoPromiseCacheMap<string, GitContributorsResult>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	private _contributorsLiteCache: RepoPromiseCacheMap<string, GitContributor[]> | undefined;
	get contributorsLite(): RepoPromiseCacheMap<string, GitContributor[]> {
		return (this._contributorsLiteCache ??= new RepoPromiseCacheMap<string, GitContributor[]>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	private _contributorsStatsCache: RepoPromiseCacheMap<string, GitContributorsStats | undefined> | undefined;
	get contributorsStats(): RepoPromiseCacheMap<string, GitContributorsStats | undefined> {
		return (this._contributorsStatsCache ??= new RepoPromiseCacheMap<string, GitContributorsStats | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
		}));
	}

	private _defaultBranchNameCache: RepoPromiseCacheMap<string, string | undefined> | undefined;
	get defaultBranchName(): RepoPromiseCacheMap<string, string | undefined> {
		return (this._defaultBranchNameCache ??= new RepoPromiseCacheMap<string, string | undefined>());
	}

	private _gitIgnoreCaches: Map<RepoPath, GitIgnoreCache> | undefined;
	get gitIgnore(): Map<RepoPath, GitIgnoreCache> {
		return (this._gitIgnoreCaches ??= new Map<RepoPath, GitIgnoreCache>());
	}

	private _initialCommitShaCache: PromiseMap<RepoPath, string | undefined> | undefined;
	get initialCommitSha(): PromiseMap<RepoPath, string | undefined> {
		return (this._initialCommitShaCache ??= new PromiseMap<RepoPath, string | undefined>());
	}

	private _lastFetchedCache: PromiseCache<RepoPath, number | undefined> | undefined;
	get lastFetched(): PromiseCache<RepoPath, number | undefined> {
		return (this._lastFetchedCache ??= new PromiseCache<RepoPath, number | undefined>({
			createTTL: 1000 * 30, // 30 seconds
		}));
	}

	private _pausedOperationStatusCache: PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined;
	get pausedOperationStatus(): PromiseMap<RepoPath, GitPausedOperationStatus | undefined> {
		return (this._pausedOperationStatusCache ??= new PromiseMap<RepoPath, GitPausedOperationStatus | undefined>());
	}

	private _reachabilityCache: RepoPromiseCacheMap<string, GitCommitReachability | undefined> | undefined;
	get reachability(): RepoPromiseCacheMap<string, GitCommitReachability | undefined> {
		return (this._reachabilityCache ??= new RepoPromiseCacheMap<string, GitCommitReachability | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 25, // Limit to 25 commits per repo
		}));
	}

	private _remotesCache: PromiseMap<RepoPath, GitRemote[]> | undefined;
	get remotes(): PromiseMap<RepoPath, GitRemote[]> {
		return (this._remotesCache ??= new PromiseMap<RepoPath, GitRemote[]>());
	}

	private _repoInfoCache: Map<RepoPath, RepositoryInfo> | undefined;
	get repoInfo(): Map<RepoPath, RepositoryInfo> {
		return (this._repoInfoCache ??= new Map<RepoPath, RepositoryInfo>());
	}

	private _stashesCache: PromiseMap<RepoPath, GitStash> | undefined;
	get stashes(): PromiseMap<RepoPath, GitStash> {
		return (this._stashesCache ??= new PromiseMap<RepoPath, GitStash>());
	}

	private _tagsCache: PromiseMap<RepoPath, PagedResult<GitTag>> | undefined;
	get tags(): PromiseMap<RepoPath, PagedResult<GitTag>> {
		return (this._tagsCache ??= new PromiseMap<RepoPath, PagedResult<GitTag>>());
	}

	private _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();
	get trackedPaths(): PathTrie<PromiseOrValue<[string, string] | undefined>> {
		return this._trackedPaths;
	}

	private _worktreesCache: PromiseMap<RepoPath, GitWorktree[]> | undefined;
	get worktrees(): PromiseMap<RepoPath, GitWorktree[]> {
		return (this._worktreesCache ??= new PromiseMap<RepoPath, GitWorktree[]>());
	}

	@log({ singleLine: true })
	clearCaches(repoPath: string | undefined, ...types: CachedGitTypes[]): void {
		type CacheType =
			| Map<string, unknown>
			| PromiseCache<string, unknown>
			| PromiseMap<string, unknown>
			| RepoPromiseCacheMap<unknown, unknown>
			| RepoPromiseMap<unknown, unknown>
			| PathTrie<unknown>
			| undefined;

		const cachesToClear = new Set<CacheType>();
		// Caches that use commonPath for shared data across worktrees
		const sharedCachesToClear = new Set<CacheType>();

		if (!types.length || types.includes('branches')) {
			// Branch caches use commonPath for shared data across worktrees
			sharedCachesToClear.add(this._branchCache);
			sharedCachesToClear.add(this._branchesCache);
			sharedCachesToClear.add(this._sharedBranchesCache);
			cachesToClear.add(this._conflictDetectionCache);
			cachesToClear.add(this._currentBranchRefCache);
			sharedCachesToClear.add(this._defaultBranchNameCache);
			sharedCachesToClear.add(this._initialCommitShaCache);
			cachesToClear.add(this._reachabilityCache);
		}

		if (!types.length || types.includes('contributors')) {
			// Contributors use commonPath for caching
			sharedCachesToClear.add(this._contributorsCache);
			sharedCachesToClear.add(this._contributorsLiteCache);
			sharedCachesToClear.add(this._contributorsStatsCache);
		}

		if (!types.length || types.includes('gitignore')) {
			cachesToClear.add(this._gitIgnoreCaches);
		}

		if (!types.length || types.includes('providers')) {
			cachesToClear.add(this._bestRemotesCache);
		}

		if (!types.length || types.includes('remotes')) {
			// Remotes use commonPath for caching
			sharedCachesToClear.add(this._remotesCache);
			cachesToClear.add(this._bestRemotesCache);
			sharedCachesToClear.add(this._defaultBranchNameCache);
		}

		if (!types.length || types.includes('stashes')) {
			// Stashes use commonPath for caching
			sharedCachesToClear.add(this._stashesCache);
		}

		if (!types.length || types.includes('status')) {
			cachesToClear.add(this._pausedOperationStatusCache);
		}

		if (!types.length || types.includes('tags')) {
			// Tags use commonPath for caching
			sharedCachesToClear.add(this._tagsCache);
		}

		if (!types.length || types.includes('worktrees')) {
			// Worktrees use commonPath for caching
			sharedCachesToClear.add(this._worktreesCache);
		}

		if (!types.length) {
			cachesToClear.add(this._repoInfoCache);
			cachesToClear.add(this._trackedPaths);
			cachesToClear.add(this._gitIgnoreCaches);
		}

		// Clear per-worktree caches
		for (const cache of cachesToClear) {
			if (repoPath != null) {
				cache?.delete(repoPath);
			} else {
				cache?.clear();
			}
		}

		// Clear shared caches using commonPath
		// For shared caches, we need to clear both the commonPath entry and all worktree entries
		for (const cache of sharedCachesToClear) {
			if (repoPath != null) {
				const commonPath = this.getCommonPath(repoPath);
				// Clear the commonPath entry (source of truth)
				cache?.delete(commonPath);
				// Clear all worktree entries that share this commonPath
				for (const worktreePath of this.getWorktreePaths(commonPath)) {
					cache?.delete(worktreePath);
				}
			} else {
				cache?.clear();
			}
		}
	}

	@log({ singleLine: true })
	reset(): void {
		this._commonPathRegistry.clear();
		this._branchCache?.clear();
		this._branchCache = undefined;
		this._branchesCache?.clear();
		this._branchesCache = undefined;
		this._sharedBranchesCache?.clear();
		this._sharedBranchesCache = undefined;
		this._conflictDetectionCache?.clear();
		this._conflictDetectionCache = undefined;
		this._currentBranchRefCache?.clear();
		this._currentBranchRefCache = undefined;
		this._contributorsCache?.clear();
		this._contributorsCache = undefined;
		this._contributorsLiteCache?.clear();
		this._contributorsLiteCache = undefined;
		this._contributorsStatsCache?.clear();
		this._contributorsStatsCache = undefined;
		this._gitIgnoreCaches?.clear();
		this._gitIgnoreCaches = undefined;
		this._initialCommitShaCache?.clear();
		this._initialCommitShaCache = undefined;
		this._lastFetchedCache?.clear();
		this._lastFetchedCache = undefined;
		this._pausedOperationStatusCache?.clear();
		this._pausedOperationStatusCache = undefined;
		this._reachabilityCache?.clear();
		this._reachabilityCache = undefined;
		this._remotesCache?.clear();
		this._remotesCache = undefined;
		this._repoInfoCache?.clear();
		this._repoInfoCache = undefined;
		this._stashesCache?.clear();
		this._stashesCache = undefined;
		this._tagsCache?.clear();
		this._tagsCache = undefined;
		this._trackedPaths.clear();
		this._worktreesCache?.clear();
		this._worktreesCache = undefined;
	}
}
