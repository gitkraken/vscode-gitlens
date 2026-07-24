import { readdir, realpath } from 'fs';
import { homedir } from 'os';
import { resolve as resolvePath } from 'path';
import type { Disposable, WorkspaceFolder } from 'vscode';
import { extensions, FileType, Uri, window, workspace } from 'vscode';
import { fetch } from '@env/fetch.js';
import { isLinux, isWindows } from '@env/platform.js';
import type { CliGitProviderOptions } from '@gitlens/git-cli/cliGitProvider.js';
import { CliGitProvider } from '@gitlens/git-cli/cliGitProvider.js';
import type { GitLocation } from '@gitlens/git-cli/exec/locator.js';
import { findGitPath, InvalidGitConfigError, UnableToFindGitError } from '@gitlens/git-cli/exec/locator.js';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { forcedRepositoryChanges } from '@gitlens/git/models/repository.js';
import { deletedOrMissing, uncommitted } from '@gitlens/git/models/revision.js';
import type { GitProvider } from '@gitlens/git/providers/provider.js';
import type { GitProviderDescriptor, RepositoryVisibility } from '@gitlens/git/providers/types.js';
import type { UnsafeGit } from '@gitlens/git/run.types.js';
import { getVisibilityCacheKey } from '@gitlens/git/utils/remote.utils.js';
import {
	getRevisionRangeParts,
	isRevisionRange,
	isUncommitted,
	isUncommittedStaged,
	shortenRevision,
} from '@gitlens/git/utils/revision.utils.js';
import type { RevisionUriData, RevisionUriOptions } from '@gitlens/git/utils/uriAuthority.js';
import { encodeGitLensRevisionUriAuthority } from '@gitlens/git/utils/uriAuthority.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter, promisifyDeferred } from '@gitlens/utils/event.js';
import { getDurationMilliseconds, hrtime } from '@gitlens/utils/hrtime.js';
import { first } from '@gitlens/utils/iterable.js';
import { getLoggableName, Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import {
	arePathsEqual,
	commonBaseIndex,
	dirname,
	getScheme,
	isAbsolute,
	joinPaths,
	maybeUri,
	normalizePath,
} from '@gitlens/utils/path.js';
import { any, asSettled } from '@gitlens/utils/promise.js';
import { equalsIgnoreCase, interpolate } from '@gitlens/utils/string.js';
import { compare, fromString } from '@gitlens/utils/version.js';
import type { APIState, GitExtension, API as ScmGitApi } from '../../../@types/vscode.git.d.js';
import { Schemes } from '../../../constants.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { Features } from '../../../features.js';
import { gitMinimumVersion } from '../../../features.js';
import type {
	GlGitProvider,
	RepositoryCloseEvent,
	RepositoryOpenEvent,
	ScmRepository,
} from '../../../git/gitProvider.js';
import { createGitProviderContext } from '../../../git/gitProviderContext.js';
import type { GitUri } from '../../../git/gitUri.js';
import { isGitUri } from '../../../git/gitUri.js';
import type { RepositoryChange, RepositoryChangeEvent } from '../../../git/models/repository.js';
import { GlRepository } from '../../../git/models/repository.js';
import { getRemoteProviderUrl } from '../../../git/utils/-webview/remote.utils.js';
import {
	showGenericErrorMessage,
	showGitDisabledErrorMessage,
	showGitInvalidConfigErrorMessage,
	showGitMissingErrorMessage,
	showGitVersionUnsupportedErrorMessage,
} from '../../../messages.js';
import { asRepoComparisonKey } from '../../../repositories.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { setContext } from '../../../system/-webview/context.js';
import { getBestPath, isDescendant, isFolderUri, relative, splitPath } from '../../../system/-webview/path.js';
import { UriSet } from '../../../system/-webview/uriMap.js';
import { gate } from '../../../system/decorators/gate.js';

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;

export class GlCliGitProvider implements GlGitProvider {
	readonly descriptor: GitProviderDescriptor = { id: 'git', name: 'Git', virtual: false };
	readonly supportedSchemes = new Set<string>([
		Schemes.File,
		Schemes.Git,
		Schemes.GitLens,
		Schemes.PRs,
		// DocumentSchemes.Vsls,
	]);

	private _onDidChange = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private _onWillChangeRepository = new Emitter<RepositoryChangeEvent>();
	get onWillChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onWillChangeRepository.event;
	}

	private _onDidChangeRepository = new Emitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private _onDidCloseRepository = new Emitter<RepositoryCloseEvent>();
	get onDidCloseRepository(): Event<RepositoryCloseEvent> {
		return this._onDidCloseRepository.event;
	}

	private _onDidOpenRepository = new Emitter<RepositoryOpenEvent>();
	get onDidOpenRepository(): Event<RepositoryOpenEvent> {
		return this._onDidOpenRepository.event;
	}

	private _disposables: Disposable[] = [];
	private _provider: CliGitProvider | undefined;
	private _providerInitializing = false;
	private _scmGitEnv: Record<string, string | undefined> | undefined;

	constructor(
		protected readonly container: Container,
		private readonly cache: Cache,
		protected readonly register: (
			provider: GitProvider,
			canHandle: (repoPath: string) => boolean,
		) => UnifiedDisposable,
	) {
		this._disposables.push(
			this._onDidChange,
			this._onWillChangeRepository,
			this._onDidChangeRepository,
			this._onDidCloseRepository,
			this._onDidOpenRepository,
		);
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	protected get provider(): CliGitProvider {
		return this.ensureProvider();
	}

	ensureRegistered(): void {
		this.ensureProvider();
	}

	protected ensureProvider(): CliGitProvider {
		if (this._provider == null) {
			if (this._providerInitializing) {
				debugger;
				throw new Error(`${getLoggableName(this)}: re-entrant access to provider getter during initialization`);
			}

			this._providerInitializing = true;
			try {
				this._provider = new CliGitProvider(this.getProviderOptions());
				this._disposables.push(
					this._provider,
					this.register(this._provider, repoPath => {
						const scheme = getScheme(repoPath);
						// No scheme means a plain path — always local.
						// Explicit scheme must be one we handle (excluding 'pr' which the extension resolves).
						return (
							scheme == null ||
							scheme === Schemes.File ||
							scheme === Schemes.Git ||
							scheme === Schemes.GitLens
						);
					}),
					// Clear pending commands on @gitlens/git-cli's Git when the cache resets
					this.container.events.on('git:cache:reset', e => {
						if (e.data.types?.every(t => t === 'providers')) return;

						this._provider?.git.clearPendingCommands();
					}),
				);
			} finally {
				this._providerInitializing = false;
			}
		}
		return this._provider;
	}

	/** Builds the options bag for the `CliGitProvider`. Override to customize (e.g., inject a custom `Git` executor). */
	protected getProviderOptions(): CliGitProviderOptions {
		const { container } = this;
		const baseContext = createGitProviderContext(container);
		const getAbsoluteUri = this.getAbsoluteUri.bind(this);

		const gitOutputChannel = window.createOutputChannel('GitLens (Git)', { log: true });
		this._disposables.push(gitOutputChannel);

		return {
			cache: this.cache,
			context: {
				...baseContext,
				workspace: {
					...baseContext.workspace!,
					getWorktreeDefaultUri: (repoPath: string): Uri | undefined => {
						let location = configuration.get('worktrees.defaultLocation');
						if (location == null) {
							const repo = container.git.getRepository(repoPath);
							const defaultUri = repo?.commonUri ?? repo?.uri;
							return defaultUri != null ? Uri.joinPath(defaultUri, '..') : undefined;
						}

						if (location.startsWith('~')) {
							location = joinPaths(homedir(), location.slice(1));
						}

						const folder = container.git.getRepository(repoPath)?.folder;
						location = interpolate(location, {
							userHome: homedir(),
							workspaceFolder: folder?.uri.fsPath,
							workspaceFolderBasename: folder?.name,
						});

						return getAbsoluteUri(location, repoPath);
					},
				},
			},
			locator: () => this.ensureGit(),
			gitOptions: {
				getEnvironment: () => this._scmGitEnv,
				decode: (data: Uint8Array, options?: { readonly encoding: string }) =>
					Promise.resolve(options ? workspace.decode(data, options) : workspace.decode(data)),
				gitTimeout: (configuration.get('advanced.git.timeout') ?? 60) * 1000,
				queue: { maxConcurrent: configuration.get('advanced.git.maxConcurrentProcesses') ?? 20 },
				logger: gitOutputChannel,
				hooks: {
					onAborted: info => container.telemetry.sendEvent('op/git/aborted', info),
					onSlowQueue: info => {
						// Surface slow-queue events in the GitLens output channel so the wait time
						// is observable during local debug — not just in telemetry. Helps catch
						// priority misclassifications where a user-initiated read got queued behind
						// background work (e.g., commit details click stuck behind graph load).
						Logger.warn(
							`Git queue wait: ${info.waitTime}ms [priority=${info.priority}, active=${info.active}/${info.maxConcurrent}, queued=${info.queued.interactive}/${info.queued.normal}/${info.queued.background}]`,
						);
						container.telemetry.sendEvent('op/git/queueWait', {
							priority: info.priority,
							waitTime: info.waitTime,
							active: info.active,
							'queued.interactive': info.queued.interactive,
							'queued.normal': info.queued.normal,
							'queued.background': info.queued.background,
							maxConcurrent: info.maxConcurrent,
						});
					},
				},
			},
		};
	}

	private createRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		opened: boolean,
	): GlRepository {
		const repo = new GlRepository(this.container, this.descriptor, folder, uri, gitDir, root, opened);

		repo.onDidChange(e => {
			// Only force-fired changes need telling here: they're delivered straight to this emitter, bypassing the
			// watch session, so nothing upstream told the cache. Everything else went through the session, which
			// already did it once, before notifying anyone (see `GitProviderService`'s global wiring) — telling it
			// again would land a second time mid-notification, and a consumer reading status synchronously in that
			// gap would spawn a duplicate `git status` the second advance immediately fences out.
			if (e.changed(...forcedRepositoryChanges)) {
				this.onRepositoryChanged(repo.path, e.changes);
			}

			if (!e.changed('unknown', 'closed')) {
				if (e.changed('head')) {
					queueMicrotask(() => this.provider.branches.onCurrentBranchAccessed?.(repo.path));
				}

				if (e.changed('index')) {
					queueMicrotask(() => this.provider.branches.onCurrentBranchModified?.(repo.path));
				}
			}

			this._onWillChangeRepository.fire(e);
			this._onDidChangeRepository.fire(e);
		});
		// Working-tree changes are not wired here: they're driven onto the cache's status clock once, globally,
		// at the watch session (see `GitProviderService`), so open repos and closed worktrees share one increment.

		return repo;
	}

	/** Advance the cache for a FORCE-fired repo change (`opened`/`closed`/`lastFetched`), which bypasses the watch
	 *  session — session-routed changes are advanced once by the session itself (see `GitProviderService`). */
	private onRepositoryChanged(repoPath: string, changes: Iterable<RepositoryChange>): void {
		this.cache.onRepositoryChanged(repoPath, changes);
	}

	private _gitLocator: Promise<GitLocation> | undefined;
	private async ensureGit(): Promise<GitLocation> {
		this._gitLocator ??= this.findGit();

		return this._gitLocator;
	}

	@debug()
	private async findGit(): Promise<GitLocation> {
		const scope = getScopedLogger();

		if (!configuration.getCore('git.enabled', null, true)) {
			scope?.warn('Built-in Git is disabled ("git.enabled": false)');
			void showGitDisabledErrorMessage();

			throw new UnableToFindGitError();
		}

		const scmGitPromise = this.getScmGitApi();

		async function subscribeToScmOpenCloseRepository(this: GlCliGitProvider) {
			const scmGit = await scmGitPromise;
			if (scmGit == null) return;

			// Find env to pass to Git (propagated to @gitlens/git-cli Git via GitOptions.getEnvironment)
			if ('env' in scmGit.git) {
				scope?.trace('Found built-in Git env');
				this._scmGitEnv = scmGit.git.env as Record<string, string | undefined>;
			} else {
				for (const v of Object.values(scmGit.git)) {
					if (v != null && typeof v === 'object' && 'git' in v) {
						for (const vv of Object.values(v.git)) {
							if (vv != null && typeof vv === 'object' && 'GIT_ASKPASS' in vv) {
								scope?.trace('Found built-in Git env');
								this._scmGitEnv = vv as Record<string, string | undefined>;
								break;
							}
						}
					}
				}
			}

			const closing = new Set<Uri>();
			const fireRepositoryClosed = debounce(() => {
				if (this.container.deactivating) return;

				const closed = [...closing];
				closing.clear();
				scope?.info(`fireRepositoryClosed: firing ${closed.length} closed repo(s) from vscode.git`);
				for (const uri of closed) {
					this._onDidCloseRepository.fire({ uri: uri, source: 'scm' });
				}
			}, 1000);

			const opening = new UriSet();
			const fireRepositoryOpened = debounce(() => {
				if (this.container.deactivating) return;

				const opened = [...opening];
				opening.clear();

				scope?.info(`fireRepositoryOpened: firing ${opened.length} opened repo(s) from vscode.git`);
				for (const uri of opened) {
					this._onDidOpenRepository.fire({ uri: uri, source: 'scm' });
				}
			}, 1000);
			this._disposables.push(
				// Since we will get "close" events for repos when vscode is shutting down, debounce the event so ensure we aren't shutting down
				scmGit.onDidCloseRepository(e => {
					if (this.container.deactivating) return;

					scope?.info(`SCM.onDidCloseRepository(${e.rootUri.toString(true)})`);
					// Track the SCM-close intent immediately (before the 1s debounce), so any
					// re-open paths during the debounce window can short-circuit.
					const repo = this.container.git.getRepository(e.rootUri);
					if (repo != null) {
						repo.closedByScm = true;
					}

					closing.add(e.rootUri);
					fireRepositoryClosed();
				}),
				scmGit.onDidOpenRepository(e => {
					if (this.container.deactivating) return;

					scope?.info(`SCM.onDidOpenRepository(${e.rootUri.toString(true)})`);
					// Clear any prior SCM-close intent immediately so subsequent paths see it as open.
					const repo = this.container.git.getRepository(e.rootUri);
					if (repo != null) {
						repo.closedByScm = false;
					}

					opening.add(e.rootUri);
					fireRepositoryOpened();
				}),
			);

			// When relying solely on SCM discovery, wait for vscode.git's initial scan so we seed from a complete
			// snapshot, not a partial one. The open/close subscriptions above are already wired, so any repo opened
			// during the wait is still caught. (In filesystem mode the scan is authoritative, so seed immediately.)
			if (!configuration.get('advanced.repositorySearch.enabled')) {
				await this.whenScmRepositoriesInitialized(scmGit);
			}

			for (const scmRepository of scmGit.repositories) {
				this._onDidOpenRepository.fire({ uri: scmRepository.rootUri, source: 'scm' });
			}
		}
		void subscribeToScmOpenCloseRepository.call(this);

		const canCacheGitPath = configuration.get('advanced.caching.gitPath');
		const potentialGitPaths =
			configuration.getCore('git.path') ??
			(canCacheGitPath ? this.container.storage.getWorkspace('gitPath') : undefined);

		const start = hrtime();

		const findGitPromise = findGitPath(potentialGitPaths);
		// Try to use the same git as the built-in vscode git extension, but don't wait for it if we find something faster
		const findGitFromSCMPromise = scmGitPromise.then(gitApi => {
			const path = gitApi?.git.path;
			if (!path) return findGitPromise;

			if (potentialGitPaths != null) {
				if (typeof potentialGitPaths === 'string') {
					if (path === potentialGitPaths) return findGitPromise;
				} else if (potentialGitPaths.includes(path)) {
					return findGitPromise;
				}
			}

			return findGitPath(path, false);
		});

		const location = await any<GitLocation>(findGitPromise, findGitFromSCMPromise);
		// Save the found git path, but let things settle first to not impact startup performance
		setTimeout(
			() =>
				void this.container.storage
					.storeWorkspace('gitPath', canCacheGitPath ? location.path : undefined)
					.catch(),
			1000,
		);

		scope?.addExitInfo(`Git (${location.version}) found in ${location.path === 'git' ? 'PATH' : location.path}`);
		scope?.info(
			`Git (${location.version}) found in ${
				location.path === 'git' ? 'PATH' : location.path
			} [${getDurationMilliseconds(start)}ms]`,
		);

		// Warn if git is less than our minimum (v2.7.2)
		if (compare(fromString(location.version), fromString(gitMinimumVersion)) === -1) {
			scope?.warn(`Git version (${location.version}) is outdated`);
			void showGitVersionUnsupportedErrorMessage(location.version, gitMinimumVersion);
		}

		return location;
	}

	@trace({ exit: true })
	async discoverRepositories(
		uri: Uri,
		options?: { cancellation?: AbortSignal; depth?: number; silent?: boolean },
	): Promise<GlRepository[]> {
		if (uri.scheme !== Schemes.File) return [];

		try {
			// When repository search is disabled, don't scan the filesystem for *automatic* workspace discovery; rely
			// on vscode.git's discovery instead. Explicit scans (`findRepositories`, which pass options — e.g. a
			// user-picked parent folder) must still scan the filesystem, since that folder isn't necessarily opened in
			// SCM. `return await` keeps any error inside this try so it shares the same error handling as the scan.
			if (options == null && !configuration.get('advanced.repositorySearch.enabled')) {
				return await this.scmRepositorySearch(uri);
			}

			const autoRepositoryDetection = configuration.getCore('git.autoRepositoryDetection') ?? true;

			const folder = workspace.getWorkspaceFolder(uri);
			if (folder == null && !options?.silent) return [];

			void (await this.ensureGit());

			if (options?.cancellation?.aborted) return [];

			const repositories = await this.repositorySearch(
				folder ?? uri,
				options?.depth ??
					(autoRepositoryDetection === false || autoRepositoryDetection === 'openEditors' ? 0 : undefined),
				options?.cancellation,
				options?.silent,
			);

			// Opening discovered repos in VS Code's built-in SCM is intentionally left to vscode.git (see the
			// note in `addRepository`) so we don't override the user's SCM closed-repos set.

			if (!options?.silent && repositories.length > 0) {
				this.cache.trackedPaths.clear();
			}

			return repositories;
		} catch (ex) {
			if (ex instanceof InvalidGitConfigError) {
				void showGitInvalidConfigErrorMessage();
			} else if (ex instanceof UnableToFindGitError) {
				void showGitMissingErrorMessage();
			} else {
				const msg: string = ex?.message ?? '';
				if (msg && !options?.silent) {
					void window.showErrorMessage(`Unable to initialize Git; ${msg}`);
				}
			}

			throw ex;
		}
	}

	@trace({ exit: true })
	addRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir | undefined,
		root: boolean,
		opened: boolean,
	): GlRepository[] {
		// Ensure the library-level provider is registered before any GlRepository is created,
		// so the library's GitService can route this repo's path to the local provider.
		this.ensureProvider();

		// `opened` is GitLens visibility only — we deliberately do NOT open the repo in VS Code's built-in SCM.
		// vscode.git's `openRepository` API force-opens AND clears the repo from its persisted closed-repos set
		// (which GitLens can't read), so syncing here would resurrect repos the user closed in SCM. vscode.git's
		// own `git.autoRepositoryDetection` opens repos in SCM honoring that set; GitLens follows via `onDidOpenRepository`.

		// Register the repo path mapping for worktree-aware caching
		if (gitDir != null) {
			this.cache.registerRepoPath(uri, gitDir);
		}

		const repositories = [
			this.createRepository(folder ?? workspace.getWorkspaceFolder(uri), uri, gitDir, root, opened),
		];

		// Add a hidden (not-opened) repository for the canonical version if not already opened
		const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
		if (canonicalUri != null && this.container.git.getRepository(canonicalUri) == null) {
			// Also register the canonical path for worktree-aware caching
			if (gitDir != null) {
				this.cache.registerRepoPath(canonicalUri, gitDir);
			}

			repositories.push(
				this.createRepository(
					folder ?? workspace.getWorkspaceFolder(canonicalUri),
					canonicalUri,
					gitDir,
					root,
					false,
				),
			);
		}

		return repositories;
	}

	private _supportedFeatures = new Map<Features, boolean>();
	async supports(feature: Features): Promise<boolean> {
		let supported = this._supportedFeatures.get(feature);
		if (supported != null) return supported;

		switch (feature) {
			case 'stashes':
			case 'timeline':
				supported = true;
				break;
			default:
				if (feature.startsWith('git:')) {
					supported = await this.provider.supports(feature);
				} else {
					supported = true;
				}
				break;
		}

		void setContext(`gitlens:feature:unsupported:${feature}`, !supported);
		this._supportedFeatures.set(feature, supported);
		return supported;
	}

	@trace({ exit: r => `returned ${r[0]}` })
	async visibility(repoPath: string): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]> {
		const remotes = await this.provider.remotes.getRemotes(repoPath, { sort: true });
		if (remotes.length === 0) return ['local', undefined];

		let local = true;
		for await (const result of asSettled(remotes.map(r => this.getRemoteVisibility(r)))) {
			if (result.status !== 'fulfilled') continue;

			if (result.value[0] === 'public') {
				return ['public', getVisibilityCacheKey(result.value[1])];
			}

			if (result.value[0] !== 'local') {
				local = false;
			}
		}

		return local ? ['local', undefined] : ['private', getVisibilityCacheKey(remotes)];
	}

	private _pendingRemoteVisibility = new Map<string, ReturnType<typeof fetch>>();
	@trace({ args: remote => ({ remote: remote.url }), exit: r => `returned ${r[0]}` })
	private async getRemoteVisibility(
		remote: GitRemote,
	): Promise<[visibility: RepositoryVisibility, remote: GitRemote]> {
		const scope = getScopedLogger();

		let url;
		switch (remote.provider?.id) {
			case 'github':
			case 'gitlab':
			case 'bitbucket':
			case 'azure-devops':
			case 'gitea':
			case 'gerrit':
			case 'google-source':
				url = await getRemoteProviderUrl(remote.provider, { type: RemoteResourceType.Repo });
				if (url == null) return ['private', remote];

				break;
			default: {
				url = remote.url;
				if (!url.includes('git@')) {
					return maybeUri(url) ? ['private', remote] : ['local', remote];
				}

				const [host, repo] = url.split('@')[1].split(':');
				if (!host || !repo) return ['private', remote];

				url = `https://${host}/${repo}`;
			}
		}

		// Check if the url returns a 200 status code
		let promise = this._pendingRemoteVisibility.get(url);
		if (promise == null) {
			const aborter = new AbortController();
			const timer = setTimeout(() => aborter.abort(), 30000);

			promise = fetch(url, { method: 'HEAD', signal: aborter.signal });
			void promise.finally(() => clearTimeout(timer));

			this._pendingRemoteVisibility.set(url, promise);
		}

		try {
			const rsp = await promise;
			if (rsp.ok) return ['public', remote];

			scope?.trace(`Response=${rsp.status}`);
		} catch (ex) {
			debugger;
			scope?.error(ex);
		} finally {
			this._pendingRemoteVisibility.delete(url);
		}
		return ['private', remote];
	}

	@debug({
		args: false,
		onlyExit: true,
		prefix: (context, folder) => `${context.prefix}(${(folder instanceof Uri ? folder : folder.uri).fsPath})`,
		exit: r => `returned ${r.length} repositories ${r.length !== 0 ? Logger.toLoggable(r) : ''}`,
	})
	private async repositorySearch(
		folderOrUri: Uri | WorkspaceFolder,
		depth?: number,
		cancellation?: AbortSignal,
		silent?: boolean | undefined,
	): Promise<GlRepository[]> {
		const scope = getScopedLogger();

		let folder;
		let rootUri;
		if (folderOrUri instanceof Uri) {
			rootUri = folderOrUri;
			folder = workspace.getWorkspaceFolder(rootUri);
		} else {
			rootUri = folderOrUri.uri;
		}

		depth =
			depth ??
			configuration.get('advanced.repositorySearchDepth', rootUri) ??
			configuration.getCore('git.repositoryScanMaxDepth', rootUri, 1);

		scope?.info(`searching (depth=${depth})...`);

		const repositories: GlRepository[] = [];

		let rootPath;
		let canonicalRootPath;

		const maybeAddRepo = async (uri: Uri, folder: WorkspaceFolder | undefined, root: boolean) => {
			repositories.push(...(await this.addDiscoveredRepository(uri, folder, root, silent, repositories, scope)));
		};

		const uri = await this.findRepositoryUri(rootUri, true);
		if (uri != null) {
			rootPath = normalizePath(uri.fsPath);

			const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
			if (canonicalUri != null) {
				canonicalRootPath = normalizePath(canonicalUri.fsPath);
			}

			await maybeAddRepo(uri, folder, true);
		}

		if (depth <= 0 || cancellation?.aborted) return repositories;

		// Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
		const excludes = new Set<string>(configuration.getCore('git.repositoryScanIgnoredFolders', rootUri, []));
		for (let [key, value] of Object.entries({
			...configuration.getCore('files.exclude', rootUri, {}),
			...configuration.getCore('search.exclude', rootUri, {}),
		})) {
			if (!value) continue;
			if (key.includes('*.')) continue;

			if (key.startsWith('**/')) {
				key = key.substring(3);
			}
			excludes.add(key);
		}

		let repoPaths;
		try {
			repoPaths = await this.repositorySearchCore(rootUri.fsPath, depth, excludes, cancellation);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (RepoSearchWarnings.doesNotExist.test(msg)) {
				scope?.warn(`FAILED${msg ? ` Error: ${msg}` : ''}`);
			} else {
				scope?.error(ex, 'FAILED');
			}

			return repositories;
		}

		for (let p of repoPaths) {
			p = dirname(p);
			const normalized = normalizePath(p);

			// If we are the same as the root, skip it
			if (
				(isLinux &&
					(normalized === rootPath || (canonicalRootPath != null && normalized === canonicalRootPath))) ||
				equalsIgnoreCase(normalized, rootPath) ||
				(canonicalRootPath != null && equalsIgnoreCase(normalized, canonicalRootPath))
			) {
				continue;
			}

			scope?.debug(`searching in '${p}'...`);
			scope?.trace(
				`normalizedRepoPath=${normalized}, rootPath=${rootPath}, canonicalRootPath=${canonicalRootPath}`,
			);

			const rp = await this.findRepositoryUri(Uri.file(p), true);
			if (rp == null) continue;

			await maybeAddRepo(rp, folder, false);
		}

		return repositories;
	}

	/** Shared repository-from-uri add logic for both filesystem ({@link repositorySearch}) and SCM ({@link scmRepositorySearch}) discovery */
	private async addDiscoveredRepository(
		uri: Uri,
		folder: WorkspaceFolder | undefined,
		root: boolean,
		silent: boolean | undefined,
		seen: GlRepository[],
		scope: ReturnType<typeof getScopedLogger>,
	): Promise<GlRepository[]> {
		const comparisonId = asRepoComparisonKey(uri);
		if (seen.some(r => r.id === comparisonId)) {
			scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - duplicate`);
			return [];
		}

		const repo = this.container.git.getRepository(uri);
		if (repo != null) {
			if (!repo.opened && silent === false) {
				if (repo.closedByScm) {
					scope?.info(
						`found ${
							root ? 'root ' : ''
						}repository in '${uri.fsPath}'; skipping - already known and closed (in SCM) (not auto-reopening)`,
					);
				} else {
					repo.opened = true;
					scope?.info(
						`found ${
							root ? 'root ' : ''
						}repository in '${uri.fsPath}'; skipping - already known; flipped closed→open`,
					);
				}
				return [];
			}

			scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - already open`);
			return [];
		}

		scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'`);
		const gitDir = await this.provider.config.getGitDir?.(uri.fsPath);
		if (gitDir == null) {
			scope?.warn(`Unable to get gitDir for '${uri.toString(true)}'`);
			return [];
		}

		return this.addRepository(folder, uri, gitDir, root, !silent);
	}

	/**
	 * Discovers repositories from vscode.git's known set (instead of scanning the filesystem) when
	 * `gitlens.advanced.repositorySearch.enabled` is off. Waits for vscode.git's initial scan to complete so
	 * discovery readiness is honest. Repos unrelated to the folder (siblings, or repos outside any workspace
	 * folder) are surfaced by the SCM open/close event path instead.
	 */
	@debug({ args: false, exit: true })
	private async scmRepositorySearch(folderUri: Uri, silent?: boolean): Promise<GlRepository[]> {
		const scope = getScopedLogger();

		// Locate Git and wire the SCM open/close subscription (mirrors the filesystem path), so live opens/closes
		// and `closedByScm` tracking work from startup even though we're not scanning the filesystem.
		void (await this.ensureGit());

		const scmGit = await this.getScmGitApi();
		if (scmGit == null) {
			scope?.warn('No built-in Git (vscode.git) API; unable to discover repositories via SCM');
			return [];
		}

		// Wait for vscode.git's initial scan so its repositories list is complete and our discovery readiness
		// (GitProviderService.isDiscoveringRepositories) reflects the real state rather than a guess/timeout.
		await this.whenScmRepositoriesInitialized(scmGit);

		const folder = workspace.getWorkspaceFolder(folderUri);
		const repositories: GlRepository[] = [];

		for (const scmRepo of scmGit.repositories) {
			const uri = scmRepo.rootUri;
			if (uri.scheme !== Schemes.File) continue;

			// Surface the repo at the folder, the repo that contains it, and repos nested under it. Note: `isDescendant`
			// is strict (a path is not its own descendant), so the equal case is checked explicitly. Unrelated repos
			// (siblings, or repos outside any folder) are surfaced by the SCM open/close event path instead.
			const sameAsFolder = arePathsEqual(getBestPath(uri), getBestPath(folderUri));
			const containsFolder = !sameAsFolder && isDescendant(folderUri, uri);
			const underFolder = !sameAsFolder && isDescendant(uri, folderUri);
			if (!sameAsFolder && !containsFolder && !underFolder) continue;

			const root = sameAsFolder || containsFolder; // the repo at or above the folder is its root
			repositories.push(...(await this.addDiscoveredRepository(uri, folder, root, silent, repositories, scope)));
		}

		if (!silent && repositories.length > 0) {
			this.cache.trackedPaths.clear();
		}

		return repositories;
	}

	/** Resolves once vscode.git has completed its initial repository scan (its `state` is `'initialized'`) */
	private async whenScmRepositoriesInitialized(scmGit: ScmGitApi): Promise<void> {
		if (scmGit.state === 'initialized') return;

		await promisifyDeferred<APIState, void>(scmGit.onDidChangeState, (state, resolve) => {
			if (state === 'initialized') {
				resolve();
			}
		}).promise;
	}

	@trace({ args: (root, depth) => ({ root: root, depth: depth }), exit: true })
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Set<string>,
		cancellation?: AbortSignal,
		repositories: string[] = [],
	): Promise<string[]> {
		const scope = getScopedLogger();

		if (cancellation?.aborted) return Promise.resolve(repositories);

		return new Promise<string[]>((resolve, reject) => {
			readdir(root, { withFileTypes: true }, async (err, files) => {
				if (err != null) {
					reject(err);
					return;
				}

				if (files.length === 0) {
					resolve(repositories);
					return;
				}

				depth--;

				let f;
				for (f of files) {
					if (cancellation?.aborted) break;

					if (f.name === '.git') {
						repositories.push(resolvePath(root, f.name));
					} else if (depth >= 0 && f.isDirectory() && !excludes.has(f.name)) {
						try {
							await this.repositorySearchCore(
								resolvePath(root, f.name),
								depth,
								excludes,
								cancellation,
								repositories,
							);
						} catch (ex) {
							scope?.error(ex, 'FAILED');
						}
					}
				}

				resolve(repositories);
			});
		});
	}

	canHandlePathOrUri(scheme: string, pathOrUri: string | Uri): string | undefined {
		if (!this.supportedSchemes.has(scheme)) return undefined;
		return getBestPath(pathOrUri);
	}

	getAbsoluteUri(pathOrUri: string | Uri, base: string | Uri): Uri {
		// Convert the base to a Uri if it isn't one
		if (typeof base === 'string') {
			// If it looks like a Uri parse it
			if (maybeUri(base)) {
				base = Uri.parse(base, true);
			} else {
				if (!isAbsolute(base)) {
					debugger;
					void window.showErrorMessage(
						`Unable to get absolute uri between ${
							typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.toString(true)
						} and ${base}; Base path '${base}' must be an absolute path`,
					);
					throw new Error(`Base path '${base}' must be an absolute path`);
				}

				base = Uri.file(base);
			}
		}

		// Short-circuit if the path is relative
		if (typeof pathOrUri === 'string') {
			const normalized = normalizePath(pathOrUri);
			if (!isAbsolute(normalized)) return Uri.joinPath(base, normalized);
		}

		const relativePath = this.getRelativePath(pathOrUri, base);
		return Uri.joinPath(base, relativePath);
	}

	@debug({ exit: true })
	async getBestRevisionUri(
		repoPath: string,
		pathOrUri: string | Uri,
		rev: string | undefined,
	): Promise<Uri | undefined> {
		if (rev === deletedOrMissing) return undefined;

		const path = getBestPath(pathOrUri);

		if (!rev || (isUncommitted(rev) && !isUncommittedStaged(rev))) {
			// Fast path: check if isTracked already resolved this path
			const trackedKey = getTrackedPathsCacheKey(`${repoPath}/${path}`);
			const trackedPromise = this.cache.trackedPaths.get(repoPath, trackedKey);
			if (trackedPromise != null) {
				const resolved = await trackedPromise;
				if (resolved !== false) return this.getAbsoluteUri(resolved[0], resolved[1]);
			}

			// Make sure the file exists in the working tree (tracked or untracked)
			if (await this.provider.revision.exists?.(repoPath, path, { untracked: 'include' })) {
				return this.getAbsoluteUri(path, repoPath);
			}

			return undefined;
		}

		// If the ref is the index, then try to create a Uri using the Git extension, but if we can't find a repo for it, then generate our own Uri
		if (isUncommittedStaged(rev)) {
			let scmRepo = await this.getScmRepository(repoPath);
			if (scmRepo == null) {
				// If the repoPath is a canonical path, then we need to remap it to the real path, because the vscode.git extension always uses the real path
				const realUri = this.fromCanonicalMap.get(repoPath);
				if (realUri != null) {
					scmRepo = await this.getScmRepository(realUri.fsPath);
				}
			}

			if (scmRepo != null) {
				return this.getScmGitUri(path, repoPath);
			}
		}

		return this.getRevisionUri(repoPath, rev, path);
	}

	getRelativePath(pathOrUri: string | Uri, base: string | Uri): string {
		// Convert the base to a Uri if it isn't one
		if (typeof base === 'string') {
			// If it looks like a Uri parse it
			if (maybeUri(base)) {
				base = Uri.parse(base, true);
			} else {
				if (!isAbsolute(base)) {
					debugger;
					void window.showErrorMessage(
						`Unable to get relative path between ${
							typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.toString(true)
						} and ${base}; Base path '${base}' must be an absolute path`,
					);
					throw new Error(`Base path '${base}' must be an absolute path`);
				}

				base = Uri.file(base);
			}
		}

		// Convert the path to a Uri if it isn't one
		if (typeof pathOrUri === 'string') {
			if (maybeUri(pathOrUri)) {
				pathOrUri = Uri.parse(pathOrUri, true);
			} else {
				if (!isAbsolute(pathOrUri)) return normalizePath(pathOrUri);

				pathOrUri = Uri.file(pathOrUri);
			}
		}

		const relativePath = relative(base.fsPath, pathOrUri.fsPath);
		return normalizePath(relativePath);
	}

	getRevisionUri(repoPath: string, rev: string, path: string, options?: RevisionUriOptions): Uri {
		if (isUncommitted(rev) && !isUncommittedStaged(rev) && !options?.submoduleSha) {
			return this.getAbsoluteUri(path, repoPath);
		}

		let uncPath;

		path = normalizePath(this.getAbsoluteUri(path, repoPath).fsPath);
		if (path.startsWith('//')) {
			// save the UNC part of the path so we can re-add it later
			const index = path.indexOf('/', 2);
			uncPath = path.substring(0, index);
			path = path.substring(index);
		}

		if (!path.startsWith('/')) {
			path = `/${path}`;
		}

		const metadata: RevisionUriData = {
			ref: rev,
			repoPath: normalizePath(repoPath),
			uncPath: uncPath,
			submoduleSha: options?.submoduleSha,
		};

		return Uri.from({
			scheme: Schemes.GitLens,
			authority: encodeGitLensRevisionUriAuthority(metadata),
			path: path,
			// Replace `/` with `\u2009\u2215\u2009` so that it doesn't get treated as part of the path of the file
			query: rev
				? JSON.stringify({ ref: shortenRevision(rev).replaceAll('/', '\u2009\u2215\u2009') })
				: undefined,
		});
	}

	@debug({ exit: true })
	async getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined> {
		let relativePath = this.getRelativePath(uri, repoPath);

		let result;
		let rev;
		do {
			// Break if the path exists in the working tree (tracked or untracked) — the fs.stat check below verifies the file
			if (await this.provider.revision.exists?.(repoPath, relativePath, { untracked: 'include' })) break;

			// TODO: Add caching

			// Get the most recent commit for this file name
			rev = first(
				await this.provider.commits.getLogShas(repoPath, undefined, { limit: 1, pathOrUri: relativePath }),
			);
			if (rev == null) return undefined;

			// Now check if that commit had any copies/renames
			result = await this.provider.diff.findPathStatusChanged(repoPath, relativePath, rev);
			// If the file was deleted, then we can't find the working file
			if (result?.file?.status === 'D') return undefined;
			if (result?.file == null) break;

			relativePath = result?.file.path;
		} while (true);

		const absoluteUri = this.getAbsoluteUri(relativePath, repoPath);

		// Check what type of thing exists at this path
		try {
			const stat = await workspace.fs.stat(absoluteUri);
			if (stat.type & FileType.File) return absoluteUri;

			if (stat.type & FileType.Directory) {
				// Check if it's a submodule
				const submoduleSha = await this.provider.revision.getSubmoduleHead?.(repoPath, relativePath);
				if (submoduleSha != null) {
					return this.getRevisionUri(repoPath, uncommitted, relativePath, { submoduleSha: submoduleSha });
				}
			}
		} catch {
			// Path doesn't exist on disk
		}

		return undefined;
	}

	@debug({ exit: true })
	async isFolderUri(repoPath: string, uri: Uri): Promise<boolean> {
		// Use tree entry to determine type: 'tree' = folder, 'commit' = submodule, 'blob' = file
		const relativePath = this.getRelativePath(uri, repoPath);
		const tree = await this.provider.revision.getTreeEntryForRevision(repoPath, relativePath, 'HEAD');
		return tree?.type === 'tree';
	}

	@debug()
	async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const scope = getScopedLogger();

		ref1 = ref1 ?? uri.sha;
		if (ref1 == null || uri.repoPath == null) return;

		if (ref2 == null) {
			ref2 = ref1;
			ref1 = `${ref1}^`;
		}

		const [relativePath, root] = splitPath(uri, uri.repoPath);

		let patch;
		try {
			const result = await this.provider.diff.diff(root, relativePath, ref1, ref2);
			patch = result.stdout;
			await this.provider.patch.apply(root, patch);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (patch && /patch does not apply/i.test(msg)) {
				const result = await window.showWarningMessage(
					'Unable to apply changes cleanly. Retry and allow conflicts?',
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);
				if (result?.title !== 'Yes') return;

				try {
					await this.provider.patch.apply(root, patch, { threeWay: true });

					return;
				} catch (e) {
					// oxlint-disable-next-line no-ex-assign
					ex = e;
				}
			}

			scope?.error(ex);
			void showGenericErrorMessage('Unable to apply changes');
		}
	}

	@debug()
	async clone(url: string, parentPath: string): Promise<string | undefined> {
		const scope = getScopedLogger();

		try {
			return await this.provider.clone?.(url, parentPath);
		} catch (ex) {
			scope?.error(ex);
			void showGenericErrorMessage(`Unable to clone '${url}'`);
		}

		return undefined;
	}

	@debug({ args: (repoPath, uris) => ({ repoPath: repoPath, uris: uris.length }) })
	excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		return this.provider.excludeIgnoredUris(repoPath, uris);
	}

	@trace()
	getIgnoredUrisFilter(repoPath: string): Promise<(uri: Uri) => boolean> {
		return this.provider.getIgnoredUrisFilter(repoPath);
	}

	private readonly toCanonicalMap = new Map<string, Uri>();
	private readonly fromCanonicalMap = new Map<string, Uri>();
	protected readonly unsafePaths = new Set<string>();

	@gate()
	@trace({ exit: true })
	async findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getScopedLogger();

		let repoPath: string | undefined;
		let gitDirInfo:
			| { gitDir: string; commonGitDir: string | undefined; superprojectPath: string | undefined }
			| undefined;
		try {
			isDirectory ??= await isFolderUri(uri);
			// If the uri isn't a directory, go up one level
			if (!isDirectory) {
				uri = Uri.joinPath(uri, '..');
			}

			// Use combined rev-parse to get both repoPath and gitDir in a single spawn
			const result = await this.provider.config.getRepositoryInfo(uri.fsPath);

			// Handle the different return types
			if (Array.isArray(result)) {
				// Tuple result: [safe: true, repoPath] or [safe: false] or []
				const [safe, path] = result as [boolean | undefined, string | undefined];
				if (safe === true) {
					this.unsafePaths.delete(uri.fsPath);
					repoPath = path;
				} else if (safe === false) {
					this.unsafePaths.add(uri.fsPath);
					return undefined;
				}
				// No gitDir info for tuple results (bare repo fallback case)
			} else if (result != null) {
				// Object result with full info
				this.unsafePaths.delete(uri.fsPath);
				repoPath = result.repoPath;
				gitDirInfo = {
					gitDir: result.gitDir,
					commonGitDir: result.commonGitDir,
					superprojectPath: result.superprojectPath,
				};
			}

			if (!repoPath) return undefined;

			const repoUri = Uri.file(repoPath);

			// On Git 2.25+ if you call `rev-parse --show-toplevel` on a mapped drive, instead of getting the mapped drive path back, you get the UNC path for the mapped drive.
			// So try to normalize it back to the mapped drive path, if possible
			if (isWindows && repoUri.authority.length !== 0 && uri.authority.length === 0) {
				const match = driveLetterRegex.exec(uri.path);
				if (match != null) {
					const [, letter] = match;

					try {
						const networkPath = await new Promise<string | undefined>(resolve =>
							realpath.native(`${letter}:\\`, { encoding: 'utf8' }, (err, resolvedPath) =>
								resolve(err != null ? undefined : resolvedPath),
							),
						);
						if (networkPath != null) {
							// If the repository is at the root of the mapped drive then we
							// have to append `\` (ex: D:\) otherwise the path is not valid.
							const isDriveRoot = arePathsEqual(repoUri.fsPath, networkPath);

							repoPath = normalizePath(
								repoUri.fsPath.replace(
									networkPath,
									`${letter.toLowerCase()}:${isDriveRoot || networkPath.endsWith('\\') ? '\\' : ''}`,
								),
							);

							// Pre-populate the gitDir cache for Windows mapped drive path
							const resultUri = Uri.file(repoPath);
							if (gitDirInfo != null) {
								const gitDir: GitDir = {
									uri: Uri.file(gitDirInfo.gitDir),
									commonUri: gitDirInfo.commonGitDir ? Uri.file(gitDirInfo.commonGitDir) : undefined,
									parentUri: gitDirInfo.superprojectPath
										? Uri.file(gitDirInfo.superprojectPath)
										: undefined,
								};
								this.cache.gitDir.set(resultUri.fsPath, gitDir);
							}
							return resultUri;
						}
					} catch {}
				}

				// Pre-populate the gitDir cache for Windows fallback path
				const fallbackUri = Uri.file(normalizePath(uri.fsPath));
				if (gitDirInfo != null) {
					const gitDir: GitDir = {
						uri: Uri.file(gitDirInfo.gitDir),
						commonUri: gitDirInfo.commonGitDir ? Uri.file(gitDirInfo.commonGitDir) : undefined,
						parentUri: gitDirInfo.superprojectPath ? Uri.file(gitDirInfo.superprojectPath) : undefined,
					};
					this.cache.gitDir.set(fallbackUri.fsPath, gitDir);
				}
				return fallbackUri;
			}

			// Check if we are a symlink and if so, use the symlink path (not its resolved path)
			// This is because VS Code will provide document Uris using the symlinked path
			const canonicalUri = this.toCanonicalMap.get(repoPath);
			if (canonicalUri == null) {
				let symlink;
				[repoPath, symlink] = await new Promise<[string, string | undefined]>(resolve => {
					realpath(uri.fsPath, { encoding: 'utf8' }, (err, resolvedPath) => {
						if (err != null) {
							scope?.warn(`fs.realpath failed; repoPath=${repoPath}`);
							resolve([repoPath!, undefined]);
							return;
						}

						if (arePathsEqual(uri.fsPath, resolvedPath)) {
							scope?.trace(`No symlink detected; repoPath=${repoPath}`);
							resolve([repoPath!, undefined]);
							return;
						}

						let linkPath = normalizePath(resolvedPath);
						const index = commonBaseIndex(`${repoPath}/`, `${linkPath}/`, '/');
						const uriPath = normalizePath(uri.fsPath);
						if (index < linkPath.length - 1) {
							linkPath = uriPath.substring(0, uriPath.length - (linkPath.length - index));
						} else {
							linkPath = uriPath;
						}

						scope?.trace(
							`Symlink detected; repoPath=${repoPath}, path=${uri.fsPath}, resolvedPath=${resolvedPath}`,
						);
						resolve([repoPath!, linkPath]);
					});
				});

				// If we found a symlink, keep track of the mappings
				if (symlink != null) {
					this.toCanonicalMap.set(repoPath, Uri.file(symlink));
					this.fromCanonicalMap.set(symlink, Uri.file(repoPath));
				} else if (isWindows && repoPath) {
					// On Windows, `fs.realpath` does not resolve SUBST drive substitutions, but
					// `git rev-parse --show-toplevel` does. Detect this by comparing drive letters
					// between the workspace URI and the git-reported repo path, then resolve the
					// SUBST target via `realpath.native` on the drive root to populate the
					// canonical/symlink mappings so SCM repository lookups can succeed.
					const uriDrive = uri.fsPath[0]?.toLowerCase();
					const repoDrive = repoPath[0]?.toLowerCase();
					if (uriDrive && repoDrive && uriDrive !== repoDrive) {
						try {
							const resolvedDrive = normalizePath(
								await new Promise<string>((resolve, reject) =>
									realpath.native(`${uriDrive}:\\`, { encoding: 'utf8' }, (err, p) =>
										err ? reject(err) : resolve(p),
									),
								),
							);
							const drivePrefix = resolvedDrive.endsWith('/') ? resolvedDrive : `${resolvedDrive}/`;
							if (repoPath.toLowerCase().startsWith(drivePrefix.toLowerCase())) {
								const suffix = repoPath.substring(drivePrefix.length);
								symlink = normalizePath(`${uriDrive}:/${suffix}`);
								this.toCanonicalMap.set(repoPath, Uri.file(symlink));
								this.fromCanonicalMap.set(symlink, Uri.file(repoPath));
								scope?.debug(`SUBST drive detected; repoPath=${repoPath}, substPath=${symlink}`);
							}
						} catch (ex) {
							scope?.warn(`Failed to resolve SUBST drive '${uriDrive}:'; ${ex}`);
						}
					}
				}
			}

			if (!repoPath) return undefined;

			// Pre-populate the gitDir cache
			const resultUri = Uri.file(repoPath);
			if (gitDirInfo != null) {
				const gitDir: GitDir = {
					uri: Uri.file(gitDirInfo.gitDir),
					commonUri: gitDirInfo.commonGitDir ? Uri.file(gitDirInfo.commonGitDir) : undefined,
					parentUri: gitDirInfo.superprojectPath ? Uri.file(gitDirInfo.superprojectPath) : undefined,
				};
				this.cache.gitDir.set(resultUri.fsPath, gitDir);
			}

			return resultUri;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@trace()
	getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		return this.provider.getLastFetchedTimestamp(repoPath);
	}

	hasUnsafeRepositories(): boolean {
		return this.unsafePaths.size !== 0;
	}

	isTrackable(uri: Uri): boolean {
		return this.supportedSchemes.has(uri.scheme);
	}

	async isTracked(uri: Uri): Promise<boolean> {
		return (await this.isTrackedWithDetails(uri)) != null;
	}

	createUnsafeGit(repoPath: string): UnsafeGit {
		return {
			run: (args, options) => this.provider.git.run({ cwd: repoPath, errors: 'throw', ...options }, ...args),
		};
	}

	private async isTrackedWithDetails(uri: Uri | GitUri): Promise<[string, string] | undefined>;
	private async isTrackedWithDetails(
		path: string,
		repoPath?: string,
		ref?: string,
	): Promise<[string, string] | undefined>;
	@debug({
		exit: tracked => `returned ${tracked != null ? `[${tracked[0]},[${tracked[1]}]` : 'false'}`,
	})
	private async isTrackedWithDetails(
		pathOrUri: string | Uri | GitUri,
		repoPath?: string,
		ref?: string,
	): Promise<[string, string] | undefined> {
		let relativePath: string;
		let repository: GlRepository | undefined;

		if (typeof pathOrUri === 'string') {
			if (ref === deletedOrMissing) return undefined;

			repository = this.container.git.getRepository(Uri.file(pathOrUri));
			repoPath ||= repository?.path;

			[relativePath, repoPath] = splitPath(pathOrUri, repoPath);
		} else {
			if (!this.isTrackable(pathOrUri)) return undefined;

			if (isGitUri(pathOrUri)) {
				// Always use the ref of the GitUri
				ref = pathOrUri.sha;
				if (ref === deletedOrMissing) return undefined;
			}

			repository = this.container.git.getRepository(pathOrUri);
			if (repository?.isSubmodule) {
				repoPath = repoPath || repository.parentUri?.fsPath || repository.path;
			} else {
				repoPath = repoPath || repository?.path;
			}

			[relativePath, repoPath] = splitPath(pathOrUri, repoPath);
		}

		const path = repoPath ? `${repoPath}/${relativePath}` : relativePath;

		const key = getTrackedPathsCacheKey(path, ref);

		// false means "confirmed not tracked"; getOrCreate handles in-flight deduplication and TTL
		const result = await this.cache.trackedPaths.getOrCreate(repoPath ?? '', key, async () => {
			const tracked = await this.isTrackedCore(path, relativePath, repoPath ?? '', ref, repository);
			return tracked ?? false;
		});
		return result === false ? undefined : result;
	}

	@trace()
	private async isTrackedCore(
		path: string,
		relativePath: string,
		repoPath: string,
		ref: string | undefined,
		repository: GlRepository | undefined,
	): Promise<[string, string] | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

		const existsInRev = async (repoPath: string, relativePath: string, ref?: string) => {
			let exists = await this.provider.revision.exists?.(repoPath, relativePath, ref);
			// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
			if (!exists && ref) {
				exists = await this.provider.revision.exists?.(repoPath, relativePath, `${ref}^`);
			}
			return exists;
		};

		try {
			while (true) {
				if (!repoPath) {
					[relativePath, repoPath] = splitPath(path, '', true);
				}

				// Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
				let tracked = await existsInRev(repoPath, relativePath);
				if (tracked) return [relativePath, repoPath];

				if (repoPath) {
					const [newRelativePath, newRepoPath] = splitPath(path, '', true);
					if (newRelativePath !== relativePath) {
						// If we didn't find it, check it as close to the file as possible (will find nested repos)
						tracked = await existsInRev(newRepoPath, newRelativePath);
						if (tracked) {
							repository = await this.container.git.getOrAddRepository(Uri.file(path), {
								detectNested: true,
								opened: false,
							});
							if (repository != null) {
								return splitPath(path, repository.path);
							}

							return [newRelativePath, newRepoPath];
						}
					}
				}

				if (!tracked && ref && !isUncommitted(ref)) {
					if (isRevisionRange(ref)) {
						const { left, right } = getRevisionRangeParts(ref) ?? {};
						tracked =
							(right ? await existsInRev(repoPath, relativePath, right) : false) ||
							(left ? await existsInRev(repoPath, relativePath, left) : false);
					} else {
						tracked = await existsInRev(repoPath, relativePath, ref);
					}
				}

				// Since the file isn't tracked, make sure it isn't part of a nested repository we don't know about yet
				if (!tracked) {
					if (repository != null) {
						// Don't look for a nested repository if the file isn't at least one folder deep
						const index = relativePath.indexOf('/');
						if (index < 0 || index === relativePath.length - 1) return undefined;

						const nested = await this.container.git.getOrAddRepository(Uri.file(path), {
							detectNested: true,
							opened: false,
						});
						if (nested != null && nested !== repository) {
							[relativePath, repoPath] = splitPath(path, repository.path);
							repository = undefined;

							continue;
						}
					}

					return undefined;
				}

				return [relativePath, repoPath];
			}
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	private _scmGitApi: Promise<ScmGitApi | undefined> | undefined;
	private async getScmGitApi(): Promise<ScmGitApi | undefined> {
		return this._scmGitApi ?? (this._scmGitApi = this.getScmGitApiCore());
	}

	@debug()
	private async getScmGitApiCore(): Promise<ScmGitApi | undefined> {
		try {
			const extension = extensions.getExtension<GitExtension>('vscode.git');
			if (extension == null) return undefined;

			const gitExtension = extension.isActive ? extension.exports : await extension.activate();
			return gitExtension?.getAPI(1);
		} catch {
			return undefined;
		}
	}

	private getScmGitUri(path: string, repoPath: string): Uri {
		// If the repoPath is a canonical path, then we need to remap it to the real path, because the vscode.git extension always uses the real path
		const realUri = this.fromCanonicalMap.get(repoPath);
		const uri = this.getAbsoluteUri(path, realUri ?? repoPath);

		return Uri.from({
			scheme: Schemes.Git,
			path: uri.path,
			query: JSON.stringify({
				// Ensure we use the fsPath here, otherwise the url won't open properly
				path: uri.fsPath,
				ref: '~',
			}),
		});
	}

	@debug()
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const scope = getScopedLogger();
		try {
			const gitApi = await this.getScmGitApi();
			return gitApi?.repositories ?? [];
		} catch (ex) {
			scope?.error(ex);
			return [];
		}
	}

	@debug({ exit: true })
	async getScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const scope = getScopedLogger();
		try {
			const gitApi = await this.getScmGitApi();
			if (gitApi == null) return undefined;

			let repo = gitApi.getRepository(Uri.file(repoPath));
			if (repo == null) {
				// If the canonical path doesn't match, try the symlinked/SUBST path
				const symlinkUri = this.toCanonicalMap.get(repoPath);
				if (symlinkUri != null) {
					repo = gitApi.getRepository(symlinkUri);
				}
			}
			return repo ?? undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@debug({ exit: true })
	async getOrOpenScmRepository(repoPath: string | Uri, source?: Source): Promise<ScmRepository | undefined> {
		const scope = getScopedLogger();

		try {
			const uri = repoPath instanceof Uri ? repoPath : Uri.file(repoPath);

			// Defense-in-depth: if GitLens knows this repo as closed in SCM, don't ask vscode.git to re-open
			// it on our behalf \u2014 `openRepository` force-opens and erases vscode.git's persisted closed-repos set.
			const known = this.container.git.getRepository(uri);
			if (known?.closedByScm) {
				scope?.info(
					`skipping opening the SCM repository for '${uri.toString(true)}'${
						source != null ? ` (source=${source.source})` : ''
					}: tracked currently as closed (in SCM)`,
				);
				return undefined;
			}

			const gitApi = await this.getScmGitApi();
			if (gitApi == null) return undefined;

			// If the canonical path doesn't match VS Code's SCM paths (e.g., SUBST drives),
			// use the symlinked/SUBST path that VS Code's SCM actually references
			const effectiveUri = this.toCanonicalMap.get(getBestPath(uri)) ?? uri;

			// `getRepository` will return an opened repository that "contains" that path, so for nested repositories, we need to force the opening of the nested path, otherwise we will only get the root repository
			let repo = gitApi.getRepository(effectiveUri);
			if (repo == null || (repo != null && repo.rootUri.toString() !== effectiveUri.toString())) {
				scope?.info(
					`opening the SCM repository for '${effectiveUri.toString(true)}'${
						source != null ? ` (source=${source.source})` : ''
					}: ${
						repo == null
							? 'no existing repository found'
							: `existing, non-matching repository '${repo.rootUri.toString(true)}'`
					}`,
				);
				repo = await gitApi.openRepository?.(effectiveUri);
			}
			return repo ?? undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}
}

function getTrackedPathsCacheKey(path: string, ref?: string): string {
	return `${ref ?? ''}:${path.startsWith('/') ? path : `/${path}`}`;
}
