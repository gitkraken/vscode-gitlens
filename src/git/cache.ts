import type { Uri } from 'vscode';
import { Disposable } from 'vscode';
import type { Container } from '../container.js';
import { configuration } from '../system/-webview/configuration.js';
import { debug } from '../system/decorators/log.js';
import { invalidateMemoized } from '../system/decorators/memoize.js';
import type { PromiseOrValue } from '../system/promise.js';
import type { RepoPromiseMap } from '../system/promiseCache.js';
import { CacheController, PromiseCache, PromiseMap, RepoPromiseCacheMap } from '../system/promiseCache.js';
import type { GitResult } from './execTypes.js';
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
import type { RepositoryChangeEvent } from './models/repository.js';
import type { GitStash } from './models/stash.js';
import type { GitTag } from './models/tag.js';
import type { GitUser } from './models/user.js';
import type { GitWorktree } from './models/worktree.js';
import type { RemoteProvider } from './remotes/remoteProvider.js';
import { getCommonRepositoryPath, getRepositoryOrWorktreePath } from './utils/-webview/repository.utils.js';

type RepoPath = string;

export type ConflictDetectionCacheKey = `apply:${string}:${string}:${string}` | `merge:${string}:${string}`;

const emptyArray: readonly any[] = Object.freeze([]);

interface Caches {
	bestRemotes: PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> | undefined;
	branch: PromiseMap<RepoPath, GitBranch | undefined> | undefined;
	branches: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	fileExistence: RepoPromiseCacheMap<string, boolean> | undefined;
	configKeys: RepoPromiseCacheMap<string, string | undefined> | undefined;
	configPatterns: RepoPromiseCacheMap<string, Map<string, string>> | undefined;
	conflictDetection: RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult> | undefined;
	contributors: RepoPromiseCacheMap<string, GitContributorsResult> | undefined;
	contributorsLite: RepoPromiseCacheMap<string, GitContributor[]> | undefined;
	contributorsStats: RepoPromiseCacheMap<string, GitContributorsStats | undefined> | undefined;
	currentBranchReference: PromiseCache<RepoPath, GitBranchReference | undefined> | undefined;
	currentUser: Map<RepoPath, GitUser | null> | undefined;
	defaultBranchName: RepoPromiseCacheMap<string, string | undefined> | undefined;
	gitDir: Map<RepoPath, GitDir> | undefined;
	gitIgnore: Map<RepoPath, GitIgnoreCache> | undefined;
	gitResults: RepoPromiseCacheMap<string, GitResult> | undefined;
	gkConfigKeys: RepoPromiseCacheMap<string, string | undefined> | undefined;
	gkConfigPatterns: RepoPromiseCacheMap<string, Map<string, string>> | undefined;
	initialCommitSha: PromiseMap<RepoPath, string | undefined> | undefined;
	lastFetched: PromiseCache<RepoPath, number | undefined> | undefined;
	logShas: RepoPromiseCacheMap<string, string[]> | undefined;
	pausedOperationStatus: PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined;
	reachability: RepoPromiseCacheMap<string, GitCommitReachability | undefined> | undefined;
	remotes: PromiseMap<RepoPath, GitRemote[]> | undefined;
	sharedBranches: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	stashes: PromiseMap<RepoPath, GitStash> | undefined;
	tags: PromiseMap<RepoPath, PagedResult<GitTag>> | undefined;
	trackedPaths: RepoPromiseCacheMap<string, [string, string] | false> | undefined;
	worktrees: PromiseMap<RepoPath, GitWorktree[]> | undefined;
}

function createEmptyCaches(): Caches {
	return {
		bestRemotes: undefined,
		branch: undefined,
		branches: undefined,
		fileExistence: undefined,
		configKeys: undefined,
		configPatterns: undefined,
		conflictDetection: undefined,
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
		reachability: undefined,
		remotes: undefined,
		sharedBranches: undefined,
		stashes: undefined,
		tags: undefined,
		trackedPaths: undefined,
		worktrees: undefined,
	};
}

export class GitCache implements Disposable {
	private _caches: Caches = createEmptyCaches();
	private _commonPathRegistry = new Map<RepoPath, string>();
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

	get bestRemotes(): PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> {
		return (this._caches.bestRemotes ??= new PromiseMap<RepoPath, GitRemote<RemoteProvider>[]>());
	}

	get branch(): PromiseMap<RepoPath, GitBranch | undefined> {
		return (this._caches.branch ??= new PromiseMap<RepoPath, GitBranch | undefined>());
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
		// Cache for current branch reference per worktree
		// Avoids running `git rev-parse --abbrev-ref --symbolic-full-name @ @{u}` repeatedly during branch mapping for worktrees

		return (this._caches.currentBranchReference ??= new PromiseCache<RepoPath, GitBranchReference | undefined>());
	}

	/**
	 * Pre-populates the current branch reference cache for a worktree.
	 * This is called when for-each-ref returns branches with worktreePath info,
	 * allowing us to skip the rev-parse call for current branch detection.
	 *
	 * @param worktreePath The path of the worktree
	 * @param reference The branch reference to cache, or undefined if no current branch
	 */
	setCurrentBranchReference(worktreePath: string, reference: GitBranchReference | undefined): void {
		// Only set if not already cached to avoid overwriting fresher data
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

	get gitIgnore(): Map<RepoPath, GitIgnoreCache> {
		return (this._caches.gitIgnore ??= new Map<RepoPath, GitIgnoreCache>());
	}

	/** Generic cache for git command results */
	get gitResults(): RepoPromiseCacheMap<RepoPath, GitResult> {
		return (this._caches.gitResults ??= new RepoPromiseCacheMap<RepoPath, GitResult>());
	}

	get initialCommitSha(): PromiseMap<RepoPath, string | undefined> {
		return (this._caches.initialCommitSha ??= new PromiseMap<RepoPath, string | undefined>());
	}

	get lastFetched(): PromiseCache<RepoPath, number | undefined> {
		return (this._caches.lastFetched ??= new PromiseCache<RepoPath, number | undefined>({
			createTTL: 1000 * 30, // 30 seconds
		}));
	}

	/**
	 * Cache for log SHA results (e.g., unpublished commits).
	 * Short TTL since commit state changes frequently, with capacity limit per repo.
	 */
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

	get reachability(): RepoPromiseCacheMap<string, GitCommitReachability | undefined> {
		return (this._caches.reachability ??= new RepoPromiseCacheMap<string, GitCommitReachability | undefined>({
			accessTTL: 1000 * 60 * 60, // 60 minutes
			capacity: 25, // Limit to 25 commits per repo
		}));
	}

	get remotes(): PromiseMap<RepoPath, GitRemote[]> {
		return (this._caches.remotes ??= new PromiseMap<RepoPath, GitRemote[]>());
	}

	get stashes(): PromiseMap<RepoPath, GitStash> {
		return (this._caches.stashes ??= new PromiseMap<RepoPath, GitStash>());
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
		type CacheType =
			| Map<string, unknown>
			| PromiseCache<string, unknown>
			| PromiseMap<string, unknown>
			| RepoPromiseCacheMap<unknown, unknown>
			| RepoPromiseMap<unknown, unknown>
			| undefined;

		const cachesToClear = new Set<CacheType>();
		// Shared caches use commonPath for data shared across worktrees
		const sharedCachesToClear = new Set<CacheType>();

		if (!types.length || types.includes('branches')) {
			sharedCachesToClear.add(this._caches.gitResults);
			cachesToClear.add(this._caches.branch); // per-worktree: each worktree has its own current branch
			sharedCachesToClear.add(this._caches.branches);
			sharedCachesToClear.add(this._caches.sharedBranches);
			cachesToClear.add(this._caches.conflictDetection);
			cachesToClear.add(this._caches.currentBranchReference);
			sharedCachesToClear.add(this._caches.defaultBranchName);
			sharedCachesToClear.add(this._caches.initialCommitSha);
			sharedCachesToClear.add(this._caches.logShas);
			cachesToClear.add(this._caches.reachability);
		}

		if (!types.length || types.includes('config')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.configKeys);
			sharedCachesToClear.add(this._caches.configPatterns);
			cachesToClear.add(this._caches.currentBranchReference);
			cachesToClear.add(this._caches.currentUser);
			cachesToClear.add(this._caches.gitDir);
		}

		if (!types.length || types.includes('contributors')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.contributors);
			sharedCachesToClear.add(this._caches.contributorsLite);
			sharedCachesToClear.add(this._caches.contributorsStats);
		}

		if (!types.length || types.includes('gitignore')) {
			cachesToClear.add(this._caches.gitIgnore);
		}

		if (!types.length || types.includes('gkConfig')) {
			sharedCachesToClear.add(this._caches.gkConfigKeys);
			sharedCachesToClear.add(this._caches.gkConfigPatterns);
		}

		if (!types.length || types.includes('providers')) {
			// When providers change, clear parsed remotes but NOT raw git output
			// Raw git output doesn't change, only the parsing/provider matching does
			sharedCachesToClear.add(this._caches.remotes);
			cachesToClear.add(this._caches.bestRemotes);
			// Invalidate memoized values that depend on providers (e.g., GitBranch.getEnrichedAutolinks)
			invalidateMemoized('providers');
		}

		if (!types.length || types.includes('remotes')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.remotes);
			cachesToClear.add(this._caches.bestRemotes);
			sharedCachesToClear.add(this._caches.defaultBranchName);
		}

		if (!types.length || types.includes('stashes')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.stashes);
		}

		if (!types.length || types.includes('status')) {
			cachesToClear.add(this._caches.pausedOperationStatus);
		}

		if (!types.length || types.includes('tags')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.tags);
		}

		if (!types.length || types.includes('worktrees')) {
			sharedCachesToClear.add(this._caches.gitResults);
			sharedCachesToClear.add(this._caches.worktrees);
		}

		if (!types.length) {
			cachesToClear.add(this._caches.currentUser);
			cachesToClear.add(this._caches.fileExistence);
			cachesToClear.add(this._caches.gitDir);
			cachesToClear.add(this._caches.gitIgnore);
			sharedCachesToClear.add(this._caches.gitResults);
			cachesToClear.add(this._caches.trackedPaths);
		}

		// Clear per-worktree caches
		for (const cache of cachesToClear) {
			if (repoPath != null) {
				cache?.delete(repoPath);
			} else {
				cache?.clear();
			}
		}

		// Clear shared caches at commonPath and all worktree paths
		for (const cache of sharedCachesToClear) {
			if (repoPath != null) {
				const commonPath = this.getCommonPath(repoPath);
				cache?.delete(commonPath);
				for (const worktreePath of this.getWorktreePaths(commonPath)) {
					cache?.delete(worktreePath);
				}
			} else {
				cache?.clear();
			}
		}
	}

	/**
	 * Gets the common repository path for the given repo/worktree path
	 * If not registered, returns the input path (assumes it's a main repo)
	 */
	getCommonPath(repoPath: string): string {
		return this._commonPathRegistry.get(repoPath) ?? repoPath;
	}

	/** Gets all registered worktree paths that share the given commonPath, includes the main repo path if it's registered */
	getWorktreePaths(commonPath: string): string[] {
		return [...this._commonPathRegistry.entries()]
			.filter(([_, cp]) => cp === commonPath)
			.map(([repoPath]) => repoPath);
	}

	/** Gets whether the given path is a worktree (has a different commonPath) */
	isWorktree(repoPath: string): boolean {
		const commonPath = this._commonPathRegistry.get(repoPath);
		return commonPath != null && commonPath !== repoPath;
	}

	/**
	 * Registers a repository path and computes its common path from the gitDir
	 * For main repositories, commonPath === repoPath
	 * For worktrees, commonPath is the path of the main repository
	 */
	registerRepoPath(repoUri: Uri, gitDir: GitDir): void {
		const repoPath = getRepositoryOrWorktreePath(repoUri);
		const commonPath = gitDir.commonUri != null ? getCommonRepositoryPath(gitDir.commonUri) : repoPath;
		this._commonPathRegistry.set(repoPath, commonPath);
	}

	@debug({ onlyExit: true })
	reset(): void {
		this._commonPathRegistry.clear();

		// Clear all caches and reset to empty state
		this._caches = createEmptyCaches();
	}

	/**
	 * Handles repository change events by invalidating appropriate caches.
	 * Encapsulates all cache invalidation logic for repository changes.
	 */
	@debug({ onlyExit: true })
	onRepositoryChanged(repoPath: string, e: RepositoryChangeEvent): void {
		if (e.changed('unknown', 'closed')) {
			this.clearCaches(repoPath);
			return;
		}

		const types = new Set<CachedGitTypes>();

		if (e.changed('head')) {
			this.currentBranchReference.delete(repoPath);
		}

		if (e.changed('index')) {
			this._caches.fileExistence?.delete(repoPath);
			this._caches.trackedPaths?.delete(repoPath);
		}

		if (e.changed('config')) {
			types.add('config');
		}

		if (e.changed('heads')) {
			// Clear branches cache (includes sharedBranches, logShas, reachability, gitResults, etc.)
			types.add('branches');
			types.add('contributors');
			types.add('worktrees');
		}

		if (e.changed('remotes')) {
			// Clear branches cache for upstream tracking state (ahead/behind counts) that changes on push
			types.add('branches');
			types.add('contributors');
			types.add('remotes');
			types.add('worktrees');
		}

		if (e.changed('ignores')) {
			types.add('gitignore');
		}

		if (e.changed('gkConfig')) {
			types.add('gkConfig');
		}

		if (e.changed('remoteProviders')) {
			// RemoteProviders change only affects parsed remotes, not raw git output
			types.add('providers');
		}

		if (e.changed('cherryPick', 'merge', 'rebase', 'revert', 'pausedOp')) {
			this.branch.delete(repoPath);
			types.add('status');
		}

		if (e.changed('stash')) {
			types.add('stashes');
		}

		if (e.changed('tags')) {
			types.add('tags');
		}

		if (e.changed('worktrees')) {
			types.add('worktrees');
		}

		if (types.size) {
			this.clearCaches(repoPath, ...types);
		}
	}

	/**
	 * Gets branches from cache or creates them via factory (branches are "mostly" shared across worktrees)
	 * Branches require special handling because the `current` flag is per-worktree
	 *
	 * @param repoPath The worktree/repo path being queried
	 * @param factory Function that fetches branches. Receives `commonPath` and `cacheable` controller
	 * @param mapper Function that maps shared branches to worktree-specific branches
	 *        Receives shared branches and target repoPath, returns branches with correct
	 *        `current` flag and repoPath for the target worktree.
	 */
	async getBranches(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<PagedResult<GitBranch>>,
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
			// Create CacheController for the factory to signal cache invalidation
			const cacheable = new CacheController();

			// No shared data - fetch from factory
			sharedPromise = Promise.resolve(factory(commonPath, cacheable));
			this.sharedBranches.set(commonPath, sharedPromise);

			// Handle invalidation after promise settles
			void sharedPromise.finally(() => {
				if (cacheable.invalidated) {
					this.sharedBranches.delete(commonPath);
					this.branches.delete(commonPath);
					if (commonPath !== repoPath) {
						this.branches.delete(repoPath);
					}
				}
			});
		}

		// Always map for the requesting repo to set correct `current` flag
		// This applies to both main repo and worktrees since factory sets current=false
		const mappedPromise = sharedPromise.then(shared => mapper(shared, repoPath, commonPath));
		this.branches.set(repoPath, mappedPromise);

		return mappedPromise;
	}

	/** Sentinel key used for global git config (when no repoPath is provided) */
	private static readonly globalConfigKey = '';

	/** Gets a config value by exact key from cache or fetches it via factory (config is shared across worktrees) */
	getConfig(
		repoPath: string | undefined,
		key: string,
		factory: () => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : GitCache.globalConfigKey;

		const result = this.configKeys.get(cacheKey, key);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.configKeys.set(cacheKey, key, factoryPromise);
		return factoryPromise;
	}

	/** Gets config values by regex pattern from cache or fetches them via factory (config is shared across worktrees) */
	getConfigRegex(
		repoPath: string | undefined,
		pattern: string,
		factory: () => PromiseOrValue<Map<string, string>>,
	): Promise<Map<string, string>> {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : GitCache.globalConfigKey;

		const result = this.configPatterns.get(cacheKey, pattern);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory());
		this.configPatterns.set(cacheKey, pattern, factoryPromise);
		return factoryPromise;
	}

	/** Deletes a cached config value by key and clears all regex pattern caches for that scope */
	deleteConfig(repoPath: string | undefined, key: string): void {
		const cacheKey = repoPath != null ? this.getCommonPath(repoPath) : GitCache.globalConfigKey;
		// Delete the specific key from the keys cache
		this._caches.configKeys?.delete(cacheKey, key);
		// Clear all regex patterns for this scope since any pattern might include this key
		this._caches.configPatterns?.delete(cacheKey);
	}

	/** Gets a GK config value by exact key from cache or fetches it via factory (GK config is shared across worktrees) */
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

	/** Gets GK config values by regex pattern from cache or fetches them via factory (GK config is shared across worktrees) */
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

	/** Deletes a cached GK config value by key and clears all regex pattern caches for that scope */
	deleteGkConfig(repoPath: string, key: string): void {
		const cacheKey = this.getCommonPath(repoPath);
		// Delete the specific key from the keys cache
		this._caches.gkConfigKeys?.delete(cacheKey, key);
		// Clear all regex patterns for this scope since any pattern might include this key
		this._caches.gkConfigPatterns?.delete(cacheKey);
	}

	/** Gets contributors from cache or creates them via factory (contributors are shared across worktrees) */
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

	/** Gets contributors (lite version) from cache or creates them via factory (contributors are shared across worktrees) */
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

	/** Gets contributors stats from cache or creates them via factory (contributors stats are shared across worktrees) */
	getContributorsStats(
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string) => PromiseOrValue<GitContributorsStats | undefined>,
		options?: { accessTTL?: number },
	): Promise<GitContributorsStats | undefined> {
		return this.getSharedSimpleWithKey(this.contributorsStats, repoPath, cacheKey, factory, options);
	}

	/** Gets the default branch name from cache or creates it via factory (default branch name is shared across worktrees) */
	getDefaultBranchName(
		repoPath: string,
		remote: string,
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimpleWithKey(this.defaultBranchName, repoPath, remote, factory);
	}

	/** Gets the initial (root) commit SHA from cache or creates it via factory (initial commit SHA is shared across worktrees) */
	getInitialCommitSha(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<string | undefined>,
	): Promise<string | undefined> {
		return this.getSharedSimple(this.initialCommitSha, repoPath, factory);
	}

	/** Gets the last fetched timestamp from cache or creates it via factory (last fetched timestamp is shared across worktrees) */
	getLastFetchedTimestamp(
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<number | undefined>,
	): Promise<number | undefined> {
		return this.getSharedSimple(this.lastFetched, repoPath, factory);
	}

	/** Gets remotes from cache or creates them via factory (remotes are shared across worktrees) */
	async getRemotes(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitRemote[]>,
	): Promise<GitRemote[]> {
		return this.getSharedOrCreate(this.remotes, repoPath, factory, (data, newRepoPath) =>
			data.map(r => r.withRepoPath(newRepoPath)),
		);
	}

	/** Gets stash from cache or creates it via factory (stashes are shared across worktrees) */
	async getStash(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitStash>,
	): Promise<GitStash> {
		return this.getSharedOrCreate(this.stashes, repoPath, factory, (data, newRepoPath) => ({
			repoPath: newRepoPath,
			stashes: new Map(
				Array.from(data.stashes.entries(), ([sha, s]) => [sha, s.withRepoPath<GitStashCommit>(newRepoPath)]),
			),
		}));
	}

	/** Gets tags from cache or creates them via factory (tags are shared across worktrees) */
	async getTags(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<PagedResult<GitTag>>,
	): Promise<PagedResult<GitTag>> {
		return this.getSharedOrCreate(this.tags, repoPath, factory, (data, newRepoPath) => ({
			...data,
			values: data.values.map(t => t.withRepoPath(newRepoPath)),
		}));
	}

	/** Gets worktrees from cache or creates them via factory (worktrees are shared across worktrees) */
	async getWorktrees(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitWorktree[]>,
	): Promise<GitWorktree[]> {
		return this.getSharedOrCreate(this.worktrees, repoPath, factory, (data, newRepoPath) =>
			data.map(w => w.withRepoPath(newRepoPath)),
		);
	}

	/** Internal helper for worktree-aware caching with simple key (repoPath-based caches) */
	private async getSharedOrCreate<T>(
		cache: PromiseMap<string, T>,
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
	): Promise<T> {
		// Check if we have cached data for this specific repoPath
		const cached = cache.get(repoPath);
		if (cached != null) return cached;

		const commonPath = this.getCommonPath(repoPath);

		// If this is a worktree, check if we have cached data at commonPath
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

		// Not cached - fetch from factory using commonPath
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

		// If this is a worktree, map and cache the result
		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, Promise.resolve(mappedData));
			return mappedData;
		}

		return factoryPromise;
	}

	/** Internal helper for worktree-aware caching with composite key (repoPath + cacheKey caches) */
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
		if (result != null) return result;

		const commonPath = this.getCommonPath(repoPath);

		// If this is a worktree, check if we have cached data at commonPath
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

		// Not cached - fetch from factory using commonPath
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

		// If this is a worktree, map and cache the result
		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, cacheKey, Promise.resolve(mappedData), options);
			return mappedData;
		}

		return factoryPromise;
	}

	/** Internal helper for worktree-aware caching of simple values (no mapper needed) */
	private async getSharedSimple<T>(
		cache: { get(key: string): Promise<T> | undefined; set(key: string, promise: Promise<T>): unknown },
		repoPath: string,
		factory: (commonPath: string) => PromiseOrValue<T>,
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		const result = cache.get(commonPath);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory(commonPath));
		cache.set(commonPath, factoryPromise);
		return factoryPromise;
	}

	/** Internal helper for worktree-aware caching of simple values with composite key (no mapper needed) */
	private async getSharedSimpleWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string) => PromiseOrValue<T>,
		options?: { accessTTL?: number },
	): Promise<T> {
		const commonPath = this.getCommonPath(repoPath);

		const result = cache.get(commonPath, cacheKey);
		if (result != null) return result;

		const factoryPromise = Promise.resolve(factory(commonPath));
		cache.set(commonPath, cacheKey, factoryPromise, options);
		return factoryPromise;
	}
}
