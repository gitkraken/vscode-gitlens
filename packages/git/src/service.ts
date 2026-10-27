import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { MergeTargetsChangeEvent } from './cache.js';
import type { GitProvider } from './providers/provider.js';
import type { RepositoryService, SubProviderForRepo } from './repositoryService.js';
import {
	clearGlobalRepositoryServiceResolver,
	createSubProviderProxyForRepo,
	setGlobalRepositoryServiceResolver,
} from './repositoryService.js';
import type { FileWatchingProvider } from './watching/provider.js';
import type { WatchPollingOptions } from './watching/watchService.js';
import { RepositoryWatchService } from './watching/watchService.js';
import type { WorktreeSummaryServiceOptions } from './watching/worktreeSummary.js';
import { WorktreeSummaryService } from './watching/worktreeSummary.js';

export interface ProvidersChangeEvent {
	readonly added: readonly GitProvider[];
	readonly removed: readonly GitProvider[];
	readonly etag: number;
}

/**
 * Result of {@link GitService.validateRepo}.
 *
 * - `valid: true, safe: true` — a usable git repository at `repoPath`; `gitDir` / `commonGitDir` / `superprojectPath` are populated when available
 * - `valid: true, safe: false` — git detected unsafe (dubious) ownership at the given path; no `repoPath` is surfaced (the raw call doesn't carry one back)
 * - `valid: false` — not a git repository, no registered provider can handle the path, or the routed provider doesn't implement `getRepositoryInfo`
 */
export type ValidateRepoResult =
	| {
			valid: true;
			safe: true;
			repoPath: string;
			gitDir?: string;
			commonGitDir?: string;
			superprojectPath?: string;
	  }
	| { valid: true; safe: false }
	| { valid: false };

interface RegisteredProvider {
	provider: GitProvider;
	canHandle: (repoPath: string) => boolean;
	/** Forwards the provider's write announcements to {@link GitService.watchService}, when there is one */
	announcements?: UnifiedDisposable;
}

interface MergeTargetsSource {
	readonly subscription: UnifiedDisposable;
	refCount: number;
}

/**
 * Entry point — provider router, repo-scoped proxy cache, and global configuration.
 *
 * Creating an instance wires up the module-level repository
 * resolver. Calling {@link dispose} tears it down.
 *
 * Consumers register providers with routing predicates, then call
 * {@link forRepo} to get a {@link RepositoryService} with sub-provider
 * proxies that auto-inject the repository path.
 *
 * The service has no discovery or repository tracking state — it trusts
 * the caller to pass valid repository paths. Discovery and lifecycle
 * (open/close, file watching, etc.) are application-level concerns.
 *
 * @example
 * ```typescript
 * const service = GitService.createSingleton();
 * service.register(cliProvider, (path) => true);
 *
 * const repo = service.forRepo('/home/user/repo');
 * const branches = await repo.branches.getBranches();
 *
 * service.dispose(); // cleans up module-level hooks
 * ```
 */
export class GitService implements UnifiedDisposable {
	private static _instance: GitService | undefined;

	/**
	 * `options.watchPolling` opts the watch service into polling what `watchingProvider` reports it can't watch,
	 * `options.readFile` lets it tell what a reported `.git/config` change changed (see `WatchServiceOptions.readFile`),
	 * and with it `options.readDirectory` lets it drop the reports of ignored worktrees (see
	 * `WatchServiceOptions.readDirectory`).
	 * `options.verifyBaseRemeasure` is for tests only (see `WorktreeSummaryServiceOptions.verifyBaseRemeasure`)
	 */
	static createSingleton(
		watchingProvider?: FileWatchingProvider,
		options?: {
			watchPolling?: WatchPollingOptions;
			readFile?: (path: string) => Promise<Uint8Array>;
			readDirectory?: (path: string) => Promise<readonly (readonly [string, number])[]>;
			verifyBaseRemeasure?: WorktreeSummaryServiceOptions['verifyBaseRemeasure'];
		},
	): GitService {
		if (GitService._instance != null) {
			throw new Error('GitService already exists — only one instance is allowed');
		}

		const instance = new GitService(
			watchingProvider,
			options?.watchPolling,
			options?.readFile,
			options?.readDirectory,
			options?.verifyBaseRemeasure,
		);
		GitService._instance = instance;
		return instance;
	}

	private readonly _onDidChangeProviders = new Emitter<ProvidersChangeEvent>();
	get onDidChangeProviders(): Event<ProvidersChangeEvent> {
		return this._onDidChangeProviders.event;
	}

	private readonly _onDidChangeMergeTargets = new Emitter<MergeTargetsChangeEvent>();
	/**
	 * Fires when a write changed a branch's merge-relevant `.git/gk/config` keys, for any registered provider that
	 * reports it — never for activity timestamps. Core's own key write fires it once, as the write completes, naming
	 * the branch. Once per change per repository (`repoPath` is its common path); see {@link MergeTargetsChangeEvent}.
	 */
	get onDidChangeMergeTargets(): Event<MergeTargetsChangeEvent> {
		return this._onDidChangeMergeTargets.event;
	}

	/** Keyed by the provider's event, so providers sharing one cache are forwarded once */
	private readonly _mergeTargetsSources = new Map<Event<MergeTargetsChangeEvent>, MergeTargetsSource>();

	private _etag = 0;
	private readonly _providers: RegisteredProvider[] = [];
	private readonly _serviceCache = new Map<string, RepositoryService>();
	private readonly _watchService: RepositoryWatchService | undefined;
	private readonly _summaries: WorktreeSummaryService | undefined;

	private constructor(
		watchingProvider?: FileWatchingProvider,
		watchPolling?: WatchPollingOptions,
		readFile?: (path: string) => Promise<Uint8Array>,
		readDirectory?: (path: string) => Promise<readonly (readonly [string, number])[]>,
		verifyBaseRemeasure?: WorktreeSummaryServiceOptions['verifyBaseRemeasure'],
	) {
		if (watchingProvider != null) {
			this._watchService = new RepositoryWatchService({
				watchingProvider: watchingProvider,
				polling: watchPolling,
				readFile: readFile,
				readDirectory: readDirectory,
				getIgnoreFilter: (repoPath, gitDirPath) => {
					return this.getProvider(repoPath)?.provider.getIgnoreFilter?.(repoPath, gitDirPath);
				},
				getIgnoredDirectories: repoPath =>
					this.getProvider(repoPath)?.provider.getIgnoredDirectories?.(repoPath) ?? Promise.resolve([]),
				getIgnoredWorktreeRoots: repoPath =>
					this.getProvider(repoPath)?.provider.getIgnoredWorktreeRoots?.(repoPath) ?? Promise.resolve([]),
				getIgnoredWorktreeFolders: repoPath =>
					this.getProvider(repoPath)?.provider.getIgnoredWorktreeFolders?.(repoPath) ?? [],
			});
			this._summaries = new WorktreeSummaryService({
				watchService: this._watchService,
				getRepository: repoPath => this.forRepo(repoPath),
				onDidChangeMergeTargets: this.onDidChangeMergeTargets,
				getCommonPath: repoPath => this.getProvider(repoPath)?.provider.getCommonPath?.(repoPath),
				// The host's polling stat, when it configured polling, answers whether an unwatched index file moved
				stat: watchPolling?.stat,
				verifyBaseRemeasure: verifyBaseRemeasure,
			});
		}

		setGlobalRepositoryServiceResolver(repoPath => this.forRepo(repoPath));
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		clearGlobalRepositoryServiceResolver();
		GitService._instance = undefined;
		this._serviceCache.clear();
		this._summaries?.dispose();
		this._watchService?.dispose();

		// Don't dispose providers since they're owned by the caller, but do clear the array to release references
		for (const entry of this._providers) {
			entry.announcements?.dispose();
		}
		this._providers.length = 0;

		for (const source of this._mergeTargetsSources.values()) {
			source.subscription.dispose();
		}
		this._mergeTargetsSources.clear();

		this._onDidChangeProviders.dispose();
		this._onDidChangeMergeTargets.dispose();
	}

	/** Monotonically increasing counter incremented on structural changes. */
	get etag(): number {
		return this._etag;
	}

	/** Whether any providers are registered. */
	get hasProviders(): boolean {
		return this._providers.length > 0;
	}

	get watchService(): RepositoryWatchService | undefined {
		return this._watchService;
	}

	/** Cached, change-notifying per-worktree summaries, kept current by {@link watchService}; present when it is */
	get summaries(): WorktreeSummaryService | undefined {
		return this._summaries;
	}

	/**
	 * Registers a provider with a routing predicate.
	 *
	 * @returns A disposable that unregisters the provider.
	 */
	register(provider: GitProvider, canHandle: (repoPath: string) => boolean): UnifiedDisposable {
		const watchService = this._watchService;
		const entry: RegisteredProvider = {
			provider: provider,
			canHandle: canHandle,
			announcements:
				watchService != null
					? provider.onDidAnnounceChanges?.(e =>
							watchService.noteSelfWrite(e.repoPath, e.changes, e.refs, {
								configConfinedToRefs: e.configConfinedToRefs,
							}),
						)
					: undefined,
		};
		this._providers.push(entry);
		this._etag++;
		this.addMergeTargetsSource(provider);

		this._onDidChangeProviders.fire({
			added: [provider],
			removed: [],
			etag: this._etag,
		});

		// Invalidate cached proxies since provider routing may have changed
		this._serviceCache.clear();

		return createDisposable(() => {
			const idx = this._providers.indexOf(entry);
			if (idx !== -1) {
				this._providers.splice(idx, 1);
				entry.announcements?.dispose();
				this._etag++;
				this.removeMergeTargetsSource(provider);
				this._serviceCache.clear();

				this._onDidChangeProviders.fire({
					added: [],
					removed: [provider],
					etag: this._etag,
				});
			}
		});
	}

	private addMergeTargetsSource(provider: GitProvider): void {
		const event = provider.onDidChangeMergeTargets;
		if (event == null) return;

		const source = this._mergeTargetsSources.get(event);
		if (source != null) {
			source.refCount++;
			return;
		}

		this._mergeTargetsSources.set(event, {
			subscription: event(e => this._onDidChangeMergeTargets.fire(e)),
			refCount: 1,
		});
	}

	private removeMergeTargetsSource(provider: GitProvider): void {
		const event = provider.onDidChangeMergeTargets;
		if (event == null) return;

		const source = this._mergeTargetsSources.get(event);
		if (source == null || --source.refCount > 0) return;

		source.subscription.dispose();
		this._mergeTargetsSources.delete(event);
	}

	/** Returns the provider that can handle the given path, or undefined if none matches. */
	getProvider(repoPath: string): { provider: GitProvider; path: string } | undefined {
		repoPath = normalizePath(repoPath);
		for (const entry of this._providers) {
			if (entry.canHandle(repoPath)) {
				return { provider: entry.provider, path: repoPath };
			}
		}
		return undefined;
	}

	/** Returns all registered providers. */
	*getProviders(): Iterable<GitProvider> {
		for (const entry of this._providers) {
			yield entry.provider;
		}
	}

	/**
	 * Routes a repo URI/path to a provider and returns a cached
	 * {@link RepositoryService} with repo-scoped sub-provider proxies.
	 * Returns undefined if no provider can handle the path.
	 */
	forRepo(repoUri: Uri | string): RepositoryService | undefined {
		const repoPath = getRepositoryKey(repoUri);

		let repo = this._serviceCache.get(repoPath);
		if (repo != null) return repo;

		const result = this.getProvider(repoPath);
		if (result == null) return undefined;

		repo = createRepositoryService(result.provider, repoPath, this._watchService);
		this._serviceCache.set(repoPath, repo);
		return repo;
	}

	/**
	 * Evicts the cached {@link RepositoryService} for a closed or removed repository.
	 * No-op if the path isn't cached.
	 */
	closeRepo(repoUri: Uri | string): void {
		const repoPath = getRepositoryKey(repoUri);
		this._serviceCache.delete(repoPath);
	}

	/**
	 * Validates whether `pathOrUri` points to (or resides inside) a git repository,
	 * and returns information about it when it does.
	 *
	 * Routes the path to a registered provider and delegates to its config sub-provider's
	 * `getRepositoryInfo` implementation, then normalizes the raw result into a clean
	 * discriminated union. For a simple yes/no check, use `(await validateRepo(path)).valid`.
	 *
	 * Returns `{ valid: false }` if no provider can handle the path or if the routed
	 * provider does not implement `getRepositoryInfo`.
	 */
	async validateRepo(pathOrUri: Uri | string): Promise<ValidateRepoResult> {
		const key = getRepositoryKey(pathOrUri);
		const routed = this.getProvider(key);
		if (routed == null) return { valid: false };

		const info = await routed.provider.config.getRepositoryInfo?.(routed.path);
		if (info == null) return { valid: false };

		if (Array.isArray(info)) {
			if (info.length === 0) return { valid: false };
			if (info[0] === false) return { valid: true, safe: false };
			return { valid: true, safe: true, repoPath: info[1] };
		}

		return {
			valid: true,
			safe: true,
			repoPath: info.repoPath,
			gitDir: info.gitDir,
			commonGitDir: info.commonGitDir,
			superprojectPath: info.superprojectPath,
		};
	}
}

function createRepositoryService(
	provider: GitProvider,
	repoPath: string,
	watchService?: RepositoryWatchService,
): RepositoryService {
	const proxies = new Map<string, SubProviderForRepo<unknown>>();

	function getProxy<T extends object>(prop: string, subProvider: T | undefined): SubProviderForRepo<T> | undefined {
		if (subProvider == null) return undefined;

		let proxy = proxies.get(prop);
		if (proxy == null) {
			proxy = createSubProviderProxyForRepo(subProvider, repoPath);
			proxies.set(prop, proxy);
		}
		return proxy as SubProviderForRepo<T>;
	}

	return {
		path: repoPath,
		provider: provider.descriptor,

		get etagWorkingTree(): number | undefined {
			return watchService?.getSession(repoPath)?.etagWorkingTree;
		},

		getAbsoluteUri: (relativePath: string): Uri => {
			return provider.getAbsoluteUri(relativePath, repoPath);
		},

		// Required sub-providers
		get branches() {
			const proxy = getProxy('branches', provider.branches);
			if (proxy == null) throw new Error('GitService: branches sub-provider is required but not registered');
			return proxy;
		},
		get commits() {
			const proxy = getProxy('commits', provider.commits);
			if (proxy == null) throw new Error('GitService: commits sub-provider is required but not registered');
			return proxy;
		},
		get config() {
			const proxy = getProxy('config', provider.config);
			if (proxy == null) throw new Error('GitService: config sub-provider is required but not registered');
			return proxy;
		},
		get contributors() {
			const proxy = getProxy('contributors', provider.contributors);
			if (proxy == null) throw new Error('GitService: contributors sub-provider is required but not registered');
			return proxy;
		},
		get diff() {
			const proxy = getProxy('diff', provider.diff);
			if (proxy == null) throw new Error('GitService: diff sub-provider is required but not registered');
			return proxy;
		},
		get graph() {
			const proxy = getProxy('graph', provider.graph);
			if (proxy == null) throw new Error('GitService: graph sub-provider is required but not registered');
			return proxy;
		},
		get refs() {
			const proxy = getProxy('refs', provider.refs);
			if (proxy == null) throw new Error('GitService: refs sub-provider is required but not registered');
			return proxy;
		},
		get remotes() {
			const proxy = getProxy('remotes', provider.remotes);
			if (proxy == null) throw new Error('GitService: remotes sub-provider is required but not registered');
			return proxy;
		},
		get revision() {
			const proxy = getProxy('revision', provider.revision);
			if (proxy == null) throw new Error('GitService: revision sub-provider is required but not registered');
			return proxy;
		},
		get status() {
			const proxy = getProxy('status', provider.status);
			if (proxy == null) throw new Error('GitService: status sub-provider is required but not registered');
			return proxy;
		},
		get tags() {
			const proxy = getProxy('tags', provider.tags);
			if (proxy == null) throw new Error('GitService: tags sub-provider is required but not registered');
			return proxy;
		},

		// Optional sub-providers
		get blame() {
			return getProxy('blame', provider.blame);
		},
		get maintenance() {
			return getProxy('maintenance', provider.maintenance);
		},
		get ops() {
			return getProxy('ops', provider.ops);
		},
		get patch() {
			return getProxy('patch', provider.patch);
		},
		get pausedOps() {
			return getProxy('pausedOps', provider.pausedOps);
		},
		get staging() {
			return getProxy('staging', provider.staging);
		},
		get stash() {
			return getProxy('stash', provider.stash);
		},
		get worktrees() {
			return getProxy('worktrees', provider.worktrees);
		},
	};
}
