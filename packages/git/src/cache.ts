import { getCommonRepositoryPath, getRepositoryOrWorktreePath } from '@gitlens/git/utils/repository.utils.js';
import { exhaustiveArray } from '@gitlens/utils/array.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { invalidateMemoized } from '@gitlens/utils/decorators/memoize.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { PromiseOrValue } from '@gitlens/utils/promise.js';
import { CacheController, PromiseCache, PromiseMap, RepoPromiseCacheMap } from '@gitlens/utils/promiseCache.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { GitResult } from './exec.types.js';
import type { ProgressiveGitBlame } from './models/blame.js';
import type { GitBranch } from './models/branch.js';
import type { GitStashCommit } from './models/commit.js';
import type { GitContributor, GitContributorsStats } from './models/contributor.js';
import type { ParsedGitDiffHunks } from './models/diff.js';
import type { GitLog } from './models/log.js';
import type { ConflictDetectionResult } from './models/mergeConflicts.js';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus.js';
import type { GitBranchReference } from './models/reference.js';
import type { GitRemote } from './models/remote.js';
import type { RemoteProvider } from './models/remoteProvider.js';
import type { GitDir, RepositoryChange } from './models/repository.js';
import type { GitStash } from './models/stash.js';
import type { GitTag } from './models/tag.js';
import type { GitUser } from './models/user.js';
import type { GitWorktree } from './models/worktree.js';
import type { GitCommitReachability } from './providers/commits.js';
import type { GitContributorsResult } from './providers/contributors.js';
import type { ResolvedRevision } from './providers/revision.js';
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
	| 'providers'
	| 'remotes'
	| 'stashes'
	| 'status'
	| 'tags'
	| 'tracking'
	| 'worktrees';

export type ConflictDetectionCacheKey = `apply:${string}:${string}:${string}` | `merge:${string}:${string}`;

/** Per-worktree caches — cleared by repoPath directly */
interface Caches {
	bestRemotes: PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> | undefined;
	blame: RepoPromiseCacheMap<string, ProgressiveGitBlame | undefined> | undefined;
	branch: PromiseMap<RepoPath, GitBranch | undefined> | undefined;
	conflictDetection: RepoPromiseCacheMap<ConflictDetectionCacheKey, ConflictDetectionResult> | undefined;
	currentBranchReference: PromiseCache<RepoPath, GitBranchReference | undefined> | undefined;
	currentUser: Map<RepoPath, GitUser | null> | undefined;
	diff: RepoPromiseCacheMap<string, ParsedGitDiffHunks | undefined> | undefined;
	fileExistence: RepoPromiseCacheMap<string, boolean> | undefined;
	fileLog: RepoPromiseCacheMap<string, GitLog | undefined> | undefined;
	gitDir: Map<RepoPath, GitDir> | undefined;
	gitIgnore: Map<RepoPath, GitIgnoreFilter> | undefined;
	ignoreRevsFile: PromiseCache<string, boolean> | undefined;
	lastFetched: PromiseCache<RepoPath, number | undefined> | undefined;
	pausedOperationStatus: PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined;
	reachability: RepoPromiseCacheMap<string, GitCommitReachability | undefined> | undefined;
	resolvedRevisions: RepoPromiseCacheMap<string, ResolvedRevision> | undefined;
	trackedPaths: RepoPromiseCacheMap<string, [string, string] | false> | undefined;
}

/** Shared caches — cleared via commonPath + all worktree paths */
interface SharedCaches {
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
	logShas: RepoPromiseCacheMap<string, string[]> | undefined;
	remotes: PromiseMap<RepoPath, GitRemote[]> | undefined;
	sharedBranches: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	stashes: PromiseMap<RepoPath, GitStash> | undefined;
	tags: PromiseMap<RepoPath, PagedResult<GitTag>> | undefined;
	worktrees: PromiseMap<RepoPath, GitWorktree[]> | undefined;
}

type AllCaches = Caches & SharedCaches;

/** Compile-time enforced: adding a key to SharedCaches without listing it here is a type error */
const sharedCacheKeys: ReadonlySet<keyof AllCaches> = new Set(
	exhaustiveArray<keyof SharedCaches>()([
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
		'logShas',
		'remotes',
		'sharedBranches',
		'stashes',
		'tags',
		'worktrees',
	]),
);

function createEmptyCaches(): AllCaches {
	return {
		bestRemotes: undefined,
		blame: undefined,
		branch: undefined,
		branches: undefined,
		fileExistence: undefined,
		ignoreRevsFile: undefined,
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

			// Per-worktree branch caches (current branch / HEAD sensitive)
			if (types.includes('branch') || types.includes('branches')) {
				keysToClear.add('branch');
				keysToClear.add('conflictDetection');
				keysToClear.add('currentBranchReference');
				keysToClear.add('reachability');
				keysToClear.add('resolvedRevisions');
			}

			// Shared branch caches (branch list, metadata)
			if (types.includes('branches')) {
				keysToClear.add('branches');
				keysToClear.add('sharedBranches');
				keysToClear.add('defaultBranchName');
				keysToClear.add('initialCommitSha');
				keysToClear.add('logShas');
			}

			if (types.includes('config')) {
				keysToClear.add('configKeys');
				keysToClear.add('configPatterns');
				keysToClear.add('currentBranchReference');
				keysToClear.add('currentUser');
				keysToClear.add('gitDir');
			}

			if (types.includes('contributors')) {
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
				cache.delete(commonPath);
				for (const worktreePath of this.getWorktreePaths(commonPath)) {
					cache.delete(worktreePath);
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
			this.clearCaches(repoPath);
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
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<PagedResult<GitBranch>>,
		mapper: (
			branches: PagedResult<GitBranch>,
			targetRepoPath: string,
			commonPath: string,
		) => PromiseOrValue<PagedResult<GitBranch>>,
	): Promise<PagedResult<GitBranch>> {
		const cached = this.branches.get(repoPath);
		if (cached != null) return Promise.resolve(cached);

		const commonPath = this.getCommonPath(repoPath);

		let sharedPromise = this.sharedBranches.get(commonPath);
		if (sharedPromise == null) {
			const cacheable = new CacheController();

			sharedPromise = Promise.resolve(factory(commonPath, cacheable));
			this.sharedBranches.set(commonPath, sharedPromise);

			void sharedPromise.finally(() => {
				if (cacheable.invalidated) {
					this.sharedBranches.delete(commonPath);
					this.branches.delete(commonPath);
					for (const worktreePath of this.getWorktreePaths(commonPath)) {
						this.branches.delete(worktreePath);
					}
				}
			});
		}

		const mappedPromise = sharedPromise.then(shared => mapper(shared, repoPath, commonPath));
		this.branches.set(repoPath, mappedPromise);

		return mappedPromise;
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

	deleteGkConfig(repoPath: string, key: string): void {
		const cacheKey = this.getCommonPath(repoPath);
		this._caches.gkConfigKeys?.delete(cacheKey, key);
		this._caches.gkConfigPatterns?.delete(cacheKey);
	}

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

	getContributorsStats(
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string) => PromiseOrValue<GitContributorsStats | undefined>,
		options?: { accessTTL?: number },
	): Promise<GitContributorsStats | undefined> {
		return this.getSharedSimpleWithKey(this.contributorsStats, repoPath, cacheKey, factory, options);
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

	async getRemotes(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitRemote[]>,
	): Promise<GitRemote[]> {
		return this.getSharedOrCreate(this.remotes, repoPath, factory, (data, newRepoPath) =>
			data.map(r => r.withRepoPath(newRepoPath)),
		);
	}

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

	async getTags(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<PagedResult<GitTag>>,
	): Promise<PagedResult<GitTag>> {
		return this.getSharedOrCreate(this.tags, repoPath, factory, (data, newRepoPath) => ({
			...data,
			values: data.values.map(t => t.withRepoPath(newRepoPath)),
		}));
	}

	async getWorktrees(
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<GitWorktree[]>,
	): Promise<GitWorktree[]> {
		return this.getSharedOrCreate(this.worktrees, repoPath, factory, (data, newRepoPath) =>
			data.map(w => w.withRepoPath(newRepoPath)),
		);
	}

	private async getSharedOrCreate<T>(
		cache: PromiseMap<string, T>,
		repoPath: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
	): Promise<T> {
		const cached = cache.get(repoPath);
		if (cached != null) return cached;

		const commonPath = this.getCommonPath(repoPath);

		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath);
			if (commonResult != null) {
				const mappedData = mapper(await commonResult, repoPath);
				cache.set(repoPath, Promise.resolve(mappedData));
				return mappedData;
			}
		}

		const cacheable = new CacheController();

		const factoryPromise = Promise.resolve(factory(commonPath, cacheable));
		cache.set(commonPath, factoryPromise);

		void factoryPromise.finally(() => {
			if (cacheable.invalidated) {
				cache.delete(commonPath);
				if (commonPath !== repoPath) {
					cache.delete(repoPath);
				}
			}
		});

		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, Promise.resolve(mappedData));
			return mappedData;
		}

		return factoryPromise;
	}

	private async getSharedOrCreateWithKey<T>(
		cache: RepoPromiseCacheMap<string, T>,
		repoPath: string,
		cacheKey: string,
		factory: (commonPath: string, cacheable: CacheController) => PromiseOrValue<T>,
		mapper: (data: T, repoPath: string) => T,
		options?: { accessTTL?: number },
	): Promise<T> {
		const result = cache.get(repoPath, cacheKey);
		if (result != null) return result;

		const commonPath = this.getCommonPath(repoPath);

		if (commonPath !== repoPath) {
			const commonResult = cache.get(commonPath, cacheKey);
			if (commonResult != null) {
				const mappedData = mapper(await commonResult, repoPath);
				cache.set(repoPath, cacheKey, Promise.resolve(mappedData), options);
				return mappedData;
			}
		}

		const cacheable = new CacheController();

		const factoryPromise = Promise.resolve(factory(commonPath, cacheable));
		cache.set(commonPath, cacheKey, factoryPromise, options);

		void factoryPromise.finally(() => {
			if (cacheable.invalidated) {
				cache.delete(commonPath, cacheKey);
				if (commonPath !== repoPath) {
					cache.delete(repoPath, cacheKey);
				}
			}
		});

		if (commonPath !== repoPath) {
			const data = await factoryPromise;
			const mappedData = mapper(data, repoPath);
			cache.set(repoPath, cacheKey, Promise.resolve(mappedData), options);
			return mappedData;
		}

		return factoryPromise;
	}

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
