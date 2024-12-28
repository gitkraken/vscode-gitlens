import { exec } from 'child_process';
import { promises as fs, readdir, realpath } from 'fs';
import { homedir, hostname, tmpdir, userInfo } from 'os';
import path, { resolve as resolvePath } from 'path';
import { env as process_env } from 'process';
import { md5 } from '@env/crypto';
import { fetch, getProxyAgent } from '@env/fetch';
import { hrtime } from '@env/hrtime';
import { isLinux, isWindows } from '@env/platform';
import type { CancellationToken, Event, TextDocument, WorkspaceFolder } from 'vscode';
import { Disposable, env, EventEmitter, extensions, FileType, Range, Uri, window, workspace } from 'vscode';
import type { GitExtension, API as ScmGitApi } from '../../../@types/vscode.git';
import { getCachedAvatarUri } from '../../../avatars';
import type { GitConfigKeys } from '../../../constants';
import { GlyphChars, Schemes } from '../../../constants';
import type { SearchQuery } from '../../../constants.search';
import type { Container } from '../../../container';
import { emojify } from '../../../emojis';
import { CancellationError } from '../../../errors';
import { Features } from '../../../features';
import { GitErrorHandling } from '../../../git/commandOptions';
import {
	ApplyPatchCommitError,
	ApplyPatchCommitErrorReason,
	BlameIgnoreRevsFileBadRevisionError,
	BlameIgnoreRevsFileError,
	CherryPickError,
	CherryPickErrorReason,
	FetchError,
	GitSearchError,
	PullError,
	PushError,
	PushErrorReason,
	StashApplyError,
	StashApplyErrorReason,
	StashPushError,
	TagError,
	WorktreeCreateError,
	WorktreeCreateErrorReason,
	WorktreeDeleteError,
	WorktreeDeleteErrorReason,
} from '../../../git/errors';
import type {
	BranchContributionsOverview,
	GitCaches,
	GitDir,
	GitProvider,
	GitProviderDescriptor,
	LeftRightCommitCountResult,
	NextComparisonUrisResult,
	PagedResult,
	PagingOptions,
	PreviousComparisonUrisResult,
	PreviousLineComparisonUrisResult,
	RepositoryCloseEvent,
	RepositoryInitWatcher,
	RepositoryOpenEvent,
	RepositoryVisibility,
	RevisionUriData,
	ScmRepository,
} from '../../../git/gitProvider';
import { GitUri, isGitUri } from '../../../git/gitUri';
import { encodeGitLensRevisionUriAuthority } from '../../../git/gitUri.authority';
import type { GitBlame, GitBlameAuthor, GitBlameLine } from '../../../git/models/blame';
import { GitBranch } from '../../../git/models/branch';
import {
	getBranchId,
	getBranchNameAndRemote,
	getBranchNameWithoutRemote,
	getBranchTrackingWithoutRemote,
	getRemoteNameFromBranchName,
	isDetachedHead,
} from '../../../git/models/branch.utils';
import type { GitStashCommit } from '../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../git/models/commit';
import type { GitContributorStats } from '../../../git/models/contributor';
import { GitContributor } from '../../../git/models/contributor';
import { calculateContributionScore } from '../../../git/models/contributor.utils';
import type {
	GitDiff,
	GitDiffFile,
	GitDiffFiles,
	GitDiffFilter,
	GitDiffLine,
	GitDiffShortStat,
} from '../../../git/models/diff';
import type { GitFile, GitFileStatus } from '../../../git/models/file';
import { GitFileChange, GitFileWorkingTreeStatus, mapFilesWithStats } from '../../../git/models/file';
import type {
	GitGraph,
	GitGraphRow,
	GitGraphRowContexts,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowsStats,
	GitGraphRowStats,
	GitGraphRowTag,
} from '../../../git/models/graph';
import type { GitLog } from '../../../git/models/log';
import type { GitMergeStatus } from '../../../git/models/merge';
import type { MergeConflict } from '../../../git/models/mergeConflict';
import type { GitRebaseStatus } from '../../../git/models/rebase';
import type { GitBranchReference, GitReference, GitTagReference } from '../../../git/models/reference';
import { createReference, getReferenceFromBranch, isBranchReference } from '../../../git/models/reference.utils';
import type { GitReflog } from '../../../git/models/reflog';
import type { GitRemote } from '../../../git/models/remote';
import { getVisibilityCacheKey, sortRemotes } from '../../../git/models/remote';
import { RemoteResourceType } from '../../../git/models/remoteResource';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { Repository, RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { GitRevisionRange } from '../../../git/models/revision';
import { deletedOrMissing, uncommitted, uncommittedStaged } from '../../../git/models/revision';
import {
	createRevisionRange,
	isRevisionRange,
	isSha,
	isShaLike,
	isUncommitted,
	isUncommittedStaged,
	shortenRevision,
} from '../../../git/models/revision.utils';
import type { GitStash } from '../../../git/models/stash';
import type { GitStatusFile } from '../../../git/models/status';
import { GitStatus } from '../../../git/models/status';
import type { GitTag } from '../../../git/models/tag';
import { getTagId } from '../../../git/models/tag';
import type { GitTreeEntry } from '../../../git/models/tree';
import type { GitUser } from '../../../git/models/user';
import { isUserMatch } from '../../../git/models/user';
import type { GitWorktree } from '../../../git/models/worktree';
import { getWorktreeId } from '../../../git/models/worktree';
import { groupWorktreesByBranch } from '../../../git/models/worktree.utils';
import { parseGitBlame } from '../../../git/parsers/blameParser';
import { parseGitBranches } from '../../../git/parsers/branchParser';
import {
	parseGitApplyFiles,
	parseGitDiffNameStatusFiles,
	parseGitDiffShortStat,
	parseGitFileDiff,
} from '../../../git/parsers/diffParser';
import type { ParserWithFilesAndMaybeStats } from '../../../git/parsers/logParser';
import {
	createLogParserSingle,
	createLogParserWithFiles,
	createLogParserWithFilesAndStats,
	getContributorsParser,
	getGraphParser,
	getGraphStatsParser,
	getRefAndDateParser,
	getRefParser,
	LogType,
	parseGitLog,
	parseGitLogAllFormat,
	parseGitLogDefaultFormat,
	parseGitLogSimple,
	parseGitLogSimpleFormat,
	parseGitLogSimpleRenamed,
} from '../../../git/parsers/logParser';
import { parseMergeTreeConflict } from '../../../git/parsers/mergeTreeParser';
import { parseGitRefLog, parseGitRefLogDefaultFormat } from '../../../git/parsers/reflogParser';
import { parseGitRemotes } from '../../../git/parsers/remoteParser';
import { parseGitStatus } from '../../../git/parsers/statusParser';
import { parseGitTags, parseGitTagsDefaultFormat } from '../../../git/parsers/tagParser';
import { parseGitLsFiles, parseGitTree } from '../../../git/parsers/treeParser';
import { parseGitWorktrees } from '../../../git/parsers/worktreeParser';
import { getRemoteProviderMatcher, loadRemoteProviders } from '../../../git/remotes/remoteProviders';
import type { GitSearch, GitSearchResultData, GitSearchResults } from '../../../git/search';
import { getGitArgsFromSearchQuery, getSearchQueryComparisonKey } from '../../../git/search';
import { getRemoteIconUri } from '../../../git/utils/icons';
import type { BranchSortOptions, TagSortOptions } from '../../../git/utils/sorting';
import { sortBranches, sortContributors, sortTags } from '../../../git/utils/sorting';
import {
	showBlameInvalidIgnoreRevsFileWarningMessage,
	showGenericErrorMessage,
	showGitDisabledErrorMessage,
	showGitInvalidConfigErrorMessage,
	showGitMissingErrorMessage,
	showGitVersionUnsupportedErrorMessage,
} from '../../../messages';
import { asRepoComparisonKey } from '../../../repositories';
import { countStringLength, filterMap } from '../../../system/array';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import { debounce } from '../../../system/function';
import {
	filterMap as filterMapIterable,
	find,
	first,
	join,
	last,
	map,
	min,
	skip,
	some,
} from '../../../system/iterable';
import { Logger } from '../../../system/logger';
import type { LogScope } from '../../../system/logger.scope';
import { getLogScope, setLogScopeExit } from '../../../system/logger.scope';
import {
	commonBaseIndex,
	dirname,
	isAbsolute,
	isFolderGlob,
	joinPaths,
	maybeUri,
	normalizePath,
	pathEquals,
} from '../../../system/path';
import type { PromiseOrValue } from '../../../system/promise';
import { any, asSettled, getSettledValue } from '../../../system/promise';
import { equalsIgnoreCase, getDurationMilliseconds, interpolate, splitSingle } from '../../../system/string';
import { PathTrie } from '../../../system/trie';
import { compare, fromString } from '../../../system/version';
import { TimedCancellationSource } from '../../../system/vscode/cancellation';
import { configuration } from '../../../system/vscode/configuration';
import { getBestPath, relative, splitPath } from '../../../system/vscode/path';
import { serializeWebviewItemContext } from '../../../system/webview';
import type { CachedBlame, CachedDiff, CachedLog, TrackedGitDocument } from '../../../trackers/trackedDocument';
import { GitDocumentState } from '../../../trackers/trackedDocument';
import type {
	GraphBranchContextValue,
	GraphItemContext,
	GraphItemRefContext,
	GraphItemRefGroupContext,
	GraphTagContextValue,
} from '../../../webviews/plus/graph/protocol';
import { registerCommitMessageProvider } from './commitMessageProvider';
import type { Git, PushForceOptions } from './git';
import {
	getShaInLogRegex,
	GitErrors,
	gitLogDefaultConfigs,
	gitLogDefaultConfigsWithFiles,
	maxGitCliLength,
} from './git';
import type { GitLocation } from './locator';
import { findGitPath, InvalidGitConfigError, UnableToFindGitError } from './locator';
import { CancelledRunError, fsExists, RunError } from './shell';

const emptyArray = Object.freeze([]) as unknown as any[];
const emptyPromise: Promise<GitBlame | GitDiffFile | GitLog | undefined> = Promise.resolve(undefined);
const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });
const slash = 47;

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;
const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;
const stashSummaryRegex =
	// eslint-disable-next-line no-control-regex
	/(?:(?:(?<wip>WIP) on|On) (?<onref>[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]):\s*)?(?<summary>.*)$/s;

const reflogCommands = ['merge', 'pull'];

interface RepositoryInfo {
	gitDir?: GitDir;
	user?: GitUser | null;
}

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

	private readonly _branchCache = new Map<string, Promise<GitBranch | undefined>>();
	private readonly _branchesCache = new Map<string, Promise<PagedResult<GitBranch>>>();
	private readonly _contributorsCache = new Map<string, Map<string, Promise<GitContributor[]>>>();
	private readonly _mergeStatusCache = new Map<string, Promise<GitMergeStatus | undefined>>();
	private readonly _rebaseStatusCache = new Map<string, Promise<GitRebaseStatus | undefined>>();
	private readonly _remotesCache = new Map<string, Promise<GitRemote[]>>();
	private readonly _repoInfoCache = new Map<string, RepositoryInfo>();
	private readonly _stashesCache = new Map<string, GitStash | null>();
	private readonly _tagsCache = new Map<string, Promise<PagedResult<GitTag>>>();
	private readonly _trackedPaths = new PathTrie<PromiseOrValue<[string, string] | undefined>>();
	private readonly _worktreesCache = new Map<string, Promise<GitWorktree[]>>();

	private _disposables: Disposable[] = [];

	constructor(
		protected readonly container: Container,
		protected readonly git: Git,
	) {
		this.git.setLocator(this.ensureGit.bind(this));

		this._disposables.push(
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'remotes')) {
					this.resetCaches(undefined, 'remotes');
				}
			}, this),
			this.container.events.on('git:cache:reset', e =>
				this.resetCaches(e.data.repoPath, ...(e.data.caches ?? emptyArray)),
			),
		);
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
			this._branchCache.delete(repo.path);
			this._branchesCache.delete(repo.path);
			this._contributorsCache.delete(repo.path);
			this._worktreesCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Remotes, RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			this._remotesCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Index, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any)) {
			this._trackedPaths.clear();
		}

		if (e.changed(RepositoryChange.Merge, RepositoryChangeComparisonMode.Any)) {
			this._branchCache.delete(repo.path);
			this._mergeStatusCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) {
			this._branchCache.delete(repo.path);
			this._rebaseStatusCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Stash, RepositoryChangeComparisonMode.Any)) {
			this._stashesCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Tags, RepositoryChangeComparisonMode.Any)) {
			this._tagsCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Worktrees, RepositoryChangeComparisonMode.Any)) {
			this._worktreesCache.delete(repo.path);
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
			case Features.Worktrees:
				supported = await this.git.isAtLeastVersion('2.17.0');
				this._supportedFeatures.set(feature, supported);
				return supported;
			case Features.StashOnlyStaged:
				supported = await this.git.isAtLeastVersion('2.35.0');
				this._supportedFeatures.set(feature, supported);
				return supported;
			case Features.ForceIfIncludes:
				supported = await this.git.isAtLeastVersion('2.30.0');
				this._supportedFeatures.set(feature, supported);
				return supported;
			default:
				return true;
		}
	}

	@debug<LocalGitProvider['visibility']>({ exit: r => `returned ${r[0]}` })
	async visibility(repoPath: string): Promise<[visibility: RepositoryVisibility, cacheKey: string | undefined]> {
		const remotes = await this.getRemotes(repoPath, { sort: true });
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
				url = remote.provider.url({ type: RemoteResourceType.Repo });
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
	async getBestRevisionUri(repoPath: string, path: string, ref: string | undefined): Promise<Uri | undefined> {
		if (ref === deletedOrMissing) return undefined;

		// TODO@eamodio Align this with isTrackedCore?
		if (!ref || (isUncommitted(ref) && !isUncommittedStaged(ref))) {
			// Make sure the file exists in the repo
			let data = await this.git.ls_files(repoPath, path);
			if (data != null) return this.getAbsoluteUri(path, repoPath);

			// Check if the file exists untracked
			data = await this.git.ls_files(repoPath, path, { untracked: true });
			if (data != null) return this.getAbsoluteUri(path, repoPath);

			return undefined;
		}

		// If the ref is the index, then try to create a Uri using the Git extension, but if we can't find a repo for it, then generate our own Uri
		if (isUncommittedStaged(ref)) {
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
		if (isUncommitted(ref) && !isUncommittedStaged(ref)) return this.getAbsoluteUri(path, repoPath);

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
			ref: ref,
			repoPath: normalizePath(repoPath),
			uncPath: uncPath,
		};

		const uri = Uri.from({
			scheme: Schemes.GitLens,
			authority: encodeGitLensRevisionUriAuthority(metadata),
			path: path,
			// Replace `/` with `\u2009\u2215\u2009` so that it doesn't get treated as part of the path of the file
			query: ref
				? JSON.stringify({ ref: shortenRevision(ref).replaceAll('/', '\u2009\u2215\u2009') })
				: undefined,
		});
		return uri;
	}

	@log({ exit: true })
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
	async addRemote(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void> {
		await this.git.remote__add(repoPath, name, url, options);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
	}

	@log()
	async pruneRemote(repoPath: string, name: string): Promise<void> {
		await this.git.remote__prune(repoPath, name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
	}

	@log()
	async removeRemote(repoPath: string, name: string): Promise<void> {
		await this.git.remote__remove(repoPath, name);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['remotes'] });
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
	async applyUnreachableCommitForPatch(
		repoPath: string,
		ref: string,
		options?: {
			branchName?: string;
			createBranchIfNeeded?: boolean;
			createWorktreePath?: string;
			stash?: boolean | 'prompt';
		},
	): Promise<void> {
		const scope = getLogScope();

		if (options?.stash) {
			// Stash any changes first
			const status = await this.getStatus(repoPath);
			if (status?.files?.length) {
				if (options.stash === 'prompt') {
					const confirm = { title: 'Stash Changes' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						'You have changes in your working tree.\nDo you want to stash them before applying the patch?',
						{ modal: true },
						confirm,
						cancel,
					);

					if (result !== confirm) throw new CancellationError();
				}

				try {
					await this.git.stash__push(repoPath, undefined, { includeUntracked: true });
				} catch (ex) {
					Logger.error(ex, scope);
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.StashFailed,
						`Unable to apply patch; failed stashing working changes changes${
							ex instanceof StashPushError ? `: ${ex.message}` : ''
						}`,
						ex,
					);
				}
			}
		}

		let targetPath = repoPath;
		const currentBranch = await this.getBranch(repoPath);
		const branchExists =
			options?.branchName == null ||
			currentBranch?.name === options.branchName ||
			(await this.getBranches(repoPath, { filter: b => b.name === options.branchName }))?.values?.length > 0;
		const shouldCreate = options?.branchName != null && !branchExists && options.createBranchIfNeeded;

		// TODO: Worktree creation should ideally be handled before calling this, and then
		// applyPatchCommit should be pointing to the worktree path. If done here, the newly created
		// worktree cannot be opened and we cannot handle issues elegantly.
		if (options?.createWorktreePath != null) {
			if (options?.branchName === null || options.branchName === currentBranch?.name) {
				throw new ApplyPatchCommitError(
					ApplyPatchCommitErrorReason.CreateWorktreeFailed,
					'Unable to apply patch; failed creating worktree',
				);
			}

			try {
				await this.createWorktree(repoPath, options.createWorktreePath, {
					commitish: options?.branchName != null && branchExists ? options.branchName : currentBranch?.name,
					createBranch: shouldCreate ? options.branchName : undefined,
				});
			} catch (ex) {
				Logger.error(ex, scope);
				throw new ApplyPatchCommitError(
					ApplyPatchCommitErrorReason.CreateWorktreeFailed,
					`Unable to apply patch; failed creating worktree${
						ex instanceof WorktreeCreateError ? `: ${ex.message}` : ''
					}`,
					ex,
				);
			}

			const worktree = await this.container.git.getWorktree(
				repoPath,
				w => normalizePath(w.uri.fsPath) === normalizePath(options.createWorktreePath!),
			);
			if (worktree == null) {
				throw new ApplyPatchCommitError(
					ApplyPatchCommitErrorReason.CreateWorktreeFailed,
					'Unable to apply patch; failed creating worktree',
				);
			}

			targetPath = worktree.uri.fsPath;
		}

		if (options?.branchName != null && currentBranch?.name !== options.branchName) {
			const checkoutRef = shouldCreate ? currentBranch?.ref ?? 'HEAD' : options.branchName;
			await this.checkout(targetPath, checkoutRef, {
				createBranch: shouldCreate ? options.branchName : undefined,
			});
		}

		// Apply the patch using a cherry pick without committing
		try {
			await this.git.cherrypick(targetPath, ref, { noCommit: true, errors: GitErrorHandling.Throw });
		} catch (ex) {
			Logger.error(ex, scope);
			if (ex instanceof CherryPickError) {
				if (ex.reason === CherryPickErrorReason.Conflicts) {
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.AppliedWithConflicts,
						`Patch applied with conflicts`,
						ex,
					);
				}

				if (ex.reason === CherryPickErrorReason.AbortedWouldOverwrite) {
					throw new ApplyPatchCommitError(
						ApplyPatchCommitErrorReason.ApplyAbortedWouldOverwrite,
						`Unable to apply patch as some local changes would be overwritten`,
						ex,
					);
				}
			}

			throw new ApplyPatchCommitError(
				ApplyPatchCommitErrorReason.ApplyFailed,
				`Unable to apply patch${ex instanceof CherryPickError ? `: ${ex.message}` : ''}`,
				ex,
			);
		}
	}

	@log()
	async createBranch(repoPath: string, name: string, ref: string): Promise<void> {
		await this.git.branch(repoPath, name, ref);
	}

	@log()
	async renameBranch(repoPath: string, oldName: string, newName: string): Promise<void> {
		await this.git.branch(repoPath, '-m', oldName, newName);
	}

	@log()
	async createTag(repoPath: string, name: string, ref: string, message?: string): Promise<void> {
		try {
			await this.git.tag(repoPath, name, ref, ...(message != null && message.length > 0 ? ['-m', message] : []));
		} catch (ex) {
			if (ex instanceof TagError) {
				throw ex.WithTag(name).WithAction('create');
			}

			throw ex;
		}
	}

	@log()
	async deleteTag(repoPath: string, name: string): Promise<void> {
		try {
			await this.git.tag(repoPath, '-d', name);
		} catch (ex) {
			if (ex instanceof TagError) {
				throw ex.WithTag(name).WithAction('delete');
			}

			throw ex;
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
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['branches', 'status'] });
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

	@log({ args: { 1: '<contents>', 3: '<message>' } })
	async createUnreachableCommitForPatch(
		repoPath: string,
		contents: string,
		baseRef: string,
		message: string,
	): Promise<GitCommit | undefined> {
		const scope = getLogScope();

		if (!contents.endsWith('\n')) {
			contents += '\n';
		}

		// Create a temporary index file
		const tempDir = await fs.mkdtemp(path.join(tmpdir(), 'gl-'));
		const tempIndex = joinPaths(tempDir, 'index');

		try {
			// Tell Git to use our soon to be created index file
			const env = { GIT_INDEX_FILE: tempIndex };

			// Create the temp index file from a base ref/sha

			// Get the tree of the base
			const newIndex = await this.git.git<string>(
				{
					cwd: repoPath,
					env: env,
				},
				'ls-tree',
				'-z',
				'-r',
				'--full-name',
				baseRef,
			);

			// Write the tree to our temp index
			await this.git.git<string>(
				{
					cwd: repoPath,
					env: env,
					stdin: newIndex,
				},
				'update-index',
				'-z',
				'--index-info',
			);

			// Apply the patch to our temp index, without touching the working directory
			await this.git.apply2(repoPath, { env: env, stdin: contents }, '--cached');

			// Create a new tree from our patched index
			const tree = (
				await this.git.git<string>(
					{
						cwd: repoPath,
						env: env,
					},
					'write-tree',
				)
			)?.trim();

			// Create new commit from the tree
			const sha = (
				await this.git.git<string>(
					{
						cwd: repoPath,
						env: env,
					},
					'commit-tree',
					tree,
					'-p',
					baseRef,
					'-m',
					message,
				)
			)?.trim();

			return await this.getCommit(repoPath, sha);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			throw ex;
		} finally {
			// Delete the temporary index file
			try {
				await fs.rm(tempDir, { recursive: true });
			} catch (_ex) {
				debugger;
			}
		}
	}

	@log({ singleLine: true })
	private resetCaches(repoPath: string | undefined, ...caches: GitCaches[]) {
		const cachesToClear = [];

		if (!caches.length || caches.includes('branches')) {
			cachesToClear.push(this._branchCache);
			cachesToClear.push(this._branchesCache);
		}

		if (!caches.length || caches.includes('contributors')) {
			cachesToClear.push(this._contributorsCache);
		}

		if (!caches.length || caches.includes('remotes')) {
			cachesToClear.push(this._remotesCache);
		}

		if (!caches.length || caches.includes('stashes')) {
			cachesToClear.push(this._stashesCache);
		}

		if (!caches.length || caches.includes('status')) {
			cachesToClear.push(this._mergeStatusCache, this._rebaseStatusCache);
		}

		if (!caches.length || caches.includes('tags')) {
			cachesToClear.push(this._tagsCache);
		}

		if (!caches.length || caches.includes('worktrees')) {
			cachesToClear.push(this._worktreesCache);
		}

		if (!caches.length) {
			cachesToClear.push(this._trackedPaths, this._repoInfoCache);
		}

		for (const cache of cachesToClear) {
			if (repoPath != null) {
				cache.delete(repoPath);
			} else {
				cache.clear();
			}
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
			const branch = await this.getBranch(repoPath);
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
				await this.git.branch__set_upstream(
					repoPath,
					setUpstream.branch,
					setUpstream.remote,
					setUpstream.remoteBranch,
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
				const stats = await workspace.fs.stat(uri);
				isDirectory = (stats.type & FileType.Directory) === FileType.Directory;
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

	@log()
	getLeftRightCommitCount(
		repoPath: string,
		range: GitRevisionRange,
		options?: { authors?: GitUser[] | undefined; excludeMerges?: boolean },
	): Promise<LeftRightCommitCountResult | undefined> {
		return this.git.rev_list__left_right(repoPath, range, options?.authors, options?.excludeMerges);
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
				this.getCurrentUser(root),
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
				const msg = ex?.toString() ?? '';
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
				this.getCurrentUser(root),
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
				const msg = ex?.toString() ?? '';
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
				this.getCurrentUser(root),
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
				this.getCurrentUser(root),
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

	@gate()
	@log()
	async getBranch(repoPath: string): Promise<GitBranch | undefined> {
		let branchPromise = this.useCaching ? this._branchCache.get(repoPath) : undefined;
		if (branchPromise == null) {
			async function load(this: LocalGitProvider): Promise<GitBranch | undefined> {
				const {
					values: [branch],
				} = await this.getBranches(repoPath, { filter: b => b.current });
				return branch ?? this.getCurrentBranch(repoPath);
			}

			branchPromise = load.call(this);

			if (this.useCaching) {
				this._branchCache.set(repoPath, branchPromise);
			}
		}

		return branchPromise;
	}

	private async getCurrentBranch(repoPath: string): Promise<GitBranch | undefined> {
		const commitOrdering = configuration.get('advanced.commitOrdering');

		const data = await this.git.rev_parse__currentBranch(repoPath, commitOrdering);
		if (data == null) return undefined;

		const [name, upstream] = data[0].split('\n');

		const [rebaseStatusResult, committerDateResult] = await Promise.allSettled([
			isDetachedHead(name) ? this.getRebaseStatus(repoPath) : undefined,
			this.git.log__recent_committerdate(repoPath, commitOrdering),
		]);

		const committerDate = getSettledValue(committerDateResult);
		const rebaseStatus = getSettledValue(rebaseStatusResult);

		return new GitBranch(
			this.container,
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

	@log({ args: { 1: false } })
	async getBranches(
		repoPath: string | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			paging?: PagingOptions;
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
					if (!data?.length) {
						const current = await this.getCurrentBranch(repoPath!);
						return current != null ? { values: [current] } : emptyPagedResult;
					}

					const branches = parseGitBranches(this.container, data, repoPath!);
					if (!branches.length) return emptyPagedResult;

					// If we don't have a current branch, check if we can find it another way (likely detached head)
					if (!branches.some(b => b.current)) {
						const current = await this.getCurrentBranch(repoPath!);
						if (current != null) {
							// replace the current branch if it already exists and add it first if not
							const index = branches.findIndex(b => b.id === current.id);
							if (index !== -1) {
								branches[index] = current;
							} else {
								branches.unshift(current);
							}
						}
					}
					return { values: branches };
				} catch (_ex) {
					this._branchesCache.delete(repoPath!);

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (this.useCaching && options?.paging?.cursor == null) {
				this._branchesCache.set(repoPath, resultsPromise);
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

		return parseGitDiffShortStat(data);
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
		refs: string[],
		branch?: string | undefined,
		options?:
			| { all?: boolean; commitDate?: Date; mode?: 'contains' | 'pointsAt' }
			| { commitDate?: Date; mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		if (branch != null) {
			const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, refs, {
				type: 'branch',
				mode: 'contains',
				name: branch,
			});
			return data ? [data?.trim()] : [];
		}

		const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, refs, { type: 'branch', ...options });
		if (!data) return [];

		return filterMap(data.split('\n'), b => b.trim() || undefined);
	}

	@log({ exit: true })
	getCommitCount(repoPath: string, ref: string): Promise<number | undefined> {
		return this.git.rev_list__count(repoPath, ref);
	}

	@log()
	async getCommitFileStats(repoPath: string, ref: string): Promise<GitFileChange[] | undefined> {
		const parser = createLogParserWithFilesAndStats<{ sha: string }>({ sha: '%H' });

		const data = await this.git.log(repoPath, { ref: ref }, '--max-count=1', ...parser.arguments);
		if (data == null) return undefined;

		let files: GitFileChange[] | undefined;

		for (const c of parser.parse(data)) {
			files = c.files.map(
				f =>
					new GitFileChange(repoPath, f.path, f.status as GitFileStatus, f.originalPath, undefined, {
						additions: f.additions,
						deletions: f.deletions,
						changes: 0,
					}),
			);
			break;
		}

		return files;
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
					if (isSha(options.ref) || isUncommitted(options.ref)) return undefined;
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
			include?: { stats?: boolean };
			limit?: number;
			ref?: string;
		},
	): Promise<GitGraph> {
		const defaultLimit = options?.limit ?? configuration.get('graph.defaultItemLimit') ?? 5000;
		const defaultPageLimit = configuration.get('graph.pageItemLimit') ?? 1000;
		const ordering = configuration.get('graph.commitOrdering', undefined, 'date');
		const onlyFollowFirstParent = configuration.get('graph.onlyFollowFirstParent', undefined, false);

		const deferStats = options?.include?.stats; // && defaultLimit > 1000;

		const parser = getGraphParser(options?.include?.stats && !deferStats);
		const refParser = getRefParser();
		const statsParser = getGraphStatsParser();

		const [refResult, stashResult, branchesResult, remotesResult, currentUserResult, worktreesResult] =
			await Promise.allSettled([
				this.git.log(repoPath, undefined, ...refParser.arguments, '-n1', options?.ref ?? 'HEAD'),
				this.getStash(repoPath),
				this.getBranches(repoPath),
				this.getRemotes(repoPath),
				this.getCurrentUser(repoPath),
				this.container.git
					.getWorktrees(repoPath)
					.then(w => [w, groupWorktreesByBranch(w, { includeDefault: true })]) satisfies Promise<
					[GitWorktree[], Map<string, GitWorktree>]
				>,
			]);

		const branches = getSettledValue(branchesResult)?.values;
		const branchMap = branches != null ? new Map(branches.map(r => [r.name, r])) : new Map<string, GitBranch>();
		const headBranch = branches?.find(b => b.current);
		const headRefUpstreamName = headBranch?.upstream?.name;
		const [worktrees, worktreesByBranch] = getSettledValue(worktreesResult) ?? [[], new Map<string, GitWorktree>()];

		let branchIdOfMainWorktree: string | undefined;
		if (worktreesByBranch != null) {
			branchIdOfMainWorktree = find(worktreesByBranch, ([, wt]) => wt.isDefault)?.[0];
			if (branchIdOfMainWorktree != null) {
				worktreesByBranch.delete(branchIdOfMainWorktree);
			}
		}

		const currentUser = getSettledValue(currentUserResult);

		const remotes = getSettledValue(remotesResult);
		const remoteMap = remotes != null ? new Map(remotes.map(r => [r.name, r])) : new Map<string, GitRemote>();
		const selectSha = first(refParser.parse(getSettledValue(refResult) ?? ''));

		const downstreamMap = new Map<string, string[]>();

		let stashes: Map<string, GitStashCommit> | undefined;
		let stdin: string | undefined;

		// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
		const gitStash = getSettledValue(stashResult);
		if (gitStash?.stashes.size) {
			stashes = new Map(gitStash.stashes);
			stdin = join(
				map(stashes.values(), c => c.sha.substring(0, 9)),
				'\n',
			);
		}

		const useAvatars = configuration.get('graph.avatars', undefined, true);

		const avatars = new Map<string, string>();
		const ids = new Set<string>();
		const reachableFromHEAD = new Set<string>();
		const remappedIds = new Map<string, string>();
		const rowStats: GitGraphRowsStats = new Map<string, GitGraphRowStats>();
		let total = 0;
		let iterations = 0;
		let pendingRowsStatsCount = 0;

		async function getCommitsForGraphCore(
			this: LocalGitProvider,
			limit: number,
			sha?: string,
			cursor?: { sha: string; skip: number },
		): Promise<GitGraph> {
			const startTotal = total;

			iterations++;

			let log: string | string[] | undefined;
			let nextPageLimit = limit;
			let size;

			do {
				const args = [...parser.arguments, `--${ordering}-order`, '--all'];
				if (onlyFollowFirstParent) {
					args.push('--first-parent');
				}
				if (cursor?.skip) {
					args.push(`--skip=${cursor.skip}`);
				}

				let data;
				if (sha) {
					[data, limit] = await this.git.logStreamTo(
						repoPath,
						sha,
						limit,
						stdin ? { stdin: stdin } : undefined,
						...args,
					);
				} else {
					args.push(`-n${nextPageLimit + 1}`);

					data = await this.git.log(repoPath, stdin ? { stdin: stdin } : undefined, ...args);

					if (cursor) {
						if (!getShaInLogRegex(cursor.sha).test(data)) {
							// If we didn't find any new commits, we must have them all so return that we have everything
							if (size === data.length) {
								return {
									repoPath: repoPath,
									avatars: avatars,
									ids: ids,
									includes: options?.include,
									branches: branchMap,
									remotes: remoteMap,
									downstreams: downstreamMap,
									stashes: stashes,
									worktrees: worktrees,
									worktreesByBranch: worktreesByBranch,
									rows: [],
								};
							}

							size = data.length;
							nextPageLimit = (nextPageLimit === 0 ? defaultPageLimit : nextPageLimit) * 2;
							cursor.skip -= Math.floor(cursor.skip * 0.1);

							continue;
						}
					}
				}

				if (!data) {
					return {
						repoPath: repoPath,
						avatars: avatars,
						ids: ids,
						includes: options?.include,
						branches: branchMap,
						remotes: remoteMap,
						downstreams: downstreamMap,
						stashes: stashes,
						worktrees: worktrees,
						worktreesByBranch: worktreesByBranch,
						rows: [],
					};
				}

				log = data;
				if (limit !== 0) {
					limit = nextPageLimit;
				}

				break;
			} while (true);

			const rows: GitGraphRow[] = [];

			let avatarUri: Uri | undefined;
			let avatarUrl: string | undefined;
			let branch: GitBranch | undefined;
			let branchId: string;
			let branchName: string;
			let context:
				| GraphItemRefContext<GraphBranchContextValue>
				| GraphItemRefContext<GraphTagContextValue>
				| undefined;
			let contexts: GitGraphRowContexts | undefined;
			let group;
			let groupName;
			const groupedRefs = new Map<
				string,
				{ head?: boolean; local?: GitBranchReference; remotes?: GitBranchReference[] }
			>();
			let head = false;
			let isCurrentUser = false;
			let refHead: GitGraphRowHead;
			let refHeads: GitGraphRowHead[];
			let refRemoteHead: GitGraphRowRemoteHead;
			let refRemoteHeads: GitGraphRowRemoteHead[];
			let refTag: GitGraphRowTag;
			let refTags: GitGraphRowTag[];
			let parent: string;
			let parents: string[];
			let remote: GitRemote | undefined;
			let remoteBranchId: string;
			let remoteName: string;
			let stash: GitStashCommit | undefined;
			let tagId: string;
			let tagName: string;
			let tip: string;

			let count = 0;

			const commits = parser.parse(log);
			for (const commit of commits) {
				count++;
				if (ids.has(commit.sha)) continue;

				total++;
				if (remappedIds.has(commit.sha)) continue;

				ids.add(commit.sha);

				refHeads = [];
				refRemoteHeads = [];
				refTags = [];
				contexts = {};

				if (commit.tips) {
					groupedRefs.clear();

					for (tip of commit.tips.split(', ')) {
						head = false;
						if (tip === 'refs/stash') continue;

						if (tip.startsWith('tag: ')) {
							tagName = tip.substring(5);
							tagId = getTagId(repoPath, tagName);
							context = {
								webviewItem: 'gitlens:tag',
								webviewItemValue: {
									type: 'tag',
									ref: createReference(tagName, repoPath, {
										id: tagId,
										refType: 'tag',
										name: tagName,
									}),
								},
							};

							refTag = {
								id: tagId,
								name: tagName,
								// Not currently used, so don't bother looking it up
								annotated: true,
								context:
									serializeWebviewItemContext<GraphItemRefContext<GraphTagContextValue>>(context),
							};
							refTags.push(refTag);

							continue;
						}

						if (tip.startsWith('HEAD')) {
							head = true;
							reachableFromHEAD.add(commit.sha);

							if (tip !== 'HEAD') {
								tip = tip.substring(8);
							}
						}

						remoteName = getRemoteNameFromBranchName(tip);
						if (remoteName) {
							remote = remoteMap.get(remoteName);
							if (remote != null) {
								branchName = getBranchNameWithoutRemote(tip);
								if (branchName === 'HEAD') continue;

								remoteBranchId = getBranchId(repoPath, true, tip);
								avatarUrl = (
									(useAvatars ? remote.provider?.avatarUri : undefined) ??
									getRemoteIconUri(this.container, remote, asWebviewUri)
								)?.toString(true);
								context = {
									webviewItem: 'gitlens:branch+remote',
									webviewItemValue: {
										type: 'branch',
										ref: createReference(tip, repoPath, {
											id: remoteBranchId,
											refType: 'branch',
											name: tip,
											remote: true,
											upstream: { name: remote.name, missing: false },
										}),
									},
								};

								refRemoteHead = {
									id: remoteBranchId,
									name: branchName,
									owner: remote.name,
									url: remote.url,
									avatarUrl: avatarUrl,
									context:
										serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(
											context,
										),
									current: tip === headRefUpstreamName,
									hostingServiceType: remote.provider?.gkProviderId,
								};
								refRemoteHeads.push(refRemoteHead);

								group = groupedRefs.get(branchName);
								if (group == null) {
									group = { remotes: [] };
									groupedRefs.set(branchName, group);
								}
								if (group.remotes == null) {
									group.remotes = [];
								}
								group.remotes.push(context.webviewItemValue.ref);

								continue;
							}
						}

						branch = branchMap.get(tip);
						branchId = branch?.id ?? getBranchId(repoPath, false, tip);
						context = {
							webviewItem: `gitlens:branch${head ? '+current' : ''}${
								branch?.upstream != null ? '+tracking' : ''
							}${
								worktreesByBranch?.has(branchId)
									? '+worktree'
									: branchIdOfMainWorktree === branchId
									  ? '+checkedout'
									  : ''
							}`,
							webviewItemValue: {
								type: 'branch',
								ref: createReference(tip, repoPath, {
									id: branchId,
									refType: 'branch',
									name: tip,
									remote: false,
									upstream: branch?.upstream,
								}),
							},
						};

						const worktree = worktreesByBranch?.get(branchId);
						refHead = {
							id: branchId,
							name: tip,
							isCurrentHead: head,
							context: serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>(context),
							upstream:
								branch?.upstream != null
									? {
											name: branch.upstream.name,
											id: getBranchId(repoPath, true, branch.upstream.name),
									  }
									: undefined,
							worktreeId: worktree != null ? getWorktreeId(repoPath, worktree.name) : undefined,
						};
						refHeads.push(refHead);
						if (branch?.upstream?.name != null) {
							// Add the branch name (tip) to the upstream name entry in the downstreams map
							let downstreams = downstreamMap.get(branch.upstream.name);
							if (downstreams == null) {
								downstreams = [];
								downstreamMap.set(branch.upstream.name, downstreams);
							}

							downstreams.push(tip);
						}

						group = groupedRefs.get(tip);
						if (group == null) {
							group = {};
							groupedRefs.set(tip, group);
						}

						if (head) {
							group.head = true;
						}
						group.local = context.webviewItemValue.ref;
					}

					for ([groupName, group] of groupedRefs) {
						if (
							group.remotes != null &&
							((group.local != null && group.remotes.length > 0) || group.remotes.length > 1)
						) {
							if (contexts.refGroups == null) {
								contexts.refGroups = {};
							}
							contexts.refGroups[groupName] = serializeWebviewItemContext<GraphItemRefGroupContext>({
								webviewItemGroup: `gitlens:refGroup${group.head ? '+current' : ''}`,
								webviewItemGroupValue: {
									type: 'refGroup',
									refs: group.local != null ? [group.local, ...group.remotes] : group.remotes,
								},
							});
						}
					}
				}

				stash = gitStash?.stashes.get(commit.sha);

				parents = commit.parents ? commit.parents.split(' ') : [];
				if (reachableFromHEAD.has(commit.sha)) {
					for (parent of parents) {
						reachableFromHEAD.add(parent);
					}
				}

				// Remove the second & third parent, if exists, from each stash commit as it is a Git implementation for the index and untracked files
				if (stash != null && parents.length > 1) {
					// Remap the "index commit" (e.g. contains staged files) of the stash
					remappedIds.set(parents[1], commit.sha);
					// Remap the "untracked commit" (e.g. contains untracked files) of the stash
					remappedIds.set(parents[2], commit.sha);
					parents.splice(1, 2);
				}

				if (stash == null && !avatars.has(commit.authorEmail)) {
					avatarUri = getCachedAvatarUri(commit.authorEmail);
					if (avatarUri != null) {
						avatars.set(commit.authorEmail, avatarUri.toString(true));
					}
				}

				isCurrentUser = isUserMatch(currentUser, commit.author, commit.authorEmail);

				if (stash != null) {
					contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
						webviewItem: 'gitlens:stash',
						webviewItemValue: {
							type: 'stash',
							ref: createReference(commit.sha, repoPath, {
								refType: 'stash',
								name: stash.name,
								message: stash.message,
								number: stash.number,
							}),
						},
					});
				} else {
					contexts.row = serializeWebviewItemContext<GraphItemRefContext>({
						webviewItem: `gitlens:commit${head ? '+HEAD' : ''}${
							reachableFromHEAD.has(commit.sha) ? '+current' : ''
						}`,
						webviewItemValue: {
							type: 'commit',
							ref: createReference(commit.sha, repoPath, {
								refType: 'revision',
								message: commit.message,
							}),
						},
					});

					contexts.avatar = serializeWebviewItemContext<GraphItemContext>({
						webviewItem: `gitlens:contributor${isCurrentUser ? '+current' : ''}`,
						webviewItemValue: {
							type: 'contributor',
							repoPath: repoPath,
							name: commit.author,
							email: commit.authorEmail,
							current: isCurrentUser,
						},
					});
				}

				rows.push({
					sha: commit.sha,
					parents: onlyFollowFirstParent ? [parents[0]] : parents,
					author: isCurrentUser ? 'You' : commit.author,
					email: commit.authorEmail,
					date: Number(ordering === 'author-date' ? commit.authorDate : commit.committerDate) * 1000,
					message: emojify(commit.message.trim()),
					// TODO: review logic for stash, wip, etc
					type: stash != null ? 'stash-node' : parents.length > 1 ? 'merge-node' : 'commit-node',
					heads: refHeads,
					remotes: refRemoteHeads,
					tags: refTags,
					contexts: contexts,
				});

				if (commit.stats != null) {
					rowStats.set(commit.sha, commit.stats);
				}
			}

			const startingCursor = cursor?.sha;
			const lastSha = last(ids);
			cursor =
				lastSha != null
					? {
							sha: lastSha,
							skip: total - iterations,
					  }
					: undefined;

			let rowsStatsDeferred: GitGraph['rowsStatsDeferred'];

			if (deferStats) {
				pendingRowsStatsCount++;

				// eslint-disable-next-line no-async-promise-executor
				const promise = new Promise<void>(async resolve => {
					try {
						const args = [...statsParser.arguments];
						if (startTotal === 0) {
							args.push(`-n${total}`);
						} else {
							args.push(`-n${total - startTotal}`, `--skip=${startTotal}`);
						}
						args.push(`--${ordering}-order`, '--all');

						const statsData = await this.git.log(repoPath, stdin ? { stdin: stdin } : undefined, ...args);
						if (statsData) {
							const commitStats = statsParser.parse(statsData);
							for (const stat of commitStats) {
								rowStats.set(stat.sha, stat.stats);
							}
						}
					} finally {
						pendingRowsStatsCount--;
						resolve();
					}
				});

				rowsStatsDeferred = {
					isLoaded: () => pendingRowsStatsCount === 0,
					promise: promise,
				};
			}

			return {
				repoPath: repoPath,
				avatars: avatars,
				ids: ids,
				includes: options?.include,
				remappedIds: remappedIds,
				branches: branchMap,
				remotes: remoteMap,
				downstreams: downstreamMap,
				stashes: stashes,
				worktrees: worktrees,
				worktreesByBranch: worktreesByBranch,
				rows: rows,
				id: sha,
				rowsStats: rowStats,
				rowsStatsDeferred: rowsStatsDeferred,

				paging: {
					limit: limit === 0 ? count : limit,
					startingCursor: startingCursor,
					hasMore: limit !== 0 && count > limit,
				},
				more: async (limit: number, sha?: string): Promise<GitGraph | undefined> =>
					getCommitsForGraphCore.call(this, limit, sha, cursor),
			};
		}

		return getCommitsForGraphCore.call(this, defaultLimit, selectSha);
	}

	@log()
	async getCommitTags(
		repoPath: string,
		ref: string,
		options?: { commitDate?: Date; mode?: 'contains' | 'pointsAt' },
	): Promise<string[]> {
		const data = await this.git.branchOrTag__containsOrPointsAt(repoPath, [ref], { type: 'tag', ...options });
		if (!data) return [];

		return filterMap(data.split('\n'), b => b.trim() || undefined);
	}

	getConfig(repoPath: string, key: GitConfigKeys): Promise<string | undefined> {
		return this.git.config__get(key, repoPath);
	}

	setConfig(repoPath: string, key: GitConfigKeys, value: string | undefined): Promise<void> {
		return this.git.config__set(key, value, repoPath);
	}

	@log()
	async getContributorsStats(
		repoPath: string,
		options?: { merges?: boolean; since?: string },
	): Promise<GitContributorStats | undefined> {
		if (repoPath == null) return undefined;

		const scope = getLogScope();

		const args = ['shortlog', '-s', '--all'];
		if (!options?.merges) {
			args.push('--no-merges');
		}
		if (options?.since) {
			args.push(`--since=${options.since}`);
		}

		try {
			const data = await this.git.git<string>({ cwd: repoPath }, ...args);
			if (data == null) return undefined;

			const contributions = data
				.split('\n')
				.map(line => parseInt(line.trim().split('\t', 1)[0], 10))
				.filter(c => !isNaN(c))
				.sort((a, b) => b - a);

			const result: GitContributorStats = {
				count: contributions.length,
				contributions: contributions,
			};
			return result;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			return undefined;
		}
	}

	@log()
	async getContributors(
		repoPath: string,
		options?: { all?: boolean; merges?: boolean | 'first-parent'; ref?: string; stats?: boolean },
	): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		let key = options?.ref ?? '';
		if (options?.all) {
			key += ':all';
		}
		if (options?.merges) {
			key += `:merges:${options.merges}`;
		}
		if (options?.stats) {
			key += ':stats';
		}

		const contributorsCache = this.useCaching ? this._contributorsCache.get(repoPath) : undefined;

		let contributors = contributorsCache?.get(key);
		if (contributors == null) {
			async function load(this: LocalGitProvider) {
				try {
					repoPath = normalizePath(repoPath);
					const currentUser = await this.getCurrentUser(repoPath);
					const parser = getContributorsParser(options?.stats);

					const args = [...parser.arguments, '--full-history', '--use-mailmap'];

					const merges = options?.merges ?? true;
					if (merges) {
						args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
					} else {
						args.push('--no-merges');
					}

					if (options?.all) {
						args.push('--all', '--single-worktree');
					}

					const data = await this.git.log(repoPath, { ref: options?.ref }, ...args);

					const contributors = new Map<string, GitContributor>();
					const commits = parser.parse(data);
					for (const c of commits) {
						const key = `${c.author}|${c.email}`;
						const timestamp = Number(c.date) * 1000;

						let contributor: Mutable<GitContributor> | undefined = contributors.get(key);
						if (contributor == null) {
							contributor = new GitContributor(
								repoPath,
								c.author,
								c.email,
								1,
								new Date(timestamp),
								new Date(timestamp),
								isUserMatch(currentUser, c.author, c.email),
								c.stats
									? {
											...c.stats,
											contributionScore: calculateContributionScore(c.stats, timestamp),
									  }
									: undefined,
							);
							contributors.set(key, contributor);
						} else {
							contributor.commits++;
							const date = new Date(timestamp);
							if (date > contributor.latestCommitDate!) {
								contributor.latestCommitDate = date;
							}
							if (date < contributor.firstCommitDate!) {
								contributor.firstCommitDate = date;
							}
							if (options?.stats && c.stats != null) {
								if (contributor.stats == null) {
									contributor.stats = {
										...c.stats,
										contributionScore: calculateContributionScore(c.stats, timestamp),
									};
								} else {
									contributor.stats = {
										additions: contributor.stats.additions + c.stats.additions,
										deletions: contributor.stats.deletions + c.stats.deletions,
										files: contributor.stats.files + c.stats.files,
										contributionScore:
											contributor.stats.contributionScore +
											calculateContributionScore(c.stats, timestamp),
									};
								}
							}
						}
					}

					return [...contributors.values()];
				} catch (_ex) {
					contributorsCache?.delete(key);

					return [];
				}
			}

			contributors = load.call(this);

			if (this.useCaching) {
				if (contributorsCache == null) {
					this._contributorsCache.set(repoPath, new Map([[key, contributors]]));
				} else {
					contributorsCache.set(key, contributors);
				}
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
					user[key as 'name' | 'email'] = ` ${value}`.substring(1);
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

	@log({ exit: true })
	async getBaseBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		try {
			const pattern = `^branch\\.${ref}\\.`;
			const data = await this.git.config__get_regex(pattern, repoPath);
			if (data) {
				const regex = new RegExp(`${pattern}(.+) (.+)$`, 'gm');

				let mergeBase: string | undefined;
				let update = false;
				while (true) {
					const match = regex.exec(data);
					if (match == null) break;

					const [, key, value] = match;
					if (key === 'gk-merge-base') {
						mergeBase = value;
						update = false;
						break;
					} else if (key === 'vscode-merge-base') {
						mergeBase = value;
						update = true;
						continue;
					}
				}

				if (mergeBase != null) {
					const branch = await this.getValidatedBranchName(repoPath, mergeBase);
					if (branch != null) {
						if (update) {
							void this.setBaseBranchName(repoPath, ref, branch);
						}
						return branch;
					}
				}
			}
		} catch {}

		const branch = await this.getBaseBranchFromReflog(repoPath, ref, { upstream: true });
		if (branch != null) {
			void this.setBaseBranchName(repoPath, ref, branch);
			return branch;
		}

		return undefined;
	}

	@log()
	async setBaseBranchName(repoPath: string, ref: string, base: string): Promise<void> {
		const mergeBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-merge-base`;

		await this.setConfig(repoPath, mergeBaseConfigKey, base);
	}

	private async getBaseBranchFromReflog(
		repoPath: string,
		ref: string,
		options?: { upstream: true },
	): Promise<string | undefined> {
		try {
			let data = await this.git.reflog(repoPath, undefined, ref, '--grep-reflog=branch: Created from *.');

			let entries = data.split('\n').filter(entry => Boolean(entry));
			if (entries.length !== 1) return undefined;

			// Check if branch created from an explicit branch
			let match = entries[0].match(/branch: Created from (.*)$/);
			if (match != null && match.length === 2) {
				let name: string | undefined = match[1];
				if (name !== 'HEAD') {
					name = await this.getValidatedBranchName(repoPath, options?.upstream ? `${name}@{u}` : name);
					if (name) return name;
				}
			}

			// Check if branch was created from HEAD
			data = await this.git.reflog(
				repoPath,
				undefined,
				'HEAD',
				`--grep-reflog=checkout: moving from .* to ${ref.replace('refs/heads/', '')}`,
			);
			entries = data.split('\n').filter(entry => Boolean(entry));

			if (!entries.length) return undefined;

			match = entries[entries.length - 1].match(/checkout: moving from ([^\s]+)\s/);
			if (match != null && match.length === 2) {
				let name: string | undefined = match[1];
				name = await this.getValidatedBranchName(repoPath, options?.upstream ? `${name}@{u}` : name);
				if (name) return name;
			}
		} catch {}

		return undefined;
	}

	private async getValidatedBranchName(repoPath: string, name: string): Promise<string | undefined> {
		const data = await this.git.git<string>(
			{ cwd: repoPath },
			'rev-parse',
			'--verify',
			'--quiet',
			'--symbolic-full-name',
			'--abbrev-ref',
			name,
		);
		return data?.trim() || undefined;
	}

	@log({ exit: true })
	async getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		if (remote) {
			try {
				const data = await this.git.ls_remote__HEAD(repoPath, remote);
				if (data == null) return undefined;

				const match = /ref:\s(\S+)\s+HEAD/m.exec(data);
				if (match == null) return undefined;

				const [, branch] = match;
				return `${remote}/${branch.substring('refs/heads/'.length)}`;
			} catch {}
		}

		try {
			const data = await this.git.symbolic_ref(repoPath, `refs/remotes/origin/HEAD`);
			return data?.trim() || undefined;
		} catch {}

		return undefined;
	}

	@log({ exit: true })
	async getTargetBranchName(repoPath: string, ref: string): Promise<string | undefined> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		let target = await this.getConfig(repoPath, targetBaseConfigKey);
		if (target != null) {
			target = await this.getValidatedBranchName(repoPath, target);
		}
		return target?.trim() || undefined;
	}

	@log()
	async setTargetBranchName(repoPath: string, ref: string, target: string): Promise<void> {
		const targetBaseConfigKey: GitConfigKeys = `branch.${ref}.gk-target-base`;

		await this.setConfig(repoPath, targetBaseConfigKey, target);
	}

	@log()
	async getDiff(
		repoPath: string,
		to: string,
		from?: string,
		options?:
			| { context?: number; includeUntracked?: never; uris?: never }
			| { context?: number; includeUntracked?: never; uris: Uri[] }
			| { context?: number; includeUntracked: boolean; uris?: never },
	): Promise<GitDiff | undefined> {
		const scope = getLogScope();
		const params = [`-U${options?.context ?? 3}`];

		if (to === uncommitted) {
			if (from != null) {
				params.push(from);
			} else {
				// Get only unstaged changes
				from = 'HEAD';
			}
		} else if (to === uncommittedStaged) {
			params.push('--staged');
			if (from != null) {
				params.push(from);
			} else {
				// Get only staged changes
				from = 'HEAD';
			}
		} else if (from == null) {
			if (to === '' || to.toUpperCase() === 'HEAD') {
				from = 'HEAD';
				params.push(from);
			} else {
				from = `${to}^`;
				params.push(from, to);
			}
		} else if (to === '') {
			params.push(from);
		} else {
			params.push(from, to);
		}

		let untrackedPaths: string[] | undefined;

		if (options?.uris) {
			params.push('--', ...options.uris.map(u => u.fsPath));
		} else if (options?.includeUntracked && to === uncommitted) {
			const status = await this.getStatus(repoPath);
			untrackedPaths = status?.untrackedChanges.map(f => f.path);
			if (untrackedPaths?.length) {
				await this.stageFiles(repoPath, untrackedPaths, { intentToAdd: true });
			}
		}

		let data;
		try {
			data = await this.git.diff2(repoPath, { errors: GitErrorHandling.Throw }, ...params);
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
			return undefined;
		} finally {
			if (untrackedPaths != null) {
				await this.unstageFiles(repoPath, untrackedPaths);
			}
		}

		const diff: GitDiff = { contents: data, from: from, to: to };
		return diff;
	}

	@log({ args: { 1: false } })
	async getDiffFiles(repoPath: string, contents: string): Promise<GitDiffFiles | undefined> {
		const data = await this.git.apply2(repoPath, { stdin: contents }, '--numstat', '--summary', '-z');
		if (!data) return undefined;

		const files = parseGitApplyFiles(data, repoPath);
		return {
			files: files,
		};
	}

	@log()
	async getDiffForFile(uri: GitUri, ref1: string | undefined, ref2?: string): Promise<GitDiffFile | undefined> {
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
				item: promise as Promise<GitDiffFile>,
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
	): Promise<GitDiffFile | undefined> {
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
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiffFile>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<GitDiffFile>;
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getDiffForFileContents']>({ args: { 1: '<contents>' } })
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<GitDiffFile | undefined> {
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
				item: promise as Promise<GitDiffFile>,
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
	): Promise<GitDiffFile | undefined> {
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
				const msg = ex?.toString() ?? '';
				Logger.debug(scope, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiffFile>,
					errorMessage: msg,
				};
				document.state.setDiff(key, value);

				return emptyPromise as Promise<GitDiffFile>;
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
	): Promise<GitDiffLine | undefined> {
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

	@log()
	async getDiffStatus(
		repoPath: string,
		ref1OrRange: string | GitRevisionRange,
		ref2?: string,
		options?: { filters?: GitDiffFilter[]; path?: string; similarityThreshold?: number },
	): Promise<GitFile[] | undefined> {
		try {
			const data = await this.git.diff__name_status(repoPath, ref1OrRange, ref2, {
				similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined,
				...options,
			});
			if (!data) return undefined;

			const files = parseGitDiffNameStatusFiles(data, repoPath);
			return files == null || files.length === 0 ? undefined : files;
		} catch (_ex) {
			return undefined;
		}
	}

	@log()
	async getFileStatusForCommit(repoPath: string, uri: Uri, ref: string): Promise<GitFile | undefined> {
		if (ref === deletedOrMissing || isUncommitted(ref)) return undefined;

		const [relativePath, root] = splitPath(uri, repoPath);

		// Don't include the filename, as renames won't be returned
		const data = await this.git.show(root, undefined, '--name-status', '--format=', '-z', ref, '--');
		if (!data) return undefined;

		const files = parseGitDiffNameStatusFiles(data, repoPath);
		if (files == null || files.length === 0) return undefined;

		const file = files.find(f => f.path === relativePath || f.originalPath === relativePath);
		return file;
	}

	@log({ exit: true })
	async getFirstCommitSha(repoPath: string): Promise<string | undefined> {
		const data = await this.git.rev_list(repoPath, 'HEAD', { maxParents: 0 });
		return data?.[0];
	}

	@gate()
	@debug<LocalGitProvider['getGitDir']>({
		exit: r => `returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const repo = this._repoInfoCache.get(repoPath);
		if (repo?.gitDir != null) return repo.gitDir;

		const gitDirPaths = await this.git.rev_parse__git_dir(repoPath);

		let gitDir: GitDir;
		if (gitDirPaths != null) {
			gitDir = {
				uri: Uri.file(gitDirPaths.path),
				commonUri: gitDirPaths.commonPath != null ? Uri.file(gitDirPaths.commonPath) : undefined,
			};
		} else {
			gitDir = {
				uri: this.getAbsoluteUri('.git', repoPath),
			};
		}
		this._repoInfoCache.set(repoPath, { ...repo, gitDir: gitDir });

		return gitDir;
	}

	@debug()
	async getLastFetchedTimestamp(repoPath: string): Promise<number | undefined> {
		try {
			const gitDir = await this.getGitDir(repoPath);
			const stats = await workspace.fs.stat(Uri.joinPath(gitDir.uri, 'FETCH_HEAD'));
			// If the file is empty, assume the fetch failed, and don't update the timestamp
			if (stats.size > 0) return stats.mtime;
		} catch {}

		return undefined;
	}

	@log()
	async getLog(
		repoPath: string,
		options?: {
			all?: boolean;
			authors?: GitUser[];
			cursor?: string;
			limit?: number;
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: number | string;
			stashes?: boolean | Map<string, GitStashCommit>;
			status?: boolean;
			until?: number | string;
			extraArgs?: string[];
		},
	): Promise<GitLog | undefined> {
		const scope = getLogScope();

		try {
			const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const args = [
				`--format=${options?.all ? parseGitLogAllFormat : parseGitLogDefaultFormat}`,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
			];

			if (options?.status !== false) {
				args.push('--name-status', '--full-history');
			}
			if (options?.all) {
				args.push('--all');
			}

			const merges = options?.merges ?? true;
			if (merges) {
				if (limit <= 2) {
					// Ensure we return the merge commit files when we are asking for a specific ref
					args.push('-m');
				}
				args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
			} else {
				args.push('--no-merges');
			}

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}
			if (options?.authors?.length) {
				args.push('--use-mailmap', ...options.authors.map(a => `--author=^${a.name} <${a.email}>$`));
			}

			let hasMoreOverride;

			if (options?.since) {
				hasMoreOverride = true;
				args.push(`--since="${options.since}"`);
			}
			if (options?.until) {
				hasMoreOverride = true;
				args.push(`--until="${options.until}"`);
			}
			if (options?.extraArgs?.length) {
				if (
					options.extraArgs.some(
						arg => arg.startsWith('-n') || arg.startsWith('--until=') || arg.startsWith('--since='),
					)
				) {
					hasMoreOverride = true;
				}
				args.push(...options.extraArgs);
			}

			if (limit) {
				hasMoreOverride = undefined;
				args.push(`-n${limit + 1}`);
			}

			let ref = options?.ref;

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (options?.stashes) {
				if (typeof options.stashes === 'boolean') {
					// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
					const gitStash = await this.getStash(repoPath, { reachableFrom: options?.ref });
					stashes = new Map(gitStash?.stashes);
					if (gitStash?.stashes.size) {
						stdin = '';
						for (const stash of gitStash.stashes.values()) {
							stdin += `${stash.sha.substring(0, 9)}\n`;
							// Include the stash's 2nd (index files) and 3rd (untracked files) parents
							for (const p of skip(stash.parents, 1)) {
								stashes.set(p, stash);
								stdin += `${p.substring(0, 9)}\n`;
							}
						}
					}
					ref ??= 'HEAD';
				} else {
					stashes = options.stashes;
					stdin = join(
						map(stashes.values(), c => c.sha.substring(0, 9)),
						'\n',
					);
					ref ??= 'HEAD';
				}
			}

			const data = await this.git.log(
				repoPath,
				{ configs: gitLogDefaultConfigsWithFiles, ref: ref, stdin: stdin },
				...args,
			);

			const log = parseGitLog(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				ref,
				await this.getCurrentUser(repoPath),
				limit,
				false,
				undefined,
				stashes,
				undefined,
				hasMoreOverride,
			);

			if (log != null) {
				log.query = (limit: number | undefined) => this.getLog(repoPath, { ...options, limit: limit });
				if (log.hasMore) {
					let opts;
					if (options != null) {
						let _;
						({ extraArgs: _, ...opts } = options);
					}
					log.more = this.getLogMoreFn(log, opts);
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
			merges?: boolean | 'first-parent';
			ordering?: 'date' | 'author-date' | 'topo' | null;
			ref?: string;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const scope = getLogScope();

		const limit = options?.limit ?? configuration.get('advanced.maxListItems') ?? 0;

		try {
			const parser = createLogParserSingle('%H');
			const args = [...parser.arguments, '--full-history'];

			const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
			if (ordering) {
				args.push(`--${ordering}-order`);
			}

			if (limit) {
				args.push(`-n${limit + 1}`);
			}

			if (options?.since) {
				args.push(`--since="${options.since}"`);
			}

			const merges = options?.merges ?? true;
			if (merges) {
				args.push(merges === 'first-parent' ? '--first-parent' : '--no-min-parents');
			} else {
				args.push('--no-merges');
			}

			if (options?.authors?.length) {
				if (!args.includes('--use-mailmap')) {
					args.push('--use-mailmap');
				}
				args.push(...options.authors.map(a => `--author=^${a.name} <${a.email}>$`));
			}

			const data = await this.git.log(repoPath, { ref: options?.ref }, ...args);

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
			if (isRevisionRange(log.sha)) {
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

			let moreLogCount;
			let queryLimit = moreUntil == null ? moreLimit : 0;
			do {
				const moreLog = await this.getLog(log.repoPath, {
					...options,
					limit: queryLimit,
					...(timestamp
						? {
								until: timestamp,
								extraArgs: ['--boundary'],
						  }
						: { ref: moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^` }),
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false, more: undefined };

				const currentCount = log.commits.size;
				const commits = new Map([...log.commits, ...moreLog.commits]);

				if (currentCount === commits.size && queryLimit !== 0) {
					// If we didn't find any new commits, we must have them all so return that we have everything
					if (moreLogCount === moreLog.commits.size) {
						return { ...log, hasMore: false, more: undefined };
					}

					moreLogCount = moreLog.commits.size;
					queryLimit = queryLimit * 2;
					continue;
				}

				if (timestamp != null && ref != null && !moreLog.commits.has(ref)) {
					debugger;
				}

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
			} while (true);
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

		const opts: typeof options & Parameters<LocalGitProvider['getLogForFileCore']>[2] = {
			reverse: false,
			...options,
		};

		if (opts.renames == null) {
			opts.renames = configuration.get('advanced.fileHistoryFollowsRenames');
		}

		if (opts.merges == null) {
			opts.merges = configuration.get('advanced.fileHistoryShowMergeCommits');
		}

		let key = 'log';
		if (opts.ref != null) {
			key += `:${opts.ref}`;
		}

		if (opts.all == null) {
			opts.all = configuration.get('advanced.fileHistoryShowAllBranches');
		}
		if (opts.all) {
			key += ':all';
		}

		opts.limit = opts.limit ?? configuration.get('advanced.maxListItems') ?? 0;
		if (opts.limit) {
			key += `:n${opts.limit}`;
		}

		if (opts.merges) {
			key += ':merges';
		}

		if (opts.renames) {
			key += ':follow';
		}

		if (opts.reverse) {
			key += ':reverse';
		}

		if (opts.since) {
			key += `:since=${opts.since}`;
		}

		if (opts.skip) {
			key += `:skip${opts.skip}`;
		}

		const doc = await this.container.documentTracker.getOrAdd(GitUri.fromFile(relativePath, repoPath, opts.ref));
		if (!opts.force && this.useCaching && opts.range == null) {
			if (doc.state != null) {
				const cachedLog = doc.state.getLog(key);
				if (cachedLog != null) {
					Logger.debug(scope, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (opts.ref != null || (opts.limit != null && opts.limit !== 0)) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.getLog(
						`log${opts.renames ? ':follow' : ''}${opts.reverse ? ':reverse' : ''}`,
					);
					if (cachedLog != null) {
						if (opts.ref == null) {
							Logger.debug(scope, `Cache hit: ~'${key}'`);
							return cachedLog.item;
						}

						Logger.debug(scope, `Cache ?: '${key}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(opts.ref)) {
							Logger.debug(scope, `Cache hit: '${key}'`);

							// Create a copy of the log starting at the requested commit
							let skip = true;
							let i = 0;
							const commits = new Map(
								filterMapIterable<[string, GitCommit], [string, GitCommit]>(
									log.commits.entries(),
									([ref, c]) => {
										if (skip) {
											if (ref !== opts?.ref) return undefined;
											skip = false;
										}

										i++;
										if (opts?.limit != null && i > opts.limit) {
											return undefined;
										}

										return [ref, c];
									},
								),
							);

							const optsCopy = { ...opts };
							log = {
								...log,
								limit: optsCopy.limit,
								count: commits.size,
								commits: commits,
								query: (limit: number | undefined) =>
									this.getLogForFile(repoPath, pathOrUri, { ...optsCopy, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(scope, `Cache miss: '${key}'`);

			doc.state ??= new GitDocumentState();
		}

		const promise = this.getLogForFileCore(repoPath, relativePath, opts, doc, key, scope);

		if (doc.state != null && opts.range == null) {
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
			merges?: boolean;
			ordering?: 'date' | 'author-date' | 'topo' | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
		document: TrackedGitDocument,
		key: string,
		scope: LogScope | undefined,
	): Promise<GitLog | undefined> {
		const paths = await this.isTrackedWithDetails(path, repoPath, ref);
		if (paths == null) {
			Logger.log(scope, `Skipping log; '${path}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [relativePath, root] = paths;

		try {
			if (range != null && range.start.line > range.end.line) {
				range = new Range(range.end, range.start);
			}

			let data = await this.git.log__file(root, relativePath, ref, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				startLine: range == null ? undefined : range.start.line + 1,
				endLine: range == null ? undefined : range.end.line + 1,
			});

			// If we didn't find any history from the working tree, check to see if the file was renamed
			if (!data && ref == null) {
				const status = await this.getStatusForFile(root, relativePath);
				if (status?.originalPath != null) {
					data = await this.git.log__file(root, status.originalPath, ref, {
						ordering: configuration.get('advanced.commitOrdering'),
						...options,
						startLine: range == null ? undefined : range.start.line + 1,
						endLine: range == null ? undefined : range.end.line + 1,
					});
				}
			}

			const log = parseGitLog(
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

			const commit = last(log.commits.values());
			let ref;
			if (commit != null) {
				ref = commit.ref;
				// Check to make sure the filename hasn't changed and if it has use the previous
				if (commit.file != null) {
					const path = commit.file.originalPath ?? commit.file.path;
					if (path !== relativePath) {
						relativePath = path;
					}
				}
			}
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

	@log()
	async getMergeStatus(repoPath: string): Promise<GitMergeStatus | undefined> {
		let status = this.useCaching ? this._mergeStatusCache.get(repoPath) : undefined;
		if (status == null) {
			async function getCore(this: LocalGitProvider): Promise<GitMergeStatus | undefined> {
				const merge = await this.git.rev_parse__verify(repoPath, 'MERGE_HEAD');
				if (merge == null) return undefined;

				const [branchResult, mergeBaseResult, possibleSourceBranchesResult] = await Promise.allSettled([
					this.getBranch(repoPath),
					this.getMergeBase(repoPath, 'MERGE_HEAD', 'HEAD'),
					this.getCommitBranches(repoPath, ['MERGE_HEAD'], undefined, { all: true, mode: 'pointsAt' }),
				]);

				const branch = getSettledValue(branchResult);
				const mergeBase = getSettledValue(mergeBaseResult);
				const possibleSourceBranches = getSettledValue(possibleSourceBranchesResult);

				return {
					type: 'merge',
					repoPath: repoPath,
					mergeBase: mergeBase,
					HEAD: createReference(merge, repoPath, { refType: 'revision' }),
					current: getReferenceFromBranch(branch!),
					incoming:
						possibleSourceBranches?.length === 1
							? createReference(possibleSourceBranches[0], repoPath, {
									refType: 'branch',
									name: possibleSourceBranches[0],
									remote: false,
							  })
							: undefined,
				} satisfies GitMergeStatus;
			}

			status = getCore.call(this);
			if (this.useCaching) {
				this._mergeStatusCache.set(repoPath, status);
			}
		}

		return status;
	}

	@log()
	async getRebaseStatus(repoPath: string): Promise<GitRebaseStatus | undefined> {
		let status = this.useCaching ? this._rebaseStatusCache.get(repoPath) : undefined;
		if (status == null) {
			async function getCore(this: LocalGitProvider): Promise<GitRebaseStatus | undefined> {
				const gitDir = await this.getGitDir(repoPath);
				const [rebaseMergeHeadResult, rebaseApplyHeadResult] = await Promise.allSettled([
					this.git.readDotGitFile(gitDir, ['rebase-merge', 'head-name']),
					this.git.readDotGitFile(gitDir, ['rebase-apply', 'head-name']),
				]);
				const rebaseMergeHead = getSettledValue(rebaseMergeHeadResult);
				const rebaseApplyHead = getSettledValue(rebaseApplyHeadResult);

				let branch = rebaseApplyHead ?? rebaseMergeHead;
				if (branch == null) return undefined;

				const path = rebaseApplyHead != null ? 'rebase-apply' : 'rebase-merge';

				const [
					rebaseHeadResult,
					origHeadResult,
					ontoResult,
					stepsNumberResult,
					stepsTotalResult,
					stepsMessageResult,
				] = await Promise.allSettled([
					this.git.rev_parse__verify(repoPath, 'REBASE_HEAD'),
					this.git.readDotGitFile(gitDir, [path, 'orig-head']),
					this.git.readDotGitFile(gitDir, [path, 'onto']),
					this.git.readDotGitFile(gitDir, [path, 'msgnum'], { numeric: true }),
					this.git.readDotGitFile(gitDir, [path, 'end'], { numeric: true }),
					this.git
						.readDotGitFile(gitDir, [path, 'message'], { throw: true })
						.catch(() => this.git.readDotGitFile(gitDir, [path, 'message-squashed'])),
				]);

				const origHead = getSettledValue(origHeadResult);
				const onto = getSettledValue(ontoResult);
				if (origHead == null || onto == null) return undefined;

				let mergeBase;
				const rebaseHead = getSettledValue(rebaseHeadResult);
				if (rebaseHead != null) {
					mergeBase = await this.getMergeBase(repoPath, rebaseHead, 'HEAD');
				} else {
					mergeBase = await this.getMergeBase(repoPath, onto, origHead);
				}

				if (branch.startsWith('refs/heads/')) {
					branch = branch.substring(11).trim();
				}

				const [branchTipsResult, tagTipsResult] = await Promise.allSettled([
					this.getCommitBranches(repoPath, [onto], undefined, { all: true, mode: 'pointsAt' }),
					this.getCommitTags(repoPath, onto, { mode: 'pointsAt' }),
				]);

				const branchTips = getSettledValue(branchTipsResult);
				const tagTips = getSettledValue(tagTipsResult);

				let ontoRef: GitBranchReference | GitTagReference | undefined;
				if (branchTips != null) {
					for (const ref of branchTips) {
						if (ref.startsWith('(no branch, rebasing')) continue;

						ontoRef = createReference(ref, repoPath, {
							refType: 'branch',
							name: ref,
							remote: false,
						});
						break;
					}
				}
				if (ontoRef == null && tagTips != null) {
					for (const ref of tagTips) {
						if (ref.startsWith('(no branch, rebasing')) continue;

						ontoRef = createReference(ref, repoPath, {
							refType: 'tag',
							name: ref,
						});
						break;
					}
				}

				return {
					type: 'rebase',
					repoPath: repoPath,
					mergeBase: mergeBase,
					HEAD: createReference(rebaseHead ?? origHead, repoPath, { refType: 'revision' }),
					onto: createReference(onto, repoPath, { refType: 'revision' }),
					current: ontoRef,
					incoming: createReference(branch, repoPath, {
						refType: 'branch',
						name: branch,
						remote: false,
					}),
					steps: {
						current: {
							number: getSettledValue(stepsNumberResult) ?? 0,
							commit:
								rebaseHead != null
									? createReference(rebaseHead, repoPath, {
											refType: 'revision',
											message: getSettledValue(stepsMessageResult),
									  })
									: undefined,
						},
						total: getSettledValue(stepsTotalResult) ?? 0,
					},
				} satisfies GitRebaseStatus;
			}

			status = getCore.call(this);
			if (this.useCaching) {
				this._rebaseStatusCache.set(repoPath, status);
			}
		}

		return status;
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

		if (isUncommittedStaged(ref)) {
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
						next: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
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
		if (!ref || isUncommittedStaged(ref)) return undefined;

		let filters: GitDiffFilter[] | undefined;
		if (ref === deletedOrMissing) {
			// If we are trying to move next from a deleted or missing ref then get the first commit
			ref = undefined;
			filters = ['A'];
		}

		const relativePath = this.getRelativePath(uri, repoPath);
		let data = await this.git.log__file(repoPath, relativePath, ref, {
			argsOrFormat: parseGitLogSimpleFormat,
			fileMode: 'simple',
			filters: filters,
			limit: skip + 1,
			ordering: configuration.get('advanced.commitOrdering'),
			reverse: true,
			// startLine: editorLine != null ? editorLine + 1 : undefined,
		});
		if (data == null || data.length === 0) return undefined;

		const [nextRef, file, status] = parseGitLogSimple(data, skip);
		// If the file was deleted, check for a possible rename
		if (status === 'D') {
			data = await this.git.log__file(repoPath, '.', nextRef, {
				argsOrFormat: parseGitLogSimpleFormat,
				fileMode: 'simple',
				filters: ['R', 'C'],
				limit: 1,
				ordering: configuration.get('advanced.commitOrdering'),
				// startLine: editorLine != null ? editorLine + 1 : undefined
			});
			if (data == null || data.length === 0) {
				return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
			}

			const [nextRenamedRef, renamedFile] = parseGitLogSimpleRenamed(data, file ?? relativePath);
			return GitUri.fromFile(
				renamedFile ?? file ?? relativePath,
				repoPath,
				nextRenamedRef ?? nextRef ?? deletedOrMissing,
			);
		}

		return GitUri.fromFile(file ?? relativePath, repoPath, nextRef);
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string, uri: Uri): Promise<string | undefined> {
		const [relativePath, root] = splitPath(uri, repoPath);

		const data = await this.git.log__file(root, relativePath, '@{u}..', {
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
	async getPreviousComparisonUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<PreviousComparisonUrisResult | undefined> {
		if (ref === deletedOrMissing) return undefined;

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
							previous: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
						};
					}

					return {
						// Diff staged with HEAD (or prior if more skips)
						current: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
						previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1),
					};
				} else if (status.workingTreeStatus != null) {
					if (skip === 0) {
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: await this.getPreviousUri(repoPath, uri, undefined, skip),
						};
					}
				}
			} else if (skip === 0) {
				skip++;
			}
		}
		// If we are at the index (staged), diff staged with HEAD
		else if (isUncommittedStaged(ref)) {
			const current =
				skip === 0
					? GitUri.fromFile(relativePath, repoPath, ref)
					: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1))!;
			if (current == null || current.sha === deletedOrMissing) return undefined;

			return {
				current: current,
				previous: await this.getPreviousUri(repoPath, uri, undefined, skip),
			};
		}

		// If we are at a commit, diff commit with previous
		const current =
			skip === 0
				? GitUri.fromFile(relativePath, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1))!;
		if (current == null || current.sha === deletedOrMissing) return undefined;

		return {
			current: current,
			previous: await this.getPreviousUri(repoPath, uri, ref, skip),
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
		if (ref === deletedOrMissing) return undefined;

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
				// Check the file status to see if there is anything staged
				const status = await this.getStatusForFile(repoPath, uri);
				if (status != null) {
					// If the file is staged, diff working with staged (index)
					// If the file is not staged, diff working with HEAD
					if (status.indexStatus != null) {
						// Diff working with staged
						return {
							current: GitUri.fromFile(relativePath, repoPath, undefined),
							previous: GitUri.fromFile(relativePath, repoPath, uncommittedStaged),
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

			// If line is committed, diff with line ref with previous
			ref = blameLine.commit.sha;
			relativePath = blameLine.commit.file?.path ?? blameLine.commit.file?.originalPath ?? relativePath;
			uri = this.getAbsoluteUri(relativePath, repoPath);
			editorLine = blameLine.line.originalLine - 1;

			if (skip === 0 && blameLine.commit.file?.previousSha) {
				previous = GitUri.fromFile(relativePath, repoPath, blameLine.commit.file.previousSha);
			}
		} else {
			if (isUncommittedStaged(ref)) {
				const current =
					skip === 0
						? GitUri.fromFile(relativePath, repoPath, ref)
						: (await this.getPreviousUri(repoPath, uri, undefined, skip - 1, editorLine))!;
				if (current.sha === deletedOrMissing) return undefined;

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
		if (current.sha === deletedOrMissing) return undefined;

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
	): Promise<GitUri | undefined> {
		if (ref === deletedOrMissing) return undefined;

		const scope = getLogScope();

		if (ref === uncommitted) {
			ref = undefined;
		}

		const relativePath = this.getRelativePath(uri, repoPath);

		// TODO: Add caching
		let data;
		try {
			data = await this.git.log__file(repoPath, relativePath, ref, {
				argsOrFormat: parseGitLogSimpleFormat,
				fileMode: 'simple',
				limit: skip + 2,
				ordering: configuration.get('advanced.commitOrdering'),
				startLine: editorLine != null ? editorLine + 1 : undefined,
			});
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			// If the line count is invalid just fallback to the most recent commit
			if ((ref == null || isUncommittedStaged(ref)) && GitErrors.invalidLineCount.test(msg)) {
				if (ref == null) {
					const status = await this.getStatusForFile(repoPath, uri);
					if (status?.indexStatus != null) {
						return GitUri.fromFile(relativePath, repoPath, uncommittedStaged);
					}
				}

				ref = await this.git.log__file_recent(repoPath, relativePath, {
					ordering: configuration.get('advanced.commitOrdering'),
				});
				return GitUri.fromFile(relativePath, repoPath, ref ?? deletedOrMissing);
			}

			Logger.error(ex, scope);
			throw ex;
		}
		if (data == null || data.length === 0) return undefined;

		const [previousRef, file] = parseGitLogSimple(data, skip, ref);
		// If the previous ref matches the ref we asked for assume we are at the end of the history
		if (ref != null && ref === previousRef) return undefined;

		return GitUri.fromFile(file ?? relativePath, repoPath, previousRef ?? deletedOrMissing);
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

		const args = ['--walk-reflogs', `--format=${parseGitRefLogDefaultFormat}`, '--date=iso8601'];

		const ordering = options?.ordering ?? configuration.get('advanced.commitOrdering');
		if (ordering) {
			args.push(`--${ordering}-order`);
		}

		if (options?.all) {
			args.push('--all');
		}

		// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
		const limit = (options?.limit ?? configuration.get('advanced.maxListItems') ?? 0) * 100;
		if (limit) {
			args.push(`-n${limit}`);
		}

		if (options?.skip) {
			args.push(`--skip=${options.skip}`);
		}

		try {
			const data = await this.git.log(repoPath, undefined, ...args);
			if (data == null) return undefined;

			const reflog = parseGitRefLog(this.container, data, repoPath, reflogCommands, limit, limit * 100);
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
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const scope = getLogScope();

		let remotesPromise = this.useCaching ? this._remotesCache.get(repoPath) : undefined;
		if (remotesPromise == null) {
			async function load(this: LocalGitProvider): Promise<GitRemote[]> {
				const providers = loadRemoteProviders(
					configuration.get('remotes', this.container.git.getRepository(repoPath!)?.folder?.uri ?? null),
				);

				try {
					const data = await this.git.remote(repoPath!);
					const remotes = parseGitRemotes(
						this.container,
						data,
						repoPath!,
						getRemoteProviderMatcher(this.container, providers),
					);
					return remotes;
				} catch (ex) {
					this._remotesCache.delete(repoPath!);
					Logger.error(ex, scope);
					return [];
				}
			}

			remotesPromise = load.call(this);

			if (this.useCaching) {
				this._remotesCache.set(repoPath, remotesPromise);
			}
		}

		let remotes = await remotesPromise;
		if (options?.filter != null) {
			remotes = remotes.filter(options.filter);
		}

		if (options?.sort) {
			sortRemotes(remotes);
		}

		return remotes;
	}

	@gate()
	@log()
	getRevisionContent(repoPath: string, path: string, ref: string): Promise<Uint8Array | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		return this.git.show__content<Buffer>(root, relativePath, ref, { encoding: 'buffer' }) as Promise<
			Uint8Array | undefined
		>;
	}

	@gate()
	@log()
	async getStash(repoPath: string | undefined, options?: { reachableFrom?: string }): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		let gitStash = this.useCaching ? this._stashesCache.get(repoPath) : undefined;
		if (gitStash === undefined) {
			const parser = createLogParserWithFiles<{
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
				summary: '%gs',
			});
			const data = await this.git.stash__list(repoPath, {
				args: parser.arguments,
				similarityThreshold: configuration.get('advanced.similarityThreshold'),
			});

			const stashes = new Map<string, GitStashCommit>();

			for (const s of parser.parse(data)) {
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

				stashes.set(
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

			gitStash = { repoPath: repoPath, stashes: stashes };

			if (this.useCaching) {
				this._stashesCache.set(repoPath, gitStash ?? null);
			}
		}

		// Return only reachable stashes from the given ref
		if (options?.reachableFrom && gitStash?.stashes.size) {
			// Create a copy because we are going to modify it and we don't want to mutate the cache
			gitStash = { ...gitStash, stashes: new Map(gitStash.stashes) };

			const oldestStashDate = new Date(min(gitStash.stashes.values(), c => c.date.getTime())).toISOString();

			const ancestors = await this.git.rev_list(repoPath, options.reachableFrom, { since: oldestStashDate });
			if (ancestors?.length && (ancestors.length !== 1 || ancestors[0])) {
				const reachableCommits = new Set(ancestors);

				if (reachableCommits.size) {
					const reachableStashes = new Set<string>();

					// First pass: mark directly reachable stashes
					for (const [sha, stash] of gitStash.stashes) {
						if (stash.parents.some(p => p === options.reachableFrom || reachableCommits.has(p))) {
							reachableStashes.add(sha);
						}
					}

					// Second pass: mark stashes that build upon reachable stashes
					let changed;
					do {
						changed = false;
						for (const [sha, stash] of gitStash.stashes) {
							if (!reachableStashes.has(sha) && stash.parents.some(p => reachableStashes.has(p))) {
								reachableStashes.add(sha);
								changed = true;
							}
						}
					} while (changed);

					// Remove unreachable stashes
					for (const [sha] of gitStash.stashes) {
						if (!reachableStashes.has(sha)) {
							gitStash.stashes.delete(sha);
						}
					}
				} else {
					gitStash.stashes.clear();
				}
			}
		}

		return gitStash ?? undefined;
	}

	@log()
	async getStashCommitFiles(
		repoPath: string,
		ref: string,
		options?: { include?: { stats?: boolean } },
	): Promise<GitFileChange[]> {
		const [stashFilesResult, stashUntrackedFilesResult, stashFilesStatsResult] = await Promise.allSettled([
			// Don't include untracked files here, because we won't be able to tell them apart from added (and we need the untracked status)
			this.getStashCommitFilesCore(repoPath, ref, { untracked: false }),
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.getStashCommitFilesCore(repoPath, ref, { untracked: 'only' }),
			options?.include?.stats
				? this.getStashCommitFilesCore(repoPath, ref, { untracked: true, stats: true })
				: undefined,
		]);

		let files = getSettledValue(stashFilesResult);
		const untrackedFiles = getSettledValue(stashUntrackedFilesResult);

		if (files?.length && untrackedFiles?.length) {
			files.push(...untrackedFiles);
		} else {
			files = files ?? untrackedFiles;
		}

		files ??= [];

		if (stashFilesStatsResult.status === 'fulfilled' && stashFilesStatsResult.value != null) {
			files = mapFilesWithStats(files, stashFilesStatsResult.value);
		}

		return files;
	}

	private async getStashCommitFilesCore(
		repoPath: string,
		ref: string,
		options?: { untracked?: boolean | 'only'; stats?: boolean },
	): Promise<GitFileChange[] | undefined> {
		const args = ['show'];
		if (options?.untracked) {
			args.push(options?.untracked === 'only' ? '--only-untracked' : '--include-untracked');
		}

		const similarityThreshold = configuration.get('advanced.similarityThreshold');
		if (similarityThreshold != null) {
			args.push(`-M${similarityThreshold}%`);
		}

		const parser: ParserWithFilesAndMaybeStats<object> = options?.stats
			? createLogParserWithFilesAndStats()
			: createLogParserWithFiles();
		const data = await this.git.stash(repoPath, ...args, ...parser.arguments, ref);

		for (const s of parser.parse(data)) {
			return (
				s.files?.map(
					f =>
						new GitFileChange(
							repoPath,
							f.path,
							(options?.untracked === 'only'
								? GitFileWorkingTreeStatus.Untracked
								: f.status) as GitFileStatus,
							f.originalPath,
							undefined,
							f.additions || f.deletions
								? {
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: 0,
								  }
								: undefined,
						),
				) ?? []
			);
		}

		return undefined;
	}

	@log()
	async getStatusForFile(repoPath: string, pathOrUri: string | Uri): Promise<GitStatusFile | undefined> {
		const status = await this.getStatus(repoPath);
		if (!status?.files.length) return undefined;

		const [relativePath] = splitPath(pathOrUri, repoPath);
		const file = status.files.find(f => f.path === relativePath);
		return file;
	}

	@log()
	async getStatusForFiles(repoPath: string, pathOrGlob: Uri): Promise<GitStatusFile[] | undefined> {
		let [relativePath] = splitPath(pathOrGlob, repoPath);
		if (!relativePath.endsWith('/*')) {
			return this.getStatusForFile(repoPath, pathOrGlob).then(f => (f != null ? [f] : undefined));
		}

		relativePath = relativePath.substring(0, relativePath.length - 1);
		const status = await this.getStatus(repoPath);
		if (!status?.files.length) return undefined;

		const files = status.files.filter(f => f.path.startsWith(relativePath));
		return files;
	}

	@log()
	async getStatus(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await this.git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await this.git.status(repoPath, porcelainVersion, {
			similarityThreshold: configuration.get('advanced.similarityThreshold') ?? undefined,
		});
		const status = parseGitStatus(data, repoPath, porcelainVersion);

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
		options?: {
			filter?: (t: GitTag) => boolean;
			paging?: PagingOptions;
			sort?: boolean | TagSortOptions;
		},
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		let resultsPromise = this.useCaching ? this._tagsCache.get(repoPath) : undefined;
		if (resultsPromise == null) {
			async function load(this: LocalGitProvider): Promise<PagedResult<GitTag>> {
				try {
					const data = await this.git.tag(repoPath!, '-l', `--format=${parseGitTagsDefaultFormat}`);
					return { values: parseGitTags(data, repoPath!) };
				} catch (_ex) {
					this._tagsCache.delete(repoPath!);

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (this.useCaching && options?.paging?.cursor == null) {
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

		if (isUncommittedStaged(ref)) {
			const data = await this.git.ls_files(root, relativePath, { ref: ref });
			const [result] = parseGitLsFiles(data);
			if (result == null) return undefined;

			const size = await this.git.cat_file__size(repoPath, result.oid);
			return {
				ref: ref,
				oid: result.oid,
				path: relativePath,
				size: size,
				type: 'blob',
			};
		}

		const data = await this.git.ls_tree(root, ref, relativePath);
		return parseGitTree(data, ref)[0];
	}

	@log()
	async getTreeForRevision(repoPath: string, ref: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		const data = await this.git.ls_tree(repoPath, ref);
		return parseGitTree(data, ref);
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

	hasUnsafeRepositories(): boolean {
		return this.unsafePaths.size !== 0;
	}

	@log()
	async isAncestorOf(repoPath: string, ref1: string, ref2: string): Promise<boolean> {
		if (repoPath == null) return false;

		return this.git.merge_base__is_ancestor(repoPath, ref1, ref2);
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
		const scope = getLogScope();
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

			Logger.error(ex, scope);
			void showGenericErrorMessage('Unable to open compare');
		}
	}

	@log()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void> {
		const scope = getLogScope();

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

			Logger.error(ex, scope);
			void showGenericErrorMessage('Unable to open directory compare');
		}
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		options?: { force?: boolean; timeout?: number },
	) {
		if (
			!ref ||
			ref === deletedOrMissing ||
			(pathOrUri == null && isSha(ref)) ||
			(pathOrUri != null && isUncommitted(ref))
		) {
			return ref;
		}

		if (pathOrUri == null) {
			// If it doesn't look like a sha at all (e.g. branch name) or is a stash ref (^3) don't try to resolve it
			if ((!options?.force && !isShaLike(ref)) || ref.endsWith('^3')) return ref;

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
		if (verified == null) return deletedOrMissing;

		const resolved = getSettledValue(resolvedResult);

		const cancelled = cancellation?.token.isCancellationRequested;
		cancellation?.dispose();

		return cancelled ? ref : resolved ?? ref;
	}

	@log<LocalGitProvider['richSearchCommits']>({
		args: {
			1: s =>
				`[${s.matchAll ? 'A' : ''}${s.matchCase ? 'C' : ''}${s.matchRegex ? 'R' : ''}]: ${
					s.query.length > 500 ? `${s.query.substring(0, 500)}...` : s.query
				}`,
		},
	})
	async richSearchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo' | null; skip?: number },
	): Promise<GitLog | undefined> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');

			const currentUser = await this.getCurrentUser(repoPath);

			const { args, files, shas } = getGitArgsFromSearchQuery(search, currentUser);

			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`, '--');
			if (files.length !== 0) {
				args.push(...files);
			}

			const includeOnlyStashes = args.includes('--no-walk');

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			if (shas == null) {
				// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
				const gitStash = await this.getStash(repoPath);
				if (gitStash?.stashes.size) {
					stdin = '';
					stashes = new Map(gitStash.stashes);
					for (const stash of gitStash.stashes.values()) {
						stdin += `${stash.sha.substring(0, 9)}\n`;
						// Include the stash's 2nd (index files) and 3rd (untracked files) parents
						for (const p of skip(stash.parents, 1)) {
							stashes.set(p, stash);
							stdin += `${p.substring(0, 9)}\n`;
						}
					}
				}
			}

			const data = await this.git.log__search(repoPath, shas?.size ? undefined : args, {
				ordering: configuration.get('advanced.commitOrdering'),
				...options,
				limit: limit,
				shas: shas,
				stdin: stdin,
			});
			const log = parseGitLog(
				this.container,
				data,
				LogType.Log,
				repoPath,
				undefined,
				undefined,
				currentUser,
				limit,
				false,
				undefined,
				stashes,
				includeOnlyStashes,
			);

			if (log != null) {
				function richSearchCommitsCore(
					this: LocalGitProvider,
					log: GitLog,
				): (limit: number | undefined) => Promise<GitLog> {
					return async (limit: number | undefined) => {
						limit = limit ?? configuration.get('advanced.maxSearchItems') ?? 0;

						const moreLog = await this.richSearchCommits(log.repoPath, search, {
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
								this.richSearchCommits(log.repoPath, search, { ...options, limit: limit }),
						};
						if (mergedLog.hasMore) {
							mergedLog.more = richSearchCommitsCore.call(this, mergedLog);
						}

						return mergedLog;
					};
				}

				log.query = (limit: number | undefined) =>
					this.richSearchCommits(repoPath, search, { ...options, limit: limit });
				if (log.hasMore) {
					log.more = richSearchCommitsCore.call(this, log);
				}
			}

			return log;
		} catch (_ex) {
			return undefined;
		}
	}

	@log()
	async searchCommits(
		repoPath: string,
		search: SearchQuery,
		options?: {
			cancellation?: CancellationToken;
			limit?: number;
			ordering?: 'date' | 'author-date' | 'topo';
		},
	): Promise<GitSearch> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		const comparisonKey = getSearchQueryComparisonKey(search);
		try {
			const refAndDateParser = getRefAndDateParser();

			const currentUser = search.query.includes('@me') ? await this.getCurrentUser(repoPath) : undefined;

			const { args: searchArgs, files, shas } = getGitArgsFromSearchQuery(search, currentUser);
			if (shas?.size) {
				const data = await this.git.show(
					repoPath,
					{ cancellation: options?.cancellation },
					'-s',
					...refAndDateParser.arguments,
					...shas.values(),
					...searchArgs,
					'--',
				);

				let i = 0;
				const results: GitSearchResults = new Map<string, GitSearchResultData>(
					map(refAndDateParser.parse(data), c => [
						c.sha,
						{
							i: i++,
							date: Number(options?.ordering === 'author-date' ? c.authorDate : c.committerDate) * 1000,
						},
					]),
				);

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
				};
			}

			const limit = options?.limit ?? configuration.get('advanced.maxSearchItems') ?? 0;
			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			const includeOnlyStashes = searchArgs.includes('--no-walk');

			let stashes: Map<string, GitStashCommit> | undefined;
			let stdin: string | undefined;

			// TODO@eamodio this is insanity -- there *HAS* to be a better way to get git log to return stashes
			const gitStash = await this.getStash(repoPath);
			if (gitStash?.stashes.size) {
				stdin = '';
				stashes = new Map(gitStash.stashes);
				for (const stash of gitStash.stashes.values()) {
					stdin += `${stash.sha.substring(0, 9)}\n`;
					// Include the stash's 2nd (index files) and 3rd (untracked files) parents
					for (const p of skip(stash.parents, 1)) {
						stashes.set(p, stash);
						stdin += `${p.substring(0, 9)}\n`;
					}
				}
			}

			const args = [
				...refAndDateParser.arguments,
				`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`,
				'--use-mailmap',
			];

			const results: GitSearchResults = new Map<string, GitSearchResultData>();
			let total = 0;

			async function searchForCommitsCore(
				this: LocalGitProvider,
				limit: number,
				cursor?: { sha: string; skip: number },
			): Promise<GitSearch> {
				if (options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				let data;
				try {
					data = await this.git.log(
						repoPath,
						{
							cancellation: options?.cancellation,
							configs: ['-C', repoPath, ...gitLogDefaultConfigs],
							errors: GitErrorHandling.Throw,
							stdin: stdin,
						},
						...args,
						...searchArgs,
						...(options?.ordering ? [`--${options.ordering}-order`] : emptyArray),
						...(limit ? [`-n${limit + 1}`] : emptyArray),
						...(cursor?.skip ? [`--skip=${cursor.skip}`] : emptyArray),
						'--',
						...files,
					);
				} catch (ex) {
					if (ex instanceof CancelledRunError || options?.cancellation?.isCancellationRequested) {
						return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
					}

					throw new GitSearchError(ex);
				}

				if (options?.cancellation?.isCancellationRequested) {
					return { repoPath: repoPath, query: search, comparisonKey: comparisonKey, results: results };
				}

				let count = total;

				for (const r of refAndDateParser.parse(data)) {
					if (includeOnlyStashes && !stashes?.has(r.sha)) continue;

					if (results.has(r.sha)) {
						limit--;
						continue;
					}
					results.set(r.sha, {
						i: total++,
						date: Number(options?.ordering === 'author-date' ? r.authorDate : r.committerDate) * 1000,
					});
				}

				count = total - count;
				const lastSha = last(results)?.[0];
				cursor =
					lastSha != null
						? {
								sha: lastSha,
								skip: total,
						  }
						: undefined;

				return {
					repoPath: repoPath,
					query: search,
					comparisonKey: comparisonKey,
					results: results,
					paging:
						limit !== 0 && count > limit
							? {
									limit: limit,
									hasMore: true,
							  }
							: undefined,
					more: async (limit: number): Promise<GitSearch> => searchForCommitsCore.call(this, limit, cursor),
				};
			}

			return await searchForCommitsCore.call(this, limit);
		} catch (ex) {
			if (ex instanceof GitSearchError) {
				throw ex;
			}
			throw new GitSearchError(ex);
		}
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

	@log()
	validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		return this.git.check_ref_format(ref, repoPath);
	}

	@log({ args: { 1: false } })
	async validatePatch(repoPath: string | undefined, contents: string): Promise<boolean> {
		try {
			await this.git.apply2(repoPath!, { stdin: contents }, '--check');
			return true;
		} catch (ex) {
			if (ex instanceof Error && ex.message) {
				if (ex.message.includes('No valid patches in input')) {
					return false;
				}

				return true;
			}

			return false;
		}
	}

	@log()
	async validateReference(repoPath: string, ref: string): Promise<boolean> {
		if (ref == null || ref.length === 0) return false;
		if (ref === deletedOrMissing || isUncommitted(ref)) return true;

		return (await this.git.rev_parse__verify(repoPath, ref)) != null;
	}

	@log()
	async stageFile(repoPath: string, pathOrUri: string | Uri, options?: { intentToAdd?: boolean }): Promise<void> {
		await this.git.add(
			repoPath,
			[typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]],
			options?.intentToAdd ? '-N' : '-A',
		);
	}

	@log()
	async stageFiles(
		repoPath: string,
		pathOrUri: string[] | Uri[],
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.add(
			repoPath,
			pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0])),
			options?.intentToAdd ? '-N' : '-A',
		);
	}

	@log()
	async stageDirectory(
		repoPath: string,
		directoryOrUri: string | Uri,
		options?: { intentToAdd?: boolean },
	): Promise<void> {
		await this.git.add(
			repoPath,
			[typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0]],
			options?.intentToAdd ? '-N' : '-A',
		);
	}

	@log()
	async unstageFile(repoPath: string, pathOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [typeof pathOrUri === 'string' ? pathOrUri : splitPath(pathOrUri, repoPath)[0]]);
	}

	@log()
	async unstageFiles(repoPath: string, pathOrUri: string[] | Uri[]): Promise<void> {
		await this.git.reset(
			repoPath,
			pathOrUri.map(p => (typeof p === 'string' ? p : splitPath(p, repoPath)[0])),
		);
	}

	@log()
	async unstageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await this.git.reset(repoPath, [
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri, repoPath)[0],
		]);
	}

	@log()
	async applyStash(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
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
	async deleteStash(repoPath: string, stashName: string, ref?: string): Promise<void> {
		await this.git.stash__delete(repoPath, stashName, ref);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['stashes'] });
	}

	@log()
	async renameStash(
		repoPath: string,
		stashName: string,
		ref: string,
		message: string,
		stashOnRef?: string,
	): Promise<void> {
		await this.git.stash__rename(repoPath, stashName, ref, message, stashOnRef);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['stashes'] });
	}

	@log<LocalGitProvider['saveStash']>({ args: { 2: uris => uris?.length } })
	async saveStash(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		try {
			if (!uris?.length) {
				await this.git.stash__push(repoPath, message, options);
				return;
			}

			await this.ensureGitVersion(
				'2.13.2',
				'Stashing individual files',
				' Please retry by stashing everything or install a more recent version of Git and try again.',
			);

			const pathspecs = uris.map(u => `./${splitPath(u, repoPath)[0]}`);

			const stdinVersion = '2.30.0';
			let stdin = await this.git.isAtLeastVersion(stdinVersion);
			if (stdin && options?.onlyStaged && uris.length) {
				// Since Git doesn't support --staged with --pathspec-from-file try to pass them in directly
				stdin = false;
			}

			// If we don't support stdin, then error out if we are over the maximum allowed git cli length
			if (!stdin && countStringLength(pathspecs) > maxGitCliLength) {
				await this.ensureGitVersion(
					stdinVersion,
					`Stashing so many files (${pathspecs.length}) at once`,
					' Please retry by stashing fewer files or install a more recent version of Git and try again.',
				);
			}

			await this.git.stash__push(repoPath, message, {
				...options,
				pathspecs: pathspecs,
				stdin: stdin,
			});
		} finally {
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['stashes', 'status'] });
		}
	}

	@log()
	async saveStashSnapshot(repoPath: string, message?: string): Promise<void> {
		const id = await this.git.stash__create(repoPath);
		if (id == null) return;

		await this.git.stash__store(repoPath, id, message);
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['stashes'] });
	}

	@log()
	async createWorktree(
		repoPath: string,
		path: string,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	) {
		const scope = getLogScope();

		try {
			await this.git.worktree__add(repoPath, path, options);
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['worktrees'] });
			if (options?.createBranch) {
				this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['branches'] });
			}
		} catch (ex) {
			Logger.error(ex, scope);

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

	@log()
	async getWorktrees(repoPath: string): Promise<GitWorktree[]> {
		await this.ensureGitVersion(
			'2.7.6',
			'Displaying worktrees',
			' Please install a more recent version of Git and try again.',
		);

		let worktrees = this.useCaching ? this._worktreesCache.get(repoPath) : undefined;
		if (worktrees == null) {
			async function load(this: LocalGitProvider) {
				try {
					const [data, branches] = await Promise.all([
						this.git.worktree__list(repoPath),
						this.getBranches(repoPath),
					]);

					return parseGitWorktrees(this.container, data, repoPath, branches.values);
				} catch (ex) {
					this._worktreesCache.delete(repoPath);

					throw ex;
				}
			}

			worktrees = load.call(this);

			if (this.useCaching) {
				this._worktreesCache.set(repoPath, worktrees);
			}
		}

		return worktrees;
	}

	@log()
	// eslint-disable-next-line @typescript-eslint/require-await
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
	async deleteWorktree(repoPath: string, path: string | Uri, options?: { force?: boolean }) {
		const scope = getLogScope();

		await this.ensureGitVersion(
			'2.17.0',
			'Deleting worktrees',
			' Please install a more recent version of Git and try again.',
		);

		path = normalizePath(typeof path === 'string' ? path : path.fsPath);
		try {
			await this.git.worktree__remove(repoPath, path, options);
		} catch (ex) {
			Logger.error(ex, scope);

			const msg = String(ex);

			if (GitErrors.mainWorkingTree.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.DefaultWorkingTree, ex);
			}

			if (GitErrors.uncommittedChanges.test(msg)) {
				throw new WorktreeDeleteError(WorktreeDeleteErrorReason.HasChanges, ex);
			}

			if (GitErrors.failedToDeleteDirectoryNotEmpty.test(msg)) {
				Logger.warn(
					scope,
					`Failed to fully delete worktree '${path}' because it is not empty. Attempting to delete it manually.`,
					scope,
				);
				try {
					await fs.rm(path, { force: true, recursive: true });
					return;
				} catch (ex) {
					if (isWindows) {
						const match = /EPERM: operation not permitted, unlink '(.*?)'/i.exec(ex.message);
						if (match != null) {
							Logger.warn(
								scope,
								`Failed to manually delete '${path}' because it is in use. Attempting to forcefully delete it.`,
								scope,
							);

							function deleteInUseSymlink(symlink: string) {
								return new Promise((resolve, reject) => {
									exec(`del "${symlink}"`, (ex, stdout, stderr) => {
										if (ex) {
											reject(ex instanceof Error ? ex : new Error(ex));
										} else if (stderr) {
											reject(new Error(stderr));
										} else {
											resolve(stdout);
										}
									});
								});
							}

							const [, file] = match;
							try {
								await deleteInUseSymlink(file);
								await fs.rm(path, { force: true, recursive: true, maxRetries: 1, retryDelay: 1 });
								return;
							} catch (ex) {
								Logger.error(
									ex,
									scope,
									`Failed to forcefully delete '${path}' because it is in use.`,
									scope,
								);
							}
						}
					}

					throw new WorktreeDeleteError(WorktreeDeleteErrorReason.DirectoryNotEmpty, ex);
				}
			}

			throw new WorktreeDeleteError(undefined, ex);
		} finally {
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, caches: ['worktrees'] });
		}
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

	@log()
	async getBranchContributionsOverview(
		repoPath: string,
		ref: string,
	): Promise<BranchContributionsOverview | undefined> {
		const scope = getLogScope();

		try {
			let baseOrTargetBranch = await this.getBaseBranchName(repoPath, ref);
			// If the base looks like its remote branch, look for the target or default
			if (baseOrTargetBranch == null || baseOrTargetBranch.endsWith(`/${ref}`)) {
				baseOrTargetBranch = await this.getTargetBranchName(repoPath, ref);
				baseOrTargetBranch ??= await this.getDefaultBranchName(repoPath);
				if (baseOrTargetBranch == null) return undefined;
			}

			const mergeBase = await this.getMergeBase(repoPath, ref, baseOrTargetBranch);
			if (mergeBase == null) return undefined;

			const contributors = await this.getContributors(repoPath, {
				ref: createRevisionRange(mergeBase, ref, '..'),
				stats: true,
			});

			sortContributors(contributors, { orderBy: 'score:desc' });

			let totalCommits = 0;
			let totalFiles = 0;
			let totalAdditions = 0;
			let totalDeletions = 0;
			let firstCommitTimestamp;
			let latestCommitTimestamp;

			for (const c of contributors) {
				totalCommits += c.commits;
				totalFiles += c.stats?.files ?? 0;
				totalAdditions += c.stats?.additions ?? 0;
				totalDeletions += c.stats?.deletions ?? 0;

				const firstTimestamp = c.firstCommitDate?.getTime();
				const latestTimestamp = c.latestCommitDate?.getTime();

				if (firstTimestamp != null || latestTimestamp != null) {
					firstCommitTimestamp =
						firstCommitTimestamp != null
							? Math.min(firstCommitTimestamp, firstTimestamp ?? Infinity, latestTimestamp ?? Infinity)
							: firstTimestamp ?? latestTimestamp;

					latestCommitTimestamp =
						latestCommitTimestamp != null
							? Math.max(latestCommitTimestamp, firstTimestamp ?? -Infinity, latestTimestamp ?? -Infinity)
							: latestTimestamp ?? firstTimestamp;
				}
			}

			return {
				repoPath: repoPath,
				branch: ref,
				baseOrTargetBranch: baseOrTargetBranch,
				mergeBase: mergeBase,

				commits: totalCommits,
				files: totalFiles,
				additions: totalAdditions,
				deletions: totalDeletions,

				latestCommitDate: latestCommitTimestamp != null ? new Date(latestCommitTimestamp) : undefined,
				firstCommitDate: firstCommitTimestamp != null ? new Date(firstCommitTimestamp) : undefined,

				contributors: contributors,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	async getPotentialMergeOrRebaseConflict(
		repoPath: string,
		branch: string,
		targetBranch: string,
	): Promise<MergeConflict | undefined> {
		const scope = getLogScope();

		try {
			// If we have don't have Git v2.33+, just return
			if (!(await this.git.isAtLeastVersion('2.33'))) {
				return undefined;
			}

			let data;
			try {
				data = await this.git.merge_tree(repoPath, branch, targetBranch, '-z', '--name-only', '--no-messages');
			} catch (ex) {
				Logger.error(ex, scope);
			}
			if (!data) return undefined;

			const mergeConflict = parseMergeTreeConflict(data);
			if (!mergeConflict.conflicts.length) return undefined;

			return {
				repoPath: repoPath,
				branch: branch,
				target: targetBranch,
				files: mergeConflict.conflicts,
			};
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
	}

	private async ensureGitVersion(version: string, prefix: string, suffix: string): Promise<void> {
		if (await this.git.isAtLeastVersion(version)) return;

		throw new Error(
			`${prefix} requires a newer version of Git (>= ${version}) than is currently installed (${await this.git.version()}).${suffix}`,
		);
	}
}

async function getEncoding(uri: Uri): Promise<string> {
	const encoding = configuration.getCore('files.encoding', uri);
	if (encoding == null || encoding === 'utf8') return 'utf8';

	const encodingExists = (await import(/* webpackChunkName: "lib-encoding" */ 'iconv-lite')).encodingExists;
	return encodingExists(encoding) ? encoding : 'utf8';
}
