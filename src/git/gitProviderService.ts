import type {
	ConfigurationChangeEvent,
	Event,
	Range,
	TextDocument,
	TextEditor,
	WindowState,
	WorkspaceFolder,
	WorkspaceFoldersChangeEvent,
} from 'vscode';
import { Disposable, EventEmitter, FileType, ProgressLocation, RelativePattern, Uri, window, workspace } from 'vscode';
import { isWeb } from '@env/platform.js';
import { getSupportedGitProviders } from '@env/providers.js';
import type { CachedGitTypes, UriScopedCachedGitTypes } from '@gitlens/git/cache.js';
import { Cache } from '@gitlens/git/cache.js';
import { BlameIgnoreRevsFileBadRevisionError, BlameIgnoreRevsFileError } from '@gitlens/git/errors.js';
import type { GitExecOptions, GitResult } from '@gitlens/git/exec.types.js';
import type { GitBlame, GitBlameLine, ProgressiveGitBlame } from '@gitlens/git/models/blame.js';
import type { GitCommitLine } from '@gitlens/git/models/commit.js';
import { GitCommit, GitCommitIdentity } from '@gitlens/git/models/commit.js';
import type { GitLineDiff, ParsedGitDiffHunks } from '@gitlens/git/models/diff.js';
import { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { GitFileIndexStatus } from '@gitlens/git/models/fileStatus.js';
import type { GitReference } from '@gitlens/git/models/reference.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type {
	GitProviderDescriptor,
	GitProviderId,
	RepositoryVisibility,
	RepositoryVisibilityInfo,
} from '@gitlens/git/providers/types.js';
import { GitService } from '@gitlens/git/service.js';
import { getBlameRange } from '@gitlens/git/utils/blame.utils.js';
import { calculateDistribution } from '@gitlens/git/utils/contributor.utils.js';
import { getVisibilityCacheKey } from '@gitlens/git/utils/remote.utils.js';
import { RepositoryInitWatcher } from '@gitlens/git/watching/initWatcher.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from '@gitlens/git/watching/provider.js';
import type { RepositoryWatchService } from '@gitlens/git/watching/watchService.js';
import { joinUnique } from '@gitlens/utils/array.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable, fromDisposables } from '@gitlens/utils/disposable.js';
import { count, filter, first, flatMap, groupByMap, join, map, some, sum } from '@gitlens/utils/iterable.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger, maybeStartScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { getScheme, isAbsolute, maybeUri, normalizePath } from '@gitlens/utils/path.js';
import type { Deferred } from '@gitlens/utils/promise.js';
import { asSettled, defer, getDeferredPromiseIfPending, getSettledValue } from '@gitlens/utils/promise.js';
import { PromiseCache } from '@gitlens/utils/promiseCache.js';
import { VisitedPathsTrie } from '@gitlens/utils/trie.js';
import { areUrisEqual, coerceUri, getRepositoryKey } from '@gitlens/utils/uri.js';
import { resetAvatarCache } from '../avatars.js';
import { Schemes } from '../constants.js';
import type { Container } from '../container.js';
import { AccessDeniedError, ProviderNotFoundError, ProviderNotSupportedError } from '../errors.js';
import { isUriScopedGitCacheReset } from '../eventBus.js';
import type { FeatureAccess, PlusFeatures, RepoFeatureAccess } from '../features.js';
import { isAdvancedFeature, isProFeatureOnAllRepos } from '../features.js';
import { showBlameInvalidIgnoreRevsFileWarningMessage } from '../messages.js';
import type { Subscription } from '../plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from '../plus/gk/subscriptionService.js';
import { isSubscriptionPaidPlan } from '../plus/gk/utils/subscription.utils.js';
import type { RepoComparisonKey } from '../repositories.js';
import { asRepoComparisonKey, Repositories } from '../repositories.js';
import { registerCommand } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { setContext } from '../system/-webview/context.js';
import { getBestPath, splitPath } from '../system/-webview/path.js';
import { rangeToLineRange } from '../system/-webview/vscode/range.js';
import { gate } from '../system/decorators/gate.js';
import type { TrackedGitDocument } from '../trackers/trackedDocument.js';
import type { GlGitProvider, ScmRepository } from './gitProvider.js';
import { GitRepositoryService } from './gitRepositoryService.js';
import type { GitUri } from './gitUri.js';
import type { GlRepository, RepositoryChangeEvent } from './models/repository.js';
import type { LocalInfoFromRemoteUriResult } from './utils/-webview/remote.utils.js';
import {
	getRemoteIntegration,
	isRemoteMaybeIntegrationConnected,
	remoteSupportsIntegration,
	resolveLocalInfoFromRemoteUri,
} from './utils/-webview/remote.utils.js';
import { sortRepositories } from './utils/-webview/sorting.js';
import { BlameSnapshot } from './utils/blameSnapshot.js';

const emptyArray: readonly any[] = Object.freeze([]);
const emptyDisposable: Disposable = Object.freeze({ dispose: () => {} });

export type GitProvidersChangeEvent = {
	readonly added: readonly GlGitProvider[];
	readonly removed: readonly GlGitProvider[];
	readonly etag: number;
};

export type RepositoriesChangeEvent = {
	readonly added: readonly GlRepository[];
	readonly removed: readonly GlRepository[];
	readonly etag: number;
};

export interface GitProviderResult {
	provider: GlGitProvider;
	path: string;
}

export type RepositoriesVisibility = RepositoryVisibility | 'mixed';

export class GitProviderService implements UnifiedDisposable {
	private readonly _onDidChangeProviders = new EventEmitter<GitProvidersChangeEvent>();
	get onDidChangeProviders(): Event<GitProvidersChangeEvent> {
		return this._onDidChangeProviders.event;
	}

	@trace({
		args: (added, removed) => ({
			added: `(${added?.length ?? 0}) ${added?.map(p => p.descriptor.id).join(', ')}`,
			removed: `(${removed?.length ?? 0}) ${removed?.map(p => p.descriptor.id).join(', ')}`,
		}),
	})
	private fireProvidersChanged(added?: GlGitProvider[], removed?: GlGitProvider[]) {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.setGlobalAttributes({
				'providers.count': this._providers.size,
				'providers.ids': join(this._providers.keys(), ','),
			});
		}

		this._onDidChangeProviders.fire({ added: added ?? [], removed: removed ?? [], etag: this._etag });
	}

	private _onDidChangeRepositories = new EventEmitter<RepositoriesChangeEvent>();
	get onDidChangeRepositories(): Event<RepositoriesChangeEvent> {
		return this._onDidChangeRepositories.event;
	}

	@trace({
		args: (added, removed) => ({
			added: `(${added?.length ?? 0}) ${added?.map(r => r.id).join(', ')}`,
			removed: `(${removed?.length ?? 0}) ${removed?.map(r => r.id).join(', ')}`,
		}),
	})
	private fireRepositoriesChanged(added?: GlRepository[], removed?: GlRepository[]) {
		if (this.container.telemetry.enabled) {
			const openSchemes = this.openRepositories.map(r => r.uri.scheme);

			this.container.telemetry.setGlobalAttributes({
				'repositories.count': openSchemes.length,
				'repositories.schemes': joinUnique(openSchemes, ','),
			});
			this.container.telemetry.sendEvent('repositories/changed', {
				'repositories.added': added?.length ?? 0,
				'repositories.removed': removed?.length ?? 0,
			});
		}

		// Pure-add of worktrees whose common repo is already known can't change aggregate visibility
		// or access (shared remotes), so the cache wipe would be wasted work. See `hasKnownCommonRepo`.
		let needsInvalidation = false;
		if (removed?.length) {
			needsInvalidation = true;
		} else if (added?.length) {
			needsInvalidation = !this.allHaveKnownCommonRepo(added);
		}
		if (needsInvalidation) {
			this.clearAccessCache();
			this._reposVisibilityCache.invalidate('visibility');
		}

		this._onDidChangeRepositories.fire({ added: added ?? [], removed: removed ?? [], etag: this._etag });

		// Queue repositories for deferred processing (location storage + telemetry)
		if (added?.length) {
			for (const repo of added) {
				this._pendingRepositoryOperations.set(repo.path, repo);
			}
			this.processPendingRepositoryOperations();
		}
	}

	// True when `repo` is a worktree whose common repository is registered with the service (open
	// or closed). A registered common repo guarantees the repo-family's identity/remotes are known
	// to GitLens — either the common repo's own add event processed storage/telemetry when it was
	// first opened, or a sibling entry (e.g. the opened URI form for a canonical-URI closed
	// duplicate) did. Since the worktree inherits the common repo's remotes and initial-commit
	// sha, the worktree's add can safely skip visibility invalidation and the remote-context
	// rescan. Uses exact-path lookup (not `getRepository`'s `getClosest`) to avoid matching an
	// unrelated ancestor repo. (A non-worktree always has `commonUri == null`, so this returns
	// false for non-worktrees without a separate `isWorktree` check.)
	private hasKnownCommonRepo(repo: GlRepository): boolean {
		return repo.commonUri != null && this._repositories.get(repo.commonUri) != null;
	}

	private allHaveKnownCommonRepo(added: GlRepository[]): boolean {
		return added.length > 0 && added.every(r => this.hasKnownCommonRepo(r));
	}

	private processPendingRepositoryOperations = debounce(() => {
		if (!this._pendingRepositoryOperations.size) return;

		// If user is active, wait for idle (up to 30s) before processing
		if (window.state.active) {
			let disposable: Disposable | undefined;
			const maxWaitTimeout = setTimeout(() => {
				disposable?.dispose();
				this.executePendingRepositoryOperations();
			}, 30000);

			disposable = window.onDidChangeWindowState(e => {
				if (!e.active) {
					clearTimeout(maxWaitTimeout);
					disposable?.dispose();
					this.executePendingRepositoryOperations();
				}
			});
			return;
		}

		this.executePendingRepositoryOperations();
	}, 5000);

	private executePendingRepositoryOperations(): void {
		if (!this._pendingRepositoryOperations.size) return;

		const repos = [...this._pendingRepositoryOperations.values()];
		this._pendingRepositoryOperations.clear();

		// Store locations (deferred to allow discovery to settle)
		void this.container.repositoryIdentity.storeRepositoryLocations(repos);

		// Send telemetry (if enabled)
		if (this.container.telemetry.enabled) {
			this.sendRepositoryOpenedTelemetry(repos);
		}
	}

	private sendRepositoryOpenedTelemetry(repos: GlRepository[]): void {
		// Group by commonPath and pick one repo per group (prefer main repo over worktrees)
		const grouped = groupByMap(repos, r => r.commonUri?.path ?? r.path);

		const reposAndCounts = Array.from(grouped.values(), group => {
			const repo = group.find(r => !r.isWorktree) ?? group[0];
			return {
				repo: repo,
				submoduleCount: group.filter(r => r.isSubmodule && r !== repo).length,
				worktreeCount: group.filter(r => r.isWorktree && r !== repo).length,
			};
		});
		if (!reposAndCounts.length) return;

		void Promise.allSettled(
			reposAndCounts.map(async ({ repo, worktreeCount, submoduleCount }) => {
				const since = '1.year.ago';
				const [remotesResult, contributorsStatsResult] = await Promise.allSettled([
					repo.git.remotes.getRemotes(),
					repo.git.contributors.getContributorsStats({ since: since }, undefined, 2000),
				]);

				const remotes = getSettledValue(remotesResult) ?? [];

				const remoteProviders = new Set<string>();
				for (const remote of remotes) {
					remoteProviders.add(remote.provider?.id ?? 'unknown');
				}

				const stats = getSettledValue(contributorsStatsResult);

				let commits;
				let avgPerContributor;
				if (stats != null) {
					commits = sum(stats.contributions);
					avgPerContributor = Math.round(commits / stats.count);
				}
				const distribution = calculateDistribution(stats, 'repository.contributors.distribution.');

				this.container.telemetry.sendEvent('repository/opened', {
					'repository.id': repo.idHash,
					'repository.scheme': repo.uri.scheme,
					'repository.closed': repo.closed,
					'repository.folder.scheme': repo.folder?.uri.scheme,
					'repository.provider.id': repo.provider.id,
					'repository.remoteProviders': join(remoteProviders, ','),
					'repository.submodules.openedCount': submoduleCount,
					'repository.worktrees.openedCount': worktreeCount,
					'repository.contributors.commits.count': commits,
					'repository.contributors.commits.avgPerContributor': avgPerContributor,
					'repository.contributors.count': stats?.count,
					'repository.contributors.since': since,
					...distribution,
				});
			}),
		);
	}

	private readonly _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	readonly supportedSchemes = new Set<string>();

	private readonly _gitService: GitService;
	private readonly _cache: Cache;
	private readonly _disposable: UnifiedDisposable;
	private _initializing: Deferred<number> | undefined;
	private readonly _initWatchHandles = new Map<string, { dispose(): void }>();
	private readonly _pendingRepositories = new Map<RepoComparisonKey, Promise<GlRepository | undefined>>();
	private readonly _pendingRepositoryOperations = new Map<string, GlRepository>();
	private readonly _providerDisposables: UnifiedDisposable[] = [];
	private readonly _providers = new Map<GitProviderId, GlGitProvider>();
	private readonly _repositoryInitWatcher: RepositoryInitWatcher;
	private readonly _repositories = new Repositories();
	private readonly _searchedRepositoryPaths = new VisitedPathsTrie();

	constructor(private readonly container: Container) {
		this._cache = new Cache();

		const watchingProvider = createWatchingProvider();
		this._gitService = GitService.createSingleton(watchingProvider);
		this._watchService = this._gitService.watchService!;
		this._repositoryInitWatcher = new RepositoryInitWatcher(watchingProvider);

		this._initializing = defer<number>();
		this._disposable = fromDisposables(
			this._gitService,
			this._cache,
			this._repositoryInitWatcher,
			this._repositoryInitWatcher.onDidCreate(e => {
				const f = workspace.getWorkspaceFolder(Uri.file(e.path));
				if (f == null) return;

				void this.discoverRepositories([f], { force: true });
			}),
			this._onDidChangeProviders,
			this._onDidChangeRepositories,
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.events.on('git:cache:reset', e => {
				if (isUriScopedGitCacheReset(e.data)) {
					this._cache.clearForPath(e.data.repoPath, e.data.path, ...e.data.types);
				} else {
					this._cache.clearCaches(e.data.repoPath, ...(e.data.types ?? []));
				}
			}),
			container.integrations.onDidChangeConnectionState(e => {
				if (e.reason === 'connected') {
					resetAvatarCache('failed');
				}

				this.resetCaches('providers');
				this.updateContext();
			}),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(() => {
						if (workspace.isTrusted && workspace.workspaceFolders?.length) {
							void this.discoverRepositories(workspace.workspaceFolders, { force: true });
						}
					})
				: emptyDisposable,
			...this.registerCommands(),
		);

		this.container.BranchDateFormatting.reset();
		this.container.CommitDateFormatting.reset();
		this.container.CommitShaFormatting.reset();
		this.container.PullRequestDateFormatting.reset();

		this.updateContext();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		this._providerDisposables.forEach(d => d.dispose());
		this._disposable.dispose();
		this._providers.clear();

		this._repositories.forEach(r => r.dispose());
		this._repositories.clear();
		this._repositoryServices.clear();
	}

	private _etag: number = 0;
	get etag(): number {
		return this._etag;
	}

	private readonly _watchService: RepositoryWatchService;
	get watchService(): RepositoryWatchService {
		return this._watchService;
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateSource') ||
			configuration.changed(e, 'defaultDateStyle')
		) {
			this.container.BranchDateFormatting.reset();
			this.container.CommitDateFormatting.reset();
			this.container.PullRequestDateFormatting.reset();
		}

		if (configuration.changed(e, 'advanced.abbreviatedShaLength')) {
			this.container.CommitShaFormatting.reset();
		}

		if (configuration.changed(e, 'views.contributors.showAllBranches')) {
			this.resetCaches('contributors');
		}

		if (
			configuration.changed(e, 'blame.ignoreWhitespace') ||
			configuration.changed(e, 'advanced.blame.customArguments')
		) {
			this.resetCaches('blame');
		}

		if (configuration.changed(e, 'remotes')) {
			this.resetCaches('remotes');
		}

		if (e != null && configuration.changed(e, 'integrations.enabled')) {
			this.updateContext();
		}
	}

	private registerCommands(): Disposable[] {
		return [registerCommand('gitlens.plus.refreshRepositoryAccess', () => this.clearAllOpenRepoVisibilityCaches())];
	}

	@trace()
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		this.clearAccessCache();
		this._subscription = e.current;
	}

	@trace({ args: e => ({ e: `focused=${e.focused}` }) })
	private onWindowStateChanged(e: WindowState) {
		if (!e.focused) {
			this._repositories.forEach(r => r.suspend());
			return;
		}

		if (!this.repositoryCount) return;

		// Resume repositories with staggered timing to prevent overwhelming the system, except for the "active" one
		const activeRepo = this.getBestRepositoryOrFirst(window.activeTextEditor);
		activeRepo?.resume();

		// Stagger remaining repositories with pending changes
		const staggerDelay = 50; // ms between each repository with pending changes
		let delay = 0;

		for (const repo of this._repositories.values()) {
			if (repo === activeRepo) continue;

			if (repo.hasPendingChanges) {
				delay += staggerDelay;
				repo.resume(delay);
			} else {
				repo.resume();
			}
		}
	}

	@trace({
		args: e => ({ e: `added=${e.added.length}, removed=${e.removed.length}` }),
		onlyExit: true,
	})
	private onWorkspaceFoldersChanged(e: WorkspaceFoldersChangeEvent) {
		if (this.container.telemetry.enabled) {
			const schemes = workspace.workspaceFolders?.map(f => f.uri.scheme);
			this.container.telemetry.setGlobalAttributes({
				'folders.count': schemes?.length ?? 0,
				'folders.schemes': schemes != null ? joinUnique(schemes, ', ') : '',
			});
		}

		if (e.added.length) {
			this._etag = Date.now();
			void this.discoverRepositories(e.added);

			for (const folder of e.added) {
				const key = folder.uri.toString();
				if (!this._initWatchHandles.has(key)) {
					this._initWatchHandles.set(key, this._repositoryInitWatcher.watch(folder.uri.fsPath));
				}
			}
		}

		if (e.removed.length) {
			this._etag = Date.now();
			const removed: GlRepository[] = [];

			for (const folder of e.removed) {
				const key = folder.uri.toString();
				this._initWatchHandles.get(key)?.dispose();
				this._initWatchHandles.delete(key);

				// Remove the closest repo and any nested repos under the removed folder
				const closest = this._repositories.getClosest(folder.uri);
				if (closest != null) {
					this._repositories.remove(closest.uri, false);
					removed.push(closest);
				}
				for (const repository of this._repositories.getDescendants(folder.uri)) {
					this._repositories.remove(repository.uri, false);
					removed.push(repository);
				}
			}

			if (removed.length) {
				this.updateContext();

				for (const r of removed) {
					this._gitService.closeRepo(r.path);
					this.removeRepositoryService(r.path);
				}

				// Defer the event trigger enough to let everything unwind
				queueMicrotask(() => {
					this.fireRepositoriesChanged([], removed);
					removed.forEach(r => r.dispose());
				});
			}
		}
	}

	get hasProviders(): boolean {
		return this._providers.size !== 0;
	}

	get registeredProviders(): GitProviderDescriptor[] {
		return [...map(this._providers.values(), p => ({ ...p.descriptor }))];
	}

	get openRepositories(): GlRepository[] {
		if (this.repositoryCount === 0) return emptyArray as GlRepository[];

		const repositories = [...filter(this.repositories, r => !r.closed)];
		if (repositories.length === 0) return repositories;

		return sortRepositories(repositories);
	}

	get openRepositoryCount(): number {
		return this.repositoryCount === 0 ? 0 : count(this.repositories, r => !r.closed);
	}

	get repositories(): IterableIterator<GlRepository> {
		return this._repositories.values();
	}

	get repositoryCount(): number {
		return this._repositories.count;
	}

	get highlander(): GlRepository | undefined {
		return this.repositoryCount === 1 || this.openRepositoryCount === 1
			? first(this._repositories.values())
			: undefined;
	}

	// get readonly() {
	// 	return true;
	// 	// return this.container.vsls.readonly;
	// }

	@debug()
	async registerProviders(): Promise<void> {
		const providers = await getSupportedGitProviders(this.container, this._cache, (provider, canHandle) =>
			this._gitService.register(provider, canHandle),
		);
		for (const provider of providers) {
			this._providerDisposables.push(this.register(provider.descriptor.id, provider));
		}

		// Don't wait here otherwise we will deadlock in certain places
		void this.registrationComplete();
	}

	/**
	 * Registers a {@link GlGitProvider}
	 * @param id A unique identifier for the provider
	 * @param name A name for the provider
	 * @param provider A provider for handling git operations
	 * @returns A disposable to unregister the {@link GlGitProvider}
	 */
	@debug({ args: (id: GitProviderId) => ({ id: id }), onlyExit: true })
	register(id: GitProviderId, provider: GlGitProvider): UnifiedDisposable {
		if (id !== provider.descriptor.id) {
			throw new Error(`Id '${id}' must match provider id '${provider.descriptor.id}'`);
		}
		if (this._providers.has(id)) throw new Error(`Provider '${id}' has already been registered`);

		this._providers.set(id, provider);
		for (const scheme of provider.supportedSchemes) {
			this.supportedSchemes.add(scheme);
		}

		const disposable = fromDisposables(
			provider,
			provider.onDidChange(() => {
				this._etag = Date.now();
				using scope = maybeStartScopedLogger(`${getLoggableName(provider)}.onDidChange`);
				scope?.trace('');

				const { workspaceFolders } = workspace;
				if (workspaceFolders?.length) {
					void this.discoverRepositories(workspaceFolders, { force: true });
				}
			}),
			provider.onDidChangeRepository(async e => {
				this._etag = Date.now();
				using scope = maybeStartScopedLogger(
					`${getLoggableName(provider)}.onDidChangeRepository(e=${Logger.toLoggable(e.repository)})`,
				);
				scope?.trace('');

				if (e.changed('closed')) {
					this.updateContext();

					// Send a notification that the repositories changed
					queueMicrotask(() => this.fireRepositoriesChanged([], [e.repository as GlRepository]));
				} else if (e.changed('opened')) {
					this.updateContext();

					// Send a notification that the repositories changed
					queueMicrotask(() => this.fireRepositoriesChanged([e.repository as GlRepository], []));
				}

				if (e.changed('remotes')) {
					const visibilityInfo = this.getVisibilityInfoFromCache(e.repository.path);
					if (visibilityInfo != null) {
						await this.checkVisibilityCachedRemotes(
							e.repository.path,
							visibilityInfo,
							() =>
								this._gitService.forRepo(e.repository.path)?.remotes.getRemotes() ??
								Promise.resolve([]),
						);
					}
				}

				this._onDidChangeRepository.fire(e);
			}),
			provider.onDidCloseRepository(e => {
				this._etag = Date.now();
				const repository = this._repositories.get(e.uri);
				using scope = maybeStartScopedLogger(
					`${getLoggableName(provider)}.onDidCloseRepository(e=${e.uri.toString()}, source=${e.source ?? 'gitlens'})`,
				);
				const wasClosed = repository?.closed;

				if (repository != null) {
					if (e.source === 'scm') {
						repository.closedByUser = true;
					}
					repository.closed = true;
				}

				scope?.info(
					`repository=${Logger.toLoggable(repository)}, closed:${wasClosed ?? '<no-repo>'}→true${
						e.source === 'scm' ? ' (closedByUser=true)' : ''
					}`,
				);
			}),
			provider.onDidOpenRepository(e => {
				this._etag = Date.now();
				const repository = this._repositories.get(e.uri);
				using scope = maybeStartScopedLogger(
					`${getLoggableName(provider)}.onDidOpenRepository(e=${e.uri.toString()}, source=${e.source ?? 'gitlens'})`,
				);
				const wasClosed = repository?.closed;

				if (repository != null) {
					if (e.source === 'scm') {
						repository.closedByUser = false;
					}
					repository.closed = false;
					scope?.info(
						`repository=${Logger.toLoggable(repository)}, closed:${wasClosed ?? '<no-repo>'}→false${
							e.source === 'scm' ? ' (closedByUser cleared)' : ''
						}`,
					);
				} else {
					scope?.info(`repository=<unknown>; deferring to getOrOpenRepository`);
					void this.getOrOpenRepository(e.uri, e.source === 'scm' ? { detectNested: true } : undefined);
				}
			}),
		);

		this._etag = Date.now();
		this.fireProvidersChanged([provider]);

		// Don't kick off the discovery if we're still initializing (we'll do it at the end for all "known" providers)
		if (this._initializing == null) {
			this.onWorkspaceFoldersChanged({ added: workspace.workspaceFolders ?? [], removed: [] });
		}

		return createDisposable(() => {
			this._etag = Date.now();
			disposable.dispose();
			this._providers.delete(id);

			const removed: GlRepository[] = [];

			for (const repository of [...this._repositories.values()]) {
				if (repository?.provider.id === id) {
					this._repositories.remove(repository.uri, false);
					removed.push(repository);
				}
			}

			const { deactivating } = this.container;
			if (!deactivating) {
				this.updateContext();
			}

			if (removed.length) {
				for (const r of removed) {
					this._gitService.closeRepo(r.path);
					this.removeRepositoryService(r.path);
				}

				// Defer the event trigger enough to let everything unwind
				queueMicrotask(() => {
					if (!deactivating) {
						this.fireRepositoriesChanged([], removed);
					}
					removed.forEach(r => r.dispose());
				});
			}

			if (!deactivating) {
				this.fireProvidersChanged([], [provider]);
			}
		});
	}

	@debug({ onlyExit: true })
	async registrationComplete(): Promise<void> {
		const scope = getScopedLogger();

		let { workspaceFolders } = workspace;
		if (workspaceFolders?.length) {
			// Set up init watchers for initial workspace folders
			for (const folder of workspaceFolders) {
				const key = folder.uri.toString();
				if (!this._initWatchHandles.has(key)) {
					this._initWatchHandles.set(key, this._repositoryInitWatcher.watch(folder.uri.fsPath));
				}
			}

			await this.discoverRepositories(workspaceFolders);

			// This is a hack to work around some issue with remote repositories on the web not being discovered on the initial load
			if (this.repositoryCount === 0 && isWeb) {
				setTimeout(() => {
					({ workspaceFolders } = workspace);
					if (workspaceFolders?.length) {
						void this.discoverRepositories(workspaceFolders, { force: true });
					}
				}, 1000);
			}
		} else {
			this._initializing?.fulfill(this._etag);
			this._initializing = undefined;

			this.updateContext();
		}

		const autoRepositoryDetection = configuration.getCore('git.autoRepositoryDetection');

		if (this.container.telemetry.enabled) {
			setTimeout(
				() =>
					this.container.telemetry.sendEvent('providers/registrationComplete', {
						'config.git.autoRepositoryDetection': autoRepositoryDetection,
					}),
				0,
			);
		}

		scope?.addExitInfo(
			`repositories=${this.repositoryCount}, workspaceFolders=${workspaceFolders?.length}, git.autoRepositoryDetection=${autoRepositoryDetection}`,
		);
	}

	getOpenRepositories(id: GitProviderId): Iterable<GlRepository> {
		return filter(this.repositories, r => !r.closed && (id == null || id === r.provider.id));
	}

	getOpenRepositoriesByProvider(): Map<GitProviderId, GlRepository[]> {
		const repositories = [...filter(this.repositories, r => !r.closed)];
		if (repositories.length === 0) return new Map();

		return groupByMap(repositories, r => r.provider.id);
	}

	hasOpenRepositories(id: GitProviderId): boolean {
		return some(this.repositories, r => !r.closed && (id == null || id === r.provider.id));
	}

	private _discoveredWorkspaceFolders = new Map<WorkspaceFolder, Promise<GlRepository[]>>();

	private _discoveringRepositories: Deferred<number> | undefined;
	get isDiscoveringRepositories(): Promise<number> | undefined {
		return (
			getDeferredPromiseIfPending(this._discoveringRepositories) ??
			getDeferredPromiseIfPending(this._initializing)
		);
	}

	@debug({ args: folders => ({ folders: folders.length }) })
	async discoverRepositories(folders: readonly WorkspaceFolder[], options?: { force?: boolean }): Promise<void> {
		if (this._discoveringRepositories?.pending) {
			await this._discoveringRepositories.promise;
			this._discoveringRepositories = undefined;
		}

		const deferred = this._initializing ?? defer<number>();
		this._discoveringRepositories = deferred;
		this._initializing = undefined;

		try {
			const promises = [];

			for (const folder of folders) {
				if (!options?.force && this._discoveredWorkspaceFolders.has(folder)) continue;

				const promise = this.discoverRepositoriesCore(folder);
				promises.push(promise);
				this._discoveredWorkspaceFolders.set(folder, promise);
			}

			if (promises.length === 0) return;

			const results = await Promise.allSettled(promises);

			const repositories = flatMap<PromiseFulfilledResult<GlRepository[]>, GlRepository>(
				filter<PromiseSettledResult<GlRepository[]>, PromiseFulfilledResult<GlRepository[]>>(
					results,
					(r): r is PromiseFulfilledResult<GlRepository[]> => r.status === 'fulfilled',
				),
				r => r.value,
			);

			const added: GlRepository[] = [];

			for (const repository of repositories) {
				this._repositories.add(repository);
				if (!repository.closed) {
					added.push(repository);
				}
			}

			this.updateContext({ skipRemotes: this.allHaveKnownCommonRepo(added) });

			if (added.length) {
				this._etag = Date.now();
				queueMicrotask(() => {
					// Defer the event trigger enough to let everything unwind
					// Note: fireRepositoriesChanged queues location storage via processPendingRepositoryOperations
					this.fireRepositoriesChanged(added);
				});
			}
		} finally {
			queueMicrotask(() => {
				deferred.fulfill(this._etag);
			});
		}
	}

	@trace({ exit: true })
	private async discoverRepositoriesCore(folder: WorkspaceFolder): Promise<GlRepository[]> {
		const scope = getScopedLogger();
		const { provider } = this.getProvider(folder.uri);

		try {
			return await provider.discoverRepositories(folder.uri);
		} catch (ex) {
			this._discoveredWorkspaceFolders.delete(folder);

			scope?.error(
				ex,
				`${provider.descriptor.name} Provider(${
					provider.descriptor.id
				}) failed discovering repositories in ${folder.uri.toString(true)}`,
			);

			return [];
		}
	}

	@debug()
	async findRepositories(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]> {
		const { provider } = this.getProvider(uri);
		return provider.discoverRepositories(uri, options);
	}

	exec(repoPath: string | Uri, args: readonly string[], options?: GitExecOptions): Promise<GitResult> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.exec == null) {
			throw new Error(`Git provider '${provider.descriptor.name}' does not support raw git exec`);
		}
		return provider.exec(path, args, options);
	}

	private _subscription: Subscription | undefined;
	private async getSubscription(): Promise<Subscription> {
		return this._subscription ?? (this._subscription = await this.container.subscription.getSubscription());
	}

	private _accessCache = new Map<PlusFeatures | undefined, Promise<FeatureAccess>>();
	private _accessCacheByRepo = new Map<string /* path */, Promise<RepoFeatureAccess>>();
	private clearAccessCache(): void {
		this._accessCache.clear();
		this._accessCacheByRepo.clear();
	}

	async access(feature: PlusFeatures | undefined, repoPath: string | Uri): Promise<RepoFeatureAccess>;
	async access(feature?: PlusFeatures, repoPath?: string | Uri): Promise<FeatureAccess | RepoFeatureAccess>;
	@trace({ exit: r => `returned allowed=${r.allowed}, plan=${r.subscription.current.plan.effective.id}` })
	async access(feature?: PlusFeatures, repoPath?: string | Uri): Promise<FeatureAccess | RepoFeatureAccess> {
		if (repoPath == null) {
			let access = this._accessCache.get(feature);
			if (access == null) {
				access = this.accessCore(feature);
				this._accessCache.set(feature, access);
			}
			return access;
		}

		const { path } = this.getProvider(repoPath);
		const cacheKey = path;

		let access = this._accessCacheByRepo.get(cacheKey);
		if (access == null) {
			access = this.accessCore(feature, repoPath);
			this._accessCacheByRepo.set(cacheKey, access);
		}

		return access;
	}

	private async accessCore(feature: PlusFeatures | undefined, repoPath: string | Uri): Promise<RepoFeatureAccess>;
	private async accessCore(
		feature?: PlusFeatures,
		repoPath?: string | Uri,
	): Promise<FeatureAccess | RepoFeatureAccess>;
	@trace({ exit: r => `returned allowed=${r.allowed}, plan=${r.subscription.current.plan.effective.id}` })
	private async accessCore(
		feature?: PlusFeatures,
		repoPath?: string | Uri,
	): Promise<FeatureAccess | RepoFeatureAccess> {
		const subscription = await this.getSubscription();

		if (this.container.telemetry.enabled) {
			queueMicrotask(() => void this.visibility());
		}

		const plan = subscription.plan.effective.id;
		if (isSubscriptionPaidPlan(plan)) {
			return { allowed: subscription.account?.verified !== false, subscription: { current: subscription } };
		}

		if (feature != null && (isProFeatureOnAllRepos(feature) || isAdvancedFeature(feature))) {
			return { allowed: false, subscription: { current: subscription, required: 'pro' } };
		}

		function getRepoAccess(
			this: GitProviderService,
			repoPath: string | Uri,
			force: boolean = false,
		): Promise<RepoFeatureAccess> {
			const { path: cacheKey } = this.getProvider(repoPath);

			let access = force ? undefined : this._accessCacheByRepo.get(cacheKey);
			if (access == null) {
				access = this.visibility(repoPath).then(
					visibility => {
						if (visibility === 'private') {
							return {
								allowed: false,
								subscription: { current: subscription, required: 'pro' },
								visibility: visibility,
							};
						}

						return {
							allowed: true,
							subscription: { current: subscription },
							visibility: visibility,
						};
					},
					// If there is a failure assume access is allowed
					() => ({ allowed: true, subscription: { current: subscription } }),
				);

				this._accessCacheByRepo.set(cacheKey, access);
			}

			return access;
		}

		if (repoPath == null) {
			const repositories = this.openRepositories;
			if (repositories.length === 0) {
				return { allowed: false, subscription: { current: subscription } };
			}

			if (repositories.length === 1) {
				return getRepoAccess.call(this, repositories[0].path);
			}

			const visibility = await this.visibility();
			switch (visibility) {
				case 'private':
					return {
						allowed: false,
						subscription: { current: subscription, required: 'pro' },
						visibility: 'private',
					};
				case 'mixed':
					return {
						allowed: 'mixed',
						subscription: { current: subscription, required: 'pro' },
					};
				default:
					return {
						allowed: true,
						subscription: { current: subscription },
						visibility: 'public',
					};
			}
		}

		// Pass force = true to bypass the cache and avoid a promise loop (where we used the cached promise we just created to try to resolve itself 🤦)
		return getRepoAccess.call(this, repoPath, true);
	}

	async ensureAccess(feature: PlusFeatures, repoPath?: string): Promise<void> {
		const { allowed, subscription } = await this.access(feature, repoPath);
		if (allowed === false) throw new AccessDeniedError(subscription.current, subscription.required);
	}

	/** Single-value cache for the aggregate `visibility()` result. Handles coalescing, soft-
	 * invalidation (in-flight callers ride the same promise; entry self-evicts on settle), and
	 * stale-compute detection via `CacheController.invalidated` — the factory skips telemetry + the
	 * final cache write when an invalidation happened mid-flight. Uses a `'visibility'` sentinel
	 * key to make the single-value intent explicit (pattern: `composerWebview.ts`). */
	private readonly _reposVisibilityCache = new PromiseCache<'visibility', RepositoriesVisibility>();
	private _repoVisibilityCache: Map<string, RepositoryVisibilityInfo> | undefined;

	private ensureRepoVisibilityCache(): void {
		if (this._repoVisibilityCache == null) {
			const repoVisibility: [string, RepositoryVisibilityInfo][] | undefined = this.container.storage
				.get('repoVisibility')
				?.map<[string, RepositoryVisibilityInfo]>(([key, visibilityInfo]) => [
					key,
					{
						visibility: visibilityInfo.visibility,
						timestamp: visibilityInfo.timestamp,
						remotesHash: visibilityInfo.remotesHash,
					},
				]);
			this._repoVisibilityCache = new Map(repoVisibility);
		}
	}

	private async clearRepoVisibilityCache(keys?: string[]): Promise<void> {
		if (keys == null) {
			this._repoVisibilityCache = undefined;
			void this.container.storage.delete('repoVisibility');
		} else {
			keys?.forEach(key => this._repoVisibilityCache?.delete(key));

			const repoVisibility = [...(this._repoVisibilityCache?.entries() ?? [])];
			if (repoVisibility.length === 0) {
				await this.container.storage.delete('repoVisibility');
			} else {
				await this.container.storage.store('repoVisibility', repoVisibility);
			}
		}
	}

	@trace({ exit: r => `returned ${r?.visibility}` })
	private getVisibilityInfoFromCache(key: string): RepositoryVisibilityInfo | undefined {
		this.ensureRepoVisibilityCache();
		const visibilityInfo = this._repoVisibilityCache?.get(key);
		if (visibilityInfo == null) return undefined;

		const now = Date.now();
		if (now - visibilityInfo.timestamp > 1000 * 60 * 60 * 24 * 30 /* TTL is 30 days */) {
			void this.clearRepoVisibilityCache([key]);
			return undefined;
		}

		return visibilityInfo;
	}

	private async checkVisibilityCachedRemotes(
		key: string,
		visibilityInfo: RepositoryVisibilityInfo | undefined,
		getRemotes: () => Promise<GitRemote[]>,
	): Promise<boolean> {
		if (visibilityInfo == null) return true;

		if (visibilityInfo.visibility === 'public') {
			const remotes = await getRemotes();
			if (remotes.length === 0 || !remotes.some(r => r.remoteKey === visibilityInfo.remotesHash)) {
				void this.clearRepoVisibilityCache([key]);
				return false;
			}
		} else if (visibilityInfo.visibility === 'private') {
			const remotesHash = getVisibilityCacheKey(await getRemotes());
			if (remotesHash !== visibilityInfo.remotesHash) {
				void this.clearRepoVisibilityCache([key]);
				return false;
			}
		}

		return true;
	}

	private updateVisibilityCache(key: string, visibilityInfo: RepositoryVisibilityInfo): void {
		this.ensureRepoVisibilityCache();
		this._repoVisibilityCache?.set(key, visibilityInfo);
		void this.container.storage.store('repoVisibility', [...this._repoVisibilityCache!.entries()]).catch();
	}

	@trace()
	clearAllRepoVisibilityCaches(): Promise<void> {
		return this.clearRepoVisibilityCache();
	}

	@trace()
	clearAllOpenRepoVisibilityCaches(): Promise<void> {
		const openRepoProviderPaths = this.openRepositories.map(r => this.getProvider(r.path).path);
		return this.clearRepoVisibilityCache(openRepoProviderPaths);
	}

	visibility(): Promise<RepositoriesVisibility>;
	visibility(repoPath: string | Uri): Promise<RepositoryVisibility>;
	@trace({ exit: true })
	async visibility(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		if (repoPath == null) {
			// Coalescing, soft-invalidation, and stale-compute detection are handled by PromiseCache:
			// - concurrent callers share one in-flight promise (no parallel `visibilityCore` runs)
			// - a mid-flight invalidation flips `controller.invalidated`; the factory skips telemetry
			//   for the stale value (callers still receive it, matching prior semantics) and the
			//   entry self-evicts on settle so the next call starts fresh
			return this._reposVisibilityCache.getOrCreate('visibility', async controller => {
				const visibility = await this.visibilityCore();
				if (!controller.invalidated && this.container.telemetry.enabled) {
					this.container.telemetry.setGlobalAttribute('repositories.visibility', visibility);
					this.container.telemetry.sendEvent('repositories/visibility', {
						'repositories.visibility': visibility,
					});
				}
				return visibility;
			});
		}

		const { path: cacheKey } = this.getProvider(repoPath);

		let visibility = this.getVisibilityInfoFromCache(cacheKey)?.visibility;
		if (visibility == null) {
			visibility = await this.visibilityCore(repoPath);
			if (this.container.telemetry.enabled) {
				setTimeout(() => {
					const repo = this.getRepository(repoPath);
					this.container.telemetry.sendEvent('repository/visibility', {
						'repository.visibility': visibility,
						'repository.id': repo?.idHash,
						'repository.scheme': repo?.uri.scheme,
						'repository.closed': repo?.closed,
						'repository.folder.scheme': repo?.folder?.uri.scheme,
						'repository.provider.id': repo?.provider.id,
					});
				}, 0);
			}
		}
		return visibility;
	}

	private visibilityCore(): Promise<RepositoriesVisibility>;
	private visibilityCore(repoPath: string | Uri): Promise<RepositoryVisibility>;
	@trace({ exit: true })
	private async visibilityCore(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		async function getRepoVisibility(
			this: GitProviderService,
			repoPath: string | Uri,
		): Promise<RepositoryVisibility> {
			const { provider, path } = this.getProvider(repoPath);
			const visibilityInfo = this.getVisibilityInfoFromCache(path);
			if (
				visibilityInfo == null ||
				!(await this.checkVisibilityCachedRemotes(
					path,
					visibilityInfo,
					() => this._gitService.forRepo(path)?.remotes.getRemotes({ sort: true }) ?? Promise.resolve([]),
				))
			) {
				const [visibility, remotesHash] = await provider.visibility(path);
				if (visibility !== 'local') {
					this.updateVisibilityCache(path, {
						visibility: visibility,
						timestamp: Date.now(),
						remotesHash: remotesHash,
					});
				}

				return visibility;
			}

			return visibilityInfo.visibility;
		}

		if (repoPath == null) {
			const repositories = this.openRepositories;
			if (repositories.length === 0) return 'private';

			if (repositories.length === 1) {
				return getRepoVisibility.call(this, repositories[0].path);
			}

			let isPublic = false;
			let isPrivate = false;
			let isLocal = false;

			for await (const result of asSettled(repositories.map(r => getRepoVisibility.call(this, r.path)))) {
				if (result.status !== 'fulfilled') continue;

				if (result.value === 'public') {
					if (isLocal || isPrivate) return 'mixed';

					isPublic = true;
				} else if (result.value === 'local') {
					if (isPublic || isPrivate) return 'mixed';

					isLocal = true;
				} else if (result.value === 'private') {
					if (isPublic || isLocal) return 'mixed';

					isPrivate = true;
				}
			}

			if (isPublic) return 'public';
			if (isLocal) return 'local';
			return 'private';
		}

		return getRepoVisibility.call(this, repoPath);
	}

	private _context: { enabled: boolean; disabled: boolean } = { enabled: false, disabled: false };

	@trace()
	async setEnabledContext(enabled: boolean): Promise<void> {
		let disabled = !enabled;
		// If we think we should be disabled during startup (or while still discovering repositories),
		// check if we have a saved value from the last time this repo was loaded
		if (!enabled && (this._initializing != null || this._discoveringRepositories?.pending)) {
			disabled = !(this.container.storage.getWorkspace('assumeRepositoriesOnStartup') ?? false);
		}

		this.container.telemetry.setGlobalAttribute('enabled', enabled);

		if (this._context.enabled === enabled && this._context.disabled === disabled) return;

		const promises = [];

		if (this._context.enabled !== enabled) {
			this._context.enabled = enabled;
			promises.push(setContext('gitlens:enabled', enabled));
		}

		if (this._context.disabled !== disabled) {
			this._context.disabled = disabled;
			promises.push(setContext('gitlens:disabled', disabled));
		}

		await Promise.allSettled(promises);

		if (this._initializing == null && !this._discoveringRepositories?.pending) {
			void this.container.storage.storeWorkspace('assumeRepositoriesOnStartup', enabled).catch();
		}
	}

	private _sendProviderContextTelemetryDebounced: Deferrable<() => void> | undefined;

	private updateContext(options?: { skipRemotes?: boolean }) {
		if (this.container.deactivating) return;

		const openRepositoryCount = this.openRepositoryCount;
		const hasRepositories = openRepositoryCount !== 0;

		void this.setEnabledContext(hasRepositories);

		// Don't bother trying to set the values if we're still starting up
		if (this._initializing != null) return;

		this.container.telemetry.setGlobalAttributes({
			enabled: hasRepositories,
			'repositories.count': openRepositoryCount,
		});

		if (!hasRepositories) return;

		// The remote/integration scan iterates every open repo and fetches their remotes. Callers
		// that know no remote-affecting change occurred (e.g. a pure-worktree add whose primary is
		// already tracked — the worktree shares the primary's remotes) can pass `skipRemotes: true`
		// to avoid the cascade while still keeping the cheap per-repo-count attributes fresh.
		if (options?.skipRemotes) {
			this._providers.forEach(p => p.updateContext?.());
			return;
		}

		// Don't block for the remote context updates (because it can block other downstream requests during initialization)
		async function updateRemoteContext(this: GitProviderService) {
			const integrations = configuration.get('integrations.enabled');

			const remoteProviders = new Set<string>();
			const reposWithRemotes = new Set<string>();
			const reposWithHostingIntegrations = new Set<string>();
			const reposWithHostingIntegrationsConnected = new Set<string>();

			async function scanRemotes(repo: GlRepository) {
				let hasSupportedIntegration = false;
				let hasConnectedIntegration = false;

				const remotes = await repo.git.remotes.getRemotes();
				for (const remote of remotes) {
					remoteProviders.add(remote.provider?.id ?? 'unknown');
					reposWithRemotes.add(repo.uri.toString());
					reposWithRemotes.add(repo.path);

					// Skip if integrations are disabled or if we've already found a connected integration
					if (!integrations || (hasSupportedIntegration && hasConnectedIntegration)) continue;

					if (remoteSupportsIntegration(remote)) {
						hasSupportedIntegration = true;
						reposWithHostingIntegrations.add(repo.uri.toString());
						reposWithHostingIntegrations.add(repo.path);

						let connected = isRemoteMaybeIntegrationConnected(remote);
						// If we don't know if we are connected, only check if the remote is the default or there is only one
						// TODO@eamodio is the above still a valid requirement?
						if (connected == null && (remote.default || remotes.length === 1)) {
							const integration = await getRemoteIntegration(remote);
							connected = await integration?.isConnected();
						}

						if (connected) {
							hasConnectedIntegration = true;
							reposWithHostingIntegrationsConnected.add(repo.uri.toString());
							reposWithHostingIntegrationsConnected.add(repo.path);
						}
					}
				}
			}

			if (hasRepositories) {
				void (await Promise.allSettled(map(this._repositories.values(), scanRemotes)));
			}

			if (this.container.telemetry.enabled) {
				this.container.telemetry.setGlobalAttributes({
					'repositories.hasRemotes': reposWithRemotes.size !== 0,
					'repositories.hasRichRemotes': reposWithHostingIntegrations.size !== 0,
					'repositories.hasConnectedRemotes': reposWithHostingIntegrationsConnected.size !== 0,

					'repositories.withRemotes': reposWithRemotes.size / 2,
					'repositories.withHostingIntegrations': reposWithHostingIntegrations.size / 2,
					'repositories.withHostingIntegrationsConnected': reposWithHostingIntegrationsConnected.size / 2,

					'repositories.remoteProviders': join(remoteProviders, ','),
				});
				this._sendProviderContextTelemetryDebounced ??= debounce(
					() => this.container.telemetry.sendEvent('providers/context'),
					2500,
				);
				this._sendProviderContextTelemetryDebounced();
			}

			await Promise.allSettled([
				setContext('gitlens:repos:withRemotes', reposWithRemotes.size ? [...reposWithRemotes] : undefined),
				setContext(
					'gitlens:repos:withHostingIntegrations',
					reposWithHostingIntegrations.size ? [...reposWithHostingIntegrations] : undefined,
				),
				setContext(
					'gitlens:repos:withHostingIntegrationsConnected',
					reposWithHostingIntegrationsConnected.size ? [...reposWithHostingIntegrationsConnected] : undefined,
				),
			]);
		}

		void updateRemoteContext.call(this);

		this._providers.forEach(p => p.updateContext?.());
	}

	private getProvider(repoPath: string | Uri): GitProviderResult {
		if (repoPath == null || (typeof repoPath !== 'string' && !this.supportedSchemes.has(repoPath.scheme))) {
			debugger;
			throw new ProviderNotFoundError(repoPath);
		}

		// Determine the scheme for GlGitProvider selection
		let scheme;
		if (typeof repoPath === 'string') {
			scheme = getScheme(repoPath) ?? Schemes.File;
		} else {
			({ scheme } = repoPath);
		}

		// Delegate to the package's GitService for provider routing — this is the
		// single source of truth so extension and package agree on which backend handles a path.
		// Use getRepositoryKey for the canonical string form: file URIs → fsPath, others → toString()
		const pathKey = typeof repoPath === 'string' ? repoPath : getRepositoryKey(repoPath);
		const resolved = this._gitService.getProvider(pathKey);
		if (resolved != null) {
			// Map the package-level provider back to the extension-level GlGitProvider.
			// Multiple GlGitProviders may share the same backing provider (e.g. Local and VSLS
			// both use CliGitProvider with id='git'). Pick the one whose supported schemes
			// include the current scheme so extension-level operations use the right provider.
			let provider = this._providers.get(resolved.provider.descriptor.id);
			if (provider != null && !provider.supportedSchemes.has(scheme)) {
				// The direct id match doesn't support this scheme — scan for one that does
				// (e.g. VSLS path routed to 'git' CliGitProvider, but we need VslsGitProvider)
				for (const p of this._providers.values()) {
					if (p.supportedSchemes.has(scheme)) {
						provider = p;
						break;
					}
				}
			}
			if (provider != null) {
				return { provider: provider, path: provider.canHandlePathOrUri(scheme, repoPath) ?? resolved.path };
			}
		}

		// Fallback: if GitService has no providers registered yet (startup timing),
		// use the extension's own provider iteration
		const possibleResults = new Set<GitProviderResult>();

		for (const provider of this._providers.values()) {
			const path = provider.canHandlePathOrUri(scheme, repoPath);
			if (path == null) continue;

			possibleResults.add({ provider: provider, path: path });
		}

		if (possibleResults.size === 0) {
			debugger;
			throw new ProviderNotFoundError(repoPath);
		}

		// Prefer the provider with an open repository
		if (possibleResults.size > 1) {
			for (const result of possibleResults) {
				if (this.hasOpenRepositories(result.provider.descriptor.id)) {
					return result;
				}
			}
		}

		return first(possibleResults)!;
	}

	getAbsoluteUri(pathOrUri: string | Uri, base?: string | Uri): Uri {
		if (base == null) {
			if (typeof pathOrUri === 'string') {
				if (maybeUri(pathOrUri)) return Uri.parse(pathOrUri, true);

				// I think it is safe to assume this should be file://
				return Uri.file(pathOrUri);
			}

			return pathOrUri;
		}

		// Short-circuit if the base is already a Uri and the path is relative
		if (typeof base !== 'string' && typeof pathOrUri === 'string') {
			const normalized = normalizePath(pathOrUri);
			if (!isAbsolute(normalized)) return Uri.joinPath(base, normalized);
		}

		const { provider } = this.getProvider(base);
		return provider.getAbsoluteUri(pathOrUri, base);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		const { provider } = this.getProvider(pathOrUri instanceof Uri ? pathOrUri : base);
		return provider.getRelativePath(pathOrUri, base);
	}

	@debug()
	getRevisionUriFromGitUri(uri: GitUri): Uri {
		const path = getBestPath(uri);

		const { provider, path: rp } = this.getProvider(uri.repoPath!);
		return provider.getRevisionUri(rp, uri.sha!, provider.getRelativePath(path, rp));
	}

	@debug()
	applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const { provider } = this.getProvider(uri);
		if (provider.applyChangesToWorkingFile == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.applyChangesToWorkingFile(uri, ref1, ref2);
	}

	@debug()
	async clone(url: string, parentPath: string): Promise<string | undefined> {
		const { provider } = this.getProvider(parentPath);
		return provider.clone?.(url, parentPath);
	}

	@debug({ onlyExit: true })
	resetCaches(...types: CachedGitTypes[]): void {
		this.container.events.fire('git:cache:reset', { types: types });
	}

	@debug({ onlyExit: true })
	resetCachesForUri(uri: Uri, ...types: UriScopedCachedGitTypes[]): void {
		const repo = this.getRepository(uri);
		if (repo == null) return;

		const [path] = splitPath(uri, repo.path);
		this.container.events.fire('git:cache:reset', { repoPath: repo.path, types: types, path: path });
	}

	@gate((repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`)
	@debug({ args: repositories => ({ repositories: repositories?.map(r => r.name).join(', ') }) })
	async fetchAll(repositories?: GlRepository[], options?: { all?: boolean; prune?: boolean }): Promise<void> {
		repositories ??= this.openRepositories;
		if (!repositories.length) return;

		if (repositories.length === 1) {
			await repositories[0].git.fetch(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Fetching ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.git.fetch({ progress: false, ...options }))),
		);
	}

	@gate((repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`)
	@debug({ args: repositories => ({ repositories: repositories?.map(r => r.name).join(', ') }) })
	async pullAll(repositories?: GlRepository[], options?: { rebase?: boolean }): Promise<void> {
		repositories ??= this.openRepositories;
		if (!repositories.length) return;

		if (repositories.length === 1) {
			await repositories[0].git.pull(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.git.pull({ progress: false, ...options }))),
		);
	}

	@gate(repos => (repos == null ? '' : repos.map(r => r.id).join(',')))
	@debug({ args: repositories => ({ repositories: repositories?.map(r => r.name).join(', ') }) })
	async pushAll(
		repositories?: GlRepository[],
		options?: {
			force?: boolean;
			reference?: GitReference;
			publish?: {
				remote: string;
			};
		},
	): Promise<void> {
		repositories ??= this.openRepositories;
		if (!repositories.length) return;

		if (repositories.length === 1) {
			await repositories[0].git.push(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pushing ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.git.push({ progress: false, ...options }))),
		);
	}

	@debug({ args: (uri, document) => ({ uri: uri, document: document?.isDirty }) })
	/**
	 * Returns the blame of a file
	 * @param uri Uri of the file to blame
	 * @param document Optional TextDocument to blame the contents of if dirty
	 */
	async getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined> {
		// Check for snapshot first — handles both dirty and recently-saved clean documents.
		// After auto-save, the document is clean but the snapshot holds the correct blame,
		// so we can return it instantly without spawning a git process.
		let doc: TrackedGitDocument | undefined;
		if (document != null) {
			doc = await this.container.documentTracker.getOrAdd(document);
			if (doc?.blameSnapshot != null) {
				if (document.isDirty) {
					const dirtyBlame = doc.blameSnapshot.computeDirtyBlame(document.getText(), document.version);
					this.ensureUncommittedBlameCommit(uri, dirtyBlame);
					return dirtyBlame;
				}
				// Ensure uncommitted commit exists for updated snapshots that may contain uncommitted lines from a previous dirty→save cycle
				this.ensureUncommittedBlameCommit(uri, doc.blameSnapshot.blame);
				return doc.blameSnapshot.blame;
			}
			if (document.isDirty) return this.getBlameContents(uri, document.getText());
		}

		const { provider } = this.getProvider(uri);
		if (!(await provider.isTracked(uri))) return undefined;

		const [path, root] = splitPath(uri, uri.repoPath);
		const blameProvider = this._gitService.forRepo(root)?.blame;
		if (blameProvider == null) return undefined;

		try {
			const start = performance.now();
			const blame = await blameProvider.getBlame(path, uri.sha, undefined, this.getBlameOptions());

			// Create snapshot so it's available for the very next call.
			// The slow HEAD-content fetch (for HEAD-anchored baselines) runs in the background.
			if (blame != null && uri.sha == null && doc != null && doc.blameSnapshot == null) {
				doc.lastBlameDuration = performance.now() - start;
				doc.blameSnapshot = new BlameSnapshot(blame, document!.getText());
				void this.upgradeBlameSnapshotToHead(doc, blame, document!, root, path);
			}

			return blame;
		} catch (ex) {
			this.handleBlameError(ex);
			return undefined;
		}
	}

	/**
	 * Returns a `GitBlameProgressive` that progressively resolves as git blame streams entries.
	 * Subscribe to `onDidProgress` for incremental updates, or `await completed` for the full result.
	 */
	async getBlameProgressive(
		uri: GitUri,
		document?: TextDocument | undefined,
	): Promise<ProgressiveGitBlame | undefined> {
		// If a snapshot exists, skip progressive blame — the snapshot serves blame instantly
		// without spawning a git process. This prevents auto-save thrashing when gutter blame
		// is active with preserveWhileEditing (restore with recompute=true).
		if (document != null) {
			const doc = await this.container.documentTracker.getOrAdd(document);
			if (doc?.blameSnapshot != null) {
				return undefined;
			}
		}

		// Dirty documents go through the existing synchronous blame path (no streaming benefit)
		if (document?.isDirty) return undefined;

		const { provider } = this.getProvider(uri);
		if (!(await provider.isTracked(uri))) return undefined;

		const [path, root] = splitPath(uri, uri.repoPath);
		const svc = this._gitService.forRepo(root);
		if (svc?.blame?.getProgressiveBlame == null) return undefined;

		try {
			return await svc.blame.getProgressiveBlame(path, uri.sha, undefined, this.getBlameOptions());
		} catch (ex) {
			this.handleBlameError(ex);
			return undefined;
		}
	}

	@debug({ args: uri => ({ uri: uri, contents: '<contents>' }) })
	/**
	 * Returns the blame of a file, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param contents Contents from the editor to use
	 */
	async getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		if (!(await provider.isTracked(uri))) return undefined;

		const [path, root] = splitPath(uri, uri.repoPath);
		const blame = this._gitService.forRepo(root)?.blame;
		if (blame == null) return undefined;

		try {
			return await blame.getBlame(path, undefined, contents, this.getBlameOptions());
		} catch (ex) {
			this.handleBlameError(ex);
			return undefined;
		}
	}

	@debug({ args: (uri, editorLine, document) => ({ uri: uri, editorLine: editorLine, document: document?.isDirty }) })
	/**
	 * Returns the blame of a single line
	 * @param uri Uri of the file to blame
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param document Optional TextDocument to blame the contents of if dirty
	 * @param options.forceSingleLine Forces blame to be for the single line (rather than the whole file)
	 */
	async getBlameForLine(
		uri: GitUri,
		editorLine: number,
		document?: TextDocument | undefined,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (document != null) {
			const doc = await this.container.documentTracker.getOrAdd(document);
			if (doc?.blameSnapshot != null) {
				if (document.isDirty) {
					// Try in-memory dirty blame first (Tier 3: per-line, then Tier 4: full diff)

					// Tier 3: fast per-line mapping
					const lineText = document.lineAt(editorLine).text;
					const result = doc.blameSnapshot.getBlameForDirtyLine(editorLine, lineText);
					if (result != null) {
						const commit = doc.blameSnapshot.blame.commits.get(result.sha);
						if (commit != null) {
							const author = doc.blameSnapshot.blame.authors.get(commit.author.name);
							return {
								author: author ? { ...author, lineCount: commit.lines.length } : undefined,
								commit: commit,
								line: result,
							};
						}
						// Uncommitted line from Tier 3
						if (result.sha === uncommitted) {
							const uncommittedCommit = this.ensureUncommittedBlameCommit(uri, doc.blameSnapshot.blame);
							return {
								author: { name: uncommittedCommit.author.name, lineCount: 0, current: true },
								commit: uncommittedCommit,
								line: result,
							};
						}
					}

					// Tier 4: full line-level diff fallback
					const dirtyBlame = doc.blameSnapshot.computeDirtyBlame(document.getText(), document.version);
					this.ensureUncommittedBlameCommit(uri, dirtyBlame);
					return this.resolveBlameLineAt(dirtyBlame, editorLine);
				}

				// Clean with valid snapshot — use snapshot blame directly (no git process)
				// Ensure uncommitted commit exists for updated snapshots
				this.ensureUncommittedBlameCommit(uri, doc.blameSnapshot.blame);
				return this.resolveBlameLineAt(doc.blameSnapshot.blame, editorLine);
			}
			if (document.isDirty) return this.getBlameForLineContents(uri, editorLine, document.getText(), options);
		}

		if (!options?.forceSingleLine) {
			const blame = await this.getBlame(uri, document);
			if (blame == null) return undefined;

			return this.resolveBlameLineAt(blame, editorLine);
		}

		const { provider } = this.getProvider(uri);
		if (!(await provider.isTracked(uri))) return undefined;

		const [path, root] = splitPath(uri, uri.repoPath);
		const blameProvider = this._gitService.forRepo(root)?.blame;
		if (blameProvider == null) return undefined;

		try {
			return await blameProvider.getBlameForLine(path, editorLine, uri.sha, undefined, {
				forceSingleLine: true,
				...this.getBlameOptions(),
			});
		} catch (ex) {
			this.handleBlameError(ex);
			return undefined;
		}
	}

	@debug({ args: (uri, editorLine) => ({ uri: uri, editorLine: editorLine, contents: '<contents>' }) })
	/**
	 * Returns the blame of a single line, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param contents Contents from the editor to use
	 * @param options.forceSingleLine Forces blame to be for the single line (rather than the whole file)
	 */
	async getBlameForLineContents(
		uri: GitUri,
		editorLine: number,
		contents: string,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (!options?.forceSingleLine) {
			const blame = await this.getBlameContents(uri, contents);
			if (blame == null) return undefined;

			let blameLine = blame.lines[editorLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLine) return undefined;
				blameLine = blame.lines[editorLine - 1];
			}

			const commit = blame.commits.get(blameLine.sha);
			if (commit == null) return undefined;

			const author = blame.authors.get(commit.author.name)!;
			return {
				author: { ...author, lineCount: commit.lines.length },
				commit: commit,
				line: blameLine,
			};
		}

		const { provider } = this.getProvider(uri);
		if (!(await provider.isTracked(uri))) return undefined;

		const [path, root] = splitPath(uri, uri.repoPath);
		const blameProvider = this._gitService.forRepo(root)?.blame;
		if (blameProvider == null) return undefined;

		try {
			return await blameProvider.getBlameForLine(path, editorLine, undefined, contents, {
				forceSingleLine: true,
				...this.getBlameOptions(),
			});
		} catch (ex) {
			this.handleBlameError(ex);
			return undefined;
		}
	}

	@debug()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(uri);
		if (blame == null) return undefined;

		return getBlameRange(blame, rangeToLineRange(range));
	}

	@debug({ args: (uri, range) => ({ uri: uri, range: range, contents: '<contents>' }) })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined> {
		const blame = await this.getBlameContents(uri, contents);
		if (blame == null) return undefined;

		return getBlameRange(blame, rangeToLineRange(range));
	}

	@debug({ args: (_blame, _uri, range) => ({ blame: '<blame>', range: range }) })
	getBlameRange(blame: GitBlame, _uri: GitUri, range: Range): GitBlame | undefined {
		return getBlameRange(blame, rangeToLineRange(range));
	}

	private getBlameOptions(): { args: string[] | null | undefined; ignoreWhitespace: boolean | undefined } {
		return {
			args: configuration.get('advanced.blame.customArguments'),
			ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
		};
	}

	/** Resolve a blame line at the given editor line (0-based), handling the off-by-one edge case at EOF */
	private resolveBlameLineAt(
		blame: GitBlame,
		editorLineOrCommitLine: number | GitCommitLine,
	): GitBlameLine | undefined {
		let blameLine: GitCommitLine | undefined;
		if (typeof editorLineOrCommitLine === 'number') {
			blameLine = blame.lines[editorLineOrCommitLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLineOrCommitLine) return undefined;
				blameLine = blame.lines[editorLineOrCommitLine - 1];
			}
		} else {
			blameLine = editorLineOrCommitLine;
		}

		const commit = blame.commits.get(blameLine.sha);
		if (commit == null) return undefined;

		const author = blame.authors.get(commit.author.name);
		return {
			author: author ? { ...author, lineCount: commit.lines.length } : undefined,
			commit: commit,
			line: blameLine,
		};
	}

	private handleBlameError(ex: unknown): void {
		if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
			void showBlameInvalidIgnoreRevsFileWarningMessage(ex);
		} else {
			Logger.error(ex);
		}
	}

	/**
	 * Upgrade a basic snapshot to a HEAD-anchored snapshot in the background.
	 * This allows restored-line attribution (lines edited back to committed content
	 * get the original commit, not "uncommitted").
	 */
	private async upgradeBlameSnapshotToHead(
		doc: TrackedGitDocument,
		blame: GitBlame,
		document: TextDocument,
		root: string,
		path: string,
	): Promise<void> {
		using scope = maybeStartScopedLogger(getLoggableName(this));

		try {
			const versionBefore = document.version;

			const svc = this._gitService.forRepo(root);

			// Only fetch HEAD blame when the working-tree blame has uncommitted lines —
			// those are the lines whose original commit SHAs we can't derive without it.
			const needsHeadBlame = blame.lines.some(l => l.sha === uncommitted);

			const [headBytesResult, headBlameResult] = await Promise.allSettled([
				svc?.revision?.getRevisionContent(path, 'HEAD'),
				needsHeadBlame ? svc?.blame?.getBlame(path, 'HEAD', undefined, this.getBlameOptions()) : undefined,
			]);

			const headBytes = getSettledValue(headBytesResult);
			if (headBytes == null) return;

			const headBlame = getSettledValue(headBlameResult);

			// Abort if the document changed while we were fetching
			if (document.version !== versionBefore) return;

			const encoding = getEncoding(document.uri);
			const headContent =
				encoding === 'utf8'
					? new TextDecoder().decode(headBytes)
					: await workspace.decode(headBytes, { encoding: encoding });
			const docText = document.getText();

			// Only upgrade if HEAD differs from working tree (otherwise basic snapshot is fine)
			if (headContent !== docText) {
				doc.blameSnapshot = BlameSnapshot.fromHead(blame, docText, headContent, headBlame);
			}
		} catch (ex) {
			Logger.error(ex, scope, 'Failed to upgrade blame snapshot to HEAD');
		}
	}

	/** Ensure the blame has a synthetic uncommitted commit (no-op if already present) */
	private ensureUncommittedBlameCommit(uri: GitUri, blame: GitBlame): GitCommit {
		let commit = blame.commits.get(uncommitted);
		if (commit != null) return commit;

		// Derive current user's name/email from an existing blame commit marked as current
		let userName = '';
		let userEmail: string | undefined;
		for (const c of blame.commits.values()) {
			if (c.author.current) {
				userName = c.author.name;
				userEmail = c.author.email;
				break;
			}
		}

		const now = new Date();
		const relativePath = this.getRelativePath(uri, blame.repoPath);
		commit = new GitCommit(
			blame.repoPath,
			uncommitted,
			new GitCommitIdentity(userName, userEmail, now, undefined, true),
			new GitCommitIdentity(userName, userEmail, now, undefined, true),
			'Uncommitted changes',
			[],
			undefined,
			{
				files: undefined,
				filtered: {
					files: [new GitFileChange(blame.repoPath, relativePath, GitFileIndexStatus.Modified, uri)],
					pathspec: relativePath,
				},
			},
		);
		blame.commits.set(uncommitted, commit);
		return commit;
	}

	@debug()
	/**
	 * Returns a file diff between two commits
	 * @param uri Uri of the file to diff
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	async getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
	): Promise<ParsedGitDiffHunks | undefined> {
		const [path, root] = splitPath(uri.fsPath, uri.repoPath);
		const diff = this._gitService.forRepo(root)?.diff;
		if (diff?.getDiffForFile == null) return undefined;

		const encoding = getEncoding(uri);
		return diff.getDiffForFile(path, ref1, ref2, { encoding: encoding });
	}

	@debug({ args: (uri, ref) => ({ uri: uri, ref: ref, contents: '<contents>' }) })
	/**
	 * Returns a file diff between a commit and the specified contents
	 * @param uri Uri of the file to diff
	 * @param ref Commit to diff from
	 * @param contents Contents to use for the diff
	 */
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<ParsedGitDiffHunks | undefined> {
		const [path, root] = splitPath(uri.fsPath, uri.repoPath);
		const diff = this._gitService.forRepo(root)?.diff;
		if (diff?.getDiffForFileContents == null) return undefined;

		const encoding = getEncoding(uri);
		return diff.getDiffForFileContents(path, ref, contents, { encoding: encoding });
	}

	@debug()
	/**
	 * Returns a line diff between two commits
	 * @param uri Uri of the file to diff
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	async getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitLineDiff | undefined> {
		const diff = await this.getDiffForFile(uri, ref1, ref2);
		if (diff == null) return undefined;

		const line = editorLine + 1;
		const hunk = diff.hunks.find(c => c.current.position.start <= line && c.current.position.end >= line);
		if (hunk == null) return undefined;

		const hunkLine = hunk.lines.get(line);
		if (hunkLine == null) return undefined;

		return { hunk: hunk, line: hunkLine };
	}

	getBestRepository(): GlRepository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepository(uri?: Uri, editor?: TextEditor): GlRepository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepository(editor?: TextEditor): GlRepository | undefined;
	@debug({ exit: true })
	getBestRepository(editorOrUri?: TextEditor | Uri, editor?: TextEditor): GlRepository | undefined {
		const count = this.repositoryCount;
		if (count === 0) return undefined;
		if (count === 1) return this.highlander;

		if (editorOrUri != null && editorOrUri instanceof Uri) {
			const repo = this.getRepository(editorOrUri);
			if (repo != null) return repo;

			editorOrUri = undefined;
		}

		editor = editorOrUri ?? editor ?? window.activeTextEditor;
		return (editor != null ? this.getRepository(editor.document.uri) : undefined) ?? this.highlander;
	}

	getBestRepositoryOrFirst(): GlRepository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepositoryOrFirst(uri?: Uri, editor?: TextEditor): GlRepository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepositoryOrFirst(editor?: TextEditor): GlRepository | undefined;
	@debug({ exit: true })
	getBestRepositoryOrFirst(editorOrUri?: TextEditor | Uri, editor?: TextEditor): GlRepository | undefined {
		const count = this.repositoryCount;
		if (count === 0) return undefined;
		if (count === 1) return first(this._repositories.values());

		if (editorOrUri != null && editorOrUri instanceof Uri) {
			const repo = this.getRepository(editorOrUri);
			if (repo != null) return repo;

			editorOrUri = undefined;
		}

		editor = editorOrUri ?? editor ?? window.activeTextEditor;
		return (
			(editor != null ? this.getRepository(editor.document.uri) : undefined) ?? first(this._repositories.values())
		);
	}

	@debug()
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const results = await Promise.allSettled(Array.from(this._providers.values(), p => p.getOpenScmRepositories()));
		const repositories = flatMap<PromiseFulfilledResult<ScmRepository[]>, ScmRepository>(
			filter<PromiseSettledResult<ScmRepository[]>, PromiseFulfilledResult<ScmRepository[]>>(
				results,
				(r): r is PromiseFulfilledResult<ScmRepository[]> => r.status === 'fulfilled',
			),
			r => r.value,
		);
		return [...repositories];
	}

	getOrOpenRepository(
		uri: Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<GlRepository | undefined>;
	getOrOpenRepository(
		path: string,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<GlRepository | undefined>;
	getOrOpenRepository(
		pathOrUri: string | Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<GlRepository | undefined>;
	@debug({ exit: true })
	async getOrOpenRepository(
		pathOrUri?: string | Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<GlRepository | undefined> {
		if (pathOrUri == null) return undefined;

		const scope = getScopedLogger();
		try {
			let uri: Uri;
			if (typeof pathOrUri === 'string') {
				if (!pathOrUri) return undefined;

				uri = this.getAbsoluteUri(pathOrUri);
			} else {
				uri = pathOrUri;
			}

			const path = getBestPath(uri);
			let repository: GlRepository | undefined = this.getRepository(uri);

			if (repository == null && this._discoveringRepositories?.pending) {
				await this._discoveringRepositories.promise;
				repository = this.getRepository(uri);
			}

			let isDirectory: boolean | undefined;

			const detectNested = options?.detectNested ?? configuration.get('detectNestedRepositories', uri);
			if (!detectNested) {
				if (repository != null) return repository;
			} else if (!options?.force) {
				// Check if we've seen this path before
				if (this._searchedRepositoryPaths.has(path)) {
					scope?.trace(`Skipped search as path is known; returning ${Logger.toLoggable(repository)}`);
					return repository;
				}

				try {
					const stats = await workspace.fs.stat(uri);
					// If the uri isn't a directory, go up one level
					if ((stats.type & FileType.Directory) !== FileType.Directory) {
						// Check if we've seen it's parent before, since a file can't be a nested repository
						if (this._searchedRepositoryPaths.hasParent(path)) {
							scope?.trace(
								`Skipped search as path is a file and parent is known; returning ${Logger.toLoggable(repository)}`,
							);
							return repository;
						}

						uri = Uri.joinPath(uri, '..');
						isDirectory = true;
					} else {
						isDirectory = true;
					}
				} catch {}
			}

			const key = asRepoComparisonKey(uri);
			let promise = this._pendingRepositories.get(key);
			if (promise == null) {
				async function findRepository(this: GitProviderService): Promise<GlRepository | undefined> {
					const { provider } = this.getProvider(uri);
					const repoUri = await provider.findRepositoryUri(uri, isDirectory);

					this._searchedRepositoryPaths.set(path, repoUri != null ? getBestPath(repoUri) : undefined);

					if (repoUri == null) return undefined;

					let root: GlRepository | undefined;
					if (this._repositories.count) {
						repository = this._repositories.get(repoUri);
						if (repository != null) return repository;

						// If this new repo is inside one of our known roots and we we don't already know about, add it
						root = this._repositories.getClosest(provider.getAbsoluteUri(uri, repoUri));
					}

					const autoRepositoryDetection = configuration.getCore('git.autoRepositoryDetection') ?? true;

					let closed =
						options?.closeOnOpen ??
						(autoRepositoryDetection !== true && autoRepositoryDetection !== 'openEditors');
					if (!closed && options?.closeOnOpen !== false && !isDirectory) {
						// If we are trying to open a file inside the .git folder or the file is git-ignored, then treat the repository as closed, unless explicitly requested it to be open
						// This avoids showing the root repo in worktrees during certain operations (e.g. rebase) and vice-versa
						if (uri.path.includes('/.git/')) {
							closed = true;
						} else {
							const filteredUris = await provider.excludeIgnoredUris(repoUri.fsPath, [uri]);
							if (!filteredUris.length) {
								scope?.trace(`File is gitignored; treating repository as closed`);
								closed = true;
							}
						}
					}

					scope?.info(`Repository found in '${repoUri.toString(true)}'`);
					const gitDir = await this._gitService.forRepo(repoUri.fsPath)?.config.getGitDir?.();
					if (gitDir == null) {
						scope?.warn(`Unable to get gitDir for '${repoUri.toString(true)}'`);
					}
					const repositories = provider.openRepository(root?.folder, repoUri, gitDir, false, closed);

					const added: GlRepository[] = [];

					for (const repository of repositories) {
						this._repositories.add(repository);
						if (!repository.closed) {
							added.push(repository);
						}
					}

					this._pendingRepositories.delete(key);

					this.updateContext({ skipRemotes: this.allHaveKnownCommonRepo(added) });

					if (added.length) {
						this._etag = Date.now();
						queueMicrotask(() => {
							// Send a notification that the repositories changed
							// Note: fireRepositoriesChanged queues location storage via processPendingRepositoryOperations
							this.fireRepositoriesChanged(added);
						});
					}

					repository = repositories.length === 1 ? repositories[0] : this.getRepository(uri);
					return repository;
				}

				promise = findRepository.call(this);
				this._pendingRepositories.set(key, promise);
			}

			try {
				return await promise;
			} catch (ex) {
				this._pendingRepositories.delete(key);
				throw ex;
			}
		} catch (ex) {
			scope?.error(ex);
			if (ex instanceof ProviderNotFoundError) return undefined;

			debugger;
			throw ex;
		}
	}

	@debug()
	async getOrOpenRepositoryForEditor(editor?: TextEditor): Promise<GlRepository | undefined> {
		editor = editor ?? window.activeTextEditor;
		if (editor == null) return this.highlander;

		const scope = getScopedLogger();
		try {
			return await this.getOrOpenRepository(editor.document.uri);
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	getRepository(uri: Uri): GlRepository | undefined;
	getRepository(path: string): GlRepository | undefined;
	getRepository(pathOrUri: string | Uri): GlRepository | undefined;
	@debug({ exit: true })
	getRepository(pathOrUri?: string | Uri): GlRepository | undefined {
		if (this.repositoryCount === 0) return undefined;
		if (pathOrUri == null) return undefined;

		if (typeof pathOrUri === 'string') {
			if (!pathOrUri) return undefined;

			return this._repositories.getClosest(this.getAbsoluteUri(pathOrUri));
		}
		return this._repositories.getClosest(pathOrUri);
	}

	private _repositoryServices = new Map<GlGitProvider, Map<string, GitRepositoryService>>();

	private removeRepositoryService(repoPath: string): void {
		for (const services of this._repositoryServices.values()) {
			if (services.delete(repoPath)) break;
		}
	}

	getRepositoryService(repoPath: string | Uri): GitRepositoryService {
		const { provider, path } = this.getProvider(repoPath);

		let services = this._repositoryServices.get(provider);
		if (services == null) {
			services = new Map<string, GitRepositoryService>();
			this._repositoryServices.set(provider, services);
		}

		let service = services.get(path);
		if (service == null) {
			const repoService = this._gitService.forRepo(path);
			if (repoService == null) {
				throw new Error(`RepositoryService not available for '${path}' — provider may not be registered`);
			}
			service = new GitRepositoryService(this, provider, path, repoService, this.container.events);
			services.set(path, service);
		}
		return service;
	}

	@debug()
	async getLocalInfoFromRemoteUri(uri: Uri): Promise<LocalInfoFromRemoteUriResult | undefined> {
		for (const repo of this.openRepositories) {
			for (const remote of await repo.git.remotes.getRemotes()) {
				if (remote?.provider == null) continue;

				const local = await resolveLocalInfoFromRemoteUri(remote.provider, repo, uri);
				if (local != null) return local;
			}
		}

		return undefined;
	}

	@debug({ exit: true })
	hasUnsafeRepositories(): boolean {
		for (const provider of this._providers.values()) {
			if (provider.hasUnsafeRepositories?.()) return true;
		}
		return false;
	}

	isRepositoryPathOrUri(uri: Uri): boolean;
	isRepositoryPathOrUri(path: string): boolean;
	isRepositoryPathOrUri(pathOrUri: string | Uri): boolean;
	@debug({ exit: true })
	isRepositoryPathOrUri(pathOrUri: string | Uri): boolean {
		if (typeof pathOrUri === 'string') {
			return this.getRepository(pathOrUri)?.path === pathOrUri;
		}
		return areUrisEqual(pathOrUri, this.getRepository(pathOrUri)?.uri);
	}

	@debug({ exit: true })
	isRepositoryForEditor(repository: GlRepository, editor?: TextEditor): boolean {
		editor = editor ?? window.activeTextEditor;
		if (editor == null) return false;

		return repository === this.getRepository(editor.document.uri);
	}

	isTrackable(uri: Uri): boolean {
		if (!this.supportedSchemes.has(uri.scheme)) return false;

		const { provider } = this.getProvider(uri);
		return provider.isTrackable(uri);
	}

	async isTracked(uri: Uri): Promise<boolean> {
		if (!this.supportedSchemes.has(uri.scheme)) return false;

		const { provider } = this.getProvider(uri);
		return provider.isTracked(uri);
	}

	@gate(repos => repos.map(r => r.id).join(','))
	@debug()
	async storeRepositoriesLocation(repos: GlRepository[]): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.container.repositoryIdentity.storeRepositoryLocations(repos);
		} catch (ex) {
			scope?.error(ex);
		}
	}
}

function getEncoding(uri: Uri): string {
	return configuration.getCore('files.encoding', uri) ?? 'utf8';
}

function createWatchingProvider(): FileWatchingProvider {
	return {
		createWatcher: function (
			basePath: string,
			pattern: string,
			onEvent: (event: FileWatchEvent) => void,
		): FileWatcher {
			const uri = coerceUri(basePath);
			const watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, pattern));

			const disposable = Disposable.from(
				watcher,
				watcher.onDidChange(e => onEvent({ path: e.fsPath, reason: 'change' })),
				watcher.onDidCreate(e => onEvent({ path: e.fsPath, reason: 'create' })),
				watcher.onDidDelete(e => onEvent({ path: e.fsPath, reason: 'delete' })),
			);

			return createDisposable(() => void disposable.dispose());
		},
	};
}
