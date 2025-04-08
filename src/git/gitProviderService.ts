import type {
	CancellationToken,
	ConfigurationChangeEvent,
	Event,
	Range,
	TextDocument,
	TextEditor,
	WindowState,
	WorkspaceFolder,
	WorkspaceFoldersChangeEvent,
} from 'vscode';
import { Disposable, EventEmitter, FileType, ProgressLocation, Uri, window, workspace } from 'vscode';
import { isWeb } from '@env/platform';
import { resetAvatarCache } from '../avatars';
import { GlyphChars, Schemes } from '../constants';
import { SubscriptionPlanId } from '../constants.subscription';
import type { Container } from '../container';
import { AccessDeniedError, ProviderNotFoundError, ProviderNotSupportedError } from '../errors';
import type { FeatureAccess, Features, PlusFeatures, RepoFeatureAccess } from '../features';
import { isAdvancedFeature, isProFeatureOnAllRepos } from '../features';
import type { Subscription } from '../plus/gk/models/subscription';
import type { SubscriptionChangeEvent } from '../plus/gk/subscriptionService';
import { isSubscriptionPaidPlan } from '../plus/gk/utils/subscription.utils';
import type { RepoComparisonKey } from '../repositories';
import { asRepoComparisonKey, Repositories } from '../repositories';
import { registerCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { setContext } from '../system/-webview/context';
import { getBestPath } from '../system/-webview/path';
import { joinUnique } from '../system/array';
import { gate } from '../system/decorators/-webview/gate';
import { debug, log } from '../system/decorators/log';
import type { Deferrable } from '../system/function/debounce';
import { debounce } from '../system/function/debounce';
import { count, filter, first, flatMap, groupByFilterMap, groupByMap, join, map, some, sum } from '../system/iterable';
import { getLoggableName, Logger } from '../system/logger';
import { getLogScope, setLogScopeExit, startLogScope } from '../system/logger.scope';
import { getScheme, isAbsolute, maybeUri, normalizePath } from '../system/path';
import type { Deferred } from '../system/promise';
import { asSettled, defer, getDeferredPromiseIfPending, getSettledValue } from '../system/promise';
import { VisitedPathsTrie } from '../system/trie';
import type {
	CachedGitTypes,
	GitBranchesSubProvider,
	GitCommitsSubProvider,
	GitConfigSubProvider,
	GitContributorsSubProvider,
	GitDiffSubProvider,
	GitGraphSubProvider,
	GitPatchSubProvider,
	GitProvider,
	GitProviderDescriptor,
	GitProviderId,
	GitRefsSubProvider,
	GitRemotesSubProvider,
	GitRevisionSubProvider,
	GitStagingSubProvider,
	GitStashSubProvider,
	GitStatusSubProvider,
	GitSubProviderForRepo,
	GitSubProviderProps,
	GitTagsSubProvider,
	GitWorktreesSubProvider,
	NonNullableGitSubProviderProps,
	RepositoryVisibility,
	RepositoryVisibilityInfo,
	ScmRepository,
} from './gitProvider';
import { createSubProviderProxyForRepo } from './gitProvider';
import type { GitUri } from './gitUri';
import type { GitBlame, GitBlameLine } from './models/blame';
import type { GitBranch } from './models/branch';
import type { GitLineDiff, ParsedGitDiffHunks } from './models/diff';
import type { GitFile } from './models/file';
import type { GitBranchReference, GitReference } from './models/reference';
import type { GitRemote } from './models/remote';
import type { Repository, RepositoryChangeEvent } from './models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from './models/repository';
import { deletedOrMissing } from './models/revision';
import type { GitTag } from './models/tag';
import type { LocalInfoFromRemoteUriResult } from './remotes/remoteProvider';
import { sortRepositories } from './utils/-webview/sorting';
import { calculateDistribution } from './utils/contributor.utils';
import { getRemoteThemeIconString, getVisibilityCacheKey } from './utils/remote.utils';
import { createRevisionRange } from './utils/revision.utils';

const emptyArray = Object.freeze([]) as unknown as any[];
const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

const maxDefaultBranchWeight = 100;
const weightedDefaultBranches = new Map<string, number>([
	['master', maxDefaultBranchWeight],
	['main', 15],
	['default', 10],
	['develop', 5],
	['development', 1],
]);

export type GitProvidersChangeEvent = {
	readonly added: readonly GitProvider[];
	readonly removed: readonly GitProvider[];
	readonly etag: number;
};

export type RepositoriesChangeEvent = {
	readonly added: readonly Repository[];
	readonly removed: readonly Repository[];
	readonly etag: number;
};

export interface GitProviderResult {
	provider: GitProvider;
	path: string;
}

export type RepositoriesVisibility = RepositoryVisibility | 'mixed';

export class GitProviderService implements Disposable {
	private readonly _onDidChangeProviders = new EventEmitter<GitProvidersChangeEvent>();
	get onDidChangeProviders(): Event<GitProvidersChangeEvent> {
		return this._onDidChangeProviders.event;
	}

	@debug<GitProviderService['fireProvidersChanged']>({
		args: {
			0: added => `(${added?.length ?? 0}) ${added?.map(p => p.descriptor.id).join(', ')}`,
			1: removed => `(${removed?.length ?? 0}) ${removed?.map(p => p.descriptor.id).join(', ')}`,
		},
	})
	private fireProvidersChanged(added?: GitProvider[], removed?: GitProvider[]) {
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

	@debug<GitProviderService['fireRepositoriesChanged']>({
		args: {
			0: added => `(${added?.length ?? 0}) ${added?.map(r => r.id).join(', ')}`,
			1: removed => `(${removed?.length ?? 0}) ${removed?.map(r => r.id).join(', ')}`,
		},
	})
	private fireRepositoriesChanged(added?: Repository[], removed?: Repository[]) {
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

		this.clearAccessCache();
		this._reposVisibilityCache = undefined;

		this._onDidChangeRepositories.fire({ added: added ?? [], removed: removed ?? [], etag: this._etag });

		if (added?.length && this.container.telemetry.enabled) {
			setTimeout(() => {
				void Promise.allSettled(
					added.map(async repo => {
						const since = '1.year.ago';
						const [remotesResult, contributorsStatsResult] = await Promise.allSettled([
							repo.git.remotes().getRemotes(),
							repo.git.contributors().getContributorsStats({ since: since }),
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
							'repository.contributors.commits.count': commits,
							'repository.contributors.commits.avgPerContributor': avgPerContributor,
							'repository.contributors.count': stats?.count,
							'repository.contributors.since': since,
							...distribution,
						});
					}),
				);
			}, 0);
		}
	}

	private readonly _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	readonly supportedSchemes = new Set<string>();

	private readonly _disposable: Disposable;
	private _initializing: Deferred<number> | undefined;
	private readonly _pendingRepositories = new Map<RepoComparisonKey, Promise<Repository | undefined>>();
	private readonly _providers = new Map<GitProviderId, GitProvider>();
	private readonly _repositories = new Repositories();
	private readonly _visitedPaths = new VisitedPathsTrie();

	constructor(private readonly container: Container) {
		this._initializing = defer<number>();
		this._disposable = Disposable.from(
			this._onDidChangeProviders,
			this._onDidChangeRepositories,
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
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

	dispose(): void {
		this._disposable.dispose();
		this._providers.clear();

		this._repositories.forEach(r => r.dispose());
		this._repositories.clear();
	}

	private _etag: number = 0;
	get etag(): number {
		return this._etag;
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

		if (e != null && configuration.changed(e, 'integrations.enabled')) {
			this.updateContext();
		}
	}

	private registerCommands(): Disposable[] {
		return [registerCommand('gitlens.plus.refreshRepositoryAccess', () => this.clearAllOpenRepoVisibilityCaches())];
	}

	@debug()
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		this.clearAccessCache();
		this._subscription = e.current;
	}

	@debug<GitProviderService['onWindowStateChanged']>({ args: { 0: e => `focused=${e.focused}` } })
	private onWindowStateChanged(e: WindowState) {
		if (e.focused) {
			this._repositories.forEach(r => r.resume());
		} else {
			this._repositories.forEach(r => r.suspend());
		}
	}

	@debug<GitProviderService['onWorkspaceFoldersChanged']>({
		args: { 0: e => `added=${e.added.length}, removed=${e.removed.length}` },
		singleLine: true,
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
		}

		if (e.removed.length) {
			this._etag = Date.now();
			const removed: Repository[] = [];

			for (const folder of e.removed) {
				const repository = this._repositories.getClosest(folder.uri);
				if (repository != null) {
					this._repositories.remove(repository.uri, false);
					removed.push(repository);
				}
			}

			if (removed.length) {
				this.updateContext();

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

	get openRepositories(): Repository[] {
		if (this.repositoryCount === 0) return emptyArray as Repository[];

		const repositories = [...filter(this.repositories, r => !r.closed)];
		if (repositories.length === 0) return repositories;

		return sortRepositories(repositories);
	}

	get openRepositoryCount(): number {
		return this.repositoryCount === 0 ? 0 : count(this.repositories, r => !r.closed);
	}

	get repositories(): IterableIterator<Repository> {
		return this._repositories.values();
	}

	get repositoryCount(): number {
		return this._repositories.count;
	}

	get highlander(): Repository | undefined {
		return this.repositoryCount === 1 || this.openRepositoryCount === 1
			? first(this._repositories.values())
			: undefined;
	}

	// get readonly() {
	// 	return true;
	// 	// return this.container.vsls.readonly;
	// }

	/**
	 * Registers a {@link GitProvider}
	 * @param id A unique identifier for the provider
	 * @param name A name for the provider
	 * @param provider A provider for handling git operations
	 * @returns A disposable to unregister the {@link GitProvider}
	 */
	@log({ args: { 1: false }, singleLine: true })
	register(id: GitProviderId, provider: GitProvider): Disposable {
		if (id !== provider.descriptor.id) {
			throw new Error(`Id '${id}' must match provider id '${provider.descriptor.id}'`);
		}
		if (this._providers.has(id)) throw new Error(`Provider '${id}' has already been registered`);

		this._providers.set(id, provider);
		for (const scheme of provider.supportedSchemes) {
			this.supportedSchemes.add(scheme);
		}

		const disposables = [];

		const watcher = provider.openRepositoryInitWatcher?.();
		if (watcher != null) {
			disposables.push(
				watcher,
				watcher.onDidCreate(uri => {
					const f = workspace.getWorkspaceFolder(uri);
					if (f == null) return;

					void this.discoverRepositories([f], { force: true });
				}),
			);
		}

		const disposable = Disposable.from(
			provider,
			...disposables,
			provider.onDidChange(() => {
				this._etag = Date.now();
				using scope = startLogScope(`${getLoggableName(provider)}.onDidChange`, false);
				Logger.debug(scope, '');

				const { workspaceFolders } = workspace;
				if (workspaceFolders?.length) {
					void this.discoverRepositories(workspaceFolders, { force: true });
				}
			}),
			provider.onDidChangeRepository(async e => {
				this._etag = Date.now();
				using scope = startLogScope(
					`${getLoggableName(provider)}.onDidChangeRepository(e=${e.repository.toString()})`,
					false,
				);
				Logger.debug(scope, '');

				if (e.changed(RepositoryChange.Closed, RepositoryChangeComparisonMode.Any)) {
					this.updateContext();

					// Send a notification that the repositories changed
					queueMicrotask(() => this.fireRepositoriesChanged([], [e.repository]));
				} else if (e.changed(RepositoryChange.Opened, RepositoryChangeComparisonMode.Any)) {
					this.updateContext();

					// Send a notification that the repositories changed
					queueMicrotask(() => this.fireRepositoriesChanged([e.repository], []));
				}

				if (e.changed(RepositoryChange.Remotes, RepositoryChangeComparisonMode.Any)) {
					const visibilityInfo = this.getVisibilityInfoFromCache(e.repository.path);
					if (visibilityInfo != null) {
						await this.checkVisibilityCachedRemotes(e.repository.path, visibilityInfo, () =>
							provider.remotes.getRemotes(e.repository.path),
						);
					}
				}

				this._onDidChangeRepository.fire(e);
			}),
			provider.onDidCloseRepository(e => {
				this._etag = Date.now();
				const repository = this._repositories.get(e.uri);
				using scope = startLogScope(
					`${getLoggableName(provider)}.onDidCloseRepository(e=${e.uri.toString()})`,
					false,
				);
				Logger.debug(scope, `repository=${repository?.toString()}`);

				if (repository != null) {
					repository.closed = true;
				}
			}),
			provider.onDidOpenRepository(e => {
				this._etag = Date.now();
				const repository = this._repositories.get(e.uri);
				using scope = startLogScope(
					`${getLoggableName(provider)}.onDidOpenRepository(e=${e.uri.toString()})`,
					false,
				);
				Logger.debug(scope, `repository=${repository?.toString()}`);

				if (repository != null) {
					repository.closed = false;
				} else {
					void this.getOrOpenRepository(e.uri);
				}
			}),
		);

		this._etag = Date.now();
		this.fireProvidersChanged([provider]);

		// Don't kick off the discovery if we're still initializing (we'll do it at the end for all "known" providers)
		if (this._initializing == null) {
			this.onWorkspaceFoldersChanged({ added: workspace.workspaceFolders ?? [], removed: [] });
		}

		return {
			dispose: () => {
				this._etag = Date.now();
				disposable.dispose();
				this._providers.delete(id);

				const removed: Repository[] = [];

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
			},
		};
	}

	@log({ singleLine: true })
	async registrationComplete(): Promise<void> {
		const scope = getLogScope();

		let { workspaceFolders } = workspace;
		if (workspaceFolders?.length) {
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

		setLogScopeExit(
			scope,
			` ${GlyphChars.Dot} repositories=${this.repositoryCount}, workspaceFolders=${workspaceFolders?.length}, git.autoRepositoryDetection=${autoRepositoryDetection}`,
		);
	}

	getOpenProviders(): GitProvider[] {
		const map = this.getOpenRepositoriesByProvider();
		return [...map.keys()].map(id => this._providers.get(id)!);
	}

	getOpenRepositories(id: GitProviderId): Iterable<Repository> {
		return filter(this.repositories, r => !r.closed && (id == null || id === r.provider.id));
	}

	getOpenRepositoriesByProvider(): Map<GitProviderId, Repository[]> {
		const repositories = [...filter(this.repositories, r => !r.closed)];
		if (repositories.length === 0) return new Map();

		return groupByMap(repositories, r => r.provider.id);
	}

	hasOpenRepositories(id: GitProviderId): boolean {
		return some(this.repositories, r => !r.closed && (id == null || id === r.provider.id));
	}

	private _discoveredWorkspaceFolders = new Map<WorkspaceFolder, Promise<Repository[]>>();

	private _discoveringRepositories: Deferred<number> | undefined;
	get isDiscoveringRepositories(): Promise<number> | undefined {
		return (
			getDeferredPromiseIfPending(this._discoveringRepositories) ??
			getDeferredPromiseIfPending(this._initializing)
		);
	}

	@log<GitProviderService['discoverRepositories']>({ args: { 0: folders => folders.length } })
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

			const repositories = flatMap<PromiseFulfilledResult<Repository[]>, Repository>(
				filter<PromiseSettledResult<Repository[]>, PromiseFulfilledResult<Repository[]>>(
					results,
					(r): r is PromiseFulfilledResult<Repository[]> => r.status === 'fulfilled',
				),
				r => r.value,
			);

			const added: Repository[] = [];

			for (const repository of repositories) {
				this._repositories.add(repository);
				if (!repository.closed) {
					added.push(repository);
				}
			}

			this.updateContext();

			if (added.length) {
				this._etag = Date.now();
				queueMicrotask(() => {
					void this.storeRepositoriesLocation(added);
					// Defer the event trigger enough to let everything unwind
					this.fireRepositoriesChanged(added);
				});
			}
		} finally {
			queueMicrotask(() => {
				deferred.fulfill(this._etag);
			});
		}
	}

	@debug({ exit: true })
	private async discoverRepositoriesCore(folder: WorkspaceFolder): Promise<Repository[]> {
		const { provider } = this.getProvider(folder.uri);

		try {
			return await provider.discoverRepositories(folder.uri);
		} catch (ex) {
			this._discoveredWorkspaceFolders.delete(folder);

			Logger.error(
				ex,
				`${provider.descriptor.name} Provider(${
					provider.descriptor.id
				}) failed discovering repositories in ${folder.uri.toString(true)}`,
			);

			return [];
		}
	}

	@log()
	async findRepositories(
		uri: Uri,
		options?: { cancellation?: CancellationToken; depth?: number; silent?: boolean },
	): Promise<Repository[]> {
		const { provider } = this.getProvider(uri);
		return provider.discoverRepositories(uri, options);
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
	@debug({ exit: true })
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
	@debug({ exit: true })
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
			return { allowed: false, subscription: { current: subscription, required: SubscriptionPlanId.Pro } };
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
								subscription: { current: subscription, required: SubscriptionPlanId.Pro },
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
						subscription: { current: subscription, required: SubscriptionPlanId.Pro },
						visibility: 'private',
					};
				case 'mixed':
					return {
						allowed: 'mixed',
						subscription: { current: subscription, required: SubscriptionPlanId.Pro },
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

	@debug({ exit: true })
	supports(repoPath: string | Uri, feature: Features): Promise<boolean> {
		const { provider } = this.getProvider(repoPath);
		return provider.supports(feature);
	}

	private _reposVisibilityCache: RepositoriesVisibility | undefined;
	private _repoVisibilityCache: Map<string, RepositoryVisibilityInfo> | undefined;

	private ensureRepoVisibilityCache(): void {
		if (this._repoVisibilityCache == null) {
			const repoVisibility: [string, RepositoryVisibilityInfo][] | undefined = this.container.storage
				.get('repoVisibility')
				?.map<[string, RepositoryVisibilityInfo]>(([key, visibilityInfo]) => [
					key,
					{
						visibility: visibilityInfo.visibility as RepositoryVisibility,
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

			const repoVisibility = Array.from(this._repoVisibilityCache?.entries() ?? []);
			if (repoVisibility.length === 0) {
				await this.container.storage.delete('repoVisibility');
			} else {
				await this.container.storage.store('repoVisibility', repoVisibility);
			}
		}
	}

	@debug<GitProviderService['getVisibilityInfoFromCache']>({ exit: r => `returned ${r?.visibility}` })
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
		void this.container.storage.store('repoVisibility', Array.from(this._repoVisibilityCache!.entries())).catch();
	}

	@debug()
	clearAllRepoVisibilityCaches(): Promise<void> {
		return this.clearRepoVisibilityCache();
	}

	@debug()
	clearAllOpenRepoVisibilityCaches(): Promise<void> {
		const openRepoProviderPaths = this.openRepositories.map(r => this.getProvider(r.path).path);
		return this.clearRepoVisibilityCache(openRepoProviderPaths);
	}

	visibility(): Promise<RepositoriesVisibility>;
	visibility(repoPath: string | Uri): Promise<RepositoryVisibility>;
	@debug({ exit: true })
	async visibility(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		if (repoPath == null) {
			let visibility = this._reposVisibilityCache;
			if (visibility == null) {
				visibility = await this.visibilityCore();
				if (this.container.telemetry.enabled) {
					this.container.telemetry.setGlobalAttribute('repositories.visibility', visibility);
					this.container.telemetry.sendEvent('repositories/visibility', {
						'repositories.visibility': visibility,
					});
				}
				this._reposVisibilityCache = visibility;
			}
			return visibility;
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
	@debug({ exit: true })
	private async visibilityCore(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		async function getRepoVisibility(
			this: GitProviderService,
			repoPath: string | Uri,
		): Promise<RepositoryVisibility> {
			const { provider, path } = this.getProvider(repoPath);
			const visibilityInfo = this.getVisibilityInfoFromCache(path);
			if (
				visibilityInfo == null ||
				!(await this.checkVisibilityCachedRemotes(path, visibilityInfo, () =>
					provider.remotes.getRemotes(path, { sort: true }),
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

	@debug()
	async setEnabledContext(enabled: boolean): Promise<void> {
		let disabled = !enabled;
		// If we think we should be disabled during startup, check if we have a saved value from the last time this repo was loaded
		if (!enabled && this._initializing != null) {
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

		if (this._initializing == null) {
			void this.container.storage.storeWorkspace('assumeRepositoriesOnStartup', enabled).catch();
		}
	}

	private _sendProviderContextTelemetryDebounced: Deferrable<() => void> | undefined;

	private updateContext() {
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

		// Don't block for the remote context updates (because it can block other downstream requests during initialization)
		async function updateRemoteContext(this: GitProviderService) {
			const integrations = configuration.get('integrations.enabled');

			const remoteProviders = new Set<string>();
			const reposWithRemotes = new Set<string>();
			const reposWithHostingIntegrations = new Set<string>();
			const reposWithHostingIntegrationsConnected = new Set<string>();

			async function scanRemotes(repo: Repository) {
				let hasSupportedIntegration = false;
				let hasConnectedIntegration = false;

				const remotes = await repo.git.remotes().getRemotes();
				for (const remote of remotes) {
					remoteProviders.add(remote.provider?.id ?? 'unknown');
					reposWithRemotes.add(repo.uri.toString());
					reposWithRemotes.add(repo.path);

					// Skip if integrations are disabled or if we've already found a connected integration
					if (!integrations || (hasSupportedIntegration && hasConnectedIntegration)) continue;

					if (remote.hasIntegration()) {
						hasSupportedIntegration = true;
						reposWithHostingIntegrations.add(repo.uri.toString());
						reposWithHostingIntegrations.add(repo.path);

						let connected = remote.maybeIntegrationConnected;
						// If we don't know if we are connected, only check if the remote is the default or there is only one
						// TODO@eamodio is the above still a valid requirement?
						if (connected == null && (remote.default || remotes.length === 1)) {
							const integration = await remote.getIntegration();
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
				if (this._sendProviderContextTelemetryDebounced == null) {
					this._sendProviderContextTelemetryDebounced = debounce(
						() => this.container.telemetry.sendEvent('providers/context'),
						2500,
					);
				}
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

		let scheme;
		if (typeof repoPath === 'string') {
			scheme = getScheme(repoPath) ?? Schemes.File;
		} else {
			({ scheme } = repoPath);
		}

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

	@log()
	async getBestRevisionUri(
		repoPath: string | Uri | undefined,
		path: string,
		rev: string | undefined,
	): Promise<Uri | undefined> {
		if (repoPath == null || rev === deletedOrMissing) return undefined;

		const { provider, path: rp } = this.getProvider(repoPath);
		return provider.getBestRevisionUri(rp, provider.getRelativePath(path, rp), rev);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		const { provider } = this.getProvider(pathOrUri instanceof Uri ? pathOrUri : base);
		return provider.getRelativePath(pathOrUri, base);
	}

	@log()
	getRevisionUri(repoPath: string | Uri, rev: string, pathOrFile: string | GitFile): Uri {
		const path = typeof pathOrFile === 'string' ? pathOrFile : pathOrFile?.originalPath ?? pathOrFile?.path ?? '';

		const { provider, path: rp } = this.getProvider(repoPath);
		return provider.getRevisionUri(rp, rev, provider.getRelativePath(path, rp));
	}

	@log()
	getRevisionUriFromGitUri(uri: GitUri): Uri {
		const path = getBestPath(uri);

		const { provider, path: rp } = this.getProvider(uri.repoPath!);
		return provider.getRevisionUri(rp, uri.sha!, provider.getRelativePath(path, rp));
	}

	@log()
	getWorkingUri(repoPath: string | Uri, uri: Uri): Promise<Uri | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getWorkingUri(path, uri);
	}

	@log()
	async reset(
		repoPath: string | Uri,
		options: { hard?: boolean } | { soft?: boolean } = {},
		ref: string,
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.reset == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.reset(path, ref, options);
	}

	@log()
	applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const { provider } = this.getProvider(uri);
		if (provider.applyChangesToWorkingFile == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.applyChangesToWorkingFile(uri, ref1, ref2);
	}

	@log()
	checkout(
		repoPath: string | Uri,
		ref: string,
		options?: { createBranch?: string } | { path?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.checkout == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.checkout(path, ref, options);
	}

	@log()
	async clone(url: string, parentPath: string): Promise<string | undefined> {
		const { provider } = this.getProvider(parentPath);
		return provider.clone?.(url, parentPath);
	}

	@log({ singleLine: true })
	resetCaches(...types: CachedGitTypes[]): void {
		this.container.events.fire('git:cache:reset', { types: types });
	}

	@log<GitProviderService['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	excludeIgnoredUris(repoPath: string | Uri, uris: Uri[]): Promise<Uri[]> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.excludeIgnoredUris(path, uris);
	}

	@gate()
	@log()
	fetch(
		repoPath: string | Uri,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.fetch == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.fetch(path, options);
	}

	@gate<GitProviderService['fetchAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log<GitProviderService['fetchAll']>({ args: { 0: repos => repos?.map(r => r.name).join(', ') } })
	async fetchAll(repositories?: Repository[], options?: { all?: boolean; prune?: boolean }): Promise<void> {
		if (repositories == null) {
			repositories = this.openRepositories;
		}
		if (repositories.length === 0) return;

		if (repositories.length === 1) {
			await repositories[0].fetch(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Fetching ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.fetch({ progress: false, ...options }))),
		);
	}

	@gate()
	@log()
	pull(repoPath: string | Uri, options?: { rebase?: boolean; tags?: boolean }): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.pull == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.pull(path, options);
	}

	@gate<GitProviderService['pullAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log<GitProviderService['pullAll']>({ args: { 0: repos => repos?.map(r => r.name).join(', ') } })
	async pullAll(repositories?: Repository[], options?: { rebase?: boolean }): Promise<void> {
		if (repositories == null) {
			repositories = this.openRepositories;
		}
		if (repositories.length === 0) return;

		if (repositories.length === 1) {
			await repositories[0].pull(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.pull({ progress: false, ...options }))),
		);
	}

	@gate()
	@log()
	push(
		repoPath: string | Uri,
		options?: { reference?: GitReference; force?: boolean; publish?: { remote: string } },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		if (provider.push == null) throw new ProviderNotSupportedError(provider.descriptor.name);

		return provider.push(path, options);
	}

	@gate<GitProviderService['pushAll']>(repos => (repos == null ? '' : repos.map(r => r.id).join(',')))
	@log<GitProviderService['pushAll']>({ args: { 0: repos => repos?.map(r => r.name).join(', ') } })
	async pushAll(
		repositories?: Repository[],
		options?: {
			force?: boolean;
			reference?: GitReference;
			publish?: {
				remote: string;
			};
		},
	): Promise<void> {
		if (repositories == null) {
			repositories = this.openRepositories;
		}
		if (repositories.length === 0) return;

		if (repositories.length === 1) {
			await repositories[0].push(options);

			return;
		}

		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pushing ${repositories.length} repositories`,
			},
			() => Promise.allSettled(repositories.map(r => r.push({ progress: false, ...options }))),
		);
	}

	@log<GitProviderService['getBlame']>({ args: { 1: d => d?.isDirty } })
	/**
	 * Returns the blame of a file
	 * @param uri Uri of the file to blame
	 * @param document Optional TextDocument to blame the contents of if dirty
	 */
	async getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlame(uri, document);
	}

	@log<GitProviderService['getBlameContents']>({ args: { 1: '<contents>' } })
	/**
	 * Returns the blame of a file, using the editor contents (for dirty editors)
	 * @param uri Uri of the file to blame
	 * @param contents Contents from the editor to use
	 */
	async getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameContents(uri, contents);
	}

	@log<GitProviderService['getBlameForLine']>({ args: { 2: d => d?.isDirty } })
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
		const { provider } = this.getProvider(uri);
		return provider.getBlameForLine(uri, editorLine, document, options);
	}

	@log<GitProviderService['getBlameForLineContents']>({ args: { 2: '<contents>' } })
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
		const { provider } = this.getProvider(uri);
		return provider.getBlameForLineContents(uri, editorLine, contents, options);
	}

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRange(uri, range);
	}

	@log<GitProviderService['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRangeContents(uri, range, contents);
	}

	@log<GitProviderService['getBlameRange']>({ args: { 0: '<blame>' } })
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlame | undefined {
		const { provider } = this.getProvider(uri);
		return provider.getBlameRange(blame, uri, range);
	}

	@log<GitProviderService['getBranchAheadRange']>({ args: { 0: b => b.name } })
	async getBranchAheadRange(branch: GitBranch): Promise<string | undefined> {
		if (branch.upstream?.state.ahead) {
			return createRevisionRange(branch.upstream?.name, branch.ref, '..');
		}

		if (branch.upstream == null) {
			// If we have no upstream branch, try to find a best guess branch to use as the "base"
			const { values: branches } = await this.branches(branch.repoPath).getBranches({
				filter: b => weightedDefaultBranches.has(b.name),
			});
			if (branches.length > 0) {
				let weightedBranch: { weight: number; branch: GitBranch } | undefined;
				for (const branch of branches) {
					const weight = weightedDefaultBranches.get(branch.name)!;
					if (weightedBranch == null || weightedBranch.weight < weight) {
						weightedBranch = { weight: weight, branch: branch };
					}

					if (weightedBranch.weight === maxDefaultBranchWeight) break;
				}

				const possibleBranch = weightedBranch!.branch.upstream?.name ?? weightedBranch!.branch.ref;
				if (possibleBranch !== branch.ref) {
					return createRevisionRange(possibleBranch, branch.ref, '..');
				}
			}
		}

		return undefined;
	}

	@log()
	async getBranchesAndTagsTipsLookup(
		repoPath: string | Uri | undefined,
		suppressName?: string,
	): Promise<
		(
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		) => string | undefined
	> {
		if (repoPath == null) return () => undefined;

		type Tip = {
			name: string;
			icon: string;
			compactName: string | undefined;
			type: 'branch' | 'tag';
		};

		const [branchesResult, tagsResult, remotesResult] = await Promise.allSettled([
			this.branches(repoPath).getBranches(),
			this.tags(repoPath).getTags(),
			this.remotes(repoPath).getRemotes(),
		]);

		const branches = getSettledValue(branchesResult)?.values ?? [];
		const tags = getSettledValue(tagsResult)?.values ?? [];
		const remotes = getSettledValue(remotesResult) ?? [];

		const branchesAndTagsBySha = groupByFilterMap(
			(branches as (GitBranch | GitTag)[]).concat(tags as (GitBranch | GitTag)[]),
			bt => bt.sha,
			bt => {
				let icon;
				if (bt.refType === 'branch') {
					if (bt.remote) {
						const remote = remotes.find(r => r.name === bt.getRemoteName());
						icon = `$(${getRemoteThemeIconString(remote)}) `;
					} else {
						icon = bt.current ? '$(target) ' : '$(git-branch) ';
					}
				} else {
					icon = '$(tag) ';
				}

				return {
					name: bt.name,
					icon: icon,
					compactName:
						suppressName && bt.refType === 'branch' && bt.getNameWithoutRemote() === suppressName
							? bt.getRemoteName()
							: undefined,
					type: bt.refType,
				} satisfies Tip;
			},
		);

		return (
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		): string | undefined => {
			const branchesAndTags = branchesAndTagsBySha.get(sha);
			if (!branchesAndTags?.length) return undefined;

			const tips =
				suppressName && options?.compact
					? branchesAndTags.filter(bt => bt.name !== suppressName)
					: branchesAndTags;

			function getIconAndLabel(tip: Tip) {
				const label = (options?.compact ? tip.compactName : undefined) ?? tip.name;
				return `${options?.icons ? `${tip.icon}${options?.pills ? '&nbsp;' : ' '}` : ''}${label}`;
			}

			let results;
			if (options?.compact) {
				if (!tips.length) return undefined;

				const [bt] = tips;
				results = [`${getIconAndLabel(bt)}${tips.length > 1 ? `, ${GlyphChars.Ellipsis}` : ''}`];
			} else {
				results = tips.map(getIconAndLabel);
			}

			if (options?.pills) {
				return results
					.map(
						t =>
							/*html*/ `<span style="color:#ffffff;background-color:#1d76db;border-radius:3px;"${
								typeof options.pills === 'object' ? ` class="${options.pills.cssClass}"` : ''
							}>&nbsp;${t}&nbsp;&nbsp;</span>`,
					)
					.join('&nbsp;&nbsp;');
			}
			return results.join(', ');
		};
	}

	@log()
	/**
	 * Returns a file diff between two commits
	 * @param uri Uri of the file to diff
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<ParsedGitDiffHunks | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForFile(uri, ref1, ref2);
	}

	@log<GitProviderService['getDiffForFileContents']>({ args: { 1: '<contents>' } })
	/**
	 * Returns a file diff between a commit and the specified contents
	 * @param uri Uri of the file to diff
	 * @param ref Commit to diff from
	 * @param contents Contents to use for the diff
	 */
	getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<ParsedGitDiffHunks | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForFileContents(uri, ref, contents);
	}

	@log()
	/**
	 * Returns a line diff between two commits
	 * @param uri Uri of the file to diff
	 * @param editorLine Editor line number (0-based) to blame (Git is 1-based)
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitLineDiff | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForLine(uri, editorLine, ref1, ref2);
	}

	@debug()
	getLastFetchedTimestamp(repoPath: string | Uri): Promise<number | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLastFetchedTimestamp(path);
	}

	getBestRepository(): Repository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepository(uri?: Uri, editor?: TextEditor): Repository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepository(editor?: TextEditor): Repository | undefined;
	@log({ exit: true })
	getBestRepository(editorOrUri?: TextEditor | Uri, editor?: TextEditor): Repository | undefined {
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

	getBestRepositoryOrFirst(): Repository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepositoryOrFirst(uri?: Uri, editor?: TextEditor): Repository | undefined;
	// eslint-disable-next-line @typescript-eslint/unified-signatures
	getBestRepositoryOrFirst(editor?: TextEditor): Repository | undefined;
	@log({ exit: true })
	getBestRepositoryOrFirst(editorOrUri?: TextEditor | Uri, editor?: TextEditor): Repository | undefined {
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

	getOrOpenRepository(
		uri: Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<Repository | undefined>;
	getOrOpenRepository(
		path: string,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<Repository | undefined>;
	getOrOpenRepository(
		pathOrUri: string | Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<Repository | undefined>;
	@log({ exit: true })
	async getOrOpenRepository(
		pathOrUri?: string | Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean; force?: boolean },
	): Promise<Repository | undefined> {
		if (pathOrUri == null) return undefined;

		const scope = getLogScope();

		let uri: Uri;
		if (typeof pathOrUri === 'string') {
			if (!pathOrUri) return undefined;

			uri = this.getAbsoluteUri(pathOrUri);
		} else {
			uri = pathOrUri;
		}

		const path = getBestPath(uri);
		let repository: Repository | undefined;
		repository = this.getRepository(uri);

		if (repository == null && this._discoveringRepositories?.pending) {
			await this._discoveringRepositories.promise;
			repository = this.getRepository(uri);
		}

		let isDirectory: boolean | undefined;

		const detectNested = options?.detectNested ?? configuration.get('detectNestedRepositories', uri);
		if (!detectNested) {
			if (repository != null) return repository;
		} else if (!options?.force && this._visitedPaths.has(path)) {
			return repository;
		} else {
			const stats = await workspace.fs.stat(uri);

			const bestPath = getBestPath(uri);

			Logger.debug(
				scope,
				`Ensuring URI is a folder; repository=${repository?.toString()}, uri=${uri.toString(true)} stats.type=${
					stats.type
				}, bestPath=${bestPath}, visitedPaths.has=${this._visitedPaths.has(bestPath)}`,
			);

			// If the uri isn't a directory, go up one level
			if ((stats.type & FileType.Directory) !== FileType.Directory) {
				uri = Uri.joinPath(uri, '..');
				if (!options?.force && this._visitedPaths.has(bestPath)) return repository;
			}

			isDirectory = true;
		}

		const key = asRepoComparisonKey(uri);
		let promise = this._pendingRepositories.get(key);
		if (promise == null) {
			async function findRepository(this: GitProviderService): Promise<Repository | undefined> {
				const { provider } = this.getProvider(uri);
				const repoUri = await provider.findRepositoryUri(uri, isDirectory);

				this._visitedPaths.set(path);

				if (repoUri == null) return undefined;

				let root: Repository | undefined;
				if (this._repositories.count !== 0) {
					repository = this._repositories.get(repoUri);
					if (repository != null) return repository;

					// If this new repo is inside one of our known roots and we we don't already know about, add it
					root = this._repositories.getClosest(provider.getAbsoluteUri(uri, repoUri));
				}

				const autoRepositoryDetection = configuration.getCore('git.autoRepositoryDetection') ?? true;

				let closed =
					options?.closeOnOpen ??
					(autoRepositoryDetection !== true && autoRepositoryDetection !== 'openEditors');
				// If we are trying to open a file inside the .git folder, then treat the repository as closed, unless explicitly requested it to be open
				// This avoids showing the root repo in worktrees during certain operations (e.g. rebase) and vice-versa
				if (!closed && options?.closeOnOpen !== false && !isDirectory && uri.path.includes('/.git/')) {
					closed = true;
				}

				Logger.log(scope, `Repository found in '${repoUri.toString(true)}'`);
				const repositories = provider.openRepository(root?.folder, repoUri, false, undefined, closed);

				const added: Repository[] = [];

				for (const repository of repositories) {
					this._repositories.add(repository);
					if (!repository.closed) {
						added.push(repository);
					}
				}

				this._pendingRepositories.delete(key);

				this.updateContext();

				if (added.length) {
					this._etag = Date.now();
					queueMicrotask(() => {
						void this.storeRepositoriesLocation(added);
						// Send a notification that the repositories changed
						this.fireRepositoriesChanged(added);
					});
				}

				repository = repositories.length === 1 ? repositories[0] : this.getRepository(uri);
				return repository;
			}

			promise = findRepository.call(this);
			this._pendingRepositories.set(key, promise);
		}

		return promise;
	}

	@gate()
	@log()
	async storeRepositoriesLocation(repos: Repository[]): Promise<void> {
		const scope = getLogScope();
		for (const repo of repos) {
			try {
				await this.container.repositoryIdentity.storeRepositoryLocation(repo);
			} catch (ex) {
				Logger.error(ex, scope);
			}
		}
	}

	@log()
	async getOrOpenRepositoryForEditor(editor?: TextEditor): Promise<Repository | undefined> {
		editor = editor ?? window.activeTextEditor;

		if (editor == null) return this.highlander;

		return this.getOrOpenRepository(editor.document.uri);
	}

	getRepository(uri: Uri): Repository | undefined;
	getRepository(path: string): Repository | undefined;
	getRepository(pathOrUri: string | Uri): Repository | undefined;
	@log({ exit: true })
	getRepository(pathOrUri?: string | Uri): Repository | undefined {
		if (this.repositoryCount === 0) return undefined;
		if (pathOrUri == null) return undefined;

		if (typeof pathOrUri === 'string') {
			if (!pathOrUri) return undefined;

			return this._repositories.getClosest(this.getAbsoluteUri(pathOrUri));
		}

		return this._repositories.getClosest(pathOrUri);
	}

	async getLocalInfoFromRemoteUri(uri: Uri): Promise<LocalInfoFromRemoteUriResult | undefined> {
		for (const repo of this.openRepositories) {
			for (const remote of await repo.git.remotes().getRemotes()) {
				const local = await remote?.provider?.getLocalInfoFromRemoteUri(repo, uri);
				if (local != null) return local;
			}
		}

		return undefined;
	}

	@log({ exit: true })
	async getUniqueRepositoryId(repoPath: string | Uri): Promise<string | undefined> {
		return this.commits(repoPath).getInitialCommitSha?.();
	}

	@log({ exit: true })
	hasUnsafeRepositories(): boolean {
		for (const provider of this._providers.values()) {
			if (provider.hasUnsafeRepositories?.()) return true;
		}
		return false;
	}

	@log({ exit: true })
	isRepositoryForEditor(repository: Repository, editor?: TextEditor): boolean {
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

	@log({ args: false })
	async runGitCommandViaTerminal(
		repoPath: string | Uri,
		command: string,
		args: string[],
		options?: { execute?: boolean },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.runGitCommandViaTerminal?.(path, command, args, options);
	}

	private readonly _subProviderProxies = new Map<GitProvider, Map<string, GitSubProviderForRepo<any>>>();

	private getSubProviderProxy<T extends NonNullableGitSubProviderProps>(
		repoPath: string | Uri,
		prop: T,
	): GitSubProviderForRepo<GitProvider[T]>;
	private getSubProviderProxy<T extends GitSubProviderProps>(
		repoPath: string | Uri,
		prop: T,
	): GitSubProviderForRepo<NonNullable<GitProvider[T]>> | undefined;
	private getSubProviderProxy<T extends GitSubProviderProps>(
		repoPath: string | Uri,
		prop: T,
	): GitSubProviderForRepo<NonNullable<GitProvider[T]>> | undefined {
		const { provider, path } = this.getProvider(repoPath);

		let proxies = this._subProviderProxies.get(provider);
		if (proxies == null) {
			proxies = new Map();
			this._subProviderProxies.set(provider, proxies);
		}

		const key = `${prop}|${path}`;
		let proxy = proxies.get(key);
		if (proxy == null) {
			const subProvider = provider[prop];
			if (subProvider == null) return undefined;

			proxy = createSubProviderProxyForRepo(subProvider, path);
			proxies.set(key, proxy);
		}

		return proxy;
	}

	@log({ singleLine: true })
	branches(repoPath: string | Uri): GitSubProviderForRepo<GitBranchesSubProvider> {
		return this.getSubProviderProxy(repoPath, 'branches');
	}

	@log({ singleLine: true })
	commits(repoPath: string | Uri): GitSubProviderForRepo<GitCommitsSubProvider> {
		return this.getSubProviderProxy(repoPath, 'commits');
	}

	@log({ singleLine: true })
	config(repoPath: string | Uri): GitSubProviderForRepo<GitConfigSubProvider> {
		return this.getSubProviderProxy(repoPath, 'config');
	}

	@log({ singleLine: true })
	contributors(repoPath: string | Uri): GitSubProviderForRepo<GitContributorsSubProvider> {
		return this.getSubProviderProxy(repoPath, 'contributors');
	}

	@log({ singleLine: true })
	diff(repoPath: string | Uri): GitSubProviderForRepo<GitDiffSubProvider> {
		return this.getSubProviderProxy(repoPath, 'diff');
	}

	@log({ singleLine: true })
	graph(repoPath: string | Uri): GitSubProviderForRepo<GitGraphSubProvider> {
		return this.getSubProviderProxy(repoPath, 'graph');
	}

	@log({ singleLine: true })
	patch(repoPath: string | Uri): GitSubProviderForRepo<GitPatchSubProvider> | undefined {
		return this.getSubProviderProxy(repoPath, 'patch');
	}

	@log({ singleLine: true })
	refs(repoPath: string | Uri): GitSubProviderForRepo<GitRefsSubProvider> {
		return this.getSubProviderProxy(repoPath, 'refs');
	}

	@log({ singleLine: true })
	remotes(repoPath: string | Uri): GitSubProviderForRepo<GitRemotesSubProvider> {
		return this.getSubProviderProxy(repoPath, 'remotes');
	}

	@log({ singleLine: true })
	revision(repoPath: string | Uri): GitSubProviderForRepo<GitRevisionSubProvider> {
		return this.getSubProviderProxy(repoPath, 'revision');
	}

	@log({ singleLine: true })
	staging(repoPath: string | Uri): GitSubProviderForRepo<GitStagingSubProvider> | undefined {
		return this.getSubProviderProxy(repoPath, 'staging');
	}

	@log({ singleLine: true })
	stash(repoPath: string | Uri): GitSubProviderForRepo<GitStashSubProvider> | undefined {
		return this.getSubProviderProxy(repoPath, 'stash');
	}

	@log({ singleLine: true })
	status(repoPath: string | Uri): GitSubProviderForRepo<GitStatusSubProvider> {
		return this.getSubProviderProxy(repoPath, 'status');
	}

	@log({ singleLine: true })
	tags(repoPath: string | Uri): GitSubProviderForRepo<GitTagsSubProvider> {
		return this.getSubProviderProxy(repoPath, 'tags');
	}

	@log({ singleLine: true })
	worktrees(repoPath: string | Uri): GitSubProviderForRepo<GitWorktreesSubProvider> | undefined {
		return this.getSubProviderProxy(repoPath, 'worktrees');
	}

	@log()
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const results = await Promise.allSettled([...this._providers.values()].map(p => p.getOpenScmRepositories()));
		const repositories = flatMap<PromiseFulfilledResult<ScmRepository[]>, ScmRepository>(
			filter<PromiseSettledResult<ScmRepository[]>, PromiseFulfilledResult<ScmRepository[]>>(
				results,
				(r): r is PromiseFulfilledResult<ScmRepository[]> => r.status === 'fulfilled',
			),
			r => r.value,
		);
		return [...repositories];
	}

	@log()
	getScmRepository(repoPath: string | Uri): Promise<ScmRepository | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getScmRepository(path);
	}

	@log()
	getOrOpenScmRepository(repoPath: string | Uri): Promise<ScmRepository | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getOrOpenScmRepository(path);
	}
}
