import { readdir, realpath } from 'fs';
import { resolve as resolvePath } from 'path';
import type { CancellationToken, Disposable, Event, Range, TextDocument, WorkspaceFolder } from 'vscode';
import { EventEmitter, extensions, Uri, window, workspace } from 'vscode';
import { md5 } from '@env/crypto';
import { fetch, getProxyAgent } from '@env/fetch';
import { hrtime } from '@env/hrtime';
import { isLinux, isWindows } from '@env/platform';
import type { GitExtension, API as ScmGitApi } from '../../../@types/vscode.git';
import { GlyphChars, Schemes } from '../../../constants';
import type { Container } from '../../../container';
import type { Features } from '../../../features';
import { GitCache } from '../../../git/cache';
import { GitErrorHandling } from '../../../git/commandOptions';
import {
	BlameIgnoreRevsFileBadRevisionError,
	BlameIgnoreRevsFileError,
	FetchError,
	PullError,
	PushError,
	PushErrorReason,
} from '../../../git/errors';
import type {
	GitProvider,
	GitProviderDescriptor,
	RepositoryCloseEvent,
	RepositoryInitWatcher,
	RepositoryOpenEvent,
	RepositoryVisibility,
	RevisionUriData,
	ScmRepository,
} from '../../../git/gitProvider';
import type { GitUri } from '../../../git/gitUri';
import { isGitUri } from '../../../git/gitUri';
import { encodeGitLensRevisionUriAuthority } from '../../../git/gitUri.authority';
import type { GitBlame, GitBlameAuthor, GitBlameLine } from '../../../git/models/blame';
import type { GitCommit } from '../../../git/models/commit';
import type { GitLineDiff, ParsedGitDiffHunks } from '../../../git/models/diff';
import type { GitLog } from '../../../git/models/log';
import type { GitBranchReference, GitReference } from '../../../git/models/reference';
import type { GitRemote } from '../../../git/models/remote';
import { RemoteResourceType } from '../../../git/models/remoteResource';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { deletedOrMissing } from '../../../git/models/revision';
import { parseGitBlame } from '../../../git/parsers/blameParser';
import { parseGitFileDiff } from '../../../git/parsers/diffParser';
import { parseGitLogSimpleFormat, parseGitLogSimpleRenamed } from '../../../git/parsers/logParser';
import { getBranchNameAndRemote, getBranchTrackingWithoutRemote } from '../../../git/utils/branch.utils';
import { isBranchReference } from '../../../git/utils/reference.utils';
import { getVisibilityCacheKey } from '../../../git/utils/remote.utils';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '../../../git/utils/revision.utils';
import {
	showBlameInvalidIgnoreRevsFileWarningMessage,
	showGenericErrorMessage,
	showGitDisabledErrorMessage,
	showGitInvalidConfigErrorMessage,
	showGitMissingErrorMessage,
	showGitVersionUnsupportedErrorMessage,
} from '../../../messages';
import { asRepoComparisonKey } from '../../../repositories';
import { configuration } from '../../../system/-webview/configuration';
import { setContext } from '../../../system/-webview/context';
import { getBestPath, isFolderUri, relative, splitPath } from '../../../system/-webview/path';
import { gate } from '../../../system/decorators/-webview/gate';
import { debug, log } from '../../../system/decorators/log';
import { debounce } from '../../../system/function/debounce';
import { first, join } from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import { getLogScope, setLogScopeExit } from '../../../system/logger.scope';
import { commonBaseIndex, dirname, isAbsolute, maybeUri, normalizePath, pathEquals } from '../../../system/path';
import { any, asSettled, getSettledValue } from '../../../system/promise';
import { equalsIgnoreCase, getDurationMilliseconds, splitSingle } from '../../../system/string';
import { compare, fromString } from '../../../system/version';
import type { CachedBlame, CachedDiff, TrackedGitDocument } from '../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../trackers/trackedDocument';
import { registerCommitMessageProvider } from './commitMessageProvider';
import type { Git, PushForceOptions } from './git';
import type { GitLocation } from './locator';
import { findGitPath, InvalidGitConfigError, UnableToFindGitError } from './locator';
import { fsExists } from './shell';
import { BranchesGitSubProvider } from './sub-providers/branches';
import { CommitsGitSubProvider } from './sub-providers/commits';
import { ConfigGitSubProvider } from './sub-providers/config';
import { ContributorsGitSubProvider } from './sub-providers/contributors';
import { DiffGitSubProvider } from './sub-providers/diff';
import { GraphGitSubProvider } from './sub-providers/graph';
import { PatchGitSubProvider } from './sub-providers/patch';
import { RefsGitSubProvider } from './sub-providers/refs';
import { RemotesGitSubProvider } from './sub-providers/remotes';
import { RevisionGitSubProvider } from './sub-providers/revision';
import { StagingGitSubProvider } from './sub-providers/staging';
import { StashGitSubProvider } from './sub-providers/stash';
import { StatusGitSubProvider } from './sub-providers/status';
import { TagsGitSubProvider } from './sub-providers/tags';
import { WorktreesGitSubProvider } from './sub-providers/worktrees';

const emptyPromise: Promise<GitBlame | ParsedGitDiffHunks | GitLog | undefined> = Promise.resolve(undefined);
const slash = 47;

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;

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

	private get useCaching() {
		return configuration.get('advanced.caching.enabled');
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Config, RepositoryChangeComparisonMode.Any)) {
			this._cache.repoInfo?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Heads, RepositoryChange.Remotes, RepositoryChangeComparisonMode.Any)) {
			this._cache.branch?.delete(repo.path);
			this._cache.branches?.delete(repo.path);
			this._cache.contributors?.delete(repo.path);
			this._cache.worktrees?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Remotes, RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			this._cache.remotes?.delete(repo.path);
			this._cache.bestRemotes?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Index, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any)) {
			this._cache.trackedPaths.clear();
		}

		if (
			e.changed(
				RepositoryChange.CherryPick,
				RepositoryChange.Merge,
				RepositoryChange.Rebase,
				RepositoryChange.Revert,
				RepositoryChangeComparisonMode.Any,
			)
		) {
			this._cache.branch?.delete(repo.path);
			this._cache.pausedOperationStatus?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			this._cache.stashes?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Tags, RepositoryChangeComparisonMode.Any)) {
			this._cache.tags?.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Worktrees, RepositoryChangeComparisonMode.Any)) {
			this._cache.worktrees?.delete(repo.path);
		}

		this._onWillChangeRepository.fire(e);
	}

	private _gitLocator: Promise<GitLocation> | undefined;
	private async ensureGit(): Promise<GitLocation> {
		if (this._gitLocator == null) {
			this._gitLocator = this.findGit();
		}

		return this._gitLocator;
	}

	@log()
	private async findGit(): Promise<GitLocation> {
		const scope = getLogScope();

		if (!configuration.getCore('git.enabled', null, true)) {
			Logger.log(scope, 'Built-in Git is disabled ("git.enabled": false)');
			void showGitDisabledErrorMessage();

			throw new UnableToFindGitError();
		}

		const scmGitPromise = this.getScmGitApi();

		async function subscribeToScmOpenCloseRepository(this: LocalGitProvider) {
			const scmGit = await scmGitPromise;
			if (scmGit == null) return;

			registerCommitMessageProvider(this.container, scmGit);

			// Find env to pass to Git
			if ('env' in scmGit.git) {
				Logger.debug(scope, 'Found built-in Git env');
				this.git.setEnv(scmGit.git.env as Record<string, unknown>);
			} else {
				for (const v of Object.values(scmGit.git)) {
					if (v != null && typeof v === 'object' && 'git' in v) {
						for (const vv of Object.values(v.git)) {
							if (vv != null && typeof vv === 'object' && 'GIT_ASKPASS' in vv) {
								Logger.debug(scope, 'Found built-in Git env');

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

				for (const uri of closing) {
					this._onDidCloseRepository.fire({ uri: uri });
				}
				closing.clear();
			}, 1000);

			this._disposables.push(
				// Since we will get "close" events for repos when vscode is shutting down, debounce the event so ensure we aren't shutting down
				scmGit.onDidCloseRepository(e => {
					if (this.container.deactivating) return;

					closing.add(e.rootUri);
					fireRepositoryClosed();
				}),
				scmGit.onDidOpenRepository(e => this._onDidOpenRepository.fire({ uri: e.rootUri })),
			);

			for (const scmRepository of scmGit.repositories) {
				this._onDidOpenRepository.fire({ uri: scmRepository.rootUri });
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

		if (scope != null) {
			setLogScopeExit(
				scope,
				` ${GlyphChars.Dot} Git (${location.version}) found in ${
					location.path === 'git' ? 'PATH' : location.path
				}`,
			);
		} else {
			Logger.log(
				scope,
				`Git (${location.version}) found in ${
					location.path === 'git' ? 'PATH' : location.path
				} [${getDurationMilliseconds(start)}ms]`,
			);
		}

		// Warn if git is less than v2.7.2
		if (compare(fromString(location.version), fromString('2.7.2')) === -1) {
			Logger.log(scope, `Git version (${location.version}) is outdated`);
			void showGitVersionUnsupportedErrorMessage(location.version, '2.7.2');
		}

		return location;
	}

	@debug({ exit: true })
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

	@debug({ exit: true })
	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository[] {
		if (!closed) {
			void this.getOrOpenScmRepository(uri);
		}

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
				root,
				suspended ?? !window.state.focused,
				closed,
			),
		];

		// Add a closed (hidden) repository for the canonical version if not already opened
		const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
		if (canonicalUri != null && this.container.git.getRepository(canonicalUri) == null) {
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
					root,
					suspended ?? !window.state.focused,
					true,
				),
			);
		}

		return opened;
	}

	@debug({ singleLine: true })
	openRepositoryInitWatcher(): RepositoryInitWatcher {
		const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
		return { onDidCreate: watcher.onDidCreate, dispose: watcher.dispose };
	}

	private _supportedFeatures = new Map<Features, boolean>();
	async supports(feature: Features): Promise<boolean> {
		let supported = this._supportedFeatures.get(feature);
		if (supported != null) return supported;

		switch (feature) {
			case 'stashes' satisfies Features:
			case 'timeline' satisfies Features:
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

	@debug<LocalGitProvider['visibility']>({ exit: r => `returned ${r[0]}` })
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
	@debug<LocalGitProvider['getRemoteVisibility']>({ args: { 0: r => r.url }, exit: r => `returned ${r[0]}` })
	private async getRemoteVisibility(
		remote: GitRemote,
	): Promise<[visibility: RepositoryVisibility, remote: GitRemote]> {
		const scope = getLogScope();

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

			Logger.debug(scope, `Response=${rsp.status}`);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
		} finally {
			this._pendingRemoteVisibility.delete(url);
		}
		return ['private', remote];
	}

	@log<LocalGitProvider['repositorySearch']>({
		args: false,
		singleLine: true,
		prefix: (context, folder) => `${context.prefix}(${(folder instanceof Uri ? folder : folder.uri).fsPath})`,
		exit: r => `returned ${r.length} repositories ${r.length !== 0 ? Logger.toLoggable(r) : ''}`,
	})
	private async repositorySearch(
		folderOrUri: Uri | WorkspaceFolder,
		depth?: number,
		cancellation?: CancellationToken,
		silent?: boolean | undefined,
	): Promise<Repository[]> {
		const scope = getLogScope();

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

		Logger.log(scope, `searching (depth=${depth})...`);

		const repositories: Repository[] = [];

		let rootPath;
		let canonicalRootPath;

		function maybeAddRepo(this: LocalGitProvider, uri: Uri, folder: WorkspaceFolder | undefined, root: boolean) {
			const comparisonId = asRepoComparisonKey(uri);
			if (repositories.some(r => r.id === comparisonId)) {
				Logger.log(scope, `found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - duplicate`);
				return;
			}

			const repo = this.container.git.getRepository(uri);
			if (repo != null) {
				if (repo.closed && silent === false) {
					repo.closed = false;
				}
				Logger.log(scope, `found ${root ? 'root ' : ''}repository in '${uri.fsPath}'; skipping - already open`);
				return;
			}

			Logger.log(scope, `found ${root ? 'root ' : ''}repository in '${uri.fsPath}'`);
			repositories.push(...this.openRepository(folder, uri, root, undefined, silent));
		}

		const uri = await this.findRepositoryUri(rootUri, true);
		if (uri != null) {
			rootPath = normalizePath(uri.fsPath);

			const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
			if (canonicalUri != null) {
				canonicalRootPath = normalizePath(canonicalUri.fsPath);
			}

			maybeAddRepo.call(this, uri, folder, true);
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
				Logger.log(scope, `FAILED${msg ? ` Error: ${msg}` : ''}`);
			} else {
				Logger.error(ex, scope, 'FAILED');
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

			Logger.log(scope, `searching in '${p}'...`);
			Logger.debug(
				scope,
				`normalizedRepoPath=${normalized}, rootPath=${rootPath}, canonicalRootPath=${canonicalRootPath}`,
			);

			const rp = await this.findRepositoryUri(Uri.file(p), true);
			if (rp == null) continue;

			maybeAddRepo.call(this, rp, folder, false);
		}

		return repositories;
	}

	@debug<LocalGitProvider['repositorySearchCore']>({ args: { 2: false, 3: false }, exit: true })
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Set<string>,
		cancellation?: CancellationToken,
		repositories: string[] = [],
	): Promise<string[]> {
		const scope = getLogScope();

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
							Logger.error(ex, scope, 'FAILED');
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

	@log({ exit: true })
	async getBestRevisionUri(repoPath: string, path: string, rev: string | undefined): Promise<Uri | undefined> {
		if (rev === deletedOrMissing) return undefined;

		// TODO@eamodio Align this with isTrackedCore?
		if (!rev || (isUncommitted(rev) && !isUncommittedStaged(rev))) {
			// Make sure the file exists in the repo
			let data = await this.git.ls_files(repoPath, path);
			if (data != null) return this.getAbsoluteUri(path, repoPath);

			// Check if the file exists untracked
			data = await this.git.ls_files(repoPath, path, { untracked: true });
			if (data != null) return this.getAbsoluteUri(path, repoPath);

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

	getRevisionUri(repoPath: string, rev: string, path: string): Uri {
		if (isUncommitted(rev) && !isUncommittedStaged(rev)) return this.getAbsoluteUri(path, repoPath);

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

	@log({ exit: true })
	async getWorkingUri(repoPath: string, uri: Uri): Promise<Uri | undefined> {
		let relativePath = this.getRelativePath(uri, repoPath);

		let data;
		let ref;
		do {
			data = await this.git.ls_files(repoPath, relativePath);
			if (data != null) {
				relativePath = splitSingle(data, '\n')[0];
				break;
			}

			// TODO: Add caching

			const cfg = configuration.get('advanced');

			// Get the most recent commit for this file name
			ref = await this.git.log__file_recent(repoPath, relativePath, {
				ordering: cfg.commitOrdering,
				similarityThreshold: cfg.similarityThreshold,
			});
			if (ref == null) return undefined;

			// Now check if that commit had any renames
			data = await this.git.log__file(repoPath, '.', ref, {
				argsOrFormat: parseGitLogSimpleFormat,
				fileMode: 'simple',
				filters: ['R', 'C', 'D'],
				limit: 1,
				ordering: cfg.commitOrdering,
			});
			if (data == null || data.length === 0) break;

			const [foundRef, foundFile, foundStatus] = parseGitLogSimpleRenamed(data, relativePath);
			if (foundStatus === 'D' && foundFile != null) return undefined;
			if (foundRef == null || foundFile == null) break;

			relativePath = foundFile;
		} while (true);

		uri = this.getAbsoluteUri(relativePath, repoPath);
		return (await fsExists(uri.fsPath)) ? uri : undefined;
	}

	@log()
	async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const scope = getLogScope();

		ref1 = ref1 ?? uri.sha;
		if (ref1 == null || uri.repoPath == null) return;

		if (ref2 == null) {
			ref2 = ref1;
			ref1 = `${ref1}^`;
		}

		const [relativePath, root] = splitPath(uri, uri.repoPath);

		let patch;
		try {
			patch = await this.git.diff(root, relativePath, ref1, ref2);
			void (await this.git.exec({ cwd: root, stdin: patch }, 'apply', '--whitespace=warn'));
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (patch && /patch does not apply/i.test(msg)) {
				const result = await window.showWarningMessage(
					'Unable to apply changes cleanly. Retry and allow conflicts?',
					{ title: 'Yes' },
					{ title: 'No', isCloseAffordance: true },
				);

				if (result == null || result.title !== 'Yes') return;

				if (result.title === 'Yes') {
					try {
						void (await this.git.exec({ cwd: root, stdin: patch }, 'apply', '--whitespace=warn', '--3way'));

						return;
					} catch (e) {
						// eslint-disable-next-line no-ex-assign
						ex = e;
					}
				}
			}

			Logger.error(ex, scope);
			void showGenericErrorMessage('Unable to apply changes');
		}
	}

	@log()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { path?: string },
	): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.checkout(repoPath, ref, options);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['branches', 'status'] });
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (/overwritten by checkout/i.test(msg)) {
				void showGenericErrorMessage(
					`Unable to checkout '${ref}'. Please commit or stash your changes before switching branches`,
				);
				return;
			}

			Logger.error(ex, scope);
			void showGenericErrorMessage(`Unable to checkout '${ref}'`);
		}
	}

	@log()
	async clone(url: string, parentPath: string): Promise<string | undefined> {
		const scope = getLogScope();

		try {
			return await this.git.clone(url, parentPath);
		} catch (ex) {
			Logger.error(ex, scope);
			void showGenericErrorMessage(`Unable to clone '${url}'`);
		}

		return undefined;
	}

	@log<LocalGitProvider['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const paths = new Map<string, Uri>(uris.map(u => [normalizePath(u.fsPath), u]));

		const data = await this.git.exec(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore, stdin: join(paths.keys(), '\0') },
			'check-ignore',
			'-z',
			'--stdin',
		);
		if (data == null) return uris;

		const ignored = data.split('\0').filter(<T>(i?: T): i is T => Boolean(i));
		if (ignored.length === 0) return uris;

		for (const file of ignored) {
			paths.delete(file);
		}

		return [...paths.values()];
	}

	@gate()
	@log()
	async fetch(
		repoPath: string,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const scope = getLogScope();

		const { branch, ...opts } = options ?? {};
		try {
			if (isBranchReference(branch)) {
				const [branchName, remoteName] = getBranchNameAndRemote(branch);
				if (remoteName == null) return undefined;

				await this.git.fetch(repoPath, {
					branch: branchName,
					remote: remoteName,
					upstream: getBranchTrackingWithoutRemote(branch)!,
					pull: options?.pull,
				});
			} else {
				await this.git.fetch(repoPath, opts);
			}

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			if (!FetchError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
		}
	}

	@gate()
	@log()
	async push(
		repoPath: string,
		options?: { reference?: GitReference; force?: boolean; publish?: { remote: string } },
	): Promise<void> {
		const scope = getLogScope();

		let branchName: string;
		let remoteName: string | undefined;
		let upstreamName: string | undefined;
		let setUpstream:
			| {
					branch: string;
					remote: string;
					remoteBranch: string;
			  }
			| undefined;

		if (isBranchReference(options?.reference)) {
			if (options.publish != null) {
				branchName = options.reference.name;
				remoteName = options.publish.remote;
			} else {
				[branchName, remoteName] = getBranchNameAndRemote(options.reference);
			}
			upstreamName = getBranchTrackingWithoutRemote(options.reference);
		} else {
			const branch = await this.branches.getBranch(repoPath);
			if (branch == null) return;

			branchName =
				options?.reference != null
					? `${options.reference.ref}:${
							options?.publish != null ? 'refs/heads/' : ''
					  }${branch.getNameWithoutRemote()}`
					: branch.name;
			remoteName = branch.getRemoteName() ?? options?.publish?.remote;
			upstreamName = options?.reference == null && options?.publish != null ? branch.name : undefined;

			// Git can't setup remote tracking when publishing a new branch to a specific commit, so we'll need to do it after the push
			if (options?.publish?.remote != null && options?.reference != null) {
				setUpstream = {
					branch: branch.getNameWithoutRemote(),
					remote: remoteName!,
					remoteBranch: branch.getNameWithoutRemote(),
				};
			}
		}

		if (options?.publish == null && remoteName == null && upstreamName == null) {
			debugger;
			throw new PushError(PushErrorReason.Other);
		}

		let forceOpts: PushForceOptions | undefined;
		if (options?.force) {
			const withLease = configuration.getCore('git.useForcePushWithLease') ?? true;
			if (withLease) {
				forceOpts = {
					withLease: withLease,
					ifIncludes: configuration.getCore('git.useForcePushIfIncludes') ?? true,
				};
			} else {
				forceOpts = {
					withLease: withLease,
				};
			}
		}

		try {
			await this.git.push(repoPath, {
				branch: branchName,
				remote: remoteName,
				upstream: upstreamName,
				force: forceOpts,
				publish: options?.publish != null,
			});

			// Since Git can't setup remote tracking when publishing a new branch to a specific commit, do it now
			if (setUpstream != null) {
				await this.git.exec(
					{ cwd: repoPath },
					'branch',
					'--set-upstream-to',
					`${setUpstream.remote}/${setUpstream.remoteBranch}`,
					setUpstream.branch,
				);
			}

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			if (!PushError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
		}
	}

	@gate()
	@log()
	async pull(repoPath: string, options?: { rebase?: boolean; tags?: boolean }): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.pull(repoPath, {
				rebase: options?.rebase,
				tags: options?.tags,
			});

			this.container.events.fire('git:cache:reset', { repoPath: repoPath });
		} catch (ex) {
			Logger.error(ex, scope);
			if (!PullError.is(ex)) throw ex;

			void window.showErrorMessage(ex.message);
		}
	}

	private readonly toCanonicalMap = new Map<string, Uri>();
	private readonly fromCanonicalMap = new Map<string, Uri>();
	protected readonly unsafePaths = new Set<string>();

	@gate()
	@debug({ exit: true })
	async findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getLogScope();

		let repoPath: string | undefined;
		try {
			if (isDirectory == null) {
				isDirectory = await isFolderUri(uri);
			}

			// If the uri isn't a directory, go up one level
			if (!isDirectory) {
				uri = Uri.joinPath(uri, '..');
			}

			let safe;
			[safe, repoPath] = await this.git.rev_parse__show_toplevel(uri.fsPath);
			if (safe) {
				this.unsafePaths.delete(uri.fsPath);
			} else if (safe === false) {
				this.unsafePaths.add(uri.fsPath);
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
							const isDriveRoot = pathEquals(repoUri.fsPath, networkPath);

							repoPath = normalizePath(
								repoUri.fsPath.replace(
									networkPath,
									`${letter.toLowerCase()}:${isDriveRoot || networkPath.endsWith('\\') ? '\\' : ''}`,
								),
							);
							return Uri.file(repoPath);
						}
					} catch {}
				}

				return Uri.file(normalizePath(uri.fsPath));
			}

			// Check if we are a symlink and if so, use the symlink path (not its resolved path)
			// This is because VS Code will provide document Uris using the symlinked path
			const canonicalUri = this.toCanonicalMap.get(repoPath);
			if (canonicalUri == null) {
				let symlink;
				[repoPath, symlink] = await new Promise<[string, string | undefined]>(resolve => {
					realpath(uri.fsPath, { encoding: 'utf8' }, (err, resolvedPath) => {
						if (err != null) {
							Logger.debug(scope, `fs.realpath failed; repoPath=${repoPath}`);
							resolve([repoPath!, undefined]);
							return;
						}

						if (pathEquals(uri.fsPath, resolvedPath)) {
							Logger.debug(scope, `No symlink detected; repoPath=${repoPath}`);
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

						Logger.debug(
							scope,
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

			return repoPath ? Uri.file(repoPath) : undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@gate<LocalGitProvider['getBlame']>((u, d) => `${u.toString()}|${d?.isDirty}`)
	@log<LocalGitProvider['getBlame']>({ args: { 1: d => d?.isDirty } })
	async getBlame(uri: GitUri, document?: TextDocument | undefined): Promise<GitBlame | undefined> {
		const scope = getLogScope();

		if (document?.isDirty) return this.getBlameContents(uri, document.getText());

		let key = 'blame';
		if (uri.sha != null) {
			key += `:${uri.sha}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(document ?? uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.getBlame(key);
				if (cachedBlame != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedBlame.item;
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getBlameCore(uri, doc, key, scope);

		if (doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

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
		scope: LogScope | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedWithDetails(uri);
		if (paths == null) {
			Logger.log(scope, `Skipping blame; '${uri.fsPath}' is not tracked`);
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
				getSettledValue(dataResult),
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			return blame;
		} catch (ex) {
			Logger.error(ex, scope);

			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'; reason=${msg}`);

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

	@log<LocalGitProvider['getBlameContents']>({ args: { 1: '<contents>' } })
	async getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const scope = getLogScope();

		const key = `blame:${md5(contents)}`;

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.getBlame(key);
				if (cachedBlame != null) {
					Logger.debug(scope, `Cache hit: ${key}`);
					return cachedBlame.item;
				}
			}

			Logger.debug(scope, `Cache miss: ${key}`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getBlameContentsCore(uri, contents, doc, key, scope);

		if (doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

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
		scope: LogScope | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedWithDetails(uri);
		if (paths == null) {
			Logger.log(scope, `Skipping blame; '${uri.fsPath}' is not tracked`);
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
				getSettledValue(dataResult),
				getSettledValue(userResult),
				getSettledValue(statResult)?.mtime,
			);
			return blame;
		} catch (ex) {
			Logger.error(ex, scope);

			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'; reason=${msg}`);

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
	@log<LocalGitProvider['getBlameForLine']>({ args: { 2: d => d?.isDirty } })
	async getBlameForLine(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
		document?: TextDocument | undefined,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (document?.isDirty) return this.getBlameForLineContents(uri, editorLine, document.getText(), options);

		const scope = getLogScope();

		if (!options?.forceSingleLine && this.useCaching) {
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
				getSettledValue(dataResult),
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
			Logger.error(ex, scope);
			if (ex instanceof BlameIgnoreRevsFileError || ex instanceof BlameIgnoreRevsFileBadRevisionError) {
				void showBlameInvalidIgnoreRevsFileWarningMessage(ex);
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getBlameForLineContents']>({ args: { 2: '<contents>' } })
	async getBlameForLineContents(
		uri: GitUri,
		editorLine: number, // 0-based, Git is 1-based
		contents: string,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (!options?.forceSingleLine && this.useCaching) {
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
				getSettledValue(dataResult),
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

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlame | undefined> {
		const blame = await this.getBlame(uri);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlame | undefined> {
		const blame = await this.getBlameContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameRange']>({ args: { 0: '<blame>' } })
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

	@log()
	async getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
	): Promise<ParsedGitDiffHunks | undefined> {
		const scope = getLogScope();

		let key = 'diff';
		if (ref1 != null) {
			key += `:${ref1}`;
		}
		if (ref2 != null) {
			key += `:${ref2}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedDiff = doc.state.getDiff(key);
				if (cachedDiff != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedDiff.item;
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

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
			Logger.debug(scope, `Cache add: '${key}'`);

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
		scope: LogScope | undefined,
	): Promise<ParsedGitDiffHunks | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		try {
			const data = await this.git.diff(root, relativePath, ref1, ref2, {
				...options,
				filters: ['M'],
				linesOfContext: 0,
				renames: true,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const diff = parseGitFileDiff(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

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

	@log<LocalGitProvider['getDiffForFileContents']>({ args: { 1: '<contents>' } })
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<ParsedGitDiffHunks | undefined> {
		const scope = getLogScope();

		const key = `diff:${md5(contents)}`;

		const doc = await this.container.documentTracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedDiff = doc.state.getDiff(key);
				if (cachedDiff != null) {
					Logger.debug(scope, `Cache hit: ${key}`);
					return cachedDiff.item;
				}
			}

			Logger.debug(scope, `Cache miss: ${key}`);

			doc.state ??= new GitDocumentState();
		}

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
			Logger.debug(scope, `Cache add: '${key}'`);

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
		scope: LogScope | undefined,
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
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

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

	@log()
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

	@debug()
	async getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		try {
			const gitDir = await this.config.getGitDir(repoPath);
			const stats = await workspace.fs.stat(Uri.joinPath(gitDir.uri, 'FETCH_HEAD'));
			// If the file is empty, assume the fetch failed, and don't update the timestamp
			if (stats.size > 0) return stats.mtime;
		} catch {}

		return undefined;
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
	@log<LocalGitProvider['isTrackedWithDetails']>({
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
			repoPath = repoPath || repository?.path;

			[relativePath, repoPath] = splitPath(pathOrUri, repoPath);
		}

		const path = repoPath ? `${repoPath}/${relativePath}` : relativePath;

		let key = path;
		key = `${ref ?? ''}:${key.startsWith('/') ? key : `/${key}`}`;

		let tracked = this._cache.trackedPaths.get(key);
		if (tracked != null) return tracked;

		tracked = this.isTrackedCore(path, relativePath, repoPath ?? '', ref, repository);
		this._cache.trackedPaths.set(key, tracked);

		tracked = await tracked;
		this._cache.trackedPaths.set(key, tracked);
		return tracked;
	}

	@debug()
	private async isTrackedCore(
		path: string,
		relativePath: string,
		repoPath: string,
		ref: string | undefined,
		repository: Repository | undefined,
	): Promise<[string, string] | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getLogScope();

		try {
			while (true) {
				if (!repoPath) {
					[relativePath, repoPath] = splitPath(path, '', true);
				}

				// Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
				let tracked = Boolean(await this.git.ls_files(repoPath, relativePath));
				if (tracked) return [relativePath, repoPath];

				if (repoPath) {
					const [newRelativePath, newRepoPath] = splitPath(path, '', true);
					if (newRelativePath !== relativePath) {
						// If we didn't find it, check it as close to the file as possible (will find nested repos)
						tracked = Boolean(await this.git.ls_files(newRepoPath, newRelativePath));
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
					tracked = Boolean(await this.git.ls_files(repoPath, relativePath, { rev: ref }));
					// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
					if (!tracked) {
						tracked = Boolean(await this.git.ls_files(repoPath, relativePath, { rev: `${ref}^` }));
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
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	async reset(repoPath: string, ref: string, options?: { hard?: boolean } | { soft?: boolean }): Promise<void> {
		await this.git.reset(repoPath, [], { ...options, ref: ref });
	}

	@log({ args: { 2: false } })
	async runGitCommandViaTerminal(
		repoPath: string,
		command: string,
		args: string[],
		options?: { execute?: boolean },
	): Promise<void> {
		await this.git.runGitCommandViaTerminal(repoPath, command, args, options);

		// Right now we are reliant on the Repository class to fire the change event (as a stop gap if we don't detect a change through the normal mechanisms)
		// setTimeout(() => this.fireChange(RepositoryChange.Unknown), 2500);
	}

	private _branches: BranchesGitSubProvider | undefined;
	get branches(): BranchesGitSubProvider {
		return (this._branches ??= new BranchesGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _commits: CommitsGitSubProvider | undefined;
	get commits(): CommitsGitSubProvider {
		return (this._commits ??= new CommitsGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _config: ConfigGitSubProvider | undefined;
	get config(): ConfigGitSubProvider {
		return (this._config ??= new ConfigGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _contributors: ContributorsGitSubProvider | undefined;
	get contributors(): ContributorsGitSubProvider {
		return (this._contributors ??= new ContributorsGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _diff: DiffGitSubProvider | undefined;
	get diff(): DiffGitSubProvider {
		return (this._diff ??= new DiffGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _graph: GraphGitSubProvider | undefined;
	get graph(): GraphGitSubProvider {
		return (this._graph ??= new GraphGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _patch: PatchGitSubProvider | undefined;
	get patch(): PatchGitSubProvider | undefined {
		return (this._patch ??= new PatchGitSubProvider(this.container, this.git, this));
	}

	private _refs: RefsGitSubProvider | undefined;
	get refs(): RefsGitSubProvider {
		return (this._refs ??= new RefsGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _remotes: RemotesGitSubProvider | undefined;
	get remotes(): RemotesGitSubProvider {
		return (this._remotes ??= new RemotesGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _revision: RevisionGitSubProvider | undefined;
	get revision(): RevisionGitSubProvider {
		return (this._revision ??= new RevisionGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _staging: StagingGitSubProvider | undefined;
	get staging(): StagingGitSubProvider | undefined {
		return (this._staging ??= new StagingGitSubProvider(this.container, this.git));
	}

	private _stash: StashGitSubProvider | undefined;
	get stash(): StashGitSubProvider {
		return (this._stash ??= new StashGitSubProvider(this.container, this.git, this._cache));
	}

	private _status: StatusGitSubProvider | undefined;
	get status(): StatusGitSubProvider {
		return (this._status ??= new StatusGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _tags: TagsGitSubProvider | undefined;
	get tags(): TagsGitSubProvider {
		return (this._tags ??= new TagsGitSubProvider(this.container, this.git, this._cache));
	}
	private _worktrees: WorktreesGitSubProvider | undefined;
	get worktrees(): WorktreesGitSubProvider {
		return (this._worktrees ??= new WorktreesGitSubProvider(this.container, this.git, this._cache, this));
	}

	private _scmGitApi: Promise<ScmGitApi | undefined> | undefined;
	private async getScmGitApi(): Promise<ScmGitApi | undefined> {
		return this._scmGitApi ?? (this._scmGitApi = this.getScmGitApiCore());
	}

	@log()
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

	@log()
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const scope = getLogScope();
		try {
			const gitApi = await this.getScmGitApi();
			return gitApi?.repositories ?? [];
		} catch (ex) {
			Logger.error(ex, scope);
			return [];
		}
	}

	@log({ exit: true })
	async getScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const scope = getLogScope();
		try {
			const gitApi = await this.getScmGitApi();
			return gitApi?.getRepository(Uri.file(repoPath)) ?? undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log({ exit: true })
	async getOrOpenScmRepository(repoPath: string | Uri): Promise<ScmRepository | undefined> {
		const scope = getLogScope();
		try {
			const uri = repoPath instanceof Uri ? repoPath : Uri.file(repoPath);
			const gitApi = await this.getScmGitApi();
			if (gitApi == null) return undefined;

			// `getRepository` will return an opened repository that "contains" that path, so for nested repositories, we need to force the opening of the nested path, otherwise we will only get the root repository
			let repo = gitApi.getRepository(uri);
			if (repo == null || (repo != null && repo.rootUri.toString() !== uri.toString())) {
				Logger.debug(
					scope,
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
			Logger.error(ex, scope);
			return undefined;
		}
	}
}

async function getEncoding(uri: Uri): Promise<string> {
	const encoding = configuration.getCore('files.encoding', uri);
	if (encoding == null || encoding === 'utf8') return 'utf8';

	const encodingExists = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).encodingExists;
	return encodingExists(encoding) ? encoding : 'utf8';
}
