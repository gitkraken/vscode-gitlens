import { readdir, realpath } from 'fs';
import { resolve as resolvePath } from 'path';
import type { CancellationToken, Disposable, Event, Range, TextDocument, WorkspaceFolder } from 'vscode';
import { EventEmitter, extensions, FileType, Uri, window, workspace } from 'vscode';
import { md5 } from '@env/crypto.js';
import { fetch, getProxyAgent } from '@env/fetch.js';
import { hrtime } from '@env/hrtime.js';
import { isLinux, isWindows } from '@env/platform.js';
import type { GitExtension, API as ScmGitApi } from '../../../@types/vscode.git.d.js';
import { Schemes } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { Features } from '../../../features.js';
import { gitMinimumVersion } from '../../../features.js';
import { GitCache } from '../../../git/cache.js';
import { BlameIgnoreRevsFileBadRevisionError, BlameIgnoreRevsFileError } from '../../../git/errors.js';
import { GitIgnoreCache } from '../../../git/gitIgnoreCache.js';
import type {
	GitDir,
	GitProvider,
	GitProviderDescriptor,
	RepositoryCloseEvent,
	RepositoryInitWatcher,
	RepositoryOpenEvent,
	RepositoryVisibility,
	RevisionUriData,
	RevisionUriOptions,
	ScmRepository,
} from '../../../git/gitProvider.js';
import { encodeGitLensRevisionUriAuthority } from '../../../git/gitUri.authority.js';
import type { GitUri } from '../../../git/gitUri.js';
import { isGitUri } from '../../../git/gitUri.js';
import type { GitBlame, GitBlameAuthor, GitBlameLine } from '../../../git/models/blame.js';
import type { GitCommit } from '../../../git/models/commit.js';
import type { GitLineDiff, ParsedGitDiffHunks } from '../../../git/models/diff.js';
import type { GitLog } from '../../../git/models/log.js';
import type { GitRemote } from '../../../git/models/remote.js';
import { RemoteResourceType } from '../../../git/models/remoteResource.js';
import type { RepositoryChangeEvent } from '../../../git/models/repository.js';
import { Repository } from '../../../git/models/repository.js';
import { deletedOrMissing, uncommitted } from '../../../git/models/revision.js';
import { parseGitBlame } from '../../../git/parsers/blameParser.js';
import { parseGitFileDiff } from '../../../git/parsers/diffParser.js';
import { getVisibilityCacheKey } from '../../../git/utils/remote.utils.js';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '../../../git/utils/revision.utils.js';
import {
	showBlameInvalidIgnoreRevsFileWarningMessage,
	showGenericErrorMessage,
	showGitDisabledErrorMessage,
	showGitInvalidConfigErrorMessage,
	showGitMissingErrorMessage,
	showGitVersionUnsupportedErrorMessage,
} from '../../../messages.js';
import { asRepoComparisonKey } from '../../../repositories.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { setContext } from '../../../system/-webview/context.js';
import { getBestPath, isFolderUri, relative, splitPath } from '../../../system/-webview/path.js';
import { UriSet } from '../../../system/-webview/uriMap.js';
import { gate } from '../../../system/decorators/gate.js';
import { debug, trace } from '../../../system/decorators/log.js';
import { debounce } from '../../../system/function/debounce.js';
import { first } from '../../../system/iterable.js';
import { Logger } from '../../../system/logger.js';
import type { ScopedLogger } from '../../../system/logger.scope.js';
import { getScopedLogger } from '../../../system/logger.scope.js';
import { arePathsEqual, commonBaseIndex, dirname, isAbsolute, maybeUri, normalizePath } from '../../../system/path.js';
import { any, asSettled, getSettledValue } from '../../../system/promise.js';
import { equalsIgnoreCase, getDurationMilliseconds } from '../../../system/string.js';
import { compare, fromString } from '../../../system/version.js';
import type { CachedBlame, CachedDiff, TrackedGitDocument } from '../../../trackers/trackedDocument.js';
import { GitDocumentState } from '../../../trackers/trackedDocument.js';
import type { Git } from './git.js';
import type { GitLocation } from './locator.js';
import { findGitPath, InvalidGitConfigError, UnableToFindGitError } from './locator.js';
import { BranchesGitSubProvider } from './sub-providers/branches.js';
import { CommitsGitSubProvider } from './sub-providers/commits.js';
import { ConfigGitSubProvider } from './sub-providers/config.js';
import { ContributorsGitSubProvider } from './sub-providers/contributors.js';
import { DiffGitSubProvider, findPathStatusChanged } from './sub-providers/diff.js';
import { GraphGitSubProvider } from './sub-providers/graph.js';
import { OperationsGitSubProvider } from './sub-providers/operations.js';
import { PatchGitSubProvider } from './sub-providers/patch.js';
import { PausedOperationsGitSubProvider } from './sub-providers/pausedOperations.js';
import { RefsGitSubProvider } from './sub-providers/refs.js';
import { RemotesGitSubProvider } from './sub-providers/remotes.js';
import { RevisionGitSubProvider } from './sub-providers/revision.js';
import { StagingGitSubProvider } from './sub-providers/staging.js';
import { StashGitSubProvider } from './sub-providers/stash.js';
import { StatusGitSubProvider } from './sub-providers/status.js';
import { TagsGitSubProvider } from './sub-providers/tags.js';
import { WorktreesGitSubProvider } from './sub-providers/worktrees.js';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);
const slash = 47;

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;

// Exposes `isTrackedWithDetails`, and any other needed private methods to internal sub-providers
export type LocalGitProviderInternal = Omit<LocalGitProvider, 'isTrackedWithDetails'> & {
	isTrackedWithDetails: LocalGitProvider['isTrackedWithDetails'];
};

export class LocalGitProvider implements GitProvider, Disposable {
	readonly descriptor: GitProviderDescriptor = { id: 'git', name: 'Git', virtual: false };
	readonly supportedSchemes = new Set<string>([
		Schemes.File,
		Schemes.Git,
		Schemes.GitLens,
		Schemes.PRs,
		// DocumentSchemes.Vsls,
	]);

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private _onWillChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onWillChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onWillChangeRepository.event;
	}

	private _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private _onDidCloseRepository = new EventEmitter<RepositoryCloseEvent>();
	get onDidCloseRepository(): Event<RepositoryCloseEvent> {
		return this._onDidCloseRepository.event;
	}

	private _onDidOpenRepository = new EventEmitter<RepositoryOpenEvent>();
	get onDidOpenRepository(): Event<RepositoryOpenEvent> {
		return this._onDidOpenRepository.event;
	}

	private readonly _cache: GitCache;
	private _disposables: Disposable[] = [];

	constructor(
		protected readonly container: Container,
		protected readonly git: Git,
	) {
		this._cache = new GitCache(this.container);
		this._disposables.push(
			this._onDidChange,
			this._onWillChangeRepository,
			this._onDidChangeRepository,
			this._onDidCloseRepository,
			this._onDidOpenRepository,
			this._cache,
		);
		this.git.setLocator(this.ensureGit.bind(this));
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		this._cache.onRepositoryChanged(repo.path, e);

		if (!e.changed('unknown', 'closed')) {
			if (e.changed('head')) {
				queueMicrotask(() => this.branches.onCurrentBranchAccessed(repo.path));
			}

			if (e.changed('index')) {
				queueMicrotask(() => this.branches.onCurrentBranchModified(repo.path));
			}
		}

		this._onWillChangeRepository.fire(e);
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

		async function subscribeToScmOpenCloseRepository(this: LocalGitProvider) {
			const scmGit = await scmGitPromise;
			if (scmGit == null) return;

			// Find env to pass to Git
			if ('env' in scmGit.git) {
				scope?.trace('Found built-in Git env');
				this.git.setEnv(scmGit.git.env as Record<string, unknown>);
			} else {
				for (const v of Object.values(scmGit.git)) {
					if (v != null && typeof v === 'object' && 'git' in v) {
						for (const vv of Object.values(v.git)) {
							if (vv != null && typeof vv === 'object' && 'GIT_ASKPASS' in vv) {
								scope?.trace('Found built-in Git env');

								this.git.setEnv(vv);
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
				for (const uri of closed) {
					this._onDidCloseRepository.fire({ uri: uri, source: 'scm' });
				}
			}, 1000);

			const opening = new UriSet();
			const fireRepositoryOpened = debounce(() => {
				if (this.container.deactivating) return;

				const opened = [...opening];
				opening.clear();

				for (const uri of opened) {
					this._onDidOpenRepository.fire({ uri: uri, source: 'scm' });
				}
			}, 1000);
			this._disposables.push(
				// Since we will get "close" events for repos when vscode is shutting down, debounce the event so ensure we aren't shutting down
				scmGit.onDidCloseRepository(e => {
					if (this.container.deactivating) return;

					closing.add(e.rootUri);
					fireRepositoryClosed();
				}),
				scmGit.onDidOpenRepository(e => {
					if (this.container.deactivating) return;

					opening.add(e.rootUri);
					fireRepositoryOpened();
				}),
			);

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
		options?: { cancellation?: CancellationToken; depth?: number; silent?: boolean },
	): Promise<Repository[]> {
		if (uri.scheme !== Schemes.File) return [];

		try {
			const autoRepositoryDetection = configuration.getCore('git.autoRepositoryDetection') ?? true;

			const folder = workspace.getWorkspaceFolder(uri);
			if (folder == null && !options?.silent) return [];

			void (await this.ensureGit());

			if (options?.cancellation?.isCancellationRequested) return [];

			const repositories = await this.repositorySearch(
				folder ?? uri,
				options?.depth ??
					(autoRepositoryDetection === false || autoRepositoryDetection === 'openEditors' ? 0 : undefined),
				options?.cancellation,
				options?.silent,
			);

			if (!options?.silent && (autoRepositoryDetection === true || autoRepositoryDetection === 'subFolders')) {
				for (const repository of repositories) {
					void this.getOrOpenScmRepository(repository.uri);
				}
			}

			if (!options?.silent && repositories.length > 0) {
				this._cache.trackedPaths.clear();
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
	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		gitDir: GitDir,
		root: boolean,
		closed?: boolean,
	): Repository[] {
		if (!closed) {
			void this.getOrOpenScmRepository(uri);
		}

		// Register the repo path mapping for worktree-aware caching
		this._cache.registerRepoPath(uri, gitDir);

		const opened = [
			new Repository(
				this.container,
				{
					onDidRepositoryChange: this._onDidChangeRepository,
					onRepositoryChanged: this.onRepositoryChanged.bind(this),
				},
				this.descriptor,
				folder ?? workspace.getWorkspaceFolder(uri),
				uri,
				gitDir,
				root,
				closed,
			),
		];

		// Add a closed (hidden) repository for the canonical version if not already opened
		const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
		if (canonicalUri != null && this.container.git.getRepository(canonicalUri) == null) {
			// Also register the canonical path for worktree-aware caching
			this._cache.registerRepoPath(canonicalUri, gitDir);

			opened.push(
				new Repository(
					this.container,
					{
						onDidRepositoryChange: this._onDidChangeRepository,
						onRepositoryChanged: this.onRepositoryChanged.bind(this),
					},
					this.descriptor,
					folder ?? workspace.getWorkspaceFolder(canonicalUri),
					canonicalUri,
					gitDir,
					root,
					true,
				),
			);
		}

		return opened;
	}

	@trace({ onlyExit: true })
	openRepositoryInitWatcher(): RepositoryInitWatcher {
		const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
		return { onDidCreate: watcher.onDidCreate, dispose: watcher.dispose };
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
					supported = await this.git.supports(feature);
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
		const remotes = await this.remotes.getRemotes(repoPath, { sort: true });
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
				url = await remote.provider.url({ type: RemoteResourceType.Repo });
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

			promise = fetch(url, { method: 'HEAD', agent: getProxyAgent(), signal: aborter.signal });
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
		cancellation?: CancellationToken,
		silent?: boolean | undefined,
	): Promise<Repository[]> {
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

		const repositories: Repository[] = [];

		let rootPath;
		let canonicalRootPath;

		const maybeAddRepo = async (uri: Uri, folder: WorkspaceFolder | undefined, root: boolean) => {
			const comparisonId = asRepoComparisonKey(uri);
			if (repositories.some(r => r.id === comparisonId)) {
				scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - duplicate`);
				return;
			}

			const repo = this.container.git.getRepository(uri);
			if (repo != null) {
				if (repo.closed && silent === false) {
					repo.closed = false;
				}
				scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - already open`);
				return;
			}

			scope?.info(`found ${root ? 'root ' : ''}repository in '${uri.fsPath}'`);
			const gitDir = await this.config.getGitDir(uri.fsPath);
			repositories.push(...this.openRepository(folder, uri, gitDir, root, silent));
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

		if (depth <= 0 || cancellation?.isCancellationRequested) return repositories;

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

	@trace({ args: (root, depth) => ({ root: root, depth: depth }), exit: true })
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Set<string>,
		cancellation?: CancellationToken,
		repositories: string[] = [],
	): Promise<string[]> {
		const scope = getScopedLogger();

		if (cancellation?.isCancellationRequested) return Promise.resolve(repositories);

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
					if (cancellation?.isCancellationRequested) break;

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
			const trackedPromise = this._cache.trackedPaths.get(repoPath, trackedKey);
			if (trackedPromise != null) {
				const resolved = await trackedPromise;
				if (resolved !== false) return this.getAbsoluteUri(resolved[0], resolved[1]);
			}

			// Make sure the file exists in the repo
			let exists = await this.revision.exists(repoPath, path);
			if (exists) return this.getAbsoluteUri(path, repoPath);

			// Check if the file exists untracked
			exists = await this.revision.exists(repoPath, path, { untracked: true });
			if (exists) return this.getAbsoluteUri(path, repoPath);

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

		if (path.charCodeAt(0) !== slash) {
			path = `/${path}`;
		}

		const metadata: RevisionUriData = {
			ref: rev,
			repoPath: normalizePath(repoPath),
			uncPath: uncPath,
			submoduleSha: options?.submoduleSha,
		};

		const uri = Uri.from({
			scheme: Schemes.GitLens,
			authority: encodeGitLensRevisionUriAuthority(metadata),
			path: path,
			// Replace `/` with `\u2009\u2215\u2009` so that it doesn't get treated as part of the path of the file
			query: rev
				? JSON.stringify({ ref: shortenRevision(rev).replaceAll('/', '\u2009\u2215\u2009') })
				: undefined,
		});
		return uri;
	}

	@debug({ exit: true })
	async getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined> {
		let relativePath = this.getRelativePath(uri, repoPath);

		let result;
		let rev;
		do {
			if (await this.revision.exists(repoPath, relativePath)) break;

			// TODO: Add caching

			// Get the most recent commit for this file name
			rev = first(await this.commits.getLogShas(repoPath, undefined, { limit: 1, pathOrUri: relativePath }));
			if (rev == null) return undefined;

			// Now check if that commit had any copies/renames
			result = await findPathStatusChanged(this.git, repoPath, relativePath, rev);
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
				const submoduleSha = await this.revision.getSubmoduleHead(repoPath, relativePath);
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
		const tree = await this.revision.getTreeEntryForRevision(repoPath, 'HEAD', relativePath);
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
			const result = await this.git.diff(root, relativePath, ref1, ref2);
			patch = result.stdout;
			void (await this.git.exec({ cwd: root, stdin: patch }, 'apply', '--whitespace=warn'));
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
					void (await this.git.exec({ cwd: root, stdin: patch }, 'apply', '--whitespace=warn', '--3way'));

					return;
				} catch (e) {
					// eslint-disable-next-line no-ex-assign
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
			return await this.git.clone(url, parentPath);
		} catch (ex) {
			scope?.error(ex);
			void showGenericErrorMessage(`Unable to clone '${url}'`);
		}

		return undefined;
	}

	@debug({ args: (repoPath, uris) => ({ repoPath: repoPath, uris: uris.length }) })
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		return this.getOrCreateIgnoreCache(repoPath).excludeIgnored(uris);
	}

	@trace()
	getIgnoredUrisFilter(repoPath: string): Promise<(uri: Uri) => boolean> {
		return this.getOrCreateIgnoreCache(repoPath).getIgnoredFilter();
	}

	private getOrCreateIgnoreCache(repoPath: string): GitIgnoreCache {
		let cache = this._cache.gitIgnore.get(repoPath);
		if (cache == null) {
			cache = new GitIgnoreCache(this.container, repoPath, () =>
				this.config.getConfig(repoPath, 'core.excludesFile'),
			);
			this._cache.gitIgnore.set(repoPath, cache);
		}
		return cache;
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
			const result = await this.git.rev_parse__repository_info(uri.fsPath);

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
								this._cache.gitDir.set(resultUri.fsPath, gitDir);
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
					this._cache.gitDir.set(fallbackUri.fsPath, gitDir);
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
				this._cache.gitDir.set(resultUri.fsPath, gitDir);
			}

			return resultUri;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@gate<LocalGitProvider['getBlame']>((u, d) => `${u.toString()}|${d?.isDirty}`)
	@debug({ args: (uri, document) => ({ uri: uri, document: document?.isDirty }) })
	async getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined> {
		const scope = getScopedLogger();

		if (document?.isDirty) return this.getBlameContents(uri, document.getText());

		let key = 'blame';
		if (uri.sha != null) {
			key += `:${uri.sha}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(document ?? uri);
		if (doc.state != null) {
			const cachedBlame = doc.state.getBlame(key);
			if (cachedBlame != null) {
				scope?.trace(`Cache hit: '${key}'`);
				return cachedBlame.item;
			}
		}

		scope?.trace(`Cache miss: '${key}'`);

		doc.state ??= new GitDocumentState();

		const promise = this.getBlameCore(uri, doc, key, scope);

		if (doc.state != null) {
			scope?.trace(`Cache add: '${key}'`);

			const value: CachedBlame = {
				item: promise as Promise<GitBlame>,
			};
			doc.state.setBlame(key, value);
		}

		return promise;
	}

	private async getBlameCore(
		uri: GitUri,
		document: TrackedGitDocument,
		key: string,
		scope: ScopedLogger | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedWithDetails(uri);
		if (paths == null) {
			scope?.debug(`Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [relativePath, root] = paths;

		try {
			const [dataResult, userResult, statResult] = await Promise.allSettled([
				this.git.blame(root, relativePath, {
					ref: uri.sha,
					args: configuration.get('advanced.blame.customArguments'),
					ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
				}),
				this.config.getCurrentUser(root),
				workspace.fs.stat(uri),
			]);

			const blame = parseGitBlame(
				this.container,
				root,
				getSettledValue(dataResult)?.stdout,
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			return blame;
		} catch (ex) {
			scope?.error(ex);

			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				scope?.trace(`Cache replace (with empty promise): '${key}'; reason=${msg}`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.setBlame(key, value);
				document.setBlameFailure(ex);

				if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
					void showBlameInvalidIgnoreRevsFileWarningMessage(ex);
				}

				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@debug({ args: (uri, _contents) => ({ uri: uri, contents: '<contents>' }) })
	async getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const scope = getScopedLogger();

		const key = `blame:${md5(contents)}`;

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (doc.state != null) {
			const cachedBlame = doc.state.getBlame(key);
			if (cachedBlame != null) {
				scope?.trace(`Cache hit: ${key}`);
				return cachedBlame.item;
			}
		}

		scope?.trace(`Cache miss: ${key}`);

		doc.state ??= new GitDocumentState();

		const promise = this.getBlameContentsCore(uri, contents, doc, key, scope);

		if (doc.state != null) {
			scope?.trace(`Cache add: '${key}'`);

			const value: CachedBlame = {
				item: promise as Promise<GitBlame>,
			};
			doc.state.setBlame(key, value);
		}

		return promise;
	}

	private async getBlameContentsCore(
		uri: GitUri,
		contents: string,
		document: TrackedGitDocument,
		key: string,
		scope: ScopedLogger | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedWithDetails(uri);
		if (paths == null) {
			scope?.debug(`Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [relativePath, root] = paths;

		try {
			const [dataResult, userResult, statResult] = await Promise.allSettled([
				this.git.blame(root, relativePath, {
					contents: contents,
					args: configuration.get('advanced.blame.customArguments'),
					correlationKey: `:${key}`,
					ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
				}),
				this.config.getCurrentUser(root),
				workspace.fs.stat(uri),
			]);

			const blame = parseGitBlame(
				this.container,
				root,
				getSettledValue(dataResult)?.stdout,
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			return blame;
		} catch (ex) {
			scope?.error(ex);

			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				scope?.trace(`Cache replace (with empty promise): '${key}'; reason=${msg}`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.setBlame(key, value);
				document.setBlameFailure(ex);

				if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
					void showBlameInvalidIgnoreRevsFileWarningMessage(ex);
				}

				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@gate<LocalGitProvider['getBlameForLine']>(
		(u, l, d, o) => `${u.toString()}|${l}|${d?.isDirty}|${o?.forceSingleLine}`,
	)
	@debug({ args: (uri, editorLine, document) => ({ uri: uri, editorLine: editorLine, document: document?.isDirty }) })
	async getBlameForLine(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
		document?: TextDocument | undefined,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (document?.isDirty) return this.getBlameForLineContents(uri, editorLine, document.getText(), options);

		const scope = getScopedLogger();

		if (!options?.forceSingleLine) {
			const blame = await this.getBlame(uri, document);
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

		const lineToBlame = editorLine + 1;
		const [relativePath, root] = splitPath(uri, uri.repoPath);

		try {
			const [dataResult, userResult, statResult] = await Promise.allSettled([
				this.git.blame(root, relativePath, {
					ref: uri.sha,
					args: configuration.get('advanced.blame.customArguments'),
					ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
					startLine: lineToBlame,
					endLine: lineToBlame,
				}),
				this.config.getCurrentUser(root),
				workspace.fs.stat(uri),
			]);

			const blame = parseGitBlame(
				this.container,
				root,
				getSettledValue(dataResult)?.stdout,
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			if (blame == null) return undefined;

			return {
				author: first(blame.authors.values())!,
				commit: first(blame.commits.values())!,
				line: blame.lines[editorLine],
			};
		} catch (ex) {
			scope?.error(ex);
			if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
				void showBlameInvalidIgnoreRevsFileWarningMessage(ex);
			}

			return undefined;
		}
	}

	@debug({ args: (uri, editorLine, _contents) => ({ uri: uri, editorLine: editorLine, contents: '<contents>' }) })
	async getBlameForLineContents(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
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

		const lineToBlame = editorLine + 1;
		const [relativePath, root] = splitPath(uri, uri.repoPath);

		try {
			const [dataResult, userResult, statResult] = await Promise.allSettled([
				this.git.blame(root, relativePath, {
					contents: contents,
					args: configuration.get('advanced.blame.customArguments'),
					ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
					startLine: lineToBlame,
					endLine: lineToBlame,
				}),
				this.config.getCurrentUser(root),
				workspace.fs.stat(uri),
			]);

			const blame = parseGitBlame(
				this.container,
				root,
				getSettledValue(dataResult)?.stdout,
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			if (blame == null) return undefined;

			return {
				author: first(blame.authors.values())!,
				commit: first(blame.commits.values())!,
				line: blame.lines[editorLine],
			};
		} catch {
			return undefined;
		}
	}

	@debug()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(uri);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@debug({ args: (uri, range, _contents) => ({ uri: uri, range: range, contents: '<contents>' }) })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined> {
		const blame = await this.getBlameContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@debug({ args: (_blame, uri, range) => ({ blame: '<blame>', uri: uri, range: range }) })
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlame | undefined {
		if (blame.lines.length === 0) return blame;

		if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
			return blame;
		}

		const lines = blame.lines.slice(range.start.line, range.end.line + 1);
		const shas = new Set(lines.map(l => l.sha));

		// ranges are 0-based
		const startLine = range.start.line + 1;
		const endLine = range.end.line + 1;

		const authors = new Map<string, GitBlameAuthor>();
		const commits = new Map<string, GitCommit>();
		for (const c of blame.commits.values()) {
			if (!shas.has(c.sha)) continue;

			const commit = c.with({
				lines: c.lines.filter(l => l.line >= startLine && l.line <= endLine),
			});
			commits.set(c.sha, commit);

			let author = authors.get(commit.author.name);
			if (author == null) {
				author = {
					name: commit.author.name,
					lineCount: 0,
				};
				authors.set(author.name, author);
			}

			author.lineCount += commit.lines.length;
		}

		const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

		return {
			repoPath: uri.repoPath!,
			authors: sortedAuthors,
			commits: commits,
			lines: lines,
		};
	}

	@debug()
	async getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
	): Promise<ParsedGitDiffHunks | undefined> {
		const scope = getScopedLogger();

		let key = 'diff';
		if (ref1 != null) {
			key += `:${ref1}`;
		}
		if (ref2 != null) {
			key += `:${ref2}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (doc.state != null) {
			const cachedDiff = doc.state.getDiff(key);
			if (cachedDiff != null) {
				scope?.trace(`Cache hit: '${key}'`);
				return cachedDiff.item;
			}
		}

		scope?.trace(`Cache miss: '${key}'`);

		doc.state ??= new GitDocumentState();

		const encoding = await getEncoding(uri);
		const promise = this.getDiffForFileCore(
			uri.repoPath,
			uri.fsPath,
			ref1,
			ref2,
			{ encoding: encoding },
			doc,
			key,
			scope,
		);

		if (doc.state != null) {
			scope?.trace(`Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<ParsedGitDiffHunks>,
			};
			doc.state.setDiff(key, value);
		}

		return promise;
	}

	private async getDiffForFileCore(
		repoPath: string | undefined,
		path: string,
		ref1: string | undefined,
		ref2: string | undefined,
		options: { encoding?: string },
		document: TrackedGitDocument,
		key: string,
		scope: ScopedLogger | undefined,
	): Promise<ParsedGitDiffHunks | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		try {
			const result = await this.git.diff(root, relativePath, ref1, ref2, {
				...options,
				filters: ['M'],
				linesOfContext: 0,
				renames: true,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const diff = parseGitFileDiff(result.stdout);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				scope?.trace(`Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<ParsedGitDiffHunks>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<ParsedGitDiffHunks>;
			}

			return undefined;
		}
	}

	@debug({ args: (uri, ref, _contents) => ({ uri: uri, ref: ref, contents: '<contents>' }) })
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<ParsedGitDiffHunks | undefined> {
		const scope = getScopedLogger();

		const key = `diff:${md5(contents)}`;

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (doc.state != null) {
			const cachedDiff = doc.state.getDiff(key);
			if (cachedDiff != null) {
				scope?.trace(`Cache hit: ${key}`);
				return cachedDiff.item;
			}
		}

		scope?.trace(`Cache miss: ${key}`);

		doc.state ??= new GitDocumentState();

		const encoding = await getEncoding(uri);
		const promise = this.getDiffForFileContentsCore(
			uri.repoPath,
			uri.fsPath,
			ref,
			contents,
			{ encoding: encoding },
			doc,
			key,
			scope,
		);

		if (doc.state != null) {
			scope?.trace(`Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<ParsedGitDiffHunks>,
			};
			doc.state.setDiff(key, value);
		}

		return promise;
	}

	private async getDiffForFileContentsCore(
		repoPath: string | undefined,
		path: string,
		ref: string,
		contents: string,
		options: { encoding?: string },
		document: TrackedGitDocument,
		key: string,
		scope: ScopedLogger | undefined,
	): Promise<ParsedGitDiffHunks | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		try {
			const data = await this.git.diff__contents(root, relativePath, ref, contents, {
				...options,
				filters: ['M'],
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const diff = parseGitFileDiff(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				scope?.trace(`Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<ParsedGitDiffHunks>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<ParsedGitDiffHunks>;
			}

			return undefined;
		}
	}

	@debug()
	async getDiffForLine(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitLineDiff | undefined> {
		try {
			const diff = await this.getDiffForFile(uri, ref1, ref2);
			if (diff == null) return undefined;

			const line = editorLine + 1;
			const hunk = diff.hunks.find(c => c.current.position.start <= line && c.current.position.end >= line);
			if (hunk == null) return undefined;

			const hunkLine = hunk.lines.get(line);
			if (hunkLine == null) return undefined;

			return {
				hunk: hunk,
				line: hunkLine,
			};
		} catch (_ex) {
			return undefined;
		}
	}

	@trace()
	getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		return this._cache.getLastFetchedTimestamp(repoPath, async (commonPath): Promise<number | undefined> => {
			try {
				const gitDir = await this.config.getGitDir(commonPath);
				// FETCH_HEAD is always in the common .git directory (gitDir.commonUri for worktrees)
				const gitDirUri = gitDir.commonUri ?? gitDir.uri;
				const stats = await workspace.fs.stat(Uri.joinPath(gitDirUri, 'FETCH_HEAD'));
				// If the file is empty, assume the fetch failed, and don't update the timestamp
				if (stats.size > 0) return stats.mtime;
			} catch {}

			return undefined;
		});
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
		let repository: Repository | undefined;

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
		const result = await this._cache.trackedPaths.getOrCreate(repoPath ?? '', key, async () => {
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
		repository: Repository | undefined,
	): Promise<[string, string] | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getScopedLogger();

		try {
			while (true) {
				if (!repoPath) {
					[relativePath, repoPath] = splitPath(path, '', true);
				}

				// Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
				let tracked = await this.revision.exists(repoPath, relativePath);
				if (tracked) return [relativePath, repoPath];

				if (repoPath) {
					const [newRelativePath, newRepoPath] = splitPath(path, '', true);
					if (newRelativePath !== relativePath) {
						// If we didn't find it, check it as close to the file as possible (will find nested repos)
						tracked = await this.revision.exists(newRepoPath, newRelativePath);
						if (tracked) {
							repository = await this.container.git.getOrOpenRepository(Uri.file(path), {
								detectNested: true,
							});
							if (repository != null) {
								return splitPath(path, repository.path);
							}

							return [newRelativePath, newRepoPath];
						}
					}
				}

				if (!tracked && ref && !isUncommitted(ref)) {
					tracked = await this.revision.exists(repoPath, relativePath, ref);
					// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
					if (!tracked) {
						tracked = await this.revision.exists(repoPath, relativePath, `${ref}^`);
					}
				}

				// Since the file isn't tracked, make sure it isn't part of a nested repository we don't know about yet
				if (!tracked) {
					if (repository != null) {
						// Don't look for a nested repository if the file isn't at least one folder deep
						const index = relativePath.indexOf('/');
						if (index < 0 || index === relativePath.length - 1) return undefined;

						const nested = await this.container.git.getOrOpenRepository(Uri.file(path), {
							detectNested: true,
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

	private _branches: BranchesGitSubProvider | undefined;
	get branches(): BranchesGitSubProvider {
		return (this._branches ??= new BranchesGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _commits: CommitsGitSubProvider | undefined;
	get commits(): CommitsGitSubProvider {
		return (this._commits ??= new CommitsGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _config: ConfigGitSubProvider | undefined;
	get config(): ConfigGitSubProvider {
		return (this._config ??= new ConfigGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _contributors: ContributorsGitSubProvider | undefined;
	get contributors(): ContributorsGitSubProvider {
		return (this._contributors ??= new ContributorsGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _diff: DiffGitSubProvider | undefined;
	get diff(): DiffGitSubProvider {
		return (this._diff ??= new DiffGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _graph: GraphGitSubProvider | undefined;
	get graph(): GraphGitSubProvider {
		return (this._graph ??= new GraphGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _operations: OperationsGitSubProvider | undefined;
	get ops(): OperationsGitSubProvider {
		return (this._operations ??= new OperationsGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _patch: PatchGitSubProvider | undefined;
	get patch(): PatchGitSubProvider | undefined {
		return (this._patch ??= new PatchGitSubProvider(
			this.container,
			this.git,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _pausedOperations: PausedOperationsGitSubProvider | undefined;
	get pausedOps(): PausedOperationsGitSubProvider {
		return (this._pausedOperations ??= new PausedOperationsGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _refs: RefsGitSubProvider | undefined;
	get refs(): RefsGitSubProvider {
		return (this._refs ??= new RefsGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _remotes: RemotesGitSubProvider | undefined;
	get remotes(): RemotesGitSubProvider {
		return (this._remotes ??= new RemotesGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _revision: RevisionGitSubProvider | undefined;
	get revision(): RevisionGitSubProvider {
		return (this._revision ??= new RevisionGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _staging: StagingGitSubProvider | undefined;
	get staging(): StagingGitSubProvider | undefined {
		return (this._staging ??= new StagingGitSubProvider(
			this.container,
			this.git,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _stash: StashGitSubProvider | undefined;
	get stash(): StashGitSubProvider {
		return (this._stash ??= new StashGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _status: StatusGitSubProvider | undefined;
	get status(): StatusGitSubProvider {
		return (this._status ??= new StatusGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
	}

	private _tags: TagsGitSubProvider | undefined;
	get tags(): TagsGitSubProvider {
		return (this._tags ??= new TagsGitSubProvider(this.container, this.git, this._cache));
	}
	private _worktrees: WorktreesGitSubProvider | undefined;
	get worktrees(): WorktreesGitSubProvider {
		return (this._worktrees ??= new WorktreesGitSubProvider(
			this.container,
			this.git,
			this._cache,
			this as unknown as LocalGitProviderInternal,
		));
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
			return gitApi?.getRepository(Uri.file(repoPath)) ?? undefined;
		} catch (ex) {
			scope?.error(ex);
			return undefined;
		}
	}

	@debug({ exit: true })
	async getOrOpenScmRepository(repoPath: string | Uri): Promise<ScmRepository | undefined> {
		const scope = getScopedLogger();

		try {
			const uri = repoPath instanceof Uri ? repoPath : Uri.file(repoPath);
			const gitApi = await this.getScmGitApi();
			if (gitApi == null) return undefined;

			// `getRepository` will return an opened repository that "contains" that path, so for nested repositories, we need to force the opening of the nested path, otherwise we will only get the root repository
			let repo = gitApi.getRepository(uri);
			if (repo == null || (repo != null && repo.rootUri.toString() !== uri.toString())) {
				scope?.trace(
					repo == null
						? '\u2022 no existing repository found, opening repository...'
						: `\u2022 existing, non-matching repository '${repo.rootUri.toString(
								true,
							)}' found, opening repository...`,
				);
				repo = await gitApi.openRepository?.(uri);
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

async function getEncoding(uri: Uri): Promise<string> {
	const encoding = configuration.getCore('files.encoding', uri);
	if (encoding == null || encoding === 'utf8') return 'utf8';

	const encodingExists = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).encodingExists;
	return encodingExists(encoding) ? encoding : 'utf8';
}
