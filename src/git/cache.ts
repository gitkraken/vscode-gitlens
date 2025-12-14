import { Disposable } from 'vscode';
import type { Container } from '../container';
import { configuration } from '../system/-webview/configuration';
import { log } from '../system/decorators/log';
import type { PromiseOrValue } from '../system/promise';
import { PromiseCache, PromiseMap, RepoPromiseCacheMap, RepoPromiseMap } from '../system/promiseCache';
import { PathTrie } from '../system/trie';
import type { GitIgnoreCache } from './gitIgnoreCache';
import type { CachedGitTypes, GitCommitReachability, GitContributorsResult, GitDir, PagedResult } from './gitProvider';
import type { GitBranch } from './models/branch';
import type { GitContributor } from './models/contributor';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus';
import type { GitRemote } from './models/remote';
import type { GitStash } from './models/stash';
import type { GitTag } from './models/tag';
import type { GitUser } from './models/user';
import type { GitWorktree } from './models/worktree';
import type { RemoteProvider } from './remotes/remoteProvider';

type RepoPath = string;

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

	private _defaultBranchNameCache: RepoPromiseMap<string, string | undefined> | undefined;
	get defaultBranchName(): RepoPromiseMap<string, string | undefined> {
		return (this._defaultBranchNameCache ??= new RepoPromiseMap<string, string | undefined>());
	}

	private _gitIgnoreCaches: Map<RepoPath, GitIgnoreCache> | undefined;
	get gitIgnore(): Map<RepoPath, GitIgnoreCache> {
		return (this._gitIgnoreCaches ??= new Map<RepoPath, GitIgnoreCache>());
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
			| PromiseMap<string, unknown>
			| RepoPromiseCacheMap<unknown, unknown>
			| RepoPromiseMap<unknown, unknown>
			| PathTrie<unknown>
			| undefined;

		const cachesToClear = new Set<CacheType>();

		if (!types.length || types.includes('branches')) {
			cachesToClear.add(this._branchCache);
			cachesToClear.add(this._branchesCache);
			cachesToClear.add(this._defaultBranchNameCache);
			cachesToClear.add(this._reachabilityCache);
		}

		if (!types.length || types.includes('contributors')) {
			cachesToClear.add(this._contributorsCache);
			cachesToClear.add(this._contributorsLiteCache);
		}

		if (!types.length || types.includes('gitignore')) {
			cachesToClear.add(this._gitIgnoreCaches);
		}

		if (!types.length || types.includes('providers')) {
			cachesToClear.add(this._bestRemotesCache);
		}

		if (!types.length || types.includes('remotes')) {
			cachesToClear.add(this._remotesCache);
			cachesToClear.add(this._bestRemotesCache);
			cachesToClear.add(this._defaultBranchNameCache);
		}

		if (!types.length || types.includes('stashes')) {
			cachesToClear.add(this._stashesCache);
		}

		if (!types.length || types.includes('status')) {
			cachesToClear.add(this._pausedOperationStatusCache);
		}

		if (!types.length || types.includes('tags')) {
			cachesToClear.add(this._tagsCache);
		}

		if (!types.length || types.includes('worktrees')) {
			cachesToClear.add(this._worktreesCache);
		}

		if (!types.length) {
			cachesToClear.add(this._repoInfoCache);
			cachesToClear.add(this._trackedPaths);
			cachesToClear.add(this._gitIgnoreCaches);
		}

		for (const cache of cachesToClear) {
			if (repoPath != null) {
				cache?.delete(repoPath);
			} else {
				cache?.clear();
			}
		}
	}

	@log({ singleLine: true })
	reset(): void {
		this._branchCache?.clear();
		this._branchCache = undefined;
		this._branchesCache?.clear();
		this._branchesCache = undefined;
		this._contributorsCache?.clear();
		this._contributorsCache = undefined;
		this._contributorsLiteCache?.clear();
		this._contributorsLiteCache = undefined;
		this._gitIgnoreCaches?.clear();
		this._gitIgnoreCaches = undefined;
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
