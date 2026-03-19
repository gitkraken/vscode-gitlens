import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { normalizePath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { GitProvider } from './providers/provider.js';
import type { RepositoryService, SubProviderForRepo } from './repositoryService.js';
import {
	clearGlobalRepositoryServiceResolver,
	createSubProviderProxyForRepo,
	setGlobalRepositoryServiceResolver,
} from './repositoryService.js';
import type { FileWatchingProvider } from './watching/provider.js';
import { RepositoryWatchService } from './watching/watchService.js';

export interface ProvidersChangeEvent {
	readonly added: readonly GitProvider[];
	readonly removed: readonly GitProvider[];
	readonly etag: number;
}

interface RegisteredProvider {
	provider: GitProvider;
	canHandle: (repoPath: string) => boolean;
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

	static createSingleton(watchingProvider?: FileWatchingProvider): GitService {
		if (GitService._instance != null) {
			throw new Error('GitService already exists — only one instance is allowed');
		}
		const instance = new GitService(watchingProvider);
		GitService._instance = instance;
		return instance;
	}

	private readonly _onDidChangeProviders = new Emitter<ProvidersChangeEvent>();
	get onDidChangeProviders(): Event<ProvidersChangeEvent> {
		return this._onDidChangeProviders.event;
	}

	private _etag = 0;
	private readonly _providers: RegisteredProvider[] = [];
	private readonly _serviceCache = new Map<string, RepositoryService>();
	private readonly _watchService: RepositoryWatchService | undefined;

	private constructor(watchingProvider?: FileWatchingProvider) {
		if (watchingProvider != null) {
			this._watchService = new RepositoryWatchService({
				watchingProvider: watchingProvider,
				getIgnoreFilter: (repoPath, gitDirPath) => {
					return this.getProvider(repoPath)?.provider.getIgnoreFilter?.(repoPath, gitDirPath);
				},
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
		this._watchService?.dispose();

		// Don't dispose providers since they're owned by the caller, but do clear the array to release references
		this._providers.length = 0;

		this._onDidChangeProviders.dispose();
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

	/**
	 * Registers a provider with a routing predicate.
	 *
	 * @returns A disposable that unregisters the provider.
	 */
	register(provider: GitProvider, canHandle: (repoPath: string) => boolean): UnifiedDisposable {
		const entry: RegisteredProvider = { provider: provider, canHandle: canHandle };
		this._providers.push(entry);
		this._etag++;

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
				this._etag++;
				this._serviceCache.clear();

				this._onDidChangeProviders.fire({
					added: [],
					removed: [provider],
					etag: this._etag,
				});
			}
		});
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
