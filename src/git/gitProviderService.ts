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
import { resetAvatarCache } from '../avatars';
import { ContextKeys, CoreGitConfiguration, GlyphChars, Schemes } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { AccessDeniedError, ProviderNotFoundError } from '../errors';
import type { FeatureAccess, Features, PlusFeatures, RepoFeatureAccess } from '../features';
import type { SubscriptionChangeEvent } from '../plus/subscription/subscriptionService';
import type { RepoComparisonKey } from '../repositories';
import { asRepoComparisonKey, Repositories } from '../repositories';
import type { Subscription } from '../subscription';
import { isSubscriptionPaidPlan, SubscriptionPlanId } from '../subscription';
import { groupByFilterMap, groupByMap, joinUnique } from '../system/array';
import { configuration } from '../system/configuration';
import { gate } from '../system/decorators/gate';
import { debug, log } from '../system/decorators/log';
import { count, filter, first, flatMap, join, map, some } from '../system/iterable';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import { getBestPath, getScheme, isAbsolute, maybeUri, normalizePath } from '../system/path';
import { cancellable, fastestSettled, getSettledValue, isPromise, PromiseCancelledError } from '../system/promise';
import { VisitedPathsTrie } from '../system/trie';
import type {
	GitCaches,
	GitDir,
	GitProvider,
	GitProviderDescriptor,
	GitProviderId,
	NextComparisonUrisResult,
	PagedResult,
	PreviousComparisonUrisResult,
	PreviousLineComparisonUrisResult,
	ScmRepository,
} from './gitProvider';
import { RepositoryVisibility } from './gitProvider';
import type { GitUri } from './gitUri';
import type { GitBlame, GitBlameLine, GitBlameLines } from './models/blame';
import type { BranchSortOptions, GitBranch } from './models/branch';
import { GitCommit, GitCommitIdentity } from './models/commit';
import { deletedOrMissing, uncommitted, uncommittedStaged } from './models/constants';
import type { GitContributor } from './models/contributor';
import type { GitDiff, GitDiffFilter, GitDiffHunkLine, GitDiffShortStat } from './models/diff';
import type { GitFile } from './models/file';
import type { GitGraph } from './models/graph';
import type { SearchedIssue } from './models/issue';
import type { GitLog } from './models/log';
import type { GitMergeStatus } from './models/merge';
import type { PullRequest, PullRequestState, SearchedPullRequest } from './models/pullRequest';
import type { GitRebaseStatus } from './models/rebase';
import type { GitBranchReference, GitReference } from './models/reference';
import { createRevisionRange, isSha, isUncommitted, isUncommittedParent } from './models/reference';
import type { GitReflog } from './models/reflog';
import { GitRemote } from './models/remote';
import type { RepositoryChangeEvent } from './models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from './models/repository';
import type { GitStash } from './models/stash';
import type { GitStatus, GitStatusFile } from './models/status';
import type { GitTag, TagSortOptions } from './models/tag';
import type { GitTreeEntry } from './models/tree';
import type { GitUser } from './models/user';
import type { GitWorktree } from './models/worktree';
import type { RemoteProvider } from './remotes/remoteProvider';
import type { RemoteProviders } from './remotes/remoteProviders';
import type { RichRemoteProvider } from './remotes/richRemoteProvider';
import type { GitSearch, SearchQuery } from './search';

const emptyArray = Object.freeze([]) as unknown as any[];
const maxDefaultBranchWeight = 100;
const weightedDefaultBranches = new Map<string, number>([
	['master', maxDefaultBranchWeight],
	['main', 15],
	['default', 10],
	['develop', 5],
	['development', 1],
]);

const defaultRepositoryId = '0';

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

export const enum RepositoriesVisibility {
	Private = 'private',
	Public = 'public',
	Local = 'local',
	Mixed = 'mixed',
}

export class GitProviderService implements Disposable {
	private readonly _onDidChangeProviders = new EventEmitter<GitProvidersChangeEvent>();
	get onDidChangeProviders(): Event<GitProvidersChangeEvent> {
		return this._onDidChangeProviders.event;
	}
	private fireProvidersChanged(added?: GitProvider[], removed?: GitProvider[]) {
		this.container.telemetry.setGlobalAttributes({
			'providers.count': this._providers.size,
			'providers.ids': join(this._providers.keys(), ','),
		});
		this.container.telemetry.sendEvent('providers/changed', {
			'providers.added': added?.length ?? 0,
			'providers.removed': removed?.length ?? 0,
		});

		this._etag = Date.now();

		this._onDidChangeProviders.fire({ added: added ?? [], removed: removed ?? [], etag: this._etag });
	}

	private _onDidChangeRepositories = new EventEmitter<RepositoriesChangeEvent>();
	get onDidChangeRepositories(): Event<RepositoriesChangeEvent> {
		return this._onDidChangeRepositories.event;
	}
	private fireRepositoriesChanged(added?: Repository[], removed?: Repository[]) {
		const openSchemes = this.openRepositories.map(r => r.uri.scheme);
		this.container.telemetry.setGlobalAttributes({
			'repositories.count': openSchemes.length,
			'repositories.schemes': joinUnique(openSchemes, ','),
		});
		this.container.telemetry.sendEvent('repositories/changed', {
			'repositories.added': added?.length ?? 0,
			'repositories.removed': removed?.length ?? 0,
		});

		this._etag = Date.now();

		this._accessCache.clear();
		this._visibilityCache.delete(undefined);
		if (removed?.length) {
			this._visibilityCache.clear();
		}
		this._onDidChangeRepositories.fire({ added: added ?? [], removed: removed ?? [], etag: this._etag });

		if (added?.length) {
			queueMicrotask(() => {
				for (const repo of added) {
					this.container.telemetry.sendEvent('repository/opened', {
						'repository.id': repo.idHash,
						'repository.scheme': repo.uri.scheme,
						'repository.closed': repo.closed,
						'repository.folder.scheme': repo.folder?.uri.scheme,
						'repository.provider.id': repo.provider.id,
					});
				}
			});
		}
	}

	private readonly _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	readonly supportedSchemes = new Set<string>();

	private readonly _disposable: Disposable;
	private readonly _pendingRepositories = new Map<RepoComparisonKey, Promise<Repository | undefined>>();
	private readonly _providers = new Map<GitProviderId, GitProvider>();
	private readonly _repositories = new Repositories();
	private readonly _bestRemotesCache: Map<RepoComparisonKey, GitRemote<RemoteProvider | RichRemoteProvider> | null> &
		Map<`rich|${RepoComparisonKey}`, GitRemote<RichRemoteProvider> | null> &
		Map<`rich+connected|${RepoComparisonKey}`, GitRemote<RichRemoteProvider> | null> = new Map();
	private readonly _visitedPaths = new VisitedPathsTrie();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.subscription.onDidChange(this.onSubscriptionChanged, this),
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			container.richRemoteProviders.onDidChangeConnectionState(e => {
				if (e.reason === 'connected') {
					resetAvatarCache('failed');
				}

				this.resetCaches('providers');
				this.updateContext();
			}),
		);

		this.container.BranchDateFormatting.reset();
		this.container.CommitDateFormatting.reset();
		this.container.CommitShaFormatting.reset();
		this.container.PullRequestDateFormatting.reset();

		this.updateContext();
	}

	dispose() {
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

	@debug()
	onSubscriptionChanged(e: SubscriptionChangeEvent) {
		this._accessCache.clear();
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
		const schemes = workspace.workspaceFolders?.map(f => f.uri.scheme);
		this.container.telemetry.setGlobalAttributes({
			'folders.count': schemes?.length ?? 0,
			'folders.schemes': schemes != null ? joinUnique(schemes, ', ') : '',
		});

		if (e.added.length) {
			void this.discoverRepositories(e.added);
		}

		if (e.removed.length) {
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

		return Repository.sort(repositories);
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
		return this.repositoryCount === 1 ? first(this._repositories.values()) : undefined;
	}

	// get readonly() {
	// 	return true;
	// 	// return this.container.vsls.readonly;
	// }

	// get useCaching() {
	// 	return configuration.get('advanced.caching.enabled');
	// }

	/**
	 * Registers a {@link GitProvider}
	 * @param id A unique indentifier for the provider
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
			provider.onDidChangeRepository(e => {
				if (
					e.changed(
						RepositoryChange.Remotes,
						RepositoryChange.RemoteProviders,
						RepositoryChangeComparisonMode.Any,
					)
				) {
					this._bestRemotesCache.clear();
				}

				if (e.changed(RepositoryChange.Closed, RepositoryChangeComparisonMode.Any)) {
					this.updateContext();

					// Send a notification that the repositories changed
					queueMicrotask(() => this.fireRepositoriesChanged([], [e.repository]));
				}

				this._visibilityCache.delete(e.repository.path);
				this._onDidChangeRepository.fire(e);
			}),
			provider.onDidCloseRepository(e => {
				const repository = this._repositories.get(e.uri);
				if (repository != null) {
					repository.closed = true;
				}
			}),
			provider.onDidOpenRepository(e => {
				const repository = this._repositories.get(e.uri);
				if (repository != null) {
					repository.closed = false;
				} else {
					void this.getOrOpenRepository(e.uri);
				}
			}),
		);

		this.fireProvidersChanged([provider]);

		// Don't kick off the discovery if we're still initializing (we'll do it at the end for all "known" providers)
		if (!this._initializing) {
			this.onWorkspaceFoldersChanged({ added: workspace.workspaceFolders ?? [], removed: [] });
		}

		return {
			dispose: () => {
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

	private _initializing: boolean = true;

	@log({ singleLine: true })
	registrationComplete() {
		const scope = getLogScope();

		this._initializing = false;

		const { workspaceFolders } = workspace;
		if (workspaceFolders?.length) {
			void this.discoverRepositories(workspaceFolders);
		} else {
			this.updateContext();
		}

		const autoRepositoryDetection = configuration.getAny<boolean | 'subFolders' | 'openEditors'>(
			CoreGitConfiguration.AutoRepositoryDetection,
		);

		queueMicrotask(() =>
			this.container.telemetry.sendEvent('providers/registrationComplete', {
				'config.git.autoRepositoryDetection': autoRepositoryDetection,
			}),
		);

		if (scope != null) {
			scope.exitDetails = ` ${GlyphChars.Dot} workspaceFolders=${workspaceFolders?.length}, git.autoRepositoryDetection=${autoRepositoryDetection}`;
		}
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

	@log<GitProviderService['discoverRepositories']>({ args: { 0: folders => folders.length } })
	async discoverRepositories(folders: readonly WorkspaceFolder[], options?: { force?: boolean }): Promise<void> {
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
			if (this._repositories.add(repository)) {
				added.push(repository);
			}
		}

		this.updateContext();

		if (added.length === 0) return;

		// Defer the event trigger enough to let everything unwind
		queueMicrotask(() => this.fireRepositoriesChanged(added));
	}

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

	private _subscription: Subscription | undefined;
	private async getSubscription(): Promise<Subscription> {
		return this._subscription ?? (this._subscription = await this.container.subscription.getSubscription());
	}

	private _accessCache: Map<string, Promise<RepoFeatureAccess>> &
		Map<undefined, Promise<FeatureAccess | RepoFeatureAccess>> = new Map();
	async access(feature: PlusFeatures | undefined, repoPath: string | Uri): Promise<RepoFeatureAccess>;
	async access(feature?: PlusFeatures, repoPath?: string | Uri): Promise<FeatureAccess | RepoFeatureAccess>;
	async access(feature?: PlusFeatures, repoPath?: string | Uri): Promise<FeatureAccess | RepoFeatureAccess> {
		if (repoPath == null) {
			let access = this._accessCache.get(undefined);
			if (access == null) {
				access = this.accessCore(feature, repoPath);
				this._accessCache.set(undefined, access);
			}
			return access;
		}

		const { path } = this.getProvider(repoPath);
		const cacheKey = path;

		let access = this._accessCache.get(cacheKey);
		if (access == null) {
			access = this.accessCore(feature, repoPath);
			this._accessCache.set(cacheKey, access);
		}

		return access;
	}

	private async accessCore(feature: PlusFeatures | undefined, repoPath: string | Uri): Promise<RepoFeatureAccess>;
	private async accessCore(
		feature?: PlusFeatures,
		repoPath?: string | Uri,
	): Promise<FeatureAccess | RepoFeatureAccess>;
	@debug()
	private async accessCore(
		_feature?: PlusFeatures,
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

		function getRepoAccess(
			this: GitProviderService,
			repoPath: string | Uri,
			force: boolean = false,
		): Promise<RepoFeatureAccess> {
			const { path: cacheKey } = this.getProvider(repoPath);

			let access = force ? undefined : this._accessCache.get(cacheKey);
			if (access == null) {
				access = this.visibility(repoPath).then(
					visibility => {
						if (visibility === RepositoryVisibility.Private) {
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

				this._accessCache.set(cacheKey, access);
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
				case RepositoriesVisibility.Private:
					return {
						allowed: false,
						subscription: { current: subscription, required: SubscriptionPlanId.Pro },
						visibility: RepositoryVisibility.Private,
					};
				case RepositoriesVisibility.Mixed:
					return {
						allowed: 'mixed',
						subscription: { current: subscription, required: SubscriptionPlanId.Pro },
					};
				default:
					return {
						allowed: true,
						subscription: { current: subscription },
						visibility: RepositoryVisibility.Public,
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

	supports(repoPath: string | Uri, feature: Features): Promise<boolean> {
		const { provider } = this.getProvider(repoPath);
		return provider.supports(feature);
	}

	private _visibilityCache: Map<undefined, Promise<RepositoriesVisibility>> &
		Map<string, Promise<RepositoryVisibility>> = new Map();
	visibility(): Promise<RepositoriesVisibility>;
	visibility(repoPath: string | Uri): Promise<RepositoryVisibility>;
	async visibility(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		if (repoPath == null) {
			let visibility = this._visibilityCache.get(undefined);
			if (visibility == null) {
				visibility = this.visibilityCore();
				void visibility.then(v => {
					this.container.telemetry.setGlobalAttribute('repositories.visibility', v);
					this.container.telemetry.sendEvent('repositories/visibility');
				});
				this._visibilityCache.set(undefined, visibility);
			}
			return visibility;
		}

		const { path: cacheKey } = this.getProvider(repoPath);

		let visibility = this._visibilityCache.get(cacheKey);
		if (visibility == null) {
			visibility = this.visibilityCore(repoPath);
			void visibility.then(v =>
				queueMicrotask(() => {
					const repo = this.getRepository(repoPath);
					this.container.telemetry.sendEvent('repository/visibility', {
						'repository.visibility': v,
						'repository.id': repo?.idHash,
						'repository.scheme': repo?.uri.scheme,
						'repository.closed': repo?.closed,
						'repository.folder.scheme': repo?.folder?.uri.scheme,
						'repository.provider.id': repo?.provider.id,
					});
				}),
			);
			this._visibilityCache.set(cacheKey, visibility);
		}
		return visibility;
	}

	private visibilityCore(): Promise<RepositoriesVisibility>;
	private visibilityCore(repoPath: string | Uri): Promise<RepositoryVisibility>;
	@debug()
	private async visibilityCore(repoPath?: string | Uri): Promise<RepositoriesVisibility | RepositoryVisibility> {
		function getRepoVisibility(this: GitProviderService, repoPath: string | Uri): Promise<RepositoryVisibility> {
			const { provider, path } = this.getProvider(repoPath);

			let visibility = this._visibilityCache.get(path);
			if (visibility == null) {
				visibility = provider.visibility(path);
				this._visibilityCache.set(path, visibility);
			}

			return visibility;
		}

		if (repoPath == null) {
			const repositories = this.openRepositories;
			if (repositories.length === 0) return RepositoriesVisibility.Private;

			if (repositories.length === 1) {
				return getRepoVisibility.call(this, repositories[0].path);
			}

			let isPublic = false;
			let isPrivate = false;
			let isLocal = false;

			for await (const result of fastestSettled(repositories.map(r => getRepoVisibility.call(this, r.path)))) {
				if (result.status !== 'fulfilled') continue;

				if (result.value === RepositoryVisibility.Public) {
					if (isLocal || isPrivate) return RepositoriesVisibility.Mixed;

					isPublic = true;
				} else if (result.value === RepositoryVisibility.Local) {
					if (isPublic || isPrivate) return RepositoriesVisibility.Mixed;

					isLocal = true;
				} else if (result.value === RepositoryVisibility.Private) {
					if (isPublic || isLocal) return RepositoriesVisibility.Mixed;

					isPrivate = true;
				}
			}

			if (isPublic) return RepositoriesVisibility.Public;
			if (isLocal) return RepositoriesVisibility.Local;
			return RepositoriesVisibility.Private;
		}

		return getRepoVisibility.call(this, repoPath);
	}

	private _context: { enabled: boolean; disabled: boolean } = { enabled: false, disabled: false };

	@debug()
	async setEnabledContext(enabled: boolean): Promise<void> {
		let disabled = !enabled;
		// If we think we should be disabled during startup, check if we have a saved value from the last time this repo was loaded
		if (!enabled && this._initializing) {
			disabled = !(this.container.storage.getWorkspace('assumeRepositoriesOnStartup') ?? true);
		}

		this.container.telemetry.setGlobalAttribute('enabled', enabled);

		if (this._context.enabled === enabled && this._context.disabled === disabled) return;

		const promises = [];

		if (this._context.enabled !== enabled) {
			this._context.enabled = enabled;
			promises.push(setContext(ContextKeys.Enabled, enabled));
		}

		if (this._context.disabled !== disabled) {
			this._context.disabled = disabled;
			promises.push(setContext(ContextKeys.Disabled, disabled));
		}

		await Promise.allSettled(promises);

		if (!this._initializing) {
			void this.container.storage.storeWorkspace('assumeRepositoriesOnStartup', enabled).catch();
		}
	}

	private updateContext() {
		if (this.container.deactivating) return;

		const openRepositoryCount = this.openRepositoryCount;
		const hasRepositories = openRepositoryCount !== 0;

		void this.setEnabledContext(hasRepositories);

		// Don't bother trying to set the values if we're still starting up
		if (this._initializing) return;

		this.container.telemetry.setGlobalAttributes({
			enabled: hasRepositories,
			'repositories.count': openRepositoryCount,
		});

		if (!hasRepositories) return;

		// Don't block for the remote context updates (because it can block other downstream requests during initialization)
		async function updateRemoteContext(this: GitProviderService) {
			const integrations = configuration.get('integrations.enabled');

			let hasRemotes = false;
			let hasRichRemotes = false;
			let hasConnectedRemotes = false;
			if (hasRepositories) {
				for (const repo of this._repositories.values()) {
					if (!hasConnectedRemotes && integrations) {
						hasConnectedRemotes = await repo.hasRichRemote(true);

						if (hasConnectedRemotes) {
							hasRichRemotes = true;
							hasRemotes = true;
						}
					}

					if (!hasRichRemotes && integrations) {
						hasRichRemotes = await repo.hasRichRemote();

						if (hasRichRemotes) {
							hasRemotes = true;
						}
					}

					if (!hasRemotes) {
						hasRemotes = await repo.hasRemotes();
					}

					if (hasRemotes && ((hasRichRemotes && hasConnectedRemotes) || !integrations)) break;
				}
			}

			this.container.telemetry.setGlobalAttributes({
				'repositories.hasRemotes': hasRemotes,
				'repositories.hasRichRemotes': hasRichRemotes,
				'repositories.hasConnectedRemotes': hasConnectedRemotes,
			});
			queueMicrotask(() => this.container.telemetry.sendEvent('providers/context'));

			await Promise.allSettled([
				setContext(ContextKeys.HasRemotes, hasRemotes),
				setContext(ContextKeys.HasRichRemotes, hasRichRemotes),
				setContext(ContextKeys.HasConnectedRemotes, hasConnectedRemotes),
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
		ref: string | undefined,
	): Promise<Uri | undefined> {
		if (repoPath == null || ref === deletedOrMissing) return undefined;

		const { provider, path: rp } = this.getProvider(repoPath);
		return provider.getBestRevisionUri(rp, provider.getRelativePath(path, rp), ref);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		const { provider } = this.getProvider(pathOrUri instanceof Uri ? pathOrUri : base);
		return provider.getRelativePath(pathOrUri, base);
	}

	getRevisionUri(uri: GitUri): Uri;
	getRevisionUri(ref: string, path: string, repoPath: string | Uri): Uri;
	getRevisionUri(ref: string, file: GitFile, repoPath: string | Uri): Uri;
	@log()
	getRevisionUri(refOrUri: string | GitUri, pathOrFile?: string | GitFile, repoPath?: string | Uri): Uri {
		let path: string;
		let ref: string | undefined;

		if (typeof refOrUri === 'string') {
			ref = refOrUri;

			if (typeof pathOrFile === 'string') {
				path = pathOrFile;
			} else {
				path = pathOrFile?.originalPath ?? pathOrFile?.path ?? '';
			}
		} else {
			ref = refOrUri.sha;
			repoPath = refOrUri.repoPath!;

			path = getBestPath(refOrUri);
		}

		const { provider, path: rp } = this.getProvider(repoPath!);
		return provider.getRevisionUri(rp, provider.getRelativePath(path, rp), ref!);
	}

	@log()
	getWorkingUri(repoPath: string | Uri, uri: Uri) {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getWorkingUri(path, uri);
	}

	@log()
	addRemote(repoPath: string | Uri, name: string, url: string, options?: { fetch?: boolean }): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.addRemote(path, name, url, options);
	}

	@log()
	pruneRemote(repoPath: string | Uri, name: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.pruneRemote(path, name);
	}

	@log()
	removeRemote(repoPath: string | Uri, name: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.removeRemote(path, name);
	}

	@log()
	applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const { provider } = this.getProvider(uri);
		return provider.applyChangesToWorkingFile(uri, ref1, ref2);
	}

	@log()
	checkout(repoPath: string, ref: string, options?: { createBranch?: string } | { path?: string }): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.checkout(path, ref, options);
	}

	@log({ singleLine: true })
	resetCaches(...caches: GitCaches[]): void {
		if (caches.length === 0 || caches.includes('providers')) {
			this._bestRemotesCache.clear();
		}

		this.container.events.fire('git:cache:reset', { caches: caches });
	}

	@log<GitProviderService['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.excludeIgnoredUris(path, uris);
	}

	@gate()
	@log()
	fetch(
		repoPath: string,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.fetch(path, options);
	}

	@gate<GitProviderService['fetchAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log<GitProviderService['fetchAll']>({ args: { 0: repos => repos?.map(r => r.name).join(', ') } })
	async fetchAll(repositories?: Repository[], options?: { all?: boolean; prune?: boolean }) {
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
			() => Promise.all(repositories!.map(r => r.fetch({ progress: false, ...options }))),
		);
	}

	@gate<GitProviderService['pullAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log<GitProviderService['pullAll']>({ args: { 0: repos => repos?.map(r => r.name).join(', ') } })
	async pullAll(repositories?: Repository[], options?: { rebase?: boolean }) {
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
			() => Promise.all(repositories!.map(r => r.pull({ progress: false, ...options }))),
		);
	}

	@gate<GitProviderService['pushAll']>(repos => `${repos == null ? '' : repos.map(r => r.id).join(',')}`)
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
	) {
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
			() => Promise.all(repositories!.map(r => r.push({ progress: false, ...options }))),
		);
	}

	@log<GitProviderService['getAheadBehindCommitCount']>({ args: { 1: refs => refs.join(',') } })
	getAheadBehindCommitCount(
		repoPath: string | Uri,
		refs: string[],
	): Promise<{ ahead: number; behind: number } | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getAheadBehindCommitCount(path, refs);
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
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRange(uri, range);
	}

	@log<GitProviderService['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRangeContents(uri, range, contents);
	}

	@log<GitProviderService['getBlameRange']>({ args: { 0: '<blame>' } })
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
		const { provider } = this.getProvider(uri);
		return provider.getBlameRange(blame, uri, range);
	}

	@log()
	async getBranch(repoPath: string | Uri | undefined): Promise<GitBranch | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getBranch(path);
	}

	@log<GitProviderService['getBranchAheadRange']>({ args: { 0: b => b.name } })
	async getBranchAheadRange(branch: GitBranch): Promise<string | undefined> {
		if (branch.state.ahead > 0) {
			return createRevisionRange(branch.upstream?.name, branch.ref);
		}

		if (branch.upstream == null) {
			// If we have no upstream branch, try to find a best guess branch to use as the "base"
			const { values: branches } = await this.getBranches(branch.repoPath, {
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
					return createRevisionRange(possibleBranch, branch.ref);
				}
			}
		}

		return undefined;
	}

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string | Uri | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			sort?: boolean | BranchSortOptions;
		},
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return { values: [] };

		const { provider, path } = this.getProvider(repoPath);
		return provider.getBranches(path, options);
	}

	@log()
	async getBranchesAndTagsTipsFn(
		repoPath: string | Uri | undefined,
		currentName?: string,
	): Promise<
		(sha: string, options?: { compact?: boolean | undefined; icons?: boolean | undefined }) => string | undefined
	> {
		const [branchesResult, tagsResult] = await Promise.allSettled([
			this.getBranches(repoPath),
			this.getTags(repoPath),
		]);

		const branches = getSettledValue(branchesResult)?.values ?? [];
		const tags = getSettledValue(tagsResult)?.values ?? [];

		const branchesAndTagsBySha = groupByFilterMap(
			(branches as (GitBranch | GitTag)[]).concat(tags as (GitBranch | GitTag)[]),
			bt => bt.sha,
			bt => {
				if (currentName) {
					if (bt.name === currentName) return undefined;
					if (bt.refType === 'branch' && bt.getNameWithoutRemote() === currentName) {
						return { name: bt.name, compactName: bt.getRemoteName(), type: bt.refType };
					}
				}

				return { name: bt.name, compactName: undefined, type: bt.refType };
			},
		);

		return (sha: string, options?: { compact?: boolean; icons?: boolean }): string | undefined => {
			const branchesAndTags = branchesAndTagsBySha.get(sha);
			if (branchesAndTags == null || branchesAndTags.length === 0) return undefined;

			if (!options?.compact) {
				return branchesAndTags
					.map(
						bt => `${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${bt.name}`,
					)
					.join(', ');
			}

			if (branchesAndTags.length > 1) {
				const [bt] = branchesAndTags;
				return `${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${
					bt.compactName ?? bt.name
				}, ${GlyphChars.Ellipsis}`;
			}

			return branchesAndTags
				.map(
					bt =>
						`${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${
							bt.compactName ?? bt.name
						}`,
				)
				.join(', ');
		};
	}

	@log()
	getChangedFilesCount(repoPath: string | Uri, ref?: string): Promise<GitDiffShortStat | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getChangedFilesCount(path, ref);
	}

	@log()
	async getCommit(repoPath: string | Uri, ref: string): Promise<GitCommit | undefined> {
		const { provider, path } = this.getProvider(repoPath);

		if (ref === uncommitted || ref === uncommittedStaged) {
			const now = new Date();
			const user = await this.getCurrentUser(repoPath);
			return new GitCommit(
				this.container,
				path,
				ref,
				new GitCommitIdentity('You', user?.email ?? undefined, now),
				new GitCommitIdentity('You', user?.email ?? undefined, now),
				'Uncommitted changes',
				[],
				'Uncommitted changes',
				undefined,
				undefined,
				[],
			);
		}

		return provider.getCommit(path, ref);
	}

	@log()
	getCommitBranches(
		repoPath: string | Uri,
		ref: string,
		options?: { branch?: string; commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitBranches(path, ref, options);
	}

	@log()
	getCommitCount(repoPath: string | Uri, ref: string): Promise<number | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitCount(path, ref);
	}

	@log()
	async getCommitForFile(
		repoPath: string | Uri | undefined,
		uri: Uri,
		options?: { ref?: string; firstIfNotFound?: boolean; range?: Range },
	): Promise<GitCommit | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitForFile(path, uri, options);
	}

	@log()
	getCommitsForGraph(
		repoPath: string | Uri,
		asWebviewUri: (uri: Uri) => Uri,
		options?: {
			branch?: string;
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
		},
	): Promise<GitGraph> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitsForGraph(path, asWebviewUri, options);
	}

	@log()
	async getConfig(repoPath: string, key: string): Promise<string | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getConfig?.(path, key);
	}

	@log()
	async setConfig(repoPath: string, key: string, value: string | undefined): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.setConfig?.(path, key, value);
	}

	@log()
	async getContributors(
		repoPath: string | Uri,
		options?: { all?: boolean; ref?: string; stats?: boolean },
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getContributors(path, options);
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string | Uri): Promise<GitUser | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCurrentUser(path);
	}

	@log()
	async getDefaultBranchName(repoPath: string | Uri | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getDefaultBranchName(path, remote);
	}

	@log()
	/**
	 * Returns a file diff between two commits
	 * @param uri Uri of the file to diff
	 * @param ref1 Commit to diff from
	 * @param ref2 Commit to diff to
	 */
	async getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<GitDiff | undefined> {
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
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<GitDiff | undefined> {
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
	async getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitDiffHunkLine | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForLine(uri, editorLine, ref1, ref2);
	}

	@log()
	async getDiffStatus(
		repoPath: string | Uri,
		ref1?: string,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getDiffStatus(path, ref1, ref2, options);
	}

	@log()
	async getFileStatusForCommit(repoPath: string | Uri, uri: Uri, ref: string): Promise<GitFile | undefined> {
		if (ref === deletedOrMissing || isUncommitted(ref)) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getFileStatusForCommit(path, uri, ref);
	}

	@debug()
	getGitDir(repoPath: string): Promise<GitDir | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return Promise.resolve(provider.getGitDir?.(path));
	}

	@debug()
	getLastFetchedTimestamp(repoPath: string | Uri): Promise<number | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLastFetchedTimestamp(path);
	}

	@log()
	async getLog(
		repoPath: string | Uri,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<GitLog | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLog(path, options);
	}

	@log()
	async getLogRefsOnly(
		repoPath: string | Uri,
		options?: {
			authors?: GitUser[];
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLogRefsOnly(path, options);
	}

	@log()
	async getLogForFile(
		repoPath: string | Uri | undefined,
		pathOrUri: string | Uri,
		options?: {
			all?: boolean;
			force?: boolean;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getLogForFile(path, pathOrUri, options);
	}

	@log()
	async getMergeBase(
		repoPath: string | Uri,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean },
	): Promise<string | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getMergeBase(path, ref1, ref2, options);
	}

	@gate()
	@log()
	async getMergeStatus(repoPath: string | Uri): Promise<GitMergeStatus | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getMergeStatus(path);
	}

	@gate()
	@log()
	async getRebaseStatus(repoPath: string | Uri): Promise<GitRebaseStatus | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getRebaseStatus(path);
	}

	@log()
	getNextComparisonUris(
		repoPath: string | Uri,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		if (!ref) return Promise.resolve(undefined);

		const { provider, path } = this.getProvider(repoPath);
		return provider.getNextComparisonUris(path, uri, ref, skip);
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string | Uri, uri: Uri): Promise<string | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getOldestUnpushedRefForFile(path, uri);
	}

	@log()
	getPreviousComparisonUris(
		repoPath: string | Uri,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
		firstParent: boolean = false,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return Promise.resolve(undefined);

		const { provider, path } = this.getProvider(repoPath);
		return provider.getPreviousComparisonUris(path, uri, ref, skip, firstParent);
	}

	@log()
	getPreviousComparisonUrisForLine(
		repoPath: string | Uri,
		uri: Uri,
		editorLine: number,
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousLineComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return Promise.resolve(undefined);

		const { provider, path } = this.getProvider(repoPath);
		return provider.getPreviousComparisonUrisForLine(path, uri, editorLine, ref, skip);
	}

	async getPullRequestForBranch(
		branch: string,
		remote: GitRemote<RemoteProvider | RichRemoteProvider>,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	async getPullRequestForBranch(
		branch: string,
		provider: RichRemoteProvider,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate<GitProviderService['getPullRequestForBranch']>((branch, remoteOrProvider, options) => {
		const provider = GitRemote.is(remoteOrProvider) ? remoteOrProvider.provider : remoteOrProvider;
		return `${branch}${
			provider != null ? `|${provider.id}:${provider.domain}/${provider.path}` : ''
		}|${JSON.stringify(options)}`;
	})
	@debug<GitProviderService['getPullRequestForBranch']>({ args: { 1: remoteOrProvider => remoteOrProvider.name } })
	async getPullRequestForBranch(
		branch: string,
		remoteOrProvider: GitRemote | RichRemoteProvider,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined> {
		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasRichIntegration()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let timeout;
		if (options != null) {
			({ timeout, ...options } = options);
		}

		let promiseOrPR = provider.getPullRequestForBranch(branch, options);
		if (promiseOrPR == null || !isPromise(promiseOrPR)) {
			return promiseOrPR;
		}

		if (timeout != null && timeout > 0) {
			promiseOrPR = cancellable(promiseOrPR, timeout);
		}

		try {
			return await promiseOrPR;
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) throw ex;

			return undefined;
		}
	}

	async getPullRequestForCommit(
		ref: string,
		remote: GitRemote,
		options?: { timeout?: number },
	): Promise<PullRequest | undefined>;
	async getPullRequestForCommit(
		ref: string,
		provider: RichRemoteProvider,
		options?: { timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate<GitProviderService['getPullRequestForCommit']>((ref, remoteOrProvider, options) => {
		const provider = GitRemote.is(remoteOrProvider) ? remoteOrProvider.provider : remoteOrProvider;
		return `${ref}${provider != null ? `|${provider.id}:${provider.domain}/${provider.path}` : ''}|${
			options?.timeout
		}`;
	})
	@debug<GitProviderService['getPullRequestForCommit']>({ args: { 1: remoteOrProvider => remoteOrProvider.name } })
	async getPullRequestForCommit(
		ref: string,
		remoteOrProvider: GitRemote | RichRemoteProvider,
		options?: { timeout?: number },
	): Promise<PullRequest | undefined> {
		if (isUncommitted(ref)) return undefined;

		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasRichIntegration()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let promiseOrPR = provider.getPullRequestForCommit(ref);
		if (promiseOrPR == null || !isPromise(promiseOrPR)) {
			return promiseOrPR;
		}

		if (options?.timeout != null && options.timeout > 0) {
			promiseOrPR = cancellable(promiseOrPR, options.timeout);
		}

		try {
			return await promiseOrPR;
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) throw ex;

			return undefined;
		}
	}

	@debug<GitProviderService['getMyPullRequests']>({ args: { 0: remoteOrProvider => remoteOrProvider.name } })
	async getMyPullRequests(
		remoteOrProvider: GitRemote | RichRemoteProvider,
		options?: { timeout?: number },
	): Promise<SearchedPullRequest[] | undefined> {
		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasRichIntegration()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let timeout;
		if (options != null) {
			({ timeout, ...options } = options);
		}

		let promiseOrPRs = provider.searchMyPullRequests();
		if (promiseOrPRs == null || !isPromise(promiseOrPRs)) {
			return promiseOrPRs;
		}

		if (timeout != null && timeout > 0) {
			promiseOrPRs = cancellable(promiseOrPRs, timeout);
		}

		try {
			return await promiseOrPRs;
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) throw ex;

			return undefined;
		}
	}

	@debug<GitProviderService['getMyIssues']>({ args: { 0: remoteOrProvider => remoteOrProvider.name } })
	async getMyIssues(
		remoteOrProvider: GitRemote | RichRemoteProvider,
		options?: { timeout?: number },
	): Promise<SearchedIssue[] | undefined> {
		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasRichIntegration()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let timeout;
		if (options != null) {
			({ timeout, ...options } = options);
		}

		let promiseOrPRs = provider.searchMyIssues();
		if (promiseOrPRs == null || !isPromise(promiseOrPRs)) {
			return promiseOrPRs;
		}

		if (timeout != null && timeout > 0) {
			promiseOrPRs = cancellable(promiseOrPRs, timeout);
		}

		try {
			return await promiseOrPRs;
		} catch (ex) {
			if (ex instanceof PromiseCancelledError) throw ex;

			return undefined;
		}
	}

	@log()
	async getIncomingActivity(
		repoPath: string | Uri,
		options?: {
			all?: boolean;
			branch?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			skip?: number;
		},
	): Promise<GitReflog | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getIncomingActivity(path, options);
	}

	async getBestRemoteWithProvider(
		repoPath: string | Uri | undefined,
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider> | undefined>;
	async getBestRemoteWithProvider(
		remotes: GitRemote[],
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider> | undefined>;
	@gate<GitProviderService['getBestRemoteWithProvider']>(
		remotesOrRepoPath =>
			`${
				remotesOrRepoPath == null || typeof remotesOrRepoPath === 'string'
					? remotesOrRepoPath
					: remotesOrRepoPath instanceof Uri
					? remotesOrRepoPath.toString()
					: `${remotesOrRepoPath.length}:${remotesOrRepoPath[0]?.repoPath ?? ''}`
			}`,
	)
	@log<GitProviderService['getBestRemoteWithProvider']>({
		args: {
			0: remotesOrRepoPath =>
				Array.isArray(remotesOrRepoPath) ? remotesOrRepoPath.map(r => r.name).join(',') : remotesOrRepoPath,
		},
	})
	async getBestRemoteWithProvider(
		remotesOrRepoPath: GitRemote[] | string | Uri | undefined,
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider> | undefined> {
		if (remotesOrRepoPath == null) return undefined;

		let remotes;
		let repoPath;
		if (Array.isArray(remotesOrRepoPath)) {
			if (remotesOrRepoPath.length === 0) return undefined;

			remotes = remotesOrRepoPath;
			repoPath = remotesOrRepoPath[0].repoPath;
		} else {
			repoPath = remotesOrRepoPath;
		}

		if (typeof repoPath === 'string') {
			repoPath = this.getAbsoluteUri(repoPath);
		}

		const cacheKey = asRepoComparisonKey(repoPath);
		let remote = this._bestRemotesCache.get(cacheKey);
		if (remote !== undefined) return remote ?? undefined;

		remotes = (remotes ?? (await this.getRemotesWithProviders(repoPath))).filter(
			(
				r: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
			): r is GitRemote<RemoteProvider | RichRemoteProvider> => r.provider != null,
		);

		if (remotes.length === 0) return undefined;

		if (remotes.length === 1) {
			remote = remotes[0];
		} else {
			const weightedRemotes = new Map<string, number>([
				['upstream', 15],
				['origin', 10],
			]);

			const branch = await this.getBranch(remotes[0].repoPath);
			const branchRemote = branch?.getRemoteName();

			if (branchRemote != null) {
				weightedRemotes.set(branchRemote, 100);
			}

			let bestRemote;
			let weight = 0;
			for (const r of remotes) {
				if (r.default) {
					bestRemote = r;
					break;
				}

				// Don't choose a remote unless its weighted above
				const matchedWeight = weightedRemotes.get(r.name) ?? -1;
				if (matchedWeight > weight) {
					bestRemote = r;
					weight = matchedWeight;
				}
			}

			remote = bestRemote ?? null;
		}

		this._bestRemotesCache.set(cacheKey, remote);

		return remote ?? undefined;
	}

	async getBestRemoteWithRichProvider(
		repoPath: string | Uri | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	async getBestRemoteWithRichProvider(
		remotes: GitRemote[],
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	@gate<GitProviderService['getBestRemoteWithRichProvider']>(
		(remotesOrRepoPath, options) =>
			`${
				remotesOrRepoPath == null || typeof remotesOrRepoPath === 'string'
					? remotesOrRepoPath
					: remotesOrRepoPath instanceof Uri
					? remotesOrRepoPath.toString()
					: `${remotesOrRepoPath.length}:${remotesOrRepoPath[0]?.repoPath ?? ''}`
			}|${options?.includeDisconnected ?? false}`,
	)
	@log<GitProviderService['getBestRemoteWithRichProvider']>({
		args: {
			0: remotesOrRepoPath =>
				Array.isArray(remotesOrRepoPath) ? remotesOrRepoPath.map(r => r.name).join(',') : remotesOrRepoPath,
		},
	})
	async getBestRemoteWithRichProvider(
		remotesOrRepoPath: GitRemote[] | string | Uri | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined> {
		if (remotesOrRepoPath == null) return undefined;

		let remotes;
		let repoPath;
		if (Array.isArray(remotesOrRepoPath)) {
			if (remotesOrRepoPath.length === 0) return undefined;

			remotes = remotesOrRepoPath;
			repoPath = remotesOrRepoPath[0].repoPath;
		} else {
			repoPath = remotesOrRepoPath;
		}

		if (typeof repoPath === 'string') {
			repoPath = this.getAbsoluteUri(repoPath);
		}

		const cacheKey = asRepoComparisonKey(repoPath);

		let richRemote = this._bestRemotesCache.get(`rich+connected|${cacheKey}`);
		if (richRemote != null) return richRemote;
		if (richRemote === null && !options?.includeDisconnected) return undefined;

		if (options?.includeDisconnected) {
			richRemote = this._bestRemotesCache.get(`rich|${cacheKey}`);
			if (richRemote !== undefined) return richRemote ?? undefined;
		}

		const remote = await (remotes != null
			? this.getBestRemoteWithProvider(remotes)
			: this.getBestRemoteWithProvider(repoPath));

		if (!remote?.hasRichProvider()) {
			this._bestRemotesCache.set(`rich|${cacheKey}`, null);
			this._bestRemotesCache.set(`rich+connected|${cacheKey}`, null);
			return undefined;
		}

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (connected) {
			this._bestRemotesCache.set(`rich|${cacheKey}`, remote);
			this._bestRemotesCache.set(`rich+connected|${cacheKey}`, remote);
		} else {
			this._bestRemotesCache.set(`rich|${cacheKey}`, remote);
			this._bestRemotesCache.set(`rich+connected|${cacheKey}`, null);

			if (!options?.includeDisconnected) return undefined;
		}

		return remote;
	}

	@log({ args: { 1: false } })
	async getRemotes(
		repoPath: string | Uri | undefined,
		options?: { providers?: RemoteProviders; sort?: boolean },
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider | undefined>[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getRemotes(path, options);
	}

	@log()
	async getRemotesWithProviders(
		repoPath: string | Uri | undefined,
		options?: { sort?: boolean },
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider>[]> {
		if (repoPath == null) return [];

		const repository = this.container.git.getRepository(repoPath);
		const remotes = await (repository != null
			? repository.getRemotes(options)
			: this.getRemotes(repoPath, options));

		return remotes.filter(
			(
				r: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
			): r is GitRemote<RemoteProvider | RichRemoteProvider> => r.provider != null,
		);
	}

	getBestRepository(): Repository | undefined;
	getBestRepository(uri?: Uri): Repository | undefined;
	getBestRepository(editor?: TextEditor): Repository | undefined;
	getBestRepository(uri?: TextEditor | Uri, editor?: TextEditor): Repository | undefined;
	@log<GitProviderService['getBestRepository']>({ exit: r => `returned ${r?.path}` })
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
	getBestRepositoryOrFirst(uri?: Uri): Repository | undefined;
	getBestRepositoryOrFirst(editor?: TextEditor): Repository | undefined;
	getBestRepositoryOrFirst(uri?: TextEditor | Uri, editor?: TextEditor): Repository | undefined;
	@log<GitProviderService['getBestRepositoryOrFirst']>({ exit: r => `returned ${r?.path}` })
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

	@log<GitProviderService['getOrOpenRepository']>({ exit: r => `returned ${r?.path}` })
	async getOrOpenRepository(
		uri: Uri,
		options?: { closeOnOpen?: boolean; detectNested?: boolean },
	): Promise<Repository | undefined> {
		const scope = getLogScope();

		const path = getBestPath(uri);
		let repository: Repository | undefined;
		repository = this.getRepository(uri);

		let isDirectory: boolean | undefined;

		const detectNested = options?.detectNested ?? configuration.get('detectNestedRepositories', uri);
		if (!detectNested) {
			if (repository != null) return repository;
		} else if (this._visitedPaths.has(path)) {
			return repository;
		} else {
			const stats = await workspace.fs.stat(uri);
			// If the uri isn't a directory, go up one level
			if ((stats.type & FileType.Directory) !== FileType.Directory) {
				uri = Uri.joinPath(uri, '..');
				if (this._visitedPaths.has(getBestPath(uri))) return repository;
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

				const autoRepositoryDetection =
					configuration.getAny<boolean | 'subFolders' | 'openEditors'>(
						CoreGitConfiguration.AutoRepositoryDetection,
					) ?? true;

				const closed =
					options?.closeOnOpen ??
					(autoRepositoryDetection !== true && autoRepositoryDetection !== 'openEditors');

				Logger.log(scope, `Repository found in '${repoUri.toString(true)}'`);
				const repositories = provider.openRepository(root?.folder, repoUri, false, undefined, closed);
				for (const repository of repositories) {
					this._repositories.add(repository);
				}

				this._pendingRepositories.delete(key);

				this.updateContext();
				// Send a notification that the repositories changed
				queueMicrotask(() => this.fireRepositoriesChanged(repositories));

				repository = repositories.length === 1 ? repositories[0] : this.getRepository(uri);
				return repository;
			}

			promise = findRepository.call(this);
			this._pendingRepositories.set(key, promise);
		}

		return promise;
	}

	@log<GitProviderService['getOrOpenRepositoryForEditor']>({
		args: { 0: e => (e != null ? `TextEditor(${Logger.toLoggable(e.document.uri)})` : undefined) },
	})
	async getOrOpenRepositoryForEditor(editor?: TextEditor): Promise<Repository | undefined> {
		editor = editor ?? window.activeTextEditor;

		if (editor == null) return this.highlander;

		return this.getOrOpenRepository(editor.document.uri);
	}

	getRepository(uri: Uri): Repository | undefined;
	getRepository(path: string): Repository | undefined;
	getRepository(pathOrUri: string | Uri): Repository | undefined;
	@log<GitProviderService['getRepository']>({ exit: r => `returned ${r?.path}` })
	getRepository(pathOrUri?: string | Uri): Repository | undefined {
		if (this.repositoryCount === 0) return undefined;
		if (pathOrUri == null) return undefined;

		if (typeof pathOrUri === 'string') {
			if (!pathOrUri) return undefined;

			return this._repositories.getClosest(this.getAbsoluteUri(pathOrUri));
		}

		return this._repositories.getClosest(pathOrUri);
	}

	async getLocalInfoFromRemoteUri(
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		for (const repo of this.openRepositories) {
			for (const remote of await repo.getRemotes()) {
				const local = await remote?.provider?.getLocalInfoFromRemoteUri(repo, uri, options);
				if (local != null) return local;
			}
		}

		return undefined;
	}

	@gate()
	@log()
	async getStash(repoPath: string | Uri | undefined): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getStash(path);
	}

	@log()
	async getStatusForFile(repoPath: string | Uri, uri: Uri): Promise<GitStatusFile | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForFile(path, uri);
	}

	@log()
	async getStatusForFiles(repoPath: string | Uri, pathOrGlob: Uri): Promise<GitStatusFile[] | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForFiles(path, pathOrGlob);
	}

	@log()
	async getStatusForRepo(repoPath: string | Uri | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForRepo(path);
	}

	@log({ args: { 1: false } })
	async getTags(
		repoPath: string | Uri | undefined,
		options?: { cursor?: string; filter?: (t: GitTag) => boolean; sort?: boolean | TagSortOptions },
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return { values: [] };

		const { provider, path } = this.getProvider(repoPath);
		return provider.getTags(path, options);
	}

	@log()
	async getTreeEntryForRevision(
		repoPath: string | Uri | undefined,
		path: string,
		ref: string,
	): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		const { provider, path: rp } = this.getProvider(repoPath);
		return provider.getTreeEntryForRevision(rp, provider.getRelativePath(path, rp), ref);
	}

	@log()
	async getTreeForRevision(repoPath: string | Uri | undefined, ref: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getTreeForRevision(path, ref);
	}

	@gate()
	@log()
	getRevisionContent(repoPath: string | Uri, path: string, ref: string): Promise<Uint8Array | undefined> {
		const { provider, path: rp } = this.getProvider(repoPath);
		return provider.getRevisionContent(rp, path, ref);
	}

	@log()
	async getUniqueRepositoryId(repoPath: string | Uri): Promise<string | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		const id = await provider.getUniqueRepositoryId(path);
		if (id != null) return id;

		return defaultRepositoryId;
	}

	@log({ args: { 1: false } })
	async hasBranchOrTag(
		repoPath: string | Uri | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
	): Promise<boolean> {
		if (repoPath == null) return false;

		const { provider, path } = this.getProvider(repoPath);
		return provider.hasBranchOrTag(path, options);
	}

	@log({ args: { 1: false } })
	async hasCommitBeenPushed(repoPath: string | Uri, ref: string): Promise<boolean> {
		if (repoPath == null) return false;

		const { provider, path } = this.getProvider(repoPath);
		return provider.hasCommitBeenPushed(path, ref);
	}

	@log()
	async hasRemotes(repoPath: string | Uri | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = this.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasRemotes();
	}

	@log()
	async hasTrackingBranch(repoPath: string | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = this.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasUpstreamBranch();
	}

	@log<GitProviderService['isRepositoryForEditor']>({
		args: {
			0: r => r.uri.toString(true),
			1: e => (e != null ? `TextEditor(${Logger.toLoggable(e.document.uri)})` : undefined),
		},
	})
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

	@log()
	async getDiffTool(repoPath?: string | Uri): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getDiffTool(path);
	}

	@log()
	async openDiffTool(
		repoPath: string | Uri,
		uri: Uri,
		options?: { ref1?: string; ref2?: string; staged?: boolean; tool?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.openDiffTool(path, uri, options);
	}

	@log()
	async openDirectoryCompare(repoPath: string | Uri, ref1: string, ref2?: string, tool?: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.openDirectoryCompare(path, ref1, ref2, tool);
	}

	async resolveReference(
		repoPath: string,
		ref: string,
		path?: string,
		options?: { force?: boolean; timeout?: number },
	): Promise<string>;
	async resolveReference(
		repoPath: string,
		ref: string,
		uri?: Uri,
		options?: { force?: boolean; timeout?: number },
	): Promise<string>;
	@gate()
	@log()
	async resolveReference(
		repoPath: string | Uri,
		ref: string,
		pathOrUri?: string | Uri,
		options?: { timeout?: number },
	) {
		if (pathOrUri != null && isUncommittedParent(ref)) {
			ref = 'HEAD';
		}

		if (
			!ref ||
			ref === deletedOrMissing ||
			(pathOrUri == null && isSha(ref)) ||
			(pathOrUri != null && isUncommitted(ref))
		) {
			return ref;
		}

		const { provider, path } = this.getProvider(repoPath);
		return provider.resolveReference(path, ref, pathOrUri, options);
	}

	@log<GitProviderService['richSearchCommits']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}]: ${
					s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
				}`,
		},
	})
	async richSearchCommits(
		repoPath: string | Uri,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.richSearchCommits(path, search, options);
	}

	@log()
	searchCommits(
		repoPath: string | Uri,
		search: SearchQuery,
		options?: {
			cancellation?: CancellationToken;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo';
		},
	): Promise<GitSearch> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.searchCommits(path, search, options);
	}

	@log()
	validateBranchOrTagName(repoPath: string | Uri, ref: string): Promise<boolean> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.validateBranchOrTagName(path, ref);
	}

	@log()
	async validateReference(repoPath: string | Uri, ref: string) {
		if (ref == null || ref.length === 0) return false;
		if (ref === deletedOrMissing || isUncommitted(ref)) return true;

		const { provider, path } = this.getProvider(repoPath);
		return provider.validateReference(path, ref);
	}

	stageFile(repoPath: string | Uri, path: string): Promise<void>;
	stageFile(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	stageFile(repoPath: string | Uri, pathOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stageFile(path, pathOrUri);
	}

	stageDirectory(repoPath: string | Uri, directory: string): Promise<void>;
	stageDirectory(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	stageDirectory(repoPath: string | Uri, directoryOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stageDirectory(path, directoryOrUri);
	}

	unStageFile(repoPath: string | Uri, path: string): Promise<void>;
	unStageFile(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	unStageFile(repoPath: string | Uri, pathOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.unStageFile(path, pathOrUri);
	}

	unStageDirectory(repoPath: string | Uri, directory: string): Promise<void>;
	unStageDirectory(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	unStageDirectory(repoPath: string | Uri, directoryOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.unStageDirectory(path, directoryOrUri);
	}

	@log()
	stashApply(repoPath: string | Uri, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stashApply(path, stashName, options);
	}

	@log()
	stashDelete(repoPath: string | Uri, stashName: string, ref?: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stashDelete(path, stashName, ref);
	}

	@log<GitProviderService['stashSave']>({ args: { 2: uris => uris?.length } })
	stashSave(
		repoPath: string | Uri,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stashSave(path, message, uris, options);
	}

	@log()
	createWorktree(
		repoPath: string | Uri,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<void> {
		const { provider, path: rp } = this.getProvider(repoPath);
		return Promise.resolve(provider.createWorktree?.(rp, path, options));
	}

	@log()
	async getWorktree(
		repoPath: string | Uri,
		predicate: (w: GitWorktree) => boolean,
	): Promise<GitWorktree | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return ((await provider.getWorktrees?.(path)) ?? []).find(predicate);
	}

	@log()
	async getWorktrees(repoPath: string | Uri): Promise<GitWorktree[]> {
		const { provider, path } = this.getProvider(repoPath);
		return (await provider.getWorktrees?.(path)) ?? [];
	}

	@log()
	async getWorktreesDefaultUri(path: string | Uri): Promise<Uri | undefined> {
		const { provider, path: rp } = this.getProvider(path);
		let defaultUri = await provider.getWorktreesDefaultUri?.(rp);
		if (defaultUri != null) return defaultUri;

		// If we don't have a default set, default it to the parent folder of the repo folder
		defaultUri = this.getRepository(rp)?.uri;
		if (defaultUri != null) {
			defaultUri = Uri.joinPath(defaultUri, '..');
		}
		return defaultUri;
	}

	@log()
	deleteWorktree(repoPath: string | Uri, path: string, options?: { force?: boolean }): Promise<void> {
		const { provider, path: rp } = this.getProvider(repoPath);
		return Promise.resolve(provider.deleteWorktree?.(rp, path, options));
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
	getScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getScmRepository(path);
	}

	@log()
	getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getOrOpenScmRepository(path);
	}
}
