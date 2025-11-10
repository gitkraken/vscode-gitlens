import { Disposable } from 'vscode';
import type { Container } from '../container';
import { configuration } from '../system/-webview/configuration';
import { log } from '../system/decorators/log';
import type { PromiseOrValue } from '../system/promise';
import type { PromiseCache } from '../system/promiseCache';
import { PromiseMap } from '../system/promiseCache';
import { PathTrie } from '../system/trie';
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
		this._useCaching = configuration.get('advanced.caching.enabled');
		this._disposable = Disposable.from(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'advanced.caching.enabled')) {
					this._useCaching = configuration.get('advanced.caching.enabled');
					if (!this._useCaching) {
						this.reset(true);
					}
				}

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

	private _useCaching: boolean = false;
	get useCaching(): boolean {
		return this._useCaching;
	}

	private _bestRemotesCache: PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> | undefined;
	get bestRemotes(): PromiseMap<RepoPath, GitRemote<RemoteProvider>[]> {
		return (this._bestRemotesCache ??= new PromiseMap<RepoPath, GitRemote<RemoteProvider>[]>());
	}

	private _branchCache: PromiseMap<RepoPath, GitBranch | undefined> | undefined;
	get branch(): PromiseMap<RepoPath, GitBranch | undefined> | undefined {
		return this.useCaching ? (this._branchCache ??= new PromiseMap<RepoPath, GitBranch | undefined>()) : undefined;
	}

	private _branchesCache: PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined;
	get branches(): PromiseMap<RepoPath, PagedResult<GitBranch>> | undefined {
		return this.useCaching
			? (this._branchesCache ??= new PromiseMap<RepoPath, PagedResult<GitBranch>>())
			: undefined;
	}

	private _contributorsCache: Map<RepoPath, PromiseCache<string, GitContributorsResult>> | undefined;
	get contributors(): Map<RepoPath, PromiseCache<string, GitContributorsResult>> | undefined {
		return this.useCaching
			? (this._contributorsCache ??= new Map<RepoPath, PromiseCache<string, GitContributorsResult>>())
			: undefined;
	}

	private _contributorsLiteCache: Map<RepoPath, PromiseCache<string, GitContributor[]>> | undefined;
	get contributorsLite(): Map<RepoPath, PromiseCache<string, GitContributor[]>> | undefined {
		return this.useCaching
			? (this._contributorsLiteCache ??= new Map<RepoPath, PromiseCache<string, GitContributor[]>>())
			: undefined;
	}

	private _defaultBranchNameCache: Map<RepoPath, PromiseMap<string, string | undefined>> | undefined;
	get defaultBranchName(): Map<RepoPath, PromiseMap<string, string | undefined>> | undefined {
		return this.useCaching
			? (this._defaultBranchNameCache ??= new Map<RepoPath, PromiseMap<string, string | undefined>>())
			: undefined;
	}

	private _pausedOperationStatusCache: PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined;
	get pausedOperationStatus(): PromiseMap<RepoPath, GitPausedOperationStatus | undefined> | undefined {
		return this.useCaching
			? (this._pausedOperationStatusCache ??= new PromiseMap<RepoPath, GitPausedOperationStatus | undefined>())
			: undefined;
	}

	private _reachabilityCache: Map<RepoPath, PromiseCache<string, GitCommitReachability | undefined>> | undefined;
	get reachability(): Map<RepoPath, PromiseCache<string, GitCommitReachability | undefined>> | undefined {
		return this.useCaching
			? (this._reachabilityCache ??= new Map<RepoPath, PromiseCache<string, GitCommitReachability | undefined>>())
			: undefined;
	}

	private _remotesCache: PromiseMap<RepoPath, GitRemote[]> | undefined;
	get remotes(): PromiseMap<RepoPath, GitRemote[]> | undefined {
		return this.useCaching ? (this._remotesCache ??= new PromiseMap<RepoPath, GitRemote[]>()) : undefined;
	}

	private _repoInfoCache: Map<RepoPath, RepositoryInfo> | undefined;
	get repoInfo(): Map<RepoPath, RepositoryInfo> {
		return (this._repoInfoCache ??= new Map<RepoPath, RepositoryInfo>());
	}

	private _stashesCache: PromiseMap<RepoPath, GitStash> | undefined;
	get stashes(): PromiseMap<RepoPath, GitStash> | undefined {
		return this.useCaching ? (this._stashesCache ??= new PromiseMap<RepoPath, GitStash>()) : undefined;
	}

	private _tagsCache: PromiseMap<RepoPath, PagedResult<GitTag>> | undefined;
	get tags(): PromiseMap<RepoPath, PagedResult<GitTag>> | undefined {
		return this.useCaching ? (this._tagsCache ??= new PromiseMap<RepoPath, PagedResult<GitTag>>()) : undefined;
	}

	private _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();
	get trackedPaths(): PathTrie<PromiseOrValue<[string, string] | undefined>> {
		return this._trackedPaths;
	}

	private _worktreesCache: PromiseMap<RepoPath, GitWorktree[]> | undefined;
	get worktrees(): PromiseMap<RepoPath, GitWorktree[]> | undefined {
		return this.useCaching ? (this._worktreesCache ??= new PromiseMap<RepoPath, GitWorktree[]>()) : undefined;
	}

	@log({ singleLine: true })
	clearCaches(repoPath: string | undefined, ...types: CachedGitTypes[]): void {
		const cachesToClear = new Set<
			Map<string, unknown> | PromiseMap<string, unknown> | PathTrie<unknown> | undefined
		>();

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

		if (!types.length || types.includes('remotes')) {
			cachesToClear.add(this._remotesCache);
			cachesToClear.add(this._bestRemotesCache);
			cachesToClear.add(this._defaultBranchNameCache);
		}

		if (!types.length || types.includes('providers')) {
			cachesToClear.add(this._bestRemotesCache);
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
	reset(onlyConfigControlledCaches: boolean = false): void {
		this._branchCache?.clear();
		this._branchCache = undefined;
		this._branchesCache?.clear();
		this._branchesCache = undefined;
		this._contributorsCache?.clear();
		this._contributorsCache = undefined;
		this._contributorsLiteCache?.clear();
		this._contributorsLiteCache = undefined;
		this._pausedOperationStatusCache?.clear();
		this._pausedOperationStatusCache = undefined;
		this._reachabilityCache?.clear();
		this._reachabilityCache = undefined;
		this._remotesCache?.clear();
		this._remotesCache = undefined;
		this._stashesCache?.clear();
		this._stashesCache = undefined;
		this._tagsCache?.clear();
		this._tagsCache = undefined;
		this._worktreesCache?.clear();
		this._worktreesCache = undefined;

		if (!onlyConfigControlledCaches) {
			this._repoInfoCache?.clear();
			this._repoInfoCache = undefined;

			this._trackedPaths.clear();
		}
	}
}
