import { readdir, realpath } from 'fs';
import { homedir, hostname, userInfo } from 'os';
import { resolve as resolvePath } from 'path';
import { env as process_env } from 'process';
import type { Event, TextDocument, WorkspaceFolder } from 'vscode';
import { Disposable, env, EventEmitter, extensions, FileType, Range, Uri, window, workspace } from 'vscode';
import { fetch, getProxyAgent } from '@env/fetch';
import { hrtime } from '@env/hrtime';
import { isLinux, isWindows } from '@env/platform';
import type {
	API as BuiltInGitApi,
	Repository as BuiltInGitRepository,
	GitExtension,
} from '../../../@types/vscode.git';
import { configuration } from '../../../configuration';
import { CoreGitConfiguration, GlyphChars, Schemes } from '../../../constants';
import type { Container } from '../../../container';
import { emojify } from '../../../emojis';
import { Features } from '../../../features';
import {
	StashApplyError,
	StashApplyErrorReason,
	WorktreeCreateError,
	WorktreeCreateErrorReason,
	WorktreeDeleteError,
	WorktreeDeleteErrorReason,
} from '../../../git/errors';
import type {
	GitProvider,
	GitProviderDescriptor,
	NextComparisonUrisResult,
	PagedResult,
	PreviousComparisonUrisResult,
	PreviousLineComparisonUrisResult,
	RepositoryCloseEvent,
	RepositoryInitWatcher,
	RepositoryOpenEvent,
	RevisionUriData,
	ScmRepository,
} from '../../../git/gitProvider';
import { GitProviderId, RepositoryVisibility } from '../../../git/gitProvider';
import { GitProviderService } from '../../../git/gitProviderService';
import { encodeGitLensRevisionUriAuthority, GitUri } from '../../../git/gitUri';
import type { GitBlame, GitBlameAuthor, GitBlameLine, GitBlameLines } from '../../../git/models/blame';
import type { BranchSortOptions } from '../../../git/models/branch';
import {
	getBranchNameWithoutRemote,
	getRemoteNameFromBranchName,
	GitBranch,
	isDetachedHead,
	sortBranches,
} from '../../../git/models/branch';
import type { GitStashCommit } from '../../../git/models/commit';
import { GitCommit, GitCommitIdentity, isStash } from '../../../git/models/commit';
import { GitContributor } from '../../../git/models/contributor';
import type { GitDiff, GitDiffFilter, GitDiffHunkLine, GitDiffShortStat } from '../../../git/models/diff';
import type { GitFile, GitFileStatus } from '../../../git/models/file';
import { GitFileChange } from '../../../git/models/file';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowTag,
} from '../../../git/models/graph';
import { GitGraphRowType } from '../../../git/models/graph';
import type { GitLog } from '../../../git/models/log';
import type { GitMergeStatus } from '../../../git/models/merge';
import type { GitRebaseStatus } from '../../../git/models/rebase';
import type { GitBranchReference } from '../../../git/models/reference';
import { GitReference, GitRevision } from '../../../git/models/reference';
import type { GitReflog } from '../../../git/models/reflog';
import { getRemoteIconUri, GitRemote } from '../../../git/models/remote';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { GitStash } from '../../../git/models/stash';
import type { GitStatusFile } from '../../../git/models/status';
import { GitStatus } from '../../../git/models/status';
import type { GitTag, TagSortOptions } from '../../../git/models/tag';
import { sortTags } from '../../../git/models/tag';
import type { GitTreeEntry } from '../../../git/models/tree';
import type { GitUser } from '../../../git/models/user';
import { isUserMatch } from '../../../git/models/user';
import type { GitWorktree } from '../../../git/models/worktree';
import { GitBlameParser } from '../../../git/parsers/blameParser';
import { GitBranchParser } from '../../../git/parsers/branchParser';
import { GitDiffParser } from '../../../git/parsers/diffParser';
import { GitLogParser, LogType } from '../../../git/parsers/logParser';
import { GitReflogParser } from '../../../git/parsers/reflogParser';
import { GitRemoteParser } from '../../../git/parsers/remoteParser';
import { GitStatusParser } from '../../../git/parsers/statusParser';
import { GitTagParser } from '../../../git/parsers/tagParser';
import { GitTreeParser } from '../../../git/parsers/treeParser';
import { GitWorktreeParser } from '../../../git/parsers/worktreeParser';
import type { RemoteProviders } from '../../../git/remotes/factory';
import { RemoteProviderFactory } from '../../../git/remotes/factory';
import type { RemoteProvider, RichRemoteProvider } from '../../../git/remotes/provider';
import { RemoteResourceType } from '../../../git/remotes/provider';
import { SearchPattern } from '../../../git/search';
import { Logger } from '../../../logger';
import type { LogScope } from '../../../logger';
import {
	showGenericErrorMessage,
	showGitDisabledErrorMessage,
	showGitInvalidConfigErrorMessage,
	showGitMissingErrorMessage,
	showGitVersionUnsupportedErrorMessage,
} from '../../../messages';
import { countStringLength, filterMap } from '../../../system/array';
import { TimedCancellationSource } from '../../../system/cancellation';
import { gate } from '../../../system/decorators/gate';
import { debug, getLogScope, log } from '../../../system/decorators/log';
import { filterMap as filterMapIterable, find, first, last, some } from '../../../system/iterable';
import {
	commonBaseIndex,
	dirname,
	getBestPath,
	isAbsolute,
	isFolderGlob,
	joinPaths,
	maybeUri,
	normalizePath,
	relative,
	splitPath,
} from '../../../system/path';
import type { PromiseOrValue } from '../../../system/promise';
import { any, fastestSettled, getSettledValue } from '../../../system/promise';
import { equalsIgnoreCase, getDurationMilliseconds, interpolate, md5, splitSingle } from '../../../system/string';
import { PathTrie } from '../../../system/trie';
import { compare, fromString } from '../../../system/version';
import type { CachedBlame, CachedDiff, CachedLog, TrackedDocument } from '../../../trackers/gitDocumentTracker';
import { GitDocumentState } from '../../../trackers/gitDocumentTracker';
import type { Git } from './git';
import { GitErrors, maxGitCliLength } from './git';
import type { GitLocation } from './locator';
import { findGitPath, InvalidGitConfigError, UnableToFindGitError } from './locator';
import { fsExists, RunError } from './shell';

const emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
const slash = 47;

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const doubleQuoteRegex = /"/g;
const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;
const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;
const stashSummaryRegex =
	/(?:(?:(?<wip>WIP) on|On) (?<onref>[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\000-\037\177 ~^:?*[\\]+[^./]):\s*)?(?<summary>.*)$/s;

const reflogCommands = ['merge', 'pull'];

interface RepositoryInfo {
	gitDir?: string;
	user?: GitUser | null;
}

export class LocalGitProvider implements GitProvider, Disposable {
	readonly descriptor: GitProviderDescriptor = { id: GitProviderId.Git, name: 'Git', virtual: false };
	readonly supportedSchemes: Set<string> = new Set([
		Schemes.File,
		Schemes.Git,
		Schemes.GitLens,
		Schemes.PRs,
		// DocumentSchemes.Vsls,
	]);

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

	private readonly _branchesCache = new Map<string, Promise<PagedResult<GitBranch>>>();
	private readonly _contributorsCache = new Map<string, Promise<GitContributor[]>>();
	private readonly _mergeStatusCache = new Map<string, GitMergeStatus | null>();
	private readonly _rebaseStatusCache = new Map<string, GitRebaseStatus | null>();
	private readonly _repoInfoCache = new Map<string, RepositoryInfo>();
	private readonly _stashesCache = new Map<string, GitStash | null>();
	private readonly _tagsCache = new Map<string, Promise<PagedResult<GitTag>>>();
	private readonly _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();

	private _disposables: Disposable[] = [];

	constructor(protected readonly container: Container, protected readonly git: Git) {
		this.git.setLocator(this.ensureGit.bind(this));
	}

	dispose() {
		Disposable.from(...this._disposables).dispose();
	}

	private get useCaching() {
		return configuration.get('advanced.caching.enabled');
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Config, RepositoryChangeComparisonMode.Any)) {
			this._repoInfoCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Heads, RepositoryChange.Remotes, RepositoryChangeComparisonMode.Any)) {
			this._branchesCache.delete(repo.path);
			this._contributorsCache.delete(repo.path);
			this._contributorsCache.delete(`stats|${repo.path}`);
		}

		if (e.changed(RepositoryChange.Index, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any)) {
			this._trackedPaths.clear();
		}

		if (e.changed(RepositoryChange.Merge, RepositoryChangeComparisonMode.Any)) {
			this._mergeStatusCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) {
			this._rebaseStatusCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			this._stashesCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Tags, RepositoryChangeComparisonMode.Any)) {
			this._tagsCache.delete(repo.path);
		}

		this._onDidChangeRepository.fire(e);
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

		if (!configuration.getAny<boolean>('git.enabled', null, true)) {
			Logger.log(scope, 'Built-in Git is disabled ("git.enabled": false)');
			void showGitDisabledErrorMessage();

			throw new UnableToFindGitError();
		}

		const scmGitPromise = this.getScmGitApi();

		async function subscribeToScmOpenCloseRepository(this: LocalGitProvider) {
			const scmGit = await scmGitPromise;
			if (scmGit == null) return;

			this._disposables.push(
				scmGit.onDidCloseRepository(e => this._onDidCloseRepository.fire({ uri: e.rootUri })),
				scmGit.onDidOpenRepository(e => this._onDidOpenRepository.fire({ uri: e.rootUri })),
			);

			for (const scmRepository of scmGit.repositories) {
				this._onDidOpenRepository.fire({ uri: scmRepository.rootUri });
			}
		}
		void subscribeToScmOpenCloseRepository.call(this);

		const potentialGitPaths =
			configuration.getAny<string | string[]>('git.path') ?? this.container.storage.getWorkspace('gitPath');

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
		setTimeout(() => {
			void this.container.storage.storeWorkspace('gitPath', location.path);
		}, 1000);

		if (scope != null) {
			scope.exitDetails = ` ${GlyphChars.Dot} Git (${location.version}) found in ${
				location.path === 'git' ? 'PATH' : location.path
			}`;
		} else {
			Logger.log(
				scope,
				`Git (${location.version}) found in ${location.path === 'git' ? 'PATH' : location.path} ${
					GlyphChars.Dot
				} ${getDurationMilliseconds(start)} ms`,
			);
		}

		// Warn if git is less than v2.7.2
		if (compare(fromString(location.version), fromString('2.7.2')) === -1) {
			Logger.log(scope, `Git version (${location.version}) is outdated`);
			void showGitVersionUnsupportedErrorMessage(location.version, '2.7.2');
		}

		return location;
	}

	async discoverRepositories(uri: Uri): Promise<Repository[]> {
		if (uri.scheme !== Schemes.File) return [];

		try {
			void (await this.ensureGit());

			const autoRepositoryDetection =
				configuration.getAny<boolean | 'subFolders' | 'openEditors'>(
					CoreGitConfiguration.AutoRepositoryDetection,
				) ?? true;

			const folder = workspace.getWorkspaceFolder(uri);
			if (folder == null) return [];

			const repositories = await this.repositorySearch(
				folder,
				autoRepositoryDetection === false || autoRepositoryDetection === 'openEditors' ? 0 : undefined,
			);

			if (autoRepositoryDetection === true || autoRepositoryDetection === 'subFolders') {
				for (const repository of repositories) {
					void this.openScmRepository(repository.uri);
				}
			}

			if (repositories.length > 0) {
				this._trackedPaths.clear();
			}

			return repositories;
		} catch (ex) {
			if (ex instanceof InvalidGitConfigError) {
				void showGitInvalidConfigErrorMessage();
			} else if (ex instanceof UnableToFindGitError) {
				void showGitMissingErrorMessage();
			} else {
				const msg: string = ex?.message ?? '';
				if (msg) {
					void window.showErrorMessage(`Unable to initialize Git; ${msg}`);
				}
			}

			throw ex;
		}
	}

	openRepository(
		folder: WorkspaceFolder | undefined,
		uri: Uri,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository[] {
		if (!closed) {
			void this.openScmRepository(uri);
		}

		// Add a closed (hidden) repository for the canonical version
		const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
		if (canonicalUri != null) {
			return [
				new Repository(
					this.container,
					this.onRepositoryChanged.bind(this),
					this.descriptor,
					folder,
					uri,
					root,
					suspended ?? !window.state.focused,
					closed,
					// canonicalUri,
				),
				new Repository(
					this.container,
					this.onRepositoryChanged.bind(this),
					this.descriptor,
					folder,
					canonicalUri,
					root,
					suspended ?? !window.state.focused,
					true,
					// uri,
				),
			];
		}

		return [
			new Repository(
				this.container,
				this.onRepositoryChanged.bind(this),
				this.descriptor,
				folder,
				uri,
				root,
				suspended ?? !window.state.focused,
				closed,
			),
		];
	}

	openRepositoryInitWatcher(): RepositoryInitWatcher {
		const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
		return {
			onDidCreate: watcher.onDidCreate,
			dispose: () => void watcher.dispose(),
		};
	}

	private _supportedFeatures = new Map<Features, boolean>();
	async supports(feature: Features): Promise<boolean> {
		let supported = this._supportedFeatures.get(feature);
		if (supported != null) return supported;

		switch (feature) {
			case Features.Worktrees:
				supported = await this.git.isAtLeastVersion('2.17.0');
				this._supportedFeatures.set(feature, supported);
				return supported;
			default:
				return true;
		}
	}

	async visibility(repoPath: string): Promise<RepositoryVisibility> {
		const remotes = await this.getRemotes(repoPath);
		if (remotes.length === 0) return RepositoryVisibility.Local;

		const origin = remotes.find(r => r.name === 'origin');
		if (origin != null) {
			return this.getRemoteVisibility(origin);
		}

		const upstream = remotes.find(r => r.name === 'upstream');
		if (upstream != null) {
			return this.getRemoteVisibility(upstream);
		}

		for await (const result of fastestSettled(remotes.map(r => this.getRemoteVisibility(r)))) {
			if (result.status !== 'fulfilled') continue;

			if (result.value === RepositoryVisibility.Public) return RepositoryVisibility.Public;
		}

		return RepositoryVisibility.Private;
	}

	private async getRemoteVisibility(
		remote: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
	): Promise<RepositoryVisibility> {
		switch (remote.provider?.id) {
			case 'github':
			case 'gitlab':
			case 'bitbucket':
			case 'azure-devops':
			case 'gitea':
			case 'gerrit':
			case 'google-source': {
				const url = remote.provider.url({ type: RemoteResourceType.Repo });
				if (url == null) return RepositoryVisibility.Private;

				// Check if the url returns a 200 status code
				try {
					const response = await fetch(url, { method: 'HEAD', agent: getProxyAgent() });
					if (response.status === 200) {
						return RepositoryVisibility.Public;
					}
				} catch {}
				return RepositoryVisibility.Private;
			}
			default:
				return RepositoryVisibility.Private;
		}
	}

	@log<LocalGitProvider['repositorySearch']>({
		args: false,
		singleLine: true,
		prefix: (context, folder) => `${context.prefix}(${folder.uri.fsPath})`,
		exit: result =>
			`returned ${result.length} repositories${
				result.length !== 0 ? ` (${result.map(r => r.path).join(', ')})` : ''
			}`,
	})
	private async repositorySearch(folder: WorkspaceFolder, depth?: number): Promise<Repository[]> {
		const scope = getLogScope();
		depth =
			depth ??
			configuration.get('advanced.repositorySearchDepth', folder.uri) ??
			configuration.getAny<number>(CoreGitConfiguration.RepositoryScanMaxDepth, folder.uri, 1);

		Logger.log(scope, `searching (depth=${depth})...`);

		const repositories: Repository[] = [];

		let rootPath;
		let canonicalRootPath;

		const uri = await this.findRepositoryUri(folder.uri, true);
		if (uri != null) {
			rootPath = normalizePath(uri.fsPath);

			const canonicalUri = this.toCanonicalMap.get(getBestPath(uri));
			if (canonicalUri != null) {
				canonicalRootPath = normalizePath(canonicalUri.fsPath);
			}

			Logger.log(scope, `found root repository in '${uri.fsPath}'`);
			repositories.push(...this.openRepository(folder, uri, true));
		}

		if (depth <= 0) return repositories;

		// Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
		const excludedConfig = {
			...configuration.getAny<Record<string, boolean>>('files.exclude', folder.uri, {}),
			...configuration.getAny<Record<string, boolean>>('search.exclude', folder.uri, {}),
		};

		const excludedPaths = [
			...filterMapIterable(Object.entries(excludedConfig), ([key, value]) => {
				if (!value) return undefined;
				if (key.startsWith('**/')) return key.substring(3);
				return key;
			}),
		];

		const excludes = excludedPaths.reduce((accumulator, current) => {
			accumulator.add(current);
			return accumulator;
		}, new Set<string>());

		let repoPaths;
		try {
			repoPaths = await this.repositorySearchCore(folder.uri.fsPath, depth, excludes);
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

			Logger.log(scope, `found repository in '${rp.fsPath}'`);
			repositories.push(...this.openRepository(folder, rp, false));
		}

		return repositories;
	}

	@debug<LocalGitProvider['repositorySearchCore']>({ args: { 2: false, 3: false } })
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Set<string>,
		repositories: string[] = [],
	): Promise<string[]> {
		const scope = getLogScope();

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
					if (f.name === '.git') {
						repositories.push(resolvePath(root, f.name));
					} else if (depth >= 0 && f.isDirectory() && !excludes.has(f.name)) {
						try {
							await this.repositorySearchCore(resolvePath(root, f.name), depth, excludes, repositories);
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
		if (typeof pathOrUri === 'string' && !isAbsolute(pathOrUri)) {
			return Uri.joinPath(base, normalizePath(pathOrUri));
		}

		const relativePath = this.getRelativePath(pathOrUri, base);
		return Uri.joinPath(base, relativePath);
	}

	@log()
	async getBestRevisionUri(repoPath: string, path: string, ref: string | undefined): Promise<Uri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		// TODO@eamodio Align this with isTrackedCore?
		if (!ref || (GitRevision.isUncommitted(ref) && !GitRevision.isUncommittedStaged(ref))) {
			// Make sure the file exists in the repo
			let data = await this.git.ls_files(repoPath, path);
			if (data != null) return this.getAbsoluteUri(path, repoPath);

			// Check if the file exists untracked
			data = await this.git.ls_files(repoPath, path, { untracked: true });
			if (data != null) return this.getAbsoluteUri(path, repoPath);

			return undefined;
		}

		if (GitRevision.isUncommittedStaged(ref)) return this.getScmGitUri(path, repoPath);

		return this.getRevisionUri(repoPath, path, ref);
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

	getRevisionUri(repoPath: string, path: string, ref: string): Uri {
		if (GitRevision.isUncommitted(ref)) {
			return GitRevision.isUncommittedStaged(ref)
				? this.getScmGitUri(path, repoPath)
				: this.getAbsoluteUri(path, repoPath);
		}

		path = normalizePath(this.getAbsoluteUri(path, repoPath).fsPath);
		if (path.charCodeAt(0) !== slash) {
			path = `/${path}`;
		}

		const metadata: RevisionUriData = {
			ref: ref,
			repoPath: normalizePath(repoPath),
		};

		const uri = Uri.from({
			scheme: Schemes.GitLens,
			authority: encodeGitLensRevisionUriAuthority(metadata),
			path: path,
			query: ref ? JSON.stringify({ ref: GitRevision.shorten(ref) }) : undefined,
		});
		return uri;
	}

	@log()
	async getWorkingUri(repoPath: string, uri: Uri) {
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
				argsOrFormat: GitLogParser.simpleFormat,
				fileMode: 'simple',
				filters: ['R', 'C', 'D'],
				limit: 1,
				ordering: cfg.commitOrdering,
			});
			if (data == null || data.length === 0) break;

			const [foundRef, foundFile, foundStatus] = GitLogParser.parseSimpleRenamed(data, relativePath);
			if (foundStatus === 'D' && foundFile != null) return undefined;
			if (foundRef == null || foundFile == null) break;

			relativePath = foundFile;
		} while (true);

		uri = this.getAbsoluteUri(relativePath, repoPath);
		return (await fsExists(uri.fsPath)) ? uri : undefined;
	}

	@log()
	async addRemote(repoPath: string, name: string, url: string): Promise<void> {
		await this.git.remote__add(repoPath, name, url);
	}

	@log()
	async pruneRemote(repoPath: string, remoteName: string): Promise<void> {
		await this.git.remote__prune(repoPath, remoteName);
	}

	@log()
	async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string) {
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
			void (await this.git.apply(root, patch));
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
						void (await this.git.apply(root, patch, { allowConflicts: true }));

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
	resetCaches(...affects: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]) {
		if (affects.length === 0 || affects.includes('branches')) {
			this._branchesCache.clear();
		}

		if (affects.length === 0 || affects.includes('contributors')) {
			this._contributorsCache.clear();
		}

		if (affects.length === 0 || affects.includes('stashes')) {
			this._stashesCache.clear();
		}

		if (affects.length === 0 || affects.includes('status')) {
			this._mergeStatusCache.clear();
			this._rebaseStatusCache.clear();
		}

		if (affects.length === 0 || affects.includes('tags')) {
			this._tagsCache.clear();
		}

		if (affects.length === 0) {
			this._trackedPaths.clear();
			this._repoInfoCache.clear();
		}
	}

	@log<LocalGitProvider['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const paths = new Map<string, Uri>(uris.map(u => [normalizePath(u.fsPath), u]));

		const data = await this.git.check_ignore(repoPath, ...paths.keys());
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
		const { branch: branchRef, ...opts } = options ?? {};
		if (GitReference.isBranch(branchRef)) {
			const repo = this.container.git.getRepository(repoPath);
			const branch = await repo?.getBranch(branchRef?.name);
			if (!branch?.remote && branch?.upstream == null) return undefined;

			return this.git.fetch(repoPath, {
				branch: branch.getNameWithoutRemote(),
				remote: branch.getRemoteName()!,
				upstream: branch.getTrackingWithoutRemote()!,
				pull: options?.pull,
			});
		}

		return this.git.fetch(repoPath, opts);
	}

	private readonly toCanonicalMap = new Map<string, Uri>();
	private readonly fromCanonicalMap = new Map<string, Uri>();

	@gate()
	@debug()
	async findRepositoryUri(uri: Uri, isDirectory?: boolean): Promise<Uri | undefined> {
		const scope = getLogScope();

		let repoPath: string | undefined;
		try {
			if (isDirectory == null) {
				const stats = await workspace.fs.stat(uri);
				isDirectory = (stats.type & FileType.Directory) === FileType.Directory;
			}

			// If the uri isn't a directory, go up one level
			if (!isDirectory) {
				uri = Uri.joinPath(uri, '..');
			}

			repoPath = await this.git.rev_parse__show_toplevel(uri.fsPath);
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
							repoPath = normalizePath(
								repoUri.fsPath.replace(
									networkPath,
									`${letter.toLowerCase()}:${networkPath.endsWith('\\') ? '\\' : ''}`,
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

						if (equalsIgnoreCase(uri.fsPath, resolvedPath)) {
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

	@log<LocalGitProvider['getAheadBehindCommitCount']>({ args: { 1: refs => refs.join(',') } })
	getAheadBehindCommitCount(
		repoPath: string,
		refs: string[],
	): Promise<{ ahead: number; behind: number } | undefined> {
		return this.git.rev_list__left_right(repoPath, refs);
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

		const doc = await this.container.tracker.getOrAdd(document ?? uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.getBlame(key);
				if (cachedBlame != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedBlame.item;
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
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
		document: TrackedDocument<GitDocumentState>,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedPrivate(uri);
		if (paths == null) {
			Logger.log(scope, `Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [relativePath, root] = paths;

		try {
			const data = await this.git.blame(root, relativePath, uri.sha, {
				args: configuration.get('advanced.blame.customArguments'),
				ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
			});
			const blame = GitBlameParser.parse(this.container, data, root, await this.getCurrentUser(root));
			return blame;
		} catch (ex) {
			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.setBlame(key, value);

				document.setBlameFailure();

				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getBlameContents']>({ args: { 1: '<contents>' } })
	async getBlameContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const scope = getLogScope();

		const key = `blame:${md5(contents)}`;

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.getBlame(key);
				if (cachedBlame != null) {
					Logger.debug(scope, `Cache hit: ${key}`);
					return cachedBlame.item;
				}
			}

			Logger.debug(scope, `Cache miss: ${key}`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
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
		document: TrackedDocument<GitDocumentState>,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitBlame | undefined> {
		const paths = await this.isTrackedPrivate(uri);
		if (paths == null) {
			Logger.log(scope, `Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [relativePath, root] = paths;

		try {
			const data = await this.git.blame__contents(root, relativePath, contents, {
				args: configuration.get('advanced.blame.customArguments'),
				correlationKey: `:${key}`,
				ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
			});
			const blame = GitBlameParser.parse(this.container, data, root, await this.getCurrentUser(root));
			return blame;
		} catch (ex) {
			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.setBlame(key, value);

				document.setBlameFailure();
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
			const data = await this.git.blame(root, relativePath, uri.sha, {
				args: configuration.get('advanced.blame.customArguments'),
				ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
				startLine: lineToBlame,
				endLine: lineToBlame,
			});
			const blame = GitBlameParser.parse(this.container, data, root, await this.getCurrentUser(root));
			if (blame == null) return undefined;

			return {
				author: first(blame.authors.values()),
				commit: first(blame.commits.values()),
				line: blame.lines[editorLine],
			};
		} catch {
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
			const data = await this.git.blame__contents(root, relativePath, contents, {
				args: configuration.get('advanced.blame.customArguments'),
				ignoreWhitespace: configuration.get('blame.ignoreWhitespace'),
				startLine: lineToBlame,
				endLine: lineToBlame,
			});
			const blame = GitBlameParser.parse(this.container, data, root, await this.getCurrentUser(root));
			if (blame == null) return undefined;

			return {
				author: first(blame.authors.values()),
				commit: first(blame.commits.values()),
				line: blame.lines[editorLine],
			};
		} catch {
			return undefined;
		}
	}

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
		const blame = await this.getBlame(uri);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
		const blame = await this.getBlameContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameRange(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameRange']>({ args: { 0: '<blame>' } })
	getBlameRange(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
		if (blame.lines.length === 0) return { allLines: blame.lines, ...blame };

		if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
			return { allLines: blame.lines, ...blame };
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
			allLines: blame.lines,
		};
	}

	@log()
	async getBranch(repoPath: string): Promise<GitBranch | undefined> {
		let {
			values: [branch],
		} = await this.getBranches(repoPath, { filter: b => b.current });
		if (branch != null) return branch;

		const commitOrdering = configuration.get('advanced.commitOrdering');

		const data = await this.git.rev_parse__currentBranch(repoPath, commitOrdering);
		if (data == null) return undefined;

		const [name, upstream] = data[0].split('\n');
		if (isDetachedHead(name)) {
			const [rebaseStatus, committerDate] = await Promise.all([
				this.getRebaseStatus(repoPath),

				this.git.log__recent_committerdate(repoPath, commitOrdering),
			]);

			branch = new GitBranch(
				repoPath,
				rebaseStatus?.incoming.name ?? name,
				false,
				true,
				committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
				data[1],
				upstream ? { name: upstream, missing: false } : undefined,
				undefined,
				undefined,
				undefined,
				rebaseStatus != null,
			);
		}

		return branch;
	}

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string | undefined,
		options?: {
			cursor?: string;
			filter?: (b: GitBranch) => boolean;
			sort?: boolean | BranchSortOptions;
		},
	): Promise<PagedResult<GitBranch>> {
		if (repoPath == null) return emptyPagedResult;

		let resultsPromise = this.useCaching ? this._branchesCache.get(repoPath) : undefined;
		if (resultsPromise == null) {
			async function load(this: LocalGitProvider): Promise<PagedResult<GitBranch>> {
				try {
					const data = await this.git.for_each_ref__branch(repoPath!, { all: true });
					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (data == null || data.length === 0) {
						let current;

						const commitOrdering = configuration.get('advanced.commitOrdering');

						const data = await this.git.rev_parse__currentBranch(repoPath!, commitOrdering);
						if (data != null) {
							const [name, upstream] = data[0].split('\n');
							const [rebaseStatus, committerDate] = await Promise.all([
								isDetachedHead(name) ? this.getRebaseStatus(repoPath!) : undefined,
								this.git.log__recent_committerdate(repoPath!, commitOrdering),
							]);

							current = new GitBranch(
								repoPath!,
								rebaseStatus?.incoming.name ?? name,
								false,
								true,
								committerDate != null ? new Date(Number(committerDate) * 1000) : undefined,
								data[1],
								{ name: upstream, missing: false },
								undefined,
								undefined,
								undefined,
								rebaseStatus != null,
							);
						}

						return current != null ? { values: [current] } : emptyPagedResult;
					}

					return { values: GitBranchParser.parse(data, repoPath!) };
				} catch (ex) {
					this._branchesCache.delete(repoPath!);

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (this.useCaching) {
				if (options?.cursor == null) {
					this._branchesCache.set(repoPath, resultsPromise);
				}
			}
		}

		let result = await resultsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort) {
			sortBranches(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		const data = await this.git.diff__shortstat(repoPath, ref);
		if (!data) return undefined;

		return GitDiffParser.parseShortStat(data);
	}

	@log()
	async getCommit(repoPath: string, ref: string): Promise<GitCommit | undefined> {
		const log = await this.getLog(repoPath, { limit: 2, ref: ref });
		if (log == null) return undefined;

		return log.commits.get(ref) ?? first(log.commits.values());
	}

	@log()
	async getCommitBranches(
		repoPath: string,
		ref: string,
		options?: { branch?: string; commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		if (options?.branch) {
			const data = await this.git.branch__containsOrPointsAt(repoPath, ref, {
				mode: 'contains',
				name: options.branch,
			});
			if (!data) return [];

			return [data?.trim()];
		}

		const data = await this.git.branch__containsOrPointsAt(repoPath, ref, options);
		if (!data) return [];

		return filterMap(data.split('\n'), b => b.trim() || undefined);
	}

	@log()
	getCommitCount(repoPath: string, ref: string): Promise<number | undefined> {
		return this.git.rev_list__count(repoPath, ref);
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		uri: Uri,
		options?: { ref?: string; firstIfNotFound?: boolean; range?: Range },
	): Promise<GitCommit | undefined> {
		const scope = getLogScope();

		const [relativePath, root] = splitPath(uri, repoPath);

		try {
			const log = await this.getLogForFile(root, relativePath, {
				limit: 2,
				ref: options?.ref,
				range: options?.range,
			});
			if (log == null) return undefined;

			let commit;
			if (options?.ref) {
				const commit = log.commits.get(options.ref);
				if (commit == null && !options?.firstIfNotFound) {
					// If the ref isn't a valid sha we will never find it, so let it fall through so we return the first
					if (GitRevision.isSha(options.ref) || GitRevision.isUncommitted(options.ref)) return undefined;
				}
			}

			return commit ?? first(log.commits.values());
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	async getCommitsForGraph(
		repoPath: string,
		asWebviewUri: (uri: Uri) => Uri,
		options?: {
			branch?: string;
			limit?: number;
			mode?: 'single' | 'local' | 'all';
			ref?: string;
		},
	): Promise<GitGraph> {
		const [logResult, stashResult, remotesResult] = await Promise.allSettled([
			this.getLog(repoPath, { all: true, ordering: 'date', limit: options?.limit }),
			this.getStash(repoPath),
			this.getRemotes(repoPath),
		]);

		return this.getCommitsForGraphCore(
			repoPath,
			asWebviewUri,
			getSettledValue(logResult),
			getSettledValue(stashResult),
			getSettledValue(remotesResult),
			options,
		);
	}

	private async getCommitsForGraphCore(
		repoPath: string,
		asWebviewUri: (uri: Uri) => Uri,
		log: GitLog | undefined,
		stash: GitStash | undefined,
		remotes: GitRemote[] | undefined,
		options?: {
			ref?: string;
			mode?: 'single' | 'local' | 'all';
			branch?: string;
		},
	): Promise<GitGraph> {
		if (log == null) {
			return {
				repoPath: repoPath,
				rows: [],
			};
		}

		const commits = (log.pagedCommits?.() ?? log.commits)?.values();
		if (commits == null) {
			return {
				repoPath: repoPath,
				rows: [],
			};
		}

		const rows: GitGraphRow[] = [];

		let current = false;
		let refHeads: GitGraphRowHead[];
		let refRemoteHeads: GitGraphRowRemoteHead[];
		let refTags: GitGraphRowTag[];
		let parents: string[];
		let remoteName: string;
		let isStashCommit: boolean;

		const remoteMap = remotes != null ? new Map(remotes.map(r => [r.name, r])) : new Map();

		const skipStashParents = new Set();

		for (const commit of commits) {
			if (skipStashParents.has(commit.sha)) continue;

			refHeads = [];
			refRemoteHeads = [];
			refTags = [];

			if (commit.tips != null) {
				for (let tip of commit.tips) {
					if (tip === 'refs/stash' || tip === 'HEAD') continue;

					if (tip.startsWith('tag: ')) {
						refTags.push({
							name: tip.substring(5),
							// Not currently used, so don't bother filling it out
							annotated: false,
						});

						continue;
					}

					current = tip.startsWith('HEAD -> ');
					if (current) {
						tip = tip.substring(8);
					}

					remoteName = getRemoteNameFromBranchName(tip);
					if (remoteName) {
						const remote = remoteMap.get(remoteName);
						if (remote != null) {
							const branchName = getBranchNameWithoutRemote(tip);
							if (branchName === 'HEAD') continue;

							refRemoteHeads.push({
								name: branchName,
								owner: remote.name,
								url: remote.url,
								avatarUrl: (
									remote.provider?.avatarUri ?? getRemoteIconUri(this.container, remote, asWebviewUri)
								)?.toString(true),
							});

							continue;
						}
					}

					refHeads.push({
						name: tip,
						isCurrentHead: current,
					});
				}
			}

			isStashCommit = isStash(commit) || (stash?.commits.has(commit.sha) ?? false);

			parents = commit.parents;
			// Remove the second & third parent, if exists, from each stash commit as it is a Git implementation for the index and untracked files
			if (isStashCommit && parents.length > 1) {
				// Copy the array to avoid mutating the original
				parents = [...parents];

				// Skip the "index commit" (e.g. contains staged files) of the stash
				skipStashParents.add(parents[1]);
				// Skip the "untracked commit" (e.g. contains untracked files) of the stash
				skipStashParents.add(parents[2]);
				parents.splice(1, 2);
			}

			rows.push({
				sha: commit.sha,
				parents: parents,
				author: commit.author.name,
				avatarUrl: !isStashCommit ? (await commit.getAvatarUri())?.toString(true) : undefined,
				email: commit.author.email ?? '',
				date: commit.committer.date.getTime(),
				message: emojify(commit.message && String(commit.message).length ? commit.message : commit.summary),
				// TODO: review logic for stash, wip, etc
				type: isStashCommit
					? GitGraphRowType.Stash
					: commit.parents.length > 1
					? GitGraphRowType.MergeCommit
					: GitGraphRowType.Commit,
				heads: refHeads,
				remotes: refRemoteHeads,
				tags: refTags,
			});
		}

		return {
			repoPath: repoPath,
			paging: {
				limit: log.limit,
				endingCursor: log.endingCursor,
				startingCursor: log.startingCursor,
				more: log.hasMore,
			},
			rows: rows,

			more: async (limit: number | { until: string } | undefined): Promise<GitGraph | undefined> => {
				const moreLog = await log.more?.(limit);
				return this.getCommitsForGraphCore(repoPath, asWebviewUri, moreLog, stash, remotes, options);
			},
		};
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string, uri: Uri): Promise<string | undefined> {
		const [relativePath, root] = splitPath(uri, repoPath);

		const data = await this.git.log__file(root, relativePath, '@{push}..', {
			argsOrFormat: ['-z', '--format=%H'],
			fileMode: 'none',
			ordering: configuration.get('advanced.commitOrdering'),
			renames: true,
		});
		if (!data) return undefined;

		// -2 to skip the ending null
		const index = data.lastIndexOf('\0', data.length - 2);
		return index === -1 ? undefined : data.slice(index + 1, data.length - 2);
	}

	@log()
	async getContributors(
		repoPath: string,
		options?: { all?: boolean; ref?: string; stats?: boolean },
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const key = options?.stats ? `stats|${repoPath}` : repoPath;

		let contributors = this.useCaching ? this._contributorsCache.get(key) : undefined;
		if (contributors == null) {
			async function load(this: LocalGitProvider) {
				try {
					repoPath = normalizePath(repoPath);
					const currentUser = await this.getCurrentUser(repoPath);

					const parser = GitLogParser.create<{
						sha: string;
						author: string;
						email: string;
						date: string;
						stats?: { files: number; additions: number; deletions: number };
					}>(
						{
							sha: '%H',
							author: '%aN',
							email: '%aE',
							date: '%at',
						},
						options?.stats
							? {
									additionalArgs: ['--shortstat', '--use-mailmap'],
									parseEntry: (fields, entry) => {
										const line = fields.next().value;
										const match = GitLogParser.shortstatRegex.exec(line);
										if (match?.groups != null) {
											const { files, additions, deletions } = match.groups;
											entry.stats = {
												files: Number(files || 0),
												additions: Number(additions || 0),
												deletions: Number(deletions || 0),
											};
										}
										return entry;
									},
									prefix: '%x00',
									fieldSuffix: '%x00',
									skip: 1,
							  }
							: undefined,
					);

					const data = await this.git.log(repoPath, options?.ref, {
						all: options?.all,
						argsOrFormat: parser.arguments,
					});

					const contributors = new Map<string, GitContributor>();

					const commits = parser.parse(data);
					for (const c of commits) {
						const key = `${c.author}|${c.email}`;
						let contributor = contributors.get(key);
						if (contributor == null) {
							contributor = new GitContributor(
								repoPath,
								c.author,
								c.email,
								1,
								new Date(Number(c.date) * 1000),
								isUserMatch(currentUser, c.author, c.email),
								c.stats,
							);
							contributors.set(key, contributor);
						} else {
							(contributor as PickMutable<GitContributor, 'count'>).count++;
							const date = new Date(Number(c.date) * 1000);
							if (date > contributor.date!) {
								(contributor as PickMutable<GitContributor, 'date'>).date = date;
							}
						}
					}

					return [...contributors.values()];
				} catch (ex) {
					this._contributorsCache.delete(key);

					return [];
				}
			}

			contributors = load.call(this);

			if (this.useCaching) {
				this._contributorsCache.set(key, contributors);
			}
		}

		return contributors;
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getLogScope();

		const repo = this._repoInfoCache.get(repoPath);

		let user = repo?.user;
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		user = { name: undefined, email: undefined };

		try {
			const data = await this.git.config__get_regex('^user\\.', repoPath, { local: true });
			if (data) {
				let key: string;
				let value: string;

				let match;
				do {
					match = userConfigRegex.exec(data);
					if (match == null) break;

					[, key, value] = match;
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					user[key as 'name' | 'email'] = ` ${value}`.substr(1);
				} while (true);
			} else {
				user.name =
					process_env.GIT_AUTHOR_NAME || process_env.GIT_COMMITTER_NAME || userInfo()?.username || undefined;
				if (!user.name) {
					// If we found no user data, mark it so we won't bother trying again
					this._repoInfoCache.set(repoPath, { ...repo, user: null });
					return undefined;
				}

				user.email =
					process_env.GIT_AUTHOR_EMAIL ||
					process_env.GIT_COMMITTER_EMAIL ||
					process_env.EMAIL ||
					`${user.name}@${hostname()}`;
			}

			const author = `${user.name} <${user.email}>`;
			// Check if there is a mailmap for the current user
			const mappedAuthor = await this.git.check_mailmap(repoPath, author);
			if (mappedAuthor != null && mappedAuthor.length !== 0 && author !== mappedAuthor) {
				const match = mappedAuthorRegex.exec(mappedAuthor);
				if (match != null) {
					[, user.name, user.email] = match;
				}
			}

			this._repoInfoCache.set(repoPath, { ...repo, user: user });
			return user;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			// Mark it so we won't bother trying again
			this._repoInfoCache.set(repoPath, { ...repo, user: null });
			return undefined;
		}
	}

	@log()
	async getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		if (!remote) {
			try {
				const data = await this.git.symbolic_ref(repoPath, 'HEAD');
				if (data != null) return data.trim();
			} catch {}
		}

		remote = remote ?? 'origin';
		try {
			const data = await this.git.ls_remote__HEAD(repoPath, remote);
			if (data == null) return undefined;

			const match = /ref:\s(\S+)\s+HEAD/m.exec(data);
			if (match == null) return undefined;

			const [, branch] = match;
			return branch.substr('refs/heads/'.length);
		} catch {
			return undefined;
		}
	}

	@log()
	async getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<GitDiff | undefined> {
		const scope = getLogScope();

		let key = 'diff';
		if (ref1 != null) {
			key += `:${ref1}`;
		}
		if (ref2 != null) {
			key += `:${ref2}`;
		}

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedDiff = doc.state.getDiff(key);
				if (cachedDiff != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedDiff.item;
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
		}

		const promise = this.getDiffForFileCore(
			uri.repoPath,
			uri.fsPath,
			ref1,
			ref2,
			{ encoding: GitProviderService.getEncoding(uri) },
			doc,
			key,
			scope,
		);

		if (doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<GitDiff>,
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
		document: TrackedDocument<GitDocumentState>,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitDiff | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		try {
			const data = await this.git.diff(root, relativePath, ref1, ref2, {
				...options,
				filters: ['M'],
				linesOfContext: 0,
				renames: true,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const diff = GitDiffParser.parse(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiff>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<GitDiff>;
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getDiffForFileContents']>({ args: { 1: '<contents>' } })
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<GitDiff | undefined> {
		const scope = getLogScope();

		const key = `diff:${md5(contents)}`;

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedDiff = doc.state.getDiff(key);
				if (cachedDiff != null) {
					Logger.debug(scope, `Cache hit: ${key}`);
					return cachedDiff.item;
				}
			}

			Logger.debug(scope, `Cache miss: ${key}`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
		}

		const promise = this.getDiffForFileContentsCore(
			uri.repoPath,
			uri.fsPath,
			ref,
			contents,
			{ encoding: GitProviderService.getEncoding(uri) },
			doc,
			key,
			scope,
		);

		if (doc.state != null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<GitDiff>,
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
		document: TrackedDocument<GitDocumentState>,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitDiff | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		try {
			const data = await this.git.diff__contents(root, relativePath, ref, contents, {
				...options,
				filters: ['M'],
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const diff = GitDiffParser.parse(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiff>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<GitDiff>;
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
	): Promise<GitDiffHunkLine | undefined> {
		try {
			const diff = await this.getDiffForFile(uri, ref1, ref2);
			if (diff == null) return undefined;

			const line = editorLine + 1;
			const hunk = diff.hunks.find(c => c.current.position.start <= line && c.current.position.end >= line);
			if (hunk == null) return undefined;

			return hunk.lines[line - Math.min(hunk.current.position.start, hunk.previous.position.start)];
		} catch (ex) {
			return undefined;
		}
	}

	@log()
	async getDiffStatus(
		repoPath: string,
		ref1?: string,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		try {
			const data = await this.git.diff__name_status(repoPath, ref1, ref2, {
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
				...options,
			});
			if (!data) return undefined;

			const files = GitDiffParser.parseNameStatus(data, repoPath);
			return files == null || files.length === 0 ? undefined : files;
		} catch (ex) {
			return undefined;
		}
	}

	@log()
	async getFileStatusForCommit(repoPath: string, uri: Uri, ref: string): Promise<GitFile | undefined> {
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return undefined;

		const [relativePath, root] = splitPath(uri, repoPath);

		const data = await this.git.show__name_status(root, relativePath, ref);
		if (!data) return undefined;

		const files = GitDiffParser.parseNameStatus(data, repoPath);
		if (files == null || files.length === 0) return undefined;

		return files[0];
	}

	@debug()
	async getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		try {
			const gitDir = await this.getGitDir(repoPath);
			const stats = await workspace.fs.stat(this.container.git.getAbsoluteUri(`${gitDir}/FETCH_HEAD`, repoPath));
			// If the file is empty, assume the fetch failed, and don't update the timestamp
			if (stats.size > 0) return stats.mtime;
		} catch {}

		return undefined;
	}

	private async getGitDir(repoPath: string): Promise<string> {
		const repo = this._repoInfoCache.get(repoPath);
		if (repo?.gitDir != null) return repo.gitDir;

		const gitDir = normalizePath((await this.git.rev_parse__git_dir(repoPath)) || '.git');
		this._repoInfoCache.set(repoPath, { ...repo, gitDir: gitDir });

		return gitDir;
	}

	@log()
	async getLog(
		repoPath: string,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: number | string;
			until?: number | string;
		},
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;

		try {
			// const parser = GitLogParser.defaultParser;

			const data = await this.git.log(repoPath, options?.ref, {
				...options,
				// args: parser.arguments,
				limit: limit,
				merges: options?.merges == null ? true : options.merges,
				ordering: options?.ordering ?? configuration.get('advanced.commitOrdering'),
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			// const commits = [];
			// const entries = parser.parse(data);
			// for (const entry of entries) {
			// 	commits.push(
			// 		new GitCommit2(
			// 			repoPath,
			// 			entry.sha,
			// 			new GitCommitIdentity(
			// 				entry.author,
			// 				entry.authorEmail,
			// 				new Date((entry.authorDate as any) * 1000),
			// 			),
			// 			new GitCommitIdentity(
			// 				entry.committer,
			// 				entry.committerEmail,
			// 				new Date((entry.committerDate as any) * 1000),
			// 			),
			// 			entry.message.split('\n', 1)[0],
			// 			entry.parents.split(' '),
			// 			entry.message,
			// 			entry.files.map(f => new GitFileChange(repoPath, f.path, f.status as any, f.originalPath)),
			// 			[],
			// 		),
			// 	);
			// }

			const log = GitLogParser.parse(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				options?.ref,
				await this.getCurrentUser(repoPath),
				limit,
				false,
				undefined,
			);

			if (log != null) {
				log.query = (limit: number | undefined) => this.getLog(repoPath, { ...options, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogMoreFn(log, options);
				}
			}

			return log;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	@log()
	async getLogRefsOnly(
		repoPath: string,
		options?: {
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const scope = getLogScope();

		const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;

		try {
			const parser = GitLogParser.createSingle('%H');

			const data = await this.git.log(repoPath, options?.ref, {
				authors: options?.authors,
				argsOrFormat: parser.arguments,
				limit: limit,
				merges: options?.merges == null ? true : options.merges,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
				since: options?.since,
				ordering: options?.ordering ?? configuration.get('advanced.commitOrdering'),
			});

			const commits = new Set(parser.parse(data));
			return commits;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
			return undefined;
		}
	}

	private getLogMoreFn(
		log: GitLog,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			limit?: number;
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			// If the log is for a range, then just get everything prior + more
			if (GitRevision.isRange(log.sha)) {
				const moreLog = await this.getLog(log.repoPath, {
					...options,
					limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				return moreLog;
			}

			const lastCommit = last(log.commits.values());
			const ref = lastCommit?.ref;

			// If we were asked for all refs, use the last commit timestamp (plus a second) as a cursor
			let timestamp: number | undefined;
			if (options?.all) {
				const date = lastCommit?.committer.date;
				// Git only allows 1-second precision, so round up to the nearest second
				timestamp = date != null ? Math.ceil(date.getTime() / 1000) + 1 : undefined;
			}
			const moreLog = await this.getLog(log.repoPath, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				...(timestamp
					? { until: timestamp }
					: { ref: moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^` }),
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: undefined,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				startingCursor: last(log.commits)?.[0],
				endingCursor: moreLog.endingCursor,
				pagedCommits: () => {
					// Remove any duplicates
					for (const sha of log.commits.keys()) {
						moreLog.commits.delete(sha);
					}
					return moreLog.commits;
				},
				query: (limit: number | undefined) => this.getLog(log.repoPath, { ...options, limit: limit }),
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogMoreFn(mergedLog, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getLogForSearch(
		repoPath: string,
		search: SearchPattern,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');

			const operations = SearchPattern.parseSearchOperations(search.pattern);

			const searchArgs = new Set<string>();
			const files: string[] = [];

			let useShow = false;

			let op;
			let values = operations.get('commit:');
			if (values != null) {
				useShow = true;

				searchArgs.add('-m');
				searchArgs.add(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
				for (const value of values) {
					searchArgs.add(value.replace(doubleQuoteRegex, ''));
				}
			} else {
				searchArgs.add(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);
				searchArgs.add('--all');
				searchArgs.add('--full-history');
				searchArgs.add(search.matchRegex ? '--extended-regexp' : '--fixed-strings');
				if (search.matchRegex && !search.matchCase) {
					searchArgs.add('--regexp-ignore-case');
				}

				for ([op, values] of operations.entries()) {
					switch (op) {
						case 'message:':
							searchArgs.add('-m');
							if (search.matchAll) {
								searchArgs.add('--all-match');
							}
							for (const value of values) {
								searchArgs.add(
									`--grep=${value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '')}`,
								);
							}

							break;

						case 'author:':
							searchArgs.add('-m');
							for (const value of values) {
								searchArgs.add(
									`--author=${value.replace(doubleQuoteRegex, search.matchRegex ? '\\b' : '')}`,
								);
							}

							break;

						case 'change:':
							for (const value of values) {
								searchArgs.add(
									search.matchRegex
										? `-G${value.replace(doubleQuoteRegex, '')}`
										: `-S${value.replace(doubleQuoteRegex, '')}`,
								);
							}

							break;

						case 'file:':
							for (const value of values) {
								files.push(value.replace(doubleQuoteRegex, ''));
							}

							break;
					}
				}
			}

			const args = [...searchArgs.values(), '--'];
			if (files.length !== 0) {
				args.push(...files);
			}

			const data = await this.git.log__search(repoPath, args, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				limit: limit,
				useShow: useShow,
			});
			const log = GitLogParser.parse(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				undefined,
				await this.getCurrentUser(repoPath),
				limit,
				false,
				undefined,
			);

			if (log != null) {
				log.query = (limit: number | undefined) =>
					this.getLogForSearch(repoPath, search, { ...options, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogForSearchMoreFn(log, search, options);
				}
			}

			return log;
		} catch (ex) {
			return undefined;
		}
	}

	private getLogForSearchMoreFn(
		log: GitLog,
		search: SearchPattern,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null },
	): (limit: number | undefined) => Promise<GitLog> {
		return async (limit: number | undefined) => {
			limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			const moreLog = await this.getLogForSearch(log.repoPath, search, {
				...options,
				limit: limit,
				skip: log.count,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: (log.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
				query: (limit: number | undefined) =>
					this.getLogForSearch(log.repoPath, search, { ...options, limit: limit }),
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForSearchMoreFn(mergedLog, search, options);
			}

			return mergedLog;
		};
	}
	@log()
	async getLogForFile(
		repoPath: string | undefined,
		pathOrUri: string | Uri,
		options?: {
			all?: boolean;
			cursor?: string;
			force?: boolean | undefined;
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

		const scope = getLogScope();

		const relativePath = this.getRelativePath(pathOrUri, repoPath);

		if (repoPath != null && repoPath === relativePath) {
			throw new Error(`File name cannot match the repository path; path=${relativePath}`);
		}

		options = { reverse: false, ...options };

		if (options.renames == null) {
			options.renames = configuration.get('advanced.fileHistoryFollowsRenames');
		}

		let key = 'log';
		if (options.ref != null) {
			key += `:${options.ref}`;
		}

		if (options.all == null) {
			options.all = configuration.get('advanced.fileHistoryShowAllBranches');
		}
		if (options.all) {
			key += ':all';
		}

		options.limit = options.limit ?? configuration.get('advanced.maxListItems') ?? 0;
		if (options.limit) {
			key += `:n${options.limit}`;
		}

		if (options.renames) {
			key += ':follow';
		}

		if (options.reverse) {
			key += ':reverse';
		}

		if (options.since) {
			key += `:since=${options.since}`;
		}

		if (options.skip) {
			key += `:skip${options.skip}`;
		}

		const doc = await this.container.tracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, options.ref));
		if (!options.force && this.useCaching && options.range == null) {
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(key);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (options.ref != null || options.limit != null) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(
						`log${options.renames ? ':follow' : ''}${options.reverse ? ':reverse' : ''}`,
					);
					if (cachedLog != null) {
						if (options.ref == null) {
							Logger.debug(scope, `Cache hit: ~'${key}'`);
							return cachedLog.item;
						}

						Logger.debug(scope, `Cache ?: '${key}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(options.ref)) {
							Logger.debug(scope, `Cache hit: '${key}'`);

							// Create a copy of the log starting at the requested commit
							let skip = true;
							let i = 0;
							const commits = new Map(
								filterMapIterable<[string, GitCommit], [string, GitCommit]>(
									log.commits.entries(),
									([ref, c]) => {
										if (skip) {
											if (ref !== options?.ref) return undefined;
											skip = false;
										}

										i++;
										if (options?.limit != null && i > options.limit) {
											return undefined;
										}

										return [ref, c];
									},
								),
							);

							const opts = { ...options };
							log = {
								...log,
								limit: options.limit,
								count: commits.size,
								commits: commits,
								query: (limit: number | undefined) =>
									this.getLogForFile(repoPath, pathOrUri, { ...opts, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState();
			}
		}

		const promise = this.getLogForFileCore(repoPath, relativePath, options, doc, key, scope);

		if (doc.state != null && options.range == null) {
			Logger.debug(scope, `Cache add: '${key}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.setLog(key, value);
		}

		return promise;
	}

	private async getLogForFileCore(
		repoPath: string | undefined,
		path: string,
		{
			ref,
			range,
			...options
		}: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
		document: TrackedDocument<GitDocumentState>,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitLog | undefined> {
		const paths = await this.isTrackedPrivate(path, repoPath, ref);
		if (paths == null) {
			Logger.log(scope, `Skipping blame; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [relativePath, root] = paths;

		try {
			if (range != null && range.start.line > range.end.line) {
				range = new Range(range.end, range.start);
			}

			const data = await this.git.log__file(root, relativePath, ref, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				firstParent: options.renames,
				startLine: range == null ? undefined : range.start.line + 1,
				endLine: range == null ? undefined : range.end.line + 1,
			});
			const log = GitLogParser.parse(
				this.container,
				data,
				// If this is the log of a folder, parse it as a normal log rather than a file log
				isFolderGlob(relativePath) ? LogType.Log : LogType.LogFile,
				root,
				relativePath,
				ref,
				await this.getCurrentUser(root),
				options.limit,
				options.reverse ?? false,
				range,
			);

			if (log != null) {
				const opts = { ...options, ref: ref, range: range };
				log.query = (limit: number | undefined) =>
					this.getLogForFile(repoPath, path, { ...opts, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogForFileMoreFn(log, path, opts);
				}
			}

			return log;
		} catch (ex) {
			// Trap and cache expected log errors
			if (document.state != null && range == null && !options.reverse) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedLog = {
					item: emptyPromise as Promise<GitLog>,
					errorMessage: msg,
				};
				document.state.setLog(key, value);

				return emptyPromise as Promise<GitLog>;
			}

			return undefined;
		}
	}

	private getLogForFileMoreFn(
		log: GitLog,
		relativePath: string,
		options: {
			all?: boolean;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			const ref = last(log.commits.values())?.ref;
			const moreLog = await this.getLogForFile(log.repoPath, relativePath, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				ref: options.all ? undefined : moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
				skip: options.all ? log.count : undefined,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false, more: undefined };

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				query: (limit: number | undefined) =>
					this.getLogForFile(log.repoPath, relativePath, { ...options, limit: limit }),
			};

			if (options.renames) {
				const renamed = find(
					moreLog.commits.values(),
					c => Boolean(c.file?.originalPath) && c.file?.originalPath !== relativePath,
				);
				relativePath = renamed?.file?.originalPath ?? relativePath;
			}

			if (mergedLog.hasMore) {
				mergedLog.more = this.getLogForFileMoreFn(mergedLog, relativePath, options);
			}

			return mergedLog;
		};
	}

	@log()
	async getMergeBase(repoPath: string, ref1: string, ref2: string, options?: { forkPoint?: boolean }) {
		const scope = getLogScope();

		try {
			const data = await this.git.merge_base(repoPath, ref1, ref2, options);
			if (data == null) return undefined;

			return data.split('\n')[0].trim() || undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@gate()
	@log()
	async getMergeStatus(repoPath: string): Promise<GitMergeStatus | undefined> {
		let status = this.useCaching ? this._mergeStatusCache.get(repoPath) : undefined;
		if (status === undefined) {
			const merge = await this.git.rev_parse__verify(repoPath, 'MERGE_HEAD');
			if (merge != null) {
				const [branch, mergeBase, possibleSourceBranches] = await Promise.all([
					this.getBranch(repoPath),
					this.getMergeBase(repoPath, 'MERGE_HEAD', 'HEAD'),
					this.getCommitBranches(repoPath, 'MERGE_HEAD', { mode: 'pointsAt' }),
				]);

				status = {
					type: 'merge',
					repoPath: repoPath,
					mergeBase: mergeBase,
					HEAD: GitReference.create(merge, repoPath, { refType: 'revision' }),
					current: GitReference.fromBranch(branch!),
					incoming:
						possibleSourceBranches?.length === 1
							? GitReference.create(possibleSourceBranches[0], repoPath, {
									refType: 'branch',
									name: possibleSourceBranches[0],
									remote: false,
							  })
							: undefined,
				};
			}

			if (this.useCaching) {
				this._mergeStatusCache.set(repoPath, status ?? null);
			}
		}

		return status ?? undefined;
	}

	@gate()
	@log()
	async getRebaseStatus(repoPath: string): Promise<GitRebaseStatus | undefined> {
		let status = this.useCaching ? this._rebaseStatusCache.get(repoPath) : undefined;
		if (status === undefined) {
			const rebase = await this.git.rev_parse__verify(repoPath, 'REBASE_HEAD');
			if (rebase != null) {
				let [mergeBase, branch, onto, stepsNumber, stepsMessage, stepsTotal] = await Promise.all([
					this.getMergeBase(repoPath, 'REBASE_HEAD', 'HEAD'),
					this.git.readDotGitFile(repoPath, ['rebase-merge', 'head-name']),
					this.git.readDotGitFile(repoPath, ['rebase-merge', 'onto']),
					this.git.readDotGitFile(repoPath, ['rebase-merge', 'msgnum'], { numeric: true }),
					this.git
						.readDotGitFile(repoPath, ['rebase-merge', 'message'], { throw: true })
						.catch(() => this.git.readDotGitFile(repoPath, ['rebase-merge', 'message-squashed'])),
					this.git.readDotGitFile(repoPath, ['rebase-merge', 'end'], { numeric: true }),
				]);

				if (branch == null || onto == null) return undefined;

				if (branch.startsWith('refs/heads/')) {
					branch = branch.substr(11).trim();
				}

				const possibleSourceBranches = await this.getCommitBranches(repoPath, onto, { mode: 'pointsAt' });

				let possibleSourceBranch: string | undefined;
				for (const b of possibleSourceBranches) {
					if (b.startsWith('(no branch, rebasing')) continue;

					possibleSourceBranch = b;
					break;
				}

				status = {
					type: 'rebase',
					repoPath: repoPath,
					mergeBase: mergeBase,
					HEAD: GitReference.create(rebase, repoPath, { refType: 'revision' }),
					onto: GitReference.create(onto, repoPath, { refType: 'revision' }),
					current:
						possibleSourceBranch != null
							? GitReference.create(possibleSourceBranch, repoPath, {
									refType: 'branch',
									name: possibleSourceBranch,
									remote: false,
							  })
							: undefined,

					incoming: GitReference.create(branch, repoPath, {
						refType: 'branch',
						name: branch,
						remote: false,
					}),
					steps: {
						current: {
							number: stepsNumber ?? 0,
							commit: GitReference.create(rebase, repoPath, {
								refType: 'revision',
								message: stepsMessage,
							}),
						},
						total: stepsTotal ?? 0,
					},
				};
			}

			if (this.useCaching) {
				this._rebaseStatusCache.set(repoPath, status ?? null);
			}
		}

		return status ?? undefined;
	}

	@log()
	async getNextComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<NextComparisonUrisResult | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (!ref) return undefined;

		const relativePath = this.getRelativePath(uri, repoPath);

		if (GitRevision.isUncommittedStaged(ref)) {
			return {
				current: GitUri.fromFile(relativePath, repoPath, ref),
				next: GitUri.fromFile(relativePath, repoPath, undefined),
			};
		}

		const next = await this.getNextUri(repoPath, uri, ref, skip);
		if (next == null) {
			const status = await this.getStatusForFile(repoPath, uri);
			if (status != null) {
				// If the file is staged, diff with the staged version
				if (status.indexStatus != null) {
					return {
						current: GitUri.fromFile(relativePath, repoPath, ref),
						next: GitUri.fromFile(relativePath, repoPath, GitRevision.uncommittedStaged),
					};
				}
			}

			return {
				current: GitUri.fromFile(relativePath, repoPath, ref),
				next: GitUri.fromFile(relativePath, repoPath, undefined),
			};
		}

		return {
			current:
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getNextUri(repoPath, uri, ref, skip - 1))!,
			next: next,
		};
	}

	@log()
	private async getNextUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		// editorLine?: number
	): Promise<GitUri | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (!ref || GitRevision.isUncommittedStaged(ref)) return undefined;

		let filters: GitDiffFilter[] | undefined;
		if (ref === GitRevision.deletedOrMissing) {
			// If we are trying to move next from a deleted or missing ref then get the first commit
			ref = undefined;
			filters = ['A'];
		}

		const relativePath = this.getRelativePath(uri, repoPath);
		let data = await this.git.log__file(repoPath, relativePath, ref, {
			argsOrFormat: GitLogParser.simpleFormat,
			fileMode: 'simple',
			filters: filters,
			limit: skip + 1,
			ordering: configuration.get('advanced.commitOrdering'),
			reverse: true,
			// startLine: editorLine != null ? editorLine + 1 : undefined,
		});
		if (data == null || data.length === 0) return undefined;

		const [nextRef, file, status] = GitLogParser.parseSimple(data, skip);
		// If the file was deleted, check for a possible rename
		if (status === 'D') {
			data = await this.git.log__file(repoPath, '.', nextRef, {
				argsOrFormat: GitLogParser.simpleFormat,
				fileMode: 'simple',
				filters: ['R', 'C'],
				limit: 1,
				ordering: configuration.get('advanced.commitOrdering'),
				// startLine: editorLine != null ? editorLine + 1 : undefined
			});
			if (data == null || data.length === 0) {
				return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
			}

			const [nextRenamedRef, renamedFile] = GitLogParser.parseSimpleRenamed(data, file ?? relativePath);
			return GitUri.fromFile(
				renamedFile ?? file ?? relativePath,
				repoPath,
				nextRenamedRef ?? nextRef ?? GitRevision.deletedOrMissing,
			);
		}

		return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
	}

	@log()
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
		firstParent: boolean = false,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const relativePath = this.getRelativePath(uri, repoPath);

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!ref) {
			// First, check the file status to see if there is anything staged
			const status = await this.getStatusForFile(repoPath, uri);
			if (status != null) {
				// If the file is staged with working changes, diff working with staged (index)
				// If the file is staged without working changes, diff staged with HEAD
				if (status.indexStatus != null) {
					// Backs up to get to HEAD
					if (status.workingTreeStatus == null) {
						skip++;
					}

					if (skip === 0) {
						// Diff working with staged
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: GitUri.fromFile(relativePath, repoPath, GitRevision.uncommittedStaged),
						};
					}

					return {
						// Diff staged with HEAD (or prior if more skips)
						current: GitUri.fromFile(relativePath, repoPath, GitRevision.uncommittedStaged),
						previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent),
					};
				} else if (status.workingTreeStatus != null) {
					if (skip === 0) {
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: await this.getPreviousUri(repoPath, uri, undefined, skip, undefined, firstParent),
						};
					}
				}
			} else if (skip === 0) {
				skip++;
			}
		}
		// If we are at the index (staged), diff staged with HEAD
		else if (GitRevision.isUncommittedStaged(ref)) {
			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, undefined, firstParent))!;
			if (current == null || current.sha === GitRevision.deletedOrMissing) return undefined;

			return {
				current: current,
				previous: await this.getPreviousUri(repoPath, uri, undefined, skip, undefined, firstParent),
			};
		}

		// If we are at a commit, diff commit with previous
		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent))!;
		if (current == null || current.sha === GitRevision.deletedOrMissing) return undefined;

		return {
			current: current,
			previous: await this.getPreviousUri(repoPath, uri, ref, skip, undefined, firstParent),
		};
	}

	@log()
	async getPreviousComparisonUrisForLine(
		repoPath: string,
		uri: Uri,
		editorLine: number, // 0-based, Git is 1-based
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousLineComparisonUrisResult | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		let relativePath = this.getRelativePath(uri, repoPath);

		let previous;

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (!ref) {
			// First, check the blame on the current line to see if there are any working/staged changes
			const gitUri = new GitUri(uri, repoPath);

			const document = await workspace.openTextDocument(uri);
			const blameLine = document.isDirty
				? await this.getBlameForLineContents(gitUri, editorLine, document.getText())
				: await this.getBlameForLine(gitUri, editorLine);
			if (blameLine == null) return undefined;

			// If line is uncommitted, we need to dig deeper to figure out where to go (because blame can't be trusted)
			if (blameLine.commit.isUncommitted) {
				// If the document is dirty (unsaved), use the status to determine where to go
				if (document.isDirty) {
					// Check the file status to see if there is anything staged
					const status = await this.getStatusForFile(repoPath, uri);
					if (status != null) {
						// If the file is staged, diff working with staged (index)
						// If the file is not staged, diff working with HEAD
						if (status.indexStatus != null) {
							// Diff working with staged
							return {
								current: GitUri.fromFile(relativePath, repoPath, undefined),
								previous: GitUri.fromFile(relativePath, repoPath, GitRevision.uncommittedStaged),
								line: editorLine,
							};
						}
					}

					// Diff working with HEAD (or prior if more skips)
					return {
						current: GitUri.fromFile(relativePath, repoPath, undefined),
						previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine),
						line: editorLine,
					};
				}

				// First, check if we have a diff in the working tree
				let hunkLine = await this.getDiffForLine(gitUri, editorLine, undefined);
				if (hunkLine == null) {
					// Next, check if we have a diff in the index (staged)
					hunkLine = await this.getDiffForLine(gitUri, editorLine, undefined, GitRevision.uncommittedStaged);

					if (hunkLine != null) {
						ref = GitRevision.uncommittedStaged;
					} else {
						skip++;
					}
				}
			}
			// If line is committed, diff with line ref with previous
			else {
				ref = blameLine.commit.sha;
				relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
				uri = this.getAbsoluteUri(relativePath, repoPath);
				editorLine = blameLine.line.originalLine - 1;

				if (skip === 0 && blameLine.commit.file?.previousSha) {
					previous = GitUri.fromFile(relativePath, repoPath, blameLine.commit.file.previousSha);
				}
			}
		} else {
			if (GitRevision.isUncommittedStaged(ref)) {
				const current =
					skip === 0
						? GitUri.fromFile(relativePath, repoPath, ref)
						: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, editorLine))!;
				if (current.sha === GitRevision.deletedOrMissing) return undefined;

				return {
					current: current,
					previous: await this.getPreviousUri(repoPath, uri, undefined, skip, editorLine),
					line: editorLine,
				};
			}

			const gitUri = new GitUri(uri, { repoPath: repoPath, sha: ref });
			const blameLine = await this.getBlameForLine(gitUri, editorLine);
			if (blameLine == null) return undefined;

			// Diff with line ref with previous
			ref = blameLine.commit.sha;
			relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
			uri = this.getAbsoluteUri(relativePath, repoPath);
			editorLine = blameLine.line.originalLine - 1;

			if (skip === 0 && blameLine.commit.file?.previousSha) {
				previous = GitUri.fromFile(relativePath, repoPath, blameLine.commit.file.previousSha);
			}
		}

		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1, editorLine))!;
		if (current.sha === GitRevision.deletedOrMissing) return undefined;

		return {
			current: current,
			previous: previous ?? (await this.getPreviousUri(repoPath, uri, ref, skip, editorLine)),
			line: editorLine,
		};
	}

	@log()
	private async getPreviousUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		editorLine?: number,
		firstParent: boolean = false,
	): Promise<GitUri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (ref === GitRevision.uncommitted) {
			ref = undefined;
		}

		const relativePath = this.getRelativePath(uri, repoPath);

		// TODO: Add caching
		let data;
		try {
			data = await this.git.log__file(repoPath, relativePath, ref, {
				argsOrFormat: GitLogParser.simpleFormat,
				fileMode: 'simple',
				firstParent: firstParent,
				limit: skip + 2,
				ordering: configuration.get('advanced.commitOrdering'),
				startLine: editorLine != null ? editorLine + 1 : undefined,
			});
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			// If the line count is invalid just fallback to the most recent commit
			if ((ref == null || GitRevision.isUncommittedStaged(ref)) && GitErrors.invalidLineCount.test(msg)) {
				if (ref == null) {
					const status = await this.getStatusForFile(repoPath, uri);
					if (status?.indexStatus != null) {
						return GitUri.fromFile(relativePath, repoPath, GitRevision.uncommittedStaged);
					}
				}

				ref = await this.git.log__file_recent(repoPath, relativePath, {
					ordering: configuration.get('advanced.commitOrdering'),
				});
				return GitUri.fromFile(relativePath, repoPath, ref ?? GitRevision.deletedOrMissing);
			}

			Logger.error(ex, scope);
			throw ex;
		}
		if (data == null || data.length === 0) return undefined;

		const [previousRef, file] = GitLogParser.parseSimple(data, skip, ref);
		// If the previous ref matches the ref we asked for assume we are at the end of the history
		if (ref != null && ref === previousRef) return undefined;

		return GitUri.fromFile(file ?? relativePath, repoPath, previousRef ?? GitRevision.deletedOrMissing);
	}

	@log()
	async getIncomingActivity(
		repoPath: string,
		options?: {
			all?: boolean;
			branch?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			skip?: number;
		},
	): Promise<GitReflog | undefined> {
		const scope = getLogScope();

		const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;
		try {
			// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
			const data = await this.git.reflog(repoPath, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				limit: limit * 100,
			});
			if (data == null) return undefined;

			const reflog = GitReflogParser.parse(data, repoPath, reflogCommands, limit, limit * 100);
			if (reflog?.hasMore) {
				reflog.more = this.getReflogMoreFn(reflog, options);
			}

			return reflog;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	private getReflogMoreFn(
		reflog: GitReflog,
		options?: {
			all?: boolean;
			branch?: string;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			skip?: number;
		},
	): (limit: number) => Promise<GitReflog> {
		return async (limit: number | undefined) => {
			limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

			const moreLog = await this.getIncomingActivity(reflog.repoPath, {
				...options,
				limit: limit,
				skip: reflog.total,
			});
			if (moreLog == null) {
				// If we can't find any more, assume we have everything
				return { ...reflog, hasMore: false, more: undefined };
			}

			const mergedLog: GitReflog = {
				repoPath: reflog.repoPath,
				records: [...reflog.records, ...moreLog.records],
				count: reflog.count + moreLog.count,
				total: reflog.total + moreLog.total,
				limit: (reflog.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
			};
			if (mergedLog.hasMore) {
				mergedLog.more = this.getReflogMoreFn(mergedLog, options);
			}

			return mergedLog;
		};
	}

	@log({ args: { 1: false } })
	async getRemotes(
		repoPath: string | undefined,
		options?: { providers?: RemoteProviders; sort?: boolean },
	): Promise<GitRemote<RemoteProvider | RichRemoteProvider | undefined>[]> {
		if (repoPath == null) return [];

		const providers = options?.providers ?? RemoteProviderFactory.loadProviders(configuration.get('remotes', null));

		try {
			const data = await this.git.remote(repoPath);
			const remotes = GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providers));
			if (remotes == null) return [];

			if (options?.sort) {
				GitRemote.sort(remotes);
			}

			return remotes;
		} catch (ex) {
			Logger.error(ex);
			return [];
		}
	}

	@gate()
	@log()
	getRevisionContent(repoPath: string, path: string, ref: string): Promise<Uint8Array | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		return this.git.show<Buffer>(root, relativePath, ref, { encoding: 'buffer' });
	}

	@gate()
	@log()
	async getStash(repoPath: string | undefined): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		let stash = this.useCaching ? this._stashesCache.get(repoPath) : undefined;
		if (stash === undefined) {
			const parser = GitLogParser.createWithFiles<{
				sha: string;
				date: string;
				committedDate: string;
				parents: string;
				stashName: string;
				summary: string;
			}>({
				sha: '%H',
				date: '%at',
				committedDate: '%ct',
				parents: '%P',
				stashName: '%gd',
				summary: '%B',
			});
			const data = await this.git.stash__list(repoPath, {
				args: parser.arguments,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const commits = new Map<string, GitStashCommit>();

			const stashes = parser.parse(data);
			for (const s of stashes) {
				let onRef;
				let summary;
				let message;

				const match = stashSummaryRegex.exec(s.summary);
				if (match?.groups != null) {
					onRef = match.groups.onref;
					summary = match.groups.summary.trim();

					if (summary.length === 0) {
						message = 'WIP';
					} else if (match.groups.wip) {
						message = `WIP: ${summary}`;
					} else {
						message = summary;
					}
				} else {
					message = s.summary.trim();
				}

				commits.set(
					s.sha,
					new GitCommit(
						this.container,
						repoPath,
						s.sha,
						new GitCommitIdentity('You', undefined, new Date((s.date as any) * 1000)),
						new GitCommitIdentity('You', undefined, new Date((s.committedDate as any) * 1000)),
						message.split('\n', 1)[0] ?? '',
						s.parents.split(' '),
						message,
						s.files?.map(
							f => new GitFileChange(repoPath, f.path, f.status as GitFileStatus, f.originalPath),
						) ?? [],
						undefined,
						[],
						undefined,
						s.stashName,
						onRef,
					) as GitStashCommit,
				);
			}

			stash = { repoPath: repoPath, commits: commits };

			if (this.useCaching) {
				this._stashesCache.set(repoPath, stash ?? null);
			}
		}

		return stash ?? undefined;
	}

	@log()
	async getStatusForFile(repoPath: string, uri: Uri): Promise<GitStatusFile | undefined> {
		const porcelainVersion = (await this.git.isAtLeastVersion('2.11')) ? 2 : 1;

		const [relativePath, root] = splitPath(uri, repoPath);

		const data = await this.git.status__file(root, relativePath, porcelainVersion, {
			similarityThreshold: configuration.get('advanced.similarityThreshold'),
		});
		const status = GitStatusParser.parse(data, root, porcelainVersion);
		if (status == null || !status.files.length) return undefined;

		return status.files[0];
	}

	@log()
	async getStatusForFiles(repoPath: string, pathOrGlob: Uri): Promise<GitStatusFile[] | undefined> {
		const porcelainVersion = (await this.git.isAtLeastVersion('2.11')) ? 2 : 1;

		const [relativePath, root] = splitPath(pathOrGlob, repoPath);

		const data = await this.git.status__file(root, relativePath, porcelainVersion, {
			similarityThreshold: configuration.get('advanced.similarityThreshold'),
		});
		const status = GitStatusParser.parse(data, root, porcelainVersion);
		if (status == null || !status.files.length) return [];

		return status.files;
	}

	@log()
	async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await this.git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await this.git.status(repoPath, porcelainVersion, {
			similarityThreshold: configuration.get('advanced.similarityThreshold'),
		});
		const status = GitStatusParser.parse(data, repoPath, porcelainVersion);

		if (status?.detached) {
			const rebaseStatus = await this.getRebaseStatus(repoPath);
			if (rebaseStatus != null) {
				return new GitStatus(
					repoPath,
					rebaseStatus.incoming.name,
					status.sha,
					status.files,
					status.state,
					status.upstream,
					true,
				);
			}
		}
		return status;
	}

	@log({ args: { 1: false } })
	async getTags(
		repoPath: string | undefined,
		options?: { cursor?: string; filter?: (t: GitTag) => boolean; sort?: boolean | TagSortOptions },
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		let resultsPromise = this.useCaching ? this._tagsCache.get(repoPath) : undefined;
		if (resultsPromise == null) {
			async function load(this: LocalGitProvider): Promise<PagedResult<GitTag>> {
				try {
					const data = await this.git.tag(repoPath!);
					return { values: GitTagParser.parse(data, repoPath!) ?? [] };
				} catch (ex) {
					this._tagsCache.delete(repoPath!);

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (this.useCaching) {
				this._tagsCache.set(repoPath, resultsPromise);
			}
		}

		let result = await resultsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		if (options?.sort) {
			sortTags(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getTreeEntryForRevision(repoPath: string, path: string, ref: string): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		const [relativePath, root] = splitPath(path, repoPath);

		const data = await this.git.ls_tree(root, ref, relativePath);
		const trees = GitTreeParser.parse(data);
		return trees?.length ? trees[0] : undefined;
	}

	@log()
	async getTreeForRevision(repoPath: string, ref: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		const data = await this.git.ls_tree(repoPath, ref);
		return GitTreeParser.parse(data) ?? [];
	}

	@log({ args: { 1: false } })
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
	) {
		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.getBranches(repoPath, {
				filter: options?.filter?.branches,
				sort: false,
			}),
			this.getTags(repoPath, {
				filter: options?.filter?.tags,
				sort: false,
			}),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@log()
	async hasCommitBeenPushed(repoPath: string, ref: string): Promise<boolean> {
		if (repoPath == null) return false;

		return this.git.merge_base__is_ancestor(repoPath, ref, '@{u}');
	}

	isTrackable(uri: Uri): boolean {
		return this.supportedSchemes.has(uri.scheme);
	}

	async isTracked(uri: Uri): Promise<boolean> {
		return (await this.isTrackedPrivate(uri)) != null;
	}

	private async isTrackedPrivate(uri: Uri | GitUri): Promise<[string, string] | undefined>;
	private async isTrackedPrivate(
		path: string,
		repoPath?: string,
		ref?: string,
	): Promise<[string, string] | undefined>;
	@log<LocalGitProvider['isTrackedPrivate']>({ exit: tracked => `returned ${Boolean(tracked)}` })
	private async isTrackedPrivate(
		pathOrUri: string | Uri | GitUri,
		repoPath?: string,
		ref?: string,
	): Promise<[string, string] | undefined> {
		let relativePath: string;
		let repository: Repository | undefined;

		if (typeof pathOrUri === 'string') {
			if (ref === GitRevision.deletedOrMissing) return undefined;

			repository = this.container.git.getRepository(Uri.file(pathOrUri));
			repoPath = repoPath || repository?.path;

			[relativePath, repoPath] = splitPath(pathOrUri, repoPath);
		} else {
			if (!this.isTrackable(pathOrUri)) return undefined;

			if (pathOrUri instanceof GitUri) {
				// Always use the ref of the GitUri
				ref = pathOrUri.sha;
				if (ref === GitRevision.deletedOrMissing) return undefined;
			}

			repository = this.container.git.getRepository(pathOrUri);
			repoPath = repoPath || repository?.path;

			[relativePath, repoPath] = splitPath(pathOrUri, repoPath);
		}

		const path = repoPath ? `${repoPath}/${relativePath}` : relativePath;

		let key = path;
		key = `${ref ?? ''}:${key.startsWith('/') ? key : `/${key}`}`;

		let tracked = this._trackedPaths.get(key);
		if (tracked != null) return tracked;

		tracked = this.isTrackedCore(path, relativePath, repoPath ?? '', ref, repository);
		this._trackedPaths.set(key, tracked);

		tracked = await tracked;
		this._trackedPaths.set(key, tracked);
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
		if (ref === GitRevision.deletedOrMissing) return undefined;

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
							repository = await this.container.git.getOrOpenRepository(Uri.file(path), true);
							if (repository != null) {
								return splitPath(path, repository.path);
							}

							return [newRelativePath, newRepoPath];
						}
					}
				}

				if (!tracked && ref && !GitRevision.isUncommitted(ref)) {
					tracked = Boolean(await this.git.ls_files(repoPath, relativePath, { ref: ref }));
					// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
					if (!tracked) {
						tracked = Boolean(await this.git.ls_files(repoPath, relativePath, { ref: `${ref}^` }));
					}
				}

				// Since the file isn't tracked, make sure it isn't part of a nested repository we don't know about yet
				if (!tracked) {
					if (repository != null) {
						// Don't look for a nested repository if the file isn't at least one folder deep
						const index = relativePath.indexOf('/');
						if (index < 0 || index === relativePath.length - 1) return undefined;

						const nested = await this.container.git.getOrOpenRepository(Uri.file(path), true);
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
			Logger.error(ex);
			return undefined;
		}
	}

	@log()
	async getDiffTool(repoPath?: string): Promise<string | undefined> {
		return (
			(await this.git.config__get('diff.guitool', repoPath, { local: true })) ??
			this.git.config__get('diff.tool', repoPath, { local: true })
		);
	}

	@log()
	async openDiffTool(
		repoPath: string,
		uri: Uri,
		options?: { ref1?: string; ref2?: string; staged?: boolean; tool?: string },
	): Promise<void> {
		const [relativePath, root] = splitPath(uri, repoPath);

		try {
			let tool = options?.tool;
			if (!tool) {
				const scope = getLogScope();

				tool = configuration.get('advanced.externalDiffTool') || (await this.getDiffTool(root));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(scope, `Using tool=${tool}`);
			}

			await this.git.difftool(root, relativePath, tool, options);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg === 'No diff tool found' || /Unknown .+? tool/.test(msg)) {
				const viewDocs = 'View Git Docs';
				const result = await window.showWarningMessage(
					'Unable to open changes because the specified diff tool cannot be found or no Git diff tool is configured',
					viewDocs,
				);
				if (result === viewDocs) {
					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}

				return;
			}

			Logger.error(ex, 'openDiffTool');
			void showGenericErrorMessage('Unable to open compare');
		}
	}

	@log()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void> {
		try {
			if (!tool) {
				const scope = getLogScope();

				tool = configuration.get('advanced.externalDirectoryDiffTool') || (await this.getDiffTool(repoPath));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(scope, `Using tool=${tool}`);
			}

			await this.git.difftool__dir_diff(repoPath, tool, ref1, ref2);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (msg === 'No diff tool found' || /Unknown .+? tool/.test(msg)) {
				const viewDocs = 'View Git Docs';
				const result = await window.showWarningMessage(
					'Unable to open directory compare because the specified diff tool cannot be found or no Git diff tool is configured',
					viewDocs,
				);
				if (result === viewDocs) {
					void env.openExternal(
						Uri.parse('https://git-scm.com/docs/git-config#Documentation/git-config.txt-difftool'),
					);
				}

				return;
			}

			Logger.error(ex, 'openDirectoryCompare');
			void showGenericErrorMessage('Unable to open directory compare');
		}
	}

	@log()
	async resolveReference(repoPath: string, ref: string, pathOrUri?: string | Uri, options?: { timeout?: number }) {
		if (
			!ref ||
			ref === GitRevision.deletedOrMissing ||
			(pathOrUri == null && GitRevision.isSha(ref)) ||
			(pathOrUri != null && GitRevision.isUncommitted(ref))
		) {
			return ref;
		}

		if (pathOrUri == null) {
			// If it doesn't look like a sha at all (e.g. branch name) or is a stash ref (^3) don't try to resolve it
			if (!GitRevision.isShaLike(ref) || ref.endsWith('^3')) return ref;

			return (await this.git.rev_parse__verify(repoPath, ref)) ?? ref;
		}

		const relativePath = this.getRelativePath(pathOrUri, repoPath);

		let cancellation: TimedCancellationSource | undefined;
		if (options?.timeout != null) {
			cancellation = new TimedCancellationSource(options.timeout);
		}

		const [verifiedResult, resolvedResult] = await Promise.allSettled([
			this.git.rev_parse__verify(repoPath, ref, relativePath),
			this.git.log__file_recent(repoPath, relativePath, {
				ref: ref,
				cancellation: cancellation?.token,
			}),
		]);

		const verified = getSettledValue(verifiedResult);
		if (verified == null) return GitRevision.deletedOrMissing;

		const resolved = getSettledValue(resolvedResult);

		const cancelled = cancellation?.token.isCancellationRequested;
		cancellation?.dispose();

		return cancelled ? ref : resolved ?? ref;
	}

	@log()
	validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		return this.git.check_ref_format(ref, repoPath);
	}

	@log()
	async validateReference(repoPath: string, ref: string): Promise<boolean> {
		if (ref == null || ref.length === 0) return false;
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return true;

		return (await this.git.rev_parse__verify(repoPath, ref)) != null;
	}

	@log()
	async stageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.add(repoPath, typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]);
	}

	@log()
	async stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.add(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		);
	}

	@log()
	async unStageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]);
	}

	@log()
	async unStageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.reset(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		);
	}

	@log()
	async stashApply(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		try {
			await this.git.stash__apply(repoPath, stashName, Boolean(options?.deleteAfter));
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
					throw new StashApplyError(StashApplyErrorReason.WorkingChanges, ex);
				}

				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					(ex instanceof RunError &&
						((ex.stdout.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
							ex.stdout.includes('needs merge')))
				) {
					void window.showInformationMessage('Stash applied with conflicts');

					return;
				}

				throw new StashApplyError(`Unable to apply stash \u2014 ${msg.trim().replace(/\n+?/g, '; ')}`, ex);
			}

			throw new StashApplyError(`Unable to apply stash \u2014 ${String(ex)}`, ex);
		}
	}

	@log()
	async stashDelete(repoPath: string, stashName: string, ref?: string): Promise<void> {
		await this.git.stash__delete(repoPath, stashName, ref);
	}

	@log<LocalGitProvider['stashSave']>({ args: { 2: uris => uris?.length } })
	async stashSave(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean },
	): Promise<void> {
		if (uris == null) return this.git.stash__push(repoPath, message, options);

		await this.ensureGitVersion(
			'2.13.2',
			'Stashing individual files',
			' Please retry by stashing everything or install a more recent version of Git and try again.',
		);

		const pathspecs = uris.map(u => `./${splitPath(u, repoPath)[0]}`);

		const stdinVersion = '2.30.0';
		const stdin = await this.git.isAtLeastVersion(stdinVersion);
		// If we don't support stdin, then error out if we are over the maximum allowed git cli length
		if (!stdin && countStringLength(pathspecs) > maxGitCliLength) {
			await this.ensureGitVersion(
				stdinVersion,
				`Stashing so many files (${pathspecs.length}) at once`,
				' Please retry by stashing fewer files or install a more recent version of Git and try again.',
			);
		}

		return this.git.stash__push(repoPath, message, {
			...options,
			pathspecs: pathspecs,
			stdin: stdin,
		});
	}

	@log()
	async createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	) {
		try {
			await this.git.worktree__add(repoPath, path, options);
		} catch (ex) {
			Logger.error(ex);

			const msg = String(ex);

			if (GitErrors.alreadyCheckedOut.test(msg)) {
				throw new WorktreeCreateError(WorktreeCreateErrorReason.AlreadyCheckedOut, ex);
			}

			if (GitErrors.alreadyExists.test(msg)) {
				throw new WorktreeCreateError(WorktreeCreateErrorReason.AlreadyExists, ex);
			}

			throw new WorktreeCreateError(undefined, ex);
		}
	}

	@gate()
	@log()
	async getWorktrees(repoPath: string): Promise<GitWorktree[]> {
		await this.ensureGitVersion(
			'2.7.6',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);

		const data = await this.git.worktree__list(repoPath);
		return GitWorktreeParser.parse(data, repoPath);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	@log()
	async getWorktreesDefaultUri(repoPath: string): Promise<Uri | undefined> {
		let location = configuration.get('worktrees.defaultLocation');
		if (location == null) return undefined;

		if (location.startsWith('~')) {
			location = joinPaths(homedir(), location.slice(1));
		}

		const folder = this.container.git.getRepository(repoPath)?.folder;
		location = interpolate(location, {
			userHome: homedir(),
			workspaceFolder: folder?.uri.fsPath,
			workspaceFolderBasename: folder?.name,
		});

		return this.getAbsoluteUri(location, repoPath);
	}

	@log()
	async deleteWorktree(repoPath: string, path: string, options?: { force?: boolean }) {
		await this.ensureGitVersion(
			'2.17.0',
			'Deleting worktrees',
			' Please install a more recent version of Git and try again.',
		);

		try {
			await this.git.worktree__remove(repoPath, path, options);
		} catch (ex) {
			Logger.error(ex);

			const msg = String(ex);

			if (GitErrors.mainWorkingTree.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.MainWorkingTree, ex);
			}

			if (GitErrors.uncommittedChanges.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.HasChanges, ex);
			}

			throw new WorktreeDeleteError(undefined, ex);
		}
	}

	private _scmGitApi: Promise<BuiltInGitApi | undefined> | undefined;
	private async getScmGitApi(): Promise<BuiltInGitApi | undefined> {
		return this._scmGitApi ?? (this._scmGitApi = this.getScmGitApiCore());
	}

	@log()
	private async getScmGitApiCore(): Promise<BuiltInGitApi | undefined> {
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

	@log()
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

	@log()
	async getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const scope = getLogScope();
		try {
			const gitApi = await this.getScmGitApi();
			if (gitApi?.openRepository != null) {
				return (await gitApi?.openRepository?.(Uri.file(repoPath))) ?? undefined;
			}

			return gitApi?.getRepository(Uri.file(repoPath)) ?? undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	private async openScmRepository(uri: Uri): Promise<BuiltInGitRepository | undefined> {
		const scope = getLogScope();
		try {
			const gitApi = await this.getScmGitApi();
			return (await gitApi?.openRepository?.(uri)) ?? undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	private async ensureGitVersion(version: string, prefix: string, suffix: string): Promise<void> {
		if (await this.git.isAtLeastVersion(version)) return;

		throw new Error(
			`${prefix} requires a newer version of Git (>= ${version}) than is currently installed (${await this.git.version()}).${suffix}`,
		);
	}
}
