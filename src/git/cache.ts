import { Disposable } from 'vscode';
import type { Container } from '../container';
import { log } from '../system/decorators/log';
import type { PromiseOrValue } from '../system/promise';
import { PathTrie } from '../system/trie';
import { configuration } from '../system/vscode/configuration';
import type { GitCaches, GitDir, PagedResult } from './gitProvider';
import type { GitBranch } from './models/branch';
import type { GitContributor } from './models/contributor';
import type { GitPausedOperationStatus } from './models/pausedOperationStatus';
import type { GitRemote } from './models/remote';
import type { GitStash } from './models/stash';
import type { GitTag } from './models/tag';
import type { GitUser } from './models/user';
import type { GitWorktree } from './models/worktree';
import type { RemoteProvider } from './remotes/remoteProvider';

interface RepositoryInfo {
	gitDir?: GitDir;
	user?: GitUser | null;
}

const emptyArray = Object.freeze([]) as unknown as any[];

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
				this.clearCaches(e.data.repoPath, ...(e.data.caches ?? emptyArray)),
			),
		);
	}

	dispose() {
		this.reset();
		this._disposable.dispose();
	}

	private _useCaching: boolean = false;
	get useCaching() {
		return this._useCaching;
	}

	private _bestRemotesCache: Map<string, Promise<GitRemote<RemoteProvider>[]>> | undefined;
	get bestRemotes(): Map<string, Promise<GitRemote<RemoteProvider>[]>> {
		return (this._bestRemotesCache ??= new Map<string, Promise<GitRemote<RemoteProvider>[]>>());
	}

	private _branchCache: Map<string, Promise<GitBranch | undefined>> | undefined;
	get branch() {
		return this.useCaching ? (this._branchCache ??= new Map<string, Promise<GitBranch | undefined>>()) : undefined;
	}

	private _branchesCache: Map<string, Promise<PagedResult<GitBranch>>> | undefined;
	get branches() {
		return this.useCaching
			? (this._branchesCache ??= new Map<string, Promise<PagedResult<GitBranch>>>())
			: undefined;
	}

	private _contributorsCache: Map<string, Map<string, Promise<GitContributor[]>>> | undefined;
	get contributors() {
		return this.useCaching
			? (this._contributorsCache ??= new Map<string, Map<string, Promise<GitContributor[]>>>())
			: undefined;
	}

	private _pausedOperationStatusCache: Map<string, Promise<GitPausedOperationStatus | undefined>> | undefined;
	get pausedOperationStatus() {
		return this.useCaching
			? (this._pausedOperationStatusCache ??= new Map<string, Promise<GitPausedOperationStatus | undefined>>())
			: undefined;
	}

	private _remotesCache: Map<string, Promise<GitRemote[]>> | undefined;
	get remotes() {
		return this.useCaching ? (this._remotesCache ??= new Map<string, Promise<GitRemote[]>>()) : undefined;
	}

	private _repoInfoCache: Map<string, RepositoryInfo> | undefined;
	get repoInfo() {
		return (this._repoInfoCache ??= new Map<string, RepositoryInfo>());
	}

	private _stashesCache: Map<string, GitStash | null> | undefined;
	get stashes() {
		return this.useCaching ? (this._stashesCache ??= new Map<string, GitStash | null>()) : undefined;
	}

	private _tagsCache: Map<string, Promise<PagedResult<GitTag>>> | undefined;
	get tags() {
		return this.useCaching ? (this._tagsCache ??= new Map<string, Promise<PagedResult<GitTag>>>()) : undefined;
	}

	private _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();
	get trackedPaths() {
		return this._trackedPaths;
	}

	private _worktreesCache: Map<string, Promise<GitWorktree[]>> | undefined;
	get worktrees() {
		return this.useCaching ? (this._worktreesCache ??= new Map<string, Promise<GitWorktree[]>>()) : undefined;
	}

	@log({ singleLine: true })
	clearCaches(repoPath: string | undefined, ...caches: GitCaches[]) {
		const cachesToClear = new Set<Map<string, unknown> | PathTrie<unknown> | undefined>();

		if (!caches.length || caches.includes('branches')) {
			cachesToClear.add(this._branchCache);
			cachesToClear.add(this._branchesCache);
		}

		if (!caches.length || caches.includes('contributors')) {
			cachesToClear.add(this._contributorsCache);
		}

		if (!caches.length || caches.includes('remotes')) {
			cachesToClear.add(this._remotesCache);
			cachesToClear.add(this._bestRemotesCache);
		}

		if (!caches.length || caches.includes('providers')) {
			cachesToClear.add(this._bestRemotesCache);
		}

		if (!caches.length || caches.includes('stashes')) {
			cachesToClear.add(this._stashesCache);
		}

		if (!caches.length || caches.includes('status')) {
			cachesToClear.add(this._pausedOperationStatusCache);
		}

		if (!caches.length || caches.includes('tags')) {
			cachesToClear.add(this._tagsCache);
		}

		if (!caches.length || caches.includes('worktrees')) {
			cachesToClear.add(this._worktreesCache);
		}

		if (!caches.length) {
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
	reset(onlyConfigControlledCaches: boolean = false) {
		this._branchCache?.clear();
		this._branchCache = undefined;
		this._branchesCache?.clear();
		this._branchesCache = undefined;
		this._contributorsCache?.clear();
		this._contributorsCache = undefined;
		this._pausedOperationStatusCache?.clear();
		this._pausedOperationStatusCache = undefined;
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
