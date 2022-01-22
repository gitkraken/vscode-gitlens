'use strict';
import { readdir, realpath, stat, Stats } from 'fs';
import { hostname, userInfo } from 'os';
import { dirname, relative, resolve as resolvePath } from 'path';
import {
	Disposable,
	env,
	Event,
	EventEmitter,
	extensions,
	Range,
	TextEditor,
	Uri,
	window,
	workspace,
	WorkspaceFolder,
} from 'vscode';
import { hrtime } from '@env/hrtime';
import { isWindows } from '@env/platform';
import type {
	API as BuiltInGitApi,
	Repository as BuiltInGitRepository,
	GitExtension,
} from '../../../@types/vscode.git';
import { configuration } from '../../../configuration';
import { BuiltInGitConfiguration, DocumentSchemes, GlyphChars, WorkspaceState } from '../../../constants';
import type { Container } from '../../../container';
import { StashApplyError, StashApplyErrorReason } from '../../../git/errors';
import {
	GitProvider,
	GitProviderDescriptor,
	GitProviderId,
	PagedResult,
	RepositoryInitWatcher,
	ScmRepository,
} from '../../../git/gitProvider';
import { GitProviderService } from '../../../git/gitProviderService';
import { GitUri } from '../../../git/gitUri';
import {
	BranchSortOptions,
	GitAuthor,
	GitBlame,
	GitBlameCommit,
	GitBlameLine,
	GitBlameLines,
	GitBranch,
	GitBranchReference,
	GitCommitType,
	GitContributor,
	GitDiff,
	GitDiffFilter,
	GitDiffHunkLine,
	GitDiffShortStat,
	GitFile,
	GitLog,
	GitLogCommit,
	GitMergeStatus,
	GitRebaseStatus,
	GitReference,
	GitReflog,
	GitRemote,
	GitRevision,
	GitStash,
	GitStatus,
	GitStatusFile,
	GitTag,
	GitTreeEntry,
	GitUser,
	PullRequest,
	PullRequestState,
	Repository,
	RepositoryChange,
	RepositoryChangeComparisonMode,
	RepositoryChangeEvent,
	TagSortOptions,
} from '../../../git/models';
import {
	GitBlameParser,
	GitBranchParser,
	GitDiffParser,
	GitLogParser,
	GitReflogParser,
	GitRemoteParser,
	GitShortLogParser,
	GitStashParser,
	GitStatusParser,
	GitTagParser,
	GitTreeParser,
} from '../../../git/parsers';
import { RemoteProviderFactory, RemoteProviders } from '../../../git/remotes/factory';
import { RemoteProvider, RichRemoteProvider } from '../../../git/remotes/provider';
import { SearchPattern } from '../../../git/search';
import { LogCorrelationContext, Logger } from '../../../logger';
import { Messages } from '../../../messages';
import { Arrays, debug, Functions, gate, Iterables, log, Promises, Strings, Versions } from '../../../system';
import { isFolderGlob, normalizePath, splitPath } from '../../../system/path';
import { any, PromiseOrValue } from '../../../system/promise';
import {
	CachedBlame,
	CachedDiff,
	CachedLog,
	GitDocumentState,
	TrackedDocument,
} from '../../../trackers/gitDocumentTracker';
import { Git, GitErrors, maxGitCliLength } from './git';
import { findGitPath, GitLocation, InvalidGitConfigError, UnableToFindGitError } from './locator';
import { fsExists, RunError } from './shell';

const emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
const emptyPagedResult: PagedResult<any> = Object.freeze({ values: [] });

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const doubleQuoteRegex = /"/g;
const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;
const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

const reflogCommands = ['merge', 'pull'];

export class LocalGitProvider implements GitProvider, Disposable {
	readonly descriptor: GitProviderDescriptor = { id: GitProviderId.Git, name: 'Git' };
	readonly supportedSchemes: string[] = [
		DocumentSchemes.File,
		DocumentSchemes.Git,
		DocumentSchemes.GitLens,
		DocumentSchemes.PRs,
		DocumentSchemes.Vsls,
	];

	private _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private readonly _branchesCache = new Map<string, Promise<PagedResult<GitBranch>>>();
	private readonly _contributorsCache = new Map<string, Promise<GitContributor[]>>();
	private readonly _mergeStatusCache = new Map<string, GitMergeStatus | null>();
	private readonly _rebaseStatusCache = new Map<string, GitRebaseStatus | null>();
	private readonly _remotesWithApiProviderCache = new Map<string, GitRemote<RichRemoteProvider> | null>();
	private readonly _stashesCache = new Map<string, GitStash | null>();
	private readonly _tagsCache = new Map<string, Promise<PagedResult<GitTag>>>();
	private readonly _trackedCache = new Map<string, PromiseOrValue<boolean>>();
	private readonly _userMapCache = new Map<string, GitUser | null>();

	constructor(private readonly container: Container) {
		Git.setLocator(this.ensureGit.bind(this));
	}

	dispose() {}

	private get useCaching() {
		return this.container.config.advanced.caching.enabled;
	}

	private onRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Config, RepositoryChangeComparisonMode.Any)) {
			this._userMapCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Heads, RepositoryChange.Remotes, RepositoryChangeComparisonMode.Any)) {
			this._branchesCache.delete(repo.path);
			this._contributorsCache.delete(repo.path);
			this._contributorsCache.delete(`stats|${repo.path}`);
		}

		if (e.changed(RepositoryChange.Remotes, RepositoryChange.RemoteProviders, RepositoryChangeComparisonMode.Any)) {
			this._remotesWithApiProviderCache.clear();
		}

		if (e.changed(RepositoryChange.Index, RepositoryChange.Unknown, RepositoryChangeComparisonMode.Any)) {
			this._trackedCache.clear();
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
		const cc = Logger.getCorrelationContext();

		if (!configuration.getAny<boolean>('git.enabled', null, true)) {
			Logger.log(cc, 'Built-in Git is disabled ("git.enabled": false)');
			void Messages.showGitDisabledErrorMessage();

			throw new UnableToFindGitError();
		}

		const scmPromise = this.getScmGitApi();

		async function subscribeToScmOpenCloseRepository(
			container: Container,
			apiPromise: Promise<BuiltInGitApi | undefined>,
		) {
			const gitApi = await apiPromise;
			if (gitApi == null) return;

			container.context.subscriptions.push(
				gitApi.onDidCloseRepository(e => {
					const repository = container.git.getCachedRepository(normalizePath(e.rootUri.fsPath));
					if (repository != null) {
						repository.closed = true;
					}
				}),
				gitApi.onDidOpenRepository(e => {
					const repository = container.git.getCachedRepository(normalizePath(e.rootUri.fsPath));
					if (repository != null) {
						repository.closed = false;
					}
				}),
			);
		}
		void subscribeToScmOpenCloseRepository(this.container, scmPromise);

		const potentialGitPaths =
			configuration.getAny<string | string[]>('git.path') ??
			this.container.context.workspaceState.get(WorkspaceState.GitPath, undefined);

		const start = hrtime();

		const findGitPromise = findGitPath(potentialGitPaths);
		// Try to use the same git as the built-in vscode git extension, but don't wait for it if we find something faster
		const findGitFromSCMPromise = scmPromise.then(gitApi => {
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
			void this.container.context.workspaceState.update(WorkspaceState.GitPath, location.path);
		}, 1000);

		if (cc != null) {
			cc.exitDetails = ` ${GlyphChars.Dot} Git found (${Strings.getDurationMilliseconds(start)} ms): ${
				location.version
			} @ ${location.path === 'git' ? 'PATH' : location.path}`;
		} else {
			Logger.log(
				cc,
				`Git found: ${location.version} @ ${location.path === 'git' ? 'PATH' : location.path} ${
					GlyphChars.Dot
				} ${Strings.getDurationMilliseconds(start)} ms`,
			);
		}

		// Warn if git is less than v2.7.2
		if (Versions.compare(Versions.fromString(location.version), Versions.fromString('2.7.2')) === -1) {
			Logger.log(cc, `Git version (${location.version}) is outdated`);
			void Messages.showGitVersionUnsupportedErrorMessage(location.version, '2.7.2');
		}

		return location;
	}

	async discoverRepositories(uri: Uri): Promise<Repository[]> {
		if (uri.scheme !== DocumentSchemes.File) return [];

		const autoRepositoryDetection =
			configuration.getAny<boolean | 'subFolders' | 'openEditors'>(
				BuiltInGitConfiguration.AutoRepositoryDetection,
			) ?? true;
		if (autoRepositoryDetection === false || autoRepositoryDetection === 'openEditors') return [];

		try {
			void (await this.ensureGit());

			const repositories = await this.repositorySearch(workspace.getWorkspaceFolder(uri)!);
			if (autoRepositoryDetection === true || autoRepositoryDetection === 'subFolders') {
				for (const repository of repositories) {
					void this.openScmRepository(repository.path);
				}
			}

			if (repositories.length > 0) {
				this._trackedCache.clear();
			}

			return repositories;
		} catch (ex) {
			if (ex instanceof InvalidGitConfigError) {
				void Messages.showGitInvalidConfigErrorMessage();
			} else if (ex instanceof UnableToFindGitError) {
				void Messages.showGitMissingErrorMessage();
			} else {
				const msg: string = ex?.message ?? '';
				if (msg) {
					void window.showErrorMessage(`Unable to initialize Git; ${msg}`);
				}
			}

			throw ex;
		}
	}

	createRepository(
		folder: WorkspaceFolder,
		path: string,
		root: boolean,
		suspended?: boolean,
		closed?: boolean,
	): Repository {
		void this.openScmRepository(path);
		return new Repository(
			this.container,
			this.onRepositoryChanged.bind(this),
			this.descriptor,
			folder,
			path,
			root,
			suspended ?? !window.state.focused,
			closed,
		);
	}

	createRepositoryInitWatcher(): RepositoryInitWatcher {
		const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
		return {
			onDidCreate: watcher.onDidCreate,
			dispose: () => watcher.dispose(),
		};
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
	private async repositorySearch(folder: WorkspaceFolder): Promise<Repository[]> {
		const cc = Logger.getCorrelationContext();
		const { uri } = folder;
		const depth = configuration.get('advanced.repositorySearchDepth', uri);

		Logger.log(cc, `searching (depth=${depth})...`);

		const repositories: Repository[] = [];

		const rootPath = await this.getRepoPath(uri.fsPath, true);
		if (rootPath != null) {
			Logger.log(cc, `found root repository in '${rootPath}'`);
			repositories.push(this.createRepository(folder, rootPath, true));
		}

		if (depth <= 0) return repositories;

		// Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
		let excludes = {
			...configuration.getAny<Record<string, boolean>>('files.exclude', uri, {}),
			...configuration.getAny<Record<string, boolean>>('search.exclude', uri, {}),
		};

		const excludedPaths = [
			...Iterables.filterMap(Object.entries(excludes), ([key, value]) => {
				if (!value) return undefined;
				if (key.startsWith('**/')) return key.substring(3);
				return key;
			}),
		];

		excludes = excludedPaths.reduce((accumulator, current) => {
			accumulator[current] = true;
			return accumulator;
		}, Object.create(null) as Record<string, boolean>);

		let repoPaths;
		try {
			repoPaths = await this.repositorySearchCore(uri.fsPath, depth, excludes);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (RepoSearchWarnings.doesNotExist.test(msg)) {
				Logger.log(cc, `FAILED${msg ? ` Error: ${msg}` : ''}`);
			} else {
				Logger.error(ex, cc, 'FAILED');
			}

			return repositories;
		}

		for (let p of repoPaths) {
			p = dirname(p);
			// If we are the same as the root, skip it
			if (normalizePath(p) === rootPath) continue;

			Logger.log(cc, `searching in '${p}'...`);
			Logger.debug(cc, `normalizedRepoPath=${normalizePath(p)}, rootPath=${rootPath}`);

			const rp = await this.getRepoPath(p, true);
			if (rp == null) continue;

			Logger.log(cc, `found repository in '${rp}'`);
			repositories.push(this.createRepository(folder, rp, false));
		}

		return repositories;
	}

	@debug<LocalGitProvider['repositorySearchCore']>({ args: { 2: false, 3: false } })
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Record<string, boolean>,
		repositories: string[] = [],
	): Promise<string[]> {
		const cc = Logger.getCorrelationContext();

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
					if (!f.isDirectory()) continue;

					if (f.name === '.git') {
						repositories.push(resolvePath(root, f.name));
					} else if (depth >= 0 && excludes[f.name] !== true) {
						try {
							await this.repositorySearchCore(resolvePath(root, f.name), depth, excludes, repositories);
						} catch (ex) {
							Logger.error(ex, cc, 'FAILED');
						}
					}
				}

				resolve(repositories);
			});
		});
	}

	@log()
	async addRemote(repoPath: string, name: string, url: string): Promise<void> {
		await Git.remote__add(repoPath, name, url);
	}

	@log()
	async pruneRemote(repoPath: string, remoteName: string): Promise<void> {
		await Git.remote__prune(repoPath, remoteName);
	}

	@log()
	async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string) {
		const cc = Logger.getCorrelationContext();

		ref1 = ref1 ?? uri.sha;
		if (ref1 == null || uri.repoPath == null) return;

		if (ref2 == null) {
			ref2 = ref1;
			ref1 = `${ref1}^`;
		}

		let patch;
		try {
			patch = await Git.diff(uri.repoPath, uri.fsPath, ref1, ref2);
			void (await Git.apply(uri.repoPath, patch));
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
						void (await Git.apply(uri.repoPath, patch, { allowConflicts: true }));

						return;
					} catch (e) {
						// eslint-disable-next-line no-ex-assign
						ex = e;
					}
				}
			}

			Logger.error(ex, cc);
			void Messages.showGenericErrorMessage('Unable to apply changes');
		}
	}

	@log()
	async branchContainsCommit(repoPath: string, name: string, ref: string): Promise<boolean> {
		let data = await Git.branch__containsOrPointsAt(repoPath, ref, { mode: 'contains', name: name });
		data = data?.trim();
		return Boolean(data);
	}

	@log()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { fileName?: string },
	): Promise<void> {
		const cc = Logger.getCorrelationContext();

		try {
			await Git.checkout(repoPath, ref, options);
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (/overwritten by checkout/i.test(msg)) {
				void Messages.showGenericErrorMessage(
					`Unable to checkout '${ref}'. Please commit or stash your changes before switching branches`,
				);
				return;
			}

			Logger.error(ex, cc);
			void void Messages.showGenericErrorMessage(`Unable to checkout '${ref}'`);
		}
	}

	@log()
	resetCaches(...cache: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]) {
		if (cache.length === 0 || cache.includes('branches')) {
			this._branchesCache.clear();
		}

		if (cache.length === 0 || cache.includes('contributors')) {
			this._contributorsCache.clear();
		}

		if (cache.length === 0 || cache.includes('providers')) {
			this._remotesWithApiProviderCache.clear();
		}

		if (cache.length === 0 || cache.includes('stashes')) {
			this._stashesCache.clear();
		}

		if (cache.length === 0 || cache.includes('status')) {
			this._mergeStatusCache.clear();
			this._rebaseStatusCache.clear();
		}

		if (cache.length === 0 || cache.includes('tags')) {
			this._tagsCache.clear();
		}

		if (cache.length === 0) {
			this._trackedCache.clear();
			this._userMapCache.clear();
		}
	}

	@log<LocalGitProvider['excludeIgnoredUris']>({ args: { 1: uris => uris.length } })
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const paths = new Map<string, Uri>(uris.map(u => [normalizePath(u.fsPath), u]));

		const data = await Git.check_ignore(repoPath, ...paths.keys());
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
			const repo = await this.container.git.getRepository(repoPath);
			const branch = await repo?.getBranch(branchRef?.name);
			if (!branch?.remote && branch?.upstream == null) return undefined;

			return Git.fetch(repoPath, {
				branch: branch.getNameWithoutRemote(),
				remote: branch.getRemoteName()!,
				upstream: branch.getTrackingWithoutRemote()!,
				pull: options?.pull,
			});
		}

		return Git.fetch(repoPath, opts);
	}

	@log<LocalGitProvider['getAheadBehindCommitCount']>({ args: { 1: refs => refs.join(',') } })
	getAheadBehindCommitCount(
		repoPath: string,
		refs: string[],
	): Promise<{ ahead: number; behind: number } | undefined> {
		return Git.rev_list__left_right(repoPath, refs);
	}

	@log()
	async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
		const cc = Logger.getCorrelationContext();

		let key = 'blame';
		if (uri.sha != null) {
			key += `:${uri.sha}`;
		}

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.get<CachedBlame>(key);
				if (cachedBlame != null) {
					Logger.debug(cc, `Cache hit: '${key}'`);
					return cachedBlame.item;
				}
			}

			Logger.debug(cc, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState(doc.key);
			}
		}

		const promise = this.getBlameForFileCore(uri, doc, key, cc);

		if (doc.state != null) {
			Logger.debug(cc, `Cache add: '${key}'`);

			const value: CachedBlame = {
				item: promise as Promise<GitBlame>,
			};
			doc.state.set<CachedBlame>(key, value);
		}

		return promise;
	}

	private async getBlameForFileCore(
		uri: GitUri,
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitBlame | undefined> {
		if (!(await this.isTracked(uri))) {
			Logger.log(cc, `Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [file, root] = splitPath(uri.fsPath, uri.repoPath, false);

		try {
			const data = await Git.blame(root, file, uri.sha, {
				args: this.container.config.advanced.blame.customArguments,
				ignoreWhitespace: this.container.config.blame.ignoreWhitespace,
			});
			const blame = GitBlameParser.parse(data, root, file, await this.getCurrentUser(root));
			return blame;
		} catch (ex) {
			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.set<CachedBlame>(key, value);

				document.setBlameFailure();

				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getBlameForFileContents']>({ args: { 1: '<contents>' } })
	async getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const cc = Logger.getCorrelationContext();

		const key = `blame:${Strings.md5(contents)}`;

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedBlame = doc.state.get<CachedBlame>(key);
				if (cachedBlame != null) {
					Logger.debug(cc, `Cache hit: ${key}`);
					return cachedBlame.item;
				}
			}

			Logger.debug(cc, `Cache miss: ${key}`);

			if (doc.state == null) {
				doc.state = new GitDocumentState(doc.key);
			}
		}

		const promise = this.getBlameForFileContentsCore(uri, contents, doc, key, cc);

		if (doc.state != null) {
			Logger.debug(cc, `Cache add: '${key}'`);

			const value: CachedBlame = {
				item: promise as Promise<GitBlame>,
			};
			doc.state.set<CachedBlame>(key, value);
		}

		return promise;
	}

	private async getBlameForFileContentsCore(
		uri: GitUri,
		contents: string,
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitBlame | undefined> {
		if (!(await this.isTracked(uri))) {
			Logger.log(cc, `Skipping blame; '${uri.fsPath}' is not tracked`);
			return emptyPromise as Promise<GitBlame>;
		}

		const [file, root] = splitPath(uri.fsPath, uri.repoPath, false);

		try {
			const data = await Git.blame__contents(root, file, contents, {
				args: this.container.config.advanced.blame.customArguments,
				correlationKey: `:${key}`,
				ignoreWhitespace: this.container.config.blame.ignoreWhitespace,
			});
			const blame = GitBlameParser.parse(data, root, file, await this.getCurrentUser(root));
			return blame;
		} catch (ex) {
			// Trap and cache expected blame errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

				const value: CachedBlame = {
					item: emptyPromise as Promise<GitBlame>,
					errorMessage: msg,
				};
				document.state.set<CachedBlame>(key, value);

				document.setBlameFailure();
				return emptyPromise as Promise<GitBlame>;
			}

			return undefined;
		}
	}

	@log()
	async getBlameForLine(
		uri: GitUri,
		editorLine: number,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (!options?.forceSingleLine && this.useCaching) {
			const blame = await this.getBlameForFile(uri);
			if (blame == null) return undefined;

			let blameLine = blame.lines[editorLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLine) return undefined;
				blameLine = blame.lines[editorLine - 1];
			}

			const commit = blame.commits.get(blameLine.sha);
			if (commit == null) return undefined;

			const author = blame.authors.get(commit.author)!;
			return {
				author: { ...author, lineCount: commit.lines.length },
				commit: commit,
				line: blameLine,
			};
		}

		const lineToBlame = editorLine + 1;
		const fileName = uri.fsPath;

		try {
			const data = await Git.blame(uri.repoPath, fileName, uri.sha, {
				args: this.container.config.advanced.blame.customArguments,
				ignoreWhitespace: this.container.config.blame.ignoreWhitespace,
				startLine: lineToBlame,
				endLine: lineToBlame,
			});
			const blame = GitBlameParser.parse(data, uri.repoPath, fileName, await this.getCurrentUser(uri.repoPath!));
			if (blame == null) return undefined;

			return {
				author: Iterables.first(blame.authors.values()),
				commit: Iterables.first(blame.commits.values()),
				line: blame.lines[editorLine],
			};
		} catch {
			return undefined;
		}
	}

	@log<LocalGitProvider['getBlameForLineContents']>({ args: { 2: '<contents>' } })
	async getBlameForLineContents(
		uri: GitUri,
		editorLine: number,
		contents: string,
		options?: { forceSingleLine?: boolean },
	): Promise<GitBlameLine | undefined> {
		if (!options?.forceSingleLine && this.useCaching) {
			const blame = await this.getBlameForFileContents(uri, contents);
			if (blame == null) return undefined;

			let blameLine = blame.lines[editorLine];
			if (blameLine == null) {
				if (blame.lines.length !== editorLine) return undefined;
				blameLine = blame.lines[editorLine - 1];
			}

			const commit = blame.commits.get(blameLine.sha);
			if (commit == null) return undefined;

			const author = blame.authors.get(commit.author)!;
			return {
				author: { ...author, lineCount: commit.lines.length },
				commit: commit,
				line: blameLine,
			};
		}

		const lineToBlame = editorLine + 1;
		const fileName = uri.fsPath;

		try {
			const data = await Git.blame__contents(uri.repoPath, fileName, contents, {
				args: this.container.config.advanced.blame.customArguments,
				ignoreWhitespace: this.container.config.blame.ignoreWhitespace,
				startLine: lineToBlame,
				endLine: lineToBlame,
			});
			const blame = GitBlameParser.parse(data, uri.repoPath, fileName, await this.getCurrentUser(uri.repoPath!));
			if (blame == null) return undefined;

			return {
				author: Iterables.first(blame.authors.values()),
				commit: Iterables.first(blame.commits.values()),
				line: blame.lines[editorLine],
			};
		} catch {
			return undefined;
		}
	}

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
		const blame = await this.getBlameForFile(uri);
		if (blame == null) return undefined;

		return this.getBlameForRangeSync(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameForRangeContents']>({ args: { 2: '<contents>' } })
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
		const blame = await this.getBlameForFileContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameForRangeSync(blame, uri, range);
	}

	@log<LocalGitProvider['getBlameForRangeContents']>({ args: { 0: '<blame>' } })
	getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
		if (blame.lines.length === 0) return { allLines: blame.lines, ...blame };

		if (range.start.line === 0 && range.end.line === blame.lines.length - 1) {
			return { allLines: blame.lines, ...blame };
		}

		const lines = blame.lines.slice(range.start.line, range.end.line + 1);
		const shas = new Set(lines.map(l => l.sha));

		// ranges are 0-based
		const startLine = range.start.line + 1;
		const endLine = range.end.line + 1;

		const authors = new Map<string, GitAuthor>();
		const commits = new Map<string, GitBlameCommit>();
		for (const c of blame.commits.values()) {
			if (!shas.has(c.sha)) continue;

			const commit = c.with({
				lines: c.lines.filter(l => l.line >= startLine && l.line <= endLine),
			});
			commits.set(c.sha, commit);

			let author = authors.get(commit.author);
			if (author == null) {
				author = {
					name: commit.author,
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

		const data = await Git.rev_parse__currentBranch(repoPath, this.container.config.advanced.commitOrdering);
		if (data == null) return undefined;

		const [name, upstream] = data[0].split('\n');
		if (GitBranch.isDetached(name)) {
			const [rebaseStatus, committerDate] = await Promise.all([
				this.getRebaseStatus(repoPath),
				Git.log__recent_committerdate(repoPath, this.container.config.advanced.commitOrdering),
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

	// @log({
	// 	args: {
	// 		0: b => b.name,
	// 	},
	// })
	// async getBranchAheadRange(branch: GitBranch) {
	// 	if (branch.state.ahead > 0) {
	// 		return GitRevision.createRange(branch.upstream?.name, branch.ref);
	// 	}

	// 	if (branch.upstream == null) {
	// 		// If we have no upstream branch, try to find a best guess branch to use as the "base"
	// 		const { values: branches } = await this.getBranches(branch.repoPath, {
	// 			filter: b => weightedDefaultBranches.has(b.name),
	// 		});
	// 		if (branches.length > 0) {
	// 			let weightedBranch: { weight: number; branch: GitBranch } | undefined;
	// 			for (const branch of branches) {
	// 				const weight = weightedDefaultBranches.get(branch.name)!;
	// 				if (weightedBranch == null || weightedBranch.weight < weight) {
	// 					weightedBranch = { weight: weight, branch: branch };
	// 				}

	// 				if (weightedBranch.weight === maxDefaultBranchWeight) break;
	// 			}

	// 			const possibleBranch = weightedBranch!.branch.upstream?.name ?? weightedBranch!.branch.ref;
	// 			if (possibleBranch !== branch.ref) {
	// 				return GitRevision.createRange(possibleBranch, branch.ref);
	// 			}
	// 		}
	// 	}

	// 	return undefined;
	// }

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
					const data = await Git.for_each_ref__branch(repoPath!, { all: true });
					// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
					if (data == null || data.length === 0) {
						let current;

						const data = await Git.rev_parse__currentBranch(
							repoPath!,
							this.container.config.advanced.commitOrdering,
						);
						if (data != null) {
							const [name, upstream] = data[0].split('\n');
							const [rebaseStatus, committerDate] = await Promise.all([
								GitBranch.isDetached(name) ? this.getRebaseStatus(repoPath!) : undefined,
								Git.log__recent_committerdate(repoPath!, this.container.config.advanced.commitOrdering),
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

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._branchesCache.delete(repoPath);
					}
				});
			}
		}

		let result = await resultsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (options?.sort) {
			GitBranch.sort(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	// @log()
	// async getBranchesAndTagsTipsFn(repoPath: string | undefined, currentName?: string) {
	// 	const [{ values: branches }, { values: tags }] = await Promise.all([
	// 		this.getBranches(repoPath),
	// 		this.getTags(repoPath),
	// 	]);

	// 	const branchesAndTagsBySha = Arrays.groupByFilterMap(
	// 		(branches as (GitBranch | GitTag)[]).concat(tags as (GitBranch | GitTag)[]),
	// 		bt => bt.sha,
	// 		bt => {
	// 			if (currentName) {
	// 				if (bt.name === currentName) return undefined;
	// 				if (bt.refType === 'branch' && bt.getNameWithoutRemote() === currentName) {
	// 					return { name: bt.name, compactName: bt.getRemoteName(), type: bt.refType };
	// 				}
	// 			}

	// 			return { name: bt.name, compactName: undefined, type: bt.refType };
	// 		},
	// 	);

	// 	return (sha: string, options?: { compact?: boolean; icons?: boolean }): string | undefined => {
	// 		const branchesAndTags = branchesAndTagsBySha.get(sha);
	// 		if (branchesAndTags == null || branchesAndTags.length === 0) return undefined;

	// 		if (!options?.compact) {
	// 			return branchesAndTags
	// 				.map(
	// 					bt => `${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${bt.name}`,
	// 				)
	// 				.join(', ');
	// 		}

	// 		if (branchesAndTags.length > 1) {
	// 			const [bt] = branchesAndTags;
	// 			return `${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${
	// 				bt.compactName ?? bt.name
	// 			}, ${GlyphChars.Ellipsis}`;
	// 		}

	// 		return branchesAndTags
	// 			.map(
	// 				bt =>
	// 					`${options?.icons ? `${bt.type === 'tag' ? '$(tag)' : '$(git-branch)'} ` : ''}${
	// 						bt.compactName ?? bt.name
	// 					}`,
	// 			)
	// 			.join(', ');
	// 	};
	// }

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		const data = await Git.diff__shortstat(repoPath, ref);
		if (!data) return undefined;

		return GitDiffParser.parseShortStat(data);
	}

	@log()
	async getCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined> {
		const log = await this.getLog(repoPath, { limit: 2, ref: ref });
		if (log == null) return undefined;

		return log.commits.get(ref) ?? Iterables.first(log.commits.values());
	}

	@log()
	async getCommitBranches(
		repoPath: string,
		ref: string,
		options?: { mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		const data = await Git.branch__containsOrPointsAt(repoPath, ref, options);
		if (!data) return [];

		return data
			.split('\n')
			.map(b => b.trim())
			.filter(<T>(i?: T): i is T => Boolean(i));
	}

	@log()
	getCommitCount(repoPath: string, ref: string): Promise<number | undefined> {
		return Git.rev_list__count(repoPath, ref);
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		uri: Uri,
		options?: { ref?: string; firstIfNotFound?: boolean; range?: Range; reverse?: boolean },
	): Promise<GitLogCommit | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const log = await this.getLogForFile(repoPath, uri.fsPath, {
				limit: 2,
				ref: options?.ref,
				range: options?.range,
				reverse: options?.reverse,
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

			return commit ?? Iterables.first(log.commits.values());
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string, uri: Uri): Promise<string | undefined> {
		const data = await Git.log__file(repoPath, uri.fsPath, '@{push}..', {
			format: 'refs',
			ordering: this.container.config.advanced.commitOrdering,
			renames: true,
		});
		if (data == null || data.length === 0) return undefined;

		return GitLogParser.parseLastRefOnly(data);
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
					const currentUser = await this.getCurrentUser(repoPath);

					const data = await Git.log(repoPath, options?.ref, {
						all: options?.all,
						format: options?.stats ? 'shortlog+stats' : 'shortlog',
					});
					const shortlog = GitShortLogParser.parseFromLog(data, repoPath, currentUser);

					return shortlog != null ? shortlog.contributors : [];
				} catch (ex) {
					this._contributorsCache.delete(key);

					return [];
				}
			}

			contributors = load.call(this);

			if (this.useCaching) {
				this._contributorsCache.set(key, contributors);

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._contributorsCache.delete(key);
					}
				});
			}
		}

		return contributors;
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		let user = this._userMapCache.get(repoPath);
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		user = { name: undefined, email: undefined };

		const data = await Git.config__get_regex('^user\\.', repoPath, { local: true });
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
				process.env.GIT_AUTHOR_NAME || process.env.GIT_COMMITTER_NAME || userInfo()?.username || undefined;
			if (!user.name) {
				// If we found no user data, mark it so we won't bother trying again
				this._userMapCache.set(repoPath, null);
				return undefined;
			}

			user.email =
				process.env.GIT_AUTHOR_EMAIL ||
				process.env.GIT_COMMITTER_EMAIL ||
				process.env.EMAIL ||
				`${user.name}@${hostname()}`;
		}

		const author = `${user.name} <${user.email}>`;
		// Check if there is a mailmap for the current user
		const mappedAuthor = await Git.check_mailmap(repoPath, author);
		if (mappedAuthor != null && mappedAuthor.length !== 0 && author !== mappedAuthor) {
			const match = mappedAuthorRegex.exec(mappedAuthor);
			if (match != null) {
				[, user.name, user.email] = match;
			}
		}

		this._userMapCache.set(repoPath, user);
		return user;
	}

	@log()
	async getDefaultBranchName(repoPath: string | undefined, remote?: string): Promise<string | undefined> {
		if (repoPath == null) return undefined;

		if (!remote) {
			try {
				const data = await Git.symbolic_ref(repoPath, 'HEAD');
				if (data != null) return data.trim();
			} catch {}
		}

		remote = remote ?? 'origin';
		try {
			const data = await Git.ls_remote__HEAD(repoPath, remote);
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
		const cc = Logger.getCorrelationContext();

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
				const cachedDiff = doc.state.get<CachedDiff>(key);
				if (cachedDiff != null) {
					Logger.debug(cc, `Cache hit: '${key}'`);
					return cachedDiff.item;
				}
			}

			Logger.debug(cc, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState(doc.key);
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
			cc,
		);

		if (doc.state != null) {
			Logger.debug(cc, `Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<GitDiff>,
			};
			doc.state.set<CachedDiff>(key, value);
		}

		return promise;
	}

	private async getDiffForFileCore(
		repoPath: string | undefined,
		fileName: string,
		ref1: string | undefined,
		ref2: string | undefined,
		options: { encoding?: string },
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitDiff | undefined> {
		const [file, root] = splitPath(fileName, repoPath, false);

		try {
			const data = await Git.diff(root, file, ref1, ref2, {
				...options,
				filters: ['M'],
				linesOfContext: 0,
				renames: true,
				similarityThreshold: this.container.config.advanced.similarityThreshold,
			});
			// }

			const diff = GitDiffParser.parse(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiff>,
					errorMessage: msg,
				};
				document.state.set<CachedDiff>(key, value);

				return emptyPromise as Promise<GitDiff>;
			}

			return undefined;
		}
	}

	@log<LocalGitProvider['getDiffForFileContents']>({ args: { 1: '<contents>' } })
	async getDiffForFileContents(uri: GitUri, ref: string, contents: string): Promise<GitDiff | undefined> {
		const cc = Logger.getCorrelationContext();

		const key = `diff:${Strings.md5(contents)}`;

		const doc = await this.container.tracker.getOrAdd(uri);
		if (this.useCaching) {
			if (doc.state != null) {
				const cachedDiff = doc.state.get<CachedDiff>(key);
				if (cachedDiff != null) {
					Logger.debug(cc, `Cache hit: ${key}`);
					return cachedDiff.item;
				}
			}

			Logger.debug(cc, `Cache miss: ${key}`);

			if (doc.state == null) {
				doc.state = new GitDocumentState(doc.key);
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
			cc,
		);

		if (doc.state != null) {
			Logger.debug(cc, `Cache add: '${key}'`);

			const value: CachedDiff = {
				item: promise as Promise<GitDiff>,
			};
			doc.state.set<CachedDiff>(key, value);
		}

		return promise;
	}

	private async getDiffForFileContentsCore(
		repoPath: string | undefined,
		fileName: string,
		ref: string,
		contents: string,
		options: { encoding?: string },
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitDiff | undefined> {
		const [file, root] = splitPath(fileName, repoPath, false);

		try {
			const data = await Git.diff__contents(root, file, ref, contents, {
				...options,
				filters: ['M'],
				similarityThreshold: this.container.config.advanced.similarityThreshold,
			});

			const diff = GitDiffParser.parse(data);
			return diff;
		} catch (ex) {
			// Trap and cache expected diff errors
			if (document.state != null) {
				const msg = ex?.toString() ?? '';
				Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

				const value: CachedDiff = {
					item: emptyPromise as Promise<GitDiff>,
					errorMessage: msg,
				};
				document.state.set<CachedDiff>(key, value);

				return emptyPromise as Promise<GitDiff>;
			}

			return undefined;
		}
	}

	@log()
	async getDiffForLine(
		uri: GitUri,
		editorLine: number,
		ref1: string | undefined,
		ref2?: string,
	): Promise<GitDiffHunkLine | undefined> {
		try {
			const diff = await this.getDiffForFile(uri, ref1, ref2);
			if (diff == null) return undefined;

			const line = editorLine + 1;
			const hunk = diff.hunks.find(c => c.current.position.start <= line && c.current.position.end >= line);
			if (hunk == null) return undefined;

			return hunk.lines[line - hunk.current.position.start];
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
			const data = await Git.diff__name_status(repoPath, ref1, ref2, {
				similarityThreshold: this.container.config.advanced.similarityThreshold,
				...options,
			});
			const files = GitDiffParser.parseNameStatus(data, repoPath);
			return files == null || files.length === 0 ? undefined : files;
		} catch (ex) {
			return undefined;
		}
	}

	@log()
	async getFileStatusForCommit(repoPath: string, uri: Uri, ref: string): Promise<GitFile | undefined> {
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return undefined;

		const data = await Git.show__name_status(repoPath, uri.fsPath, ref);
		if (!data) return undefined;

		const files = GitDiffParser.parseNameStatus(data, repoPath);
		if (files == null || files.length === 0) return undefined;

		return files[0];
	}

	@log()
	async getLog(
		repoPath: string,
		options?: {
			all?: boolean;
			authors?: string[];
			cursor?: string;
			limit?: number;
			merges?: boolean;
			ordering?: string | null;
			ref?: string;
			reverse?: boolean;
			since?: string;
		},
	): Promise<GitLog | undefined> {
		const limit = options?.limit ?? this.container.config.advanced.maxListItems ?? 0;

		try {
			const data = await Git.log(repoPath, options?.ref, {
				...options,
				limit: limit,
				merges: options?.merges == null ? true : options.merges,
				ordering: options?.ordering ?? this.container.config.advanced.commitOrdering,
				similarityThreshold: this.container.config.advanced.similarityThreshold,
			});
			const log = GitLogParser.parse(
				data,
				GitCommitType.Log,
				repoPath,
				undefined,
				options?.ref,
				await this.getCurrentUser(repoPath),
				limit,
				options?.reverse ?? false,
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
			return undefined;
		}
	}

	@log()
	async getLogRefsOnly(
		repoPath: string,
		options?: {
			authors?: string[];
			cursor?: string;
			limit?: number;
			merges?: boolean;
			ordering?: string | null;
			ref?: string;
			reverse?: boolean;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const limit = options?.limit ?? this.container.config.advanced.maxListItems ?? 0;

		try {
			const data = await Git.log(repoPath, options?.ref, {
				authors: options?.authors,
				format: 'refs',
				limit: limit,
				merges: options?.merges == null ? true : options.merges,
				reverse: options?.reverse,
				similarityThreshold: this.container.config.advanced.similarityThreshold,
				since: options?.since,
				ordering: options?.ordering ?? this.container.config.advanced.commitOrdering,
			});
			const commits = GitLogParser.parseRefsOnly(data);
			return new Set(commits);
		} catch (ex) {
			return undefined;
		}
	}

	private getLogMoreFn(
		log: GitLog,
		options?: {
			authors?: string[];
			limit?: number;
			merges?: boolean;
			ordering?: string | null;
			ref?: string;
			reverse?: boolean;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && Iterables.some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? this.container.config.advanced.maxSearchItems ?? 0;

			// If the log is for a range, then just get everything prior + more
			if (GitRevision.isRange(log.sha)) {
				const moreLog = await this.getLog(log.repoPath, {
					...options,
					limit: moreLimit === 0 ? 0 : (options?.limit ?? 0) + moreLimit,
				});
				// If we can't find any more, assume we have everything
				if (moreLog == null) return { ...log, hasMore: false };

				return moreLog;
			}

			const ref = Iterables.last(log.commits.values())?.ref;
			const moreLog = await this.getLog(log.repoPath, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				ref: moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false };

			// Merge authors
			const authors = new Map([...log.authors]);
			for (const [key, addAuthor] of moreLog.authors) {
				const author = authors.get(key);
				if (author == null) {
					authors.set(key, addAuthor);
				} else {
					author.lineCount += addAuthor.lineCount;
				}
			}

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				authors: authors,
				commits: commits,
				sha: log.sha,
				range: undefined,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				query: (limit: number | undefined) => this.getLog(log.repoPath, { ...options, limit: limit }),
			};
			mergedLog.more = this.getLogMoreFn(mergedLog, options);

			return mergedLog;
		};
	}

	@log()
	async getLogForSearch(
		repoPath: string,
		search: SearchPattern,
		options?: { limit?: number; ordering?: string | null; skip?: number },
	): Promise<GitLog | undefined> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const limit = options?.limit ?? this.container.config.advanced.maxSearchItems ?? 0;
			const similarityThreshold = this.container.config.advanced.similarityThreshold;

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

			const data = await Git.log__search(repoPath, args, {
				ordering: this.container.config.advanced.commitOrdering,
				...options,
				limit: limit,
				useShow: useShow,
			});
			const log = GitLogParser.parse(
				data,
				GitCommitType.Log,
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
		options?: { limit?: number; ordering?: string | null },
	): (limit: number | undefined) => Promise<GitLog> {
		return async (limit: number | undefined) => {
			limit = limit ?? this.container.config.advanced.maxSearchItems ?? 0;

			const moreLog = await this.getLogForSearch(log.repoPath, search, {
				...options,
				limit: limit,
				skip: log.count,
			});
			if (moreLog == null) {
				// If we can't find any more, assume we have everything
				return { ...log, hasMore: false };
			}

			// Merge authors
			const authors = new Map([...log.authors]);
			for (const [key, addAuthor] of moreLog.authors) {
				const author = authors.get(key);
				if (author == null) {
					authors.set(key, addAuthor);
				} else {
					author.lineCount += addAuthor.lineCount;
				}
			}

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				authors: authors,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: (log.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
				query: (limit: number | undefined) =>
					this.getLogForSearch(log.repoPath, search, { ...options, limit: limit }),
			};
			mergedLog.more = this.getLogForSearchMoreFn(mergedLog, search, options);

			return mergedLog;
		};
	}
	@log()
	async getLogForFile(
		repoPath: string | undefined,
		fileName: string,
		options?: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			ordering?: string | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
	): Promise<GitLog | undefined> {
		if (repoPath != null && repoPath === normalizePath(fileName)) {
			throw new Error(`File name cannot match the repository path; fileName=${fileName}`);
		}

		const cc = Logger.getCorrelationContext();

		options = { reverse: false, ...options };

		if (options.renames == null) {
			options.renames = this.container.config.advanced.fileHistoryFollowsRenames;
		}

		let key = 'log';
		if (options.ref != null) {
			key += `:${options.ref}`;
		}

		if (options.all == null) {
			options.all = this.container.config.advanced.fileHistoryShowAllBranches;
		}
		if (options.all) {
			key += ':all';
		}

		options.limit = options.limit == null ? this.container.config.advanced.maxListItems || 0 : options.limit;
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

		const doc = await this.container.tracker.getOrAdd(GitUri.fromFile(fileName, repoPath!, options.ref));
		if (this.useCaching && options.range == null) {
			if (doc.state != null) {
				const cachedLog = doc.state.get<CachedLog>(key);
				if (cachedLog != null) {
					Logger.debug(cc, `Cache hit: '${key}'`);
					return cachedLog.item;
				}

				if (options.ref != null || options.limit != null) {
					// Since we are looking for partial log, see if we have the log of the whole file
					const cachedLog = doc.state.get<CachedLog>(
						`log${options.renames ? ':follow' : ''}${options.reverse ? ':reverse' : ''}`,
					);
					if (cachedLog != null) {
						if (options.ref == null) {
							Logger.debug(cc, `Cache hit: ~'${key}'`);
							return cachedLog.item;
						}

						Logger.debug(cc, `Cache ?: '${key}'`);
						let log = await cachedLog.item;
						if (log != null && !log.hasMore && log.commits.has(options.ref)) {
							Logger.debug(cc, `Cache hit: '${key}'`);

							// Create a copy of the log starting at the requested commit
							let skip = true;
							let i = 0;
							const authors = new Map<string, GitAuthor>();
							const commits = new Map(
								Iterables.filterMap<[string, GitLogCommit], [string, GitLogCommit]>(
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

										authors.set(c.author, log.authors.get(c.author)!);
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
								authors: authors,
								query: (limit: number | undefined) =>
									this.getLogForFile(repoPath, fileName, { ...opts, limit: limit }),
							};

							return log;
						}
					}
				}
			}

			Logger.debug(cc, `Cache miss: '${key}'`);

			if (doc.state == null) {
				doc.state = new GitDocumentState(doc.key);
			}
		}

		const promise = this.getLogForFileCore(repoPath, fileName, options, doc, key, cc);

		if (doc.state != null && options.range == null) {
			Logger.debug(cc, `Cache add: '${key}'`);

			const value: CachedLog = {
				item: promise as Promise<GitLog>,
			};
			doc.state.set<CachedLog>(key, value);
		}

		return promise;
	}

	private async getLogForFileCore(
		repoPath: string | undefined,
		fileName: string,
		{
			ref,
			range,
			...options
		}: {
			all?: boolean;
			cursor?: string;
			limit?: number;
			ordering?: string | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		},
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitLog | undefined> {
		if (!(await this.isTracked(fileName, repoPath, ref))) {
			Logger.log(cc, `Skipping log; '${fileName}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [file, root] = splitPath(fileName, repoPath, false);

		try {
			if (range != null && range.start.line > range.end.line) {
				range = new Range(range.end, range.start);
			}

			const data = await Git.log__file(root, file, ref, {
				ordering: this.container.config.advanced.commitOrdering,
				...options,
				firstParent: options.renames,
				startLine: range == null ? undefined : range.start.line + 1,
				endLine: range == null ? undefined : range.end.line + 1,
			});
			const log = GitLogParser.parse(
				data,
				// If this is the log of a folder, parse it as a normal log rather than a file log
				isFolderGlob(file) ? GitCommitType.Log : GitCommitType.LogFile,
				root,
				file,
				ref,
				await this.getCurrentUser(root),
				options.limit,
				options.reverse!,
				range,
			);

			if (log != null) {
				const opts = { ...options, ref: ref, range: range };
				log.query = (limit: number | undefined) =>
					this.getLogForFile(repoPath, fileName, { ...opts, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogForFileMoreFn(log, fileName, opts);
				}
			}

			return log;
		} catch (ex) {
			// Trap and cache expected log errors
			if (document.state != null && range == null && !options.reverse) {
				const msg: string = ex?.toString() ?? '';
				Logger.debug(cc, `Cache replace (with empty promise): '${key}'`);

				const value: CachedLog = {
					item: emptyPromise as Promise<GitLog>,
					errorMessage: msg,
				};
				document.state.set<CachedLog>(key, value);

				return emptyPromise as Promise<GitLog>;
			}

			return undefined;
		}
	}

	private getLogForFileMoreFn(
		log: GitLog,
		fileName: string,
		options: {
			all?: boolean;
			limit?: number;
			ordering?: string | null;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
		},
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && Iterables.some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? this.container.config.advanced.maxSearchItems ?? 0;

			const ref = Iterables.last(log.commits.values())?.ref;
			const moreLog = await this.getLogForFile(log.repoPath, fileName, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				ref: options.all ? undefined : moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
				skip: options.all ? log.count : undefined,
			});
			// If we can't find any more, assume we have everything
			if (moreLog == null) return { ...log, hasMore: false };

			// Merge authors
			const authors = new Map([...log.authors]);
			for (const [key, addAuthor] of moreLog.authors) {
				const author = authors.get(key);
				if (author == null) {
					authors.set(key, addAuthor);
				} else {
					author.lineCount += addAuthor.lineCount;
				}
			}

			const commits = new Map([...log.commits, ...moreLog.commits]);

			const mergedLog: GitLog = {
				repoPath: log.repoPath,
				authors: authors,
				commits: commits,
				sha: log.sha,
				range: log.range,
				count: commits.size,
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				query: (limit: number | undefined) =>
					this.getLogForFile(log.repoPath, fileName, { ...options, limit: limit }),
			};

			if (options.renames) {
				const renamed = Iterables.find(
					moreLog.commits.values(),
					c => Boolean(c.originalFileName) && c.originalFileName !== fileName,
				);
				if (renamed != null) {
					fileName = renamed.originalFileName!;
				}
			}

			mergedLog.more = this.getLogForFileMoreFn(mergedLog, fileName, options);

			return mergedLog;
		};
	}

	@log()
	async getMergeBase(repoPath: string, ref1: string, ref2: string, options?: { forkPoint?: boolean }) {
		const cc = Logger.getCorrelationContext();

		try {
			const data = await Git.merge_base(repoPath, ref1, ref2, options);
			if (data == null) return undefined;

			return data.split('\n')[0].trim() || undefined;
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	@gate()
	@log()
	async getMergeStatus(repoPath: string): Promise<GitMergeStatus | undefined> {
		let status = this.useCaching ? this._mergeStatusCache.get(repoPath) : undefined;
		if (status === undefined) {
			const merge = await Git.rev_parse__verify(repoPath, 'MERGE_HEAD');
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

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._mergeStatusCache.delete(repoPath);
					}
				});
			}
		}

		return status ?? undefined;
	}

	@gate()
	@log()
	async getRebaseStatus(repoPath: string): Promise<GitRebaseStatus | undefined> {
		let status = this.useCaching ? this._rebaseStatusCache.get(repoPath) : undefined;
		if (status === undefined) {
			const rebase = await Git.rev_parse__verify(repoPath, 'REBASE_HEAD');
			if (rebase != null) {
				let [mergeBase, branch, onto, stepsNumber, stepsMessage, stepsTotal] = await Promise.all([
					this.getMergeBase(repoPath, 'REBASE_HEAD', 'HEAD'),
					Git.readDotGitFile(repoPath, ['rebase-merge', 'head-name']),
					Git.readDotGitFile(repoPath, ['rebase-merge', 'onto']),
					Git.readDotGitFile(repoPath, ['rebase-merge', 'msgnum'], { numeric: true }),
					Git.readDotGitFile(repoPath, ['rebase-merge', 'message'], { throw: true }).catch(() =>
						Git.readDotGitFile(repoPath, ['rebase-merge', 'message-squashed']),
					),
					Git.readDotGitFile(repoPath, ['rebase-merge', 'end'], { numeric: true }),
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

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._rebaseStatusCache.delete(repoPath);
					}
				});
			}
		}

		return status ?? undefined;
	}

	@log()
	async getNextDiffUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<{ current: GitUri; next: GitUri | undefined; deleted?: boolean } | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (ref == null || ref.length === 0) return undefined;

		const fileName = GitUri.relativeTo(uri, repoPath);

		if (GitRevision.isUncommittedStaged(ref)) {
			return {
				current: GitUri.fromFile(fileName, repoPath, ref),
				next: GitUri.fromFile(fileName, repoPath, undefined),
			};
		}

		const next = await this.getNextUri(repoPath, uri, ref, skip);
		if (next == null) {
			const status = await this.getStatusForFile(repoPath, fileName);
			if (status != null) {
				// If the file is staged, diff with the staged version
				if (status.indexStatus != null) {
					return {
						current: GitUri.fromFile(fileName, repoPath, ref),
						next: GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged),
					};
				}
			}

			return {
				current: GitUri.fromFile(fileName, repoPath, ref),
				next: GitUri.fromFile(fileName, repoPath, undefined),
			};
		}

		return {
			current:
				skip === 0
					? GitUri.fromFile(fileName, repoPath, ref)
					: (await this.getNextUri(repoPath, uri, ref, skip - 1))!,
			next: next,
		};
	}

	@log()
	async getNextUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		// editorLine?: number
	): Promise<GitUri | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (ref == null || ref.length === 0 || GitRevision.isUncommittedStaged(ref)) return undefined;

		let filters: GitDiffFilter[] | undefined;
		if (ref === GitRevision.deletedOrMissing) {
			// If we are trying to move next from a deleted or missing ref then get the first commit
			ref = undefined;
			filters = ['A'];
		}

		const fileName = GitUri.relativeTo(uri, repoPath);
		let data = await Git.log__file(repoPath, fileName, ref, {
			filters: filters,
			format: 'simple',
			limit: skip + 1,
			ordering: this.container.config.advanced.commitOrdering,
			reverse: true,
			// startLine: editorLine != null ? editorLine + 1 : undefined,
		});
		if (data == null || data.length === 0) return undefined;

		const [nextRef, file, status] = GitLogParser.parseSimple(data, skip);
		// If the file was deleted, check for a possible rename
		if (status === 'D') {
			data = await Git.log__file(repoPath, '.', nextRef, {
				filters: ['R', 'C'],
				format: 'simple',
				limit: 1,
				ordering: this.container.config.advanced.commitOrdering,
				// startLine: editorLine != null ? editorLine + 1 : undefined
			});
			if (data == null || data.length === 0) {
				return GitUri.fromFile(file ?? fileName, repoPath, nextRef);
			}

			const [nextRenamedRef, renamedFile] = GitLogParser.parseSimpleRenamed(data, file ?? fileName);
			return GitUri.fromFile(
				renamedFile ?? file ?? fileName,
				repoPath,
				nextRenamedRef ?? nextRef ?? GitRevision.deletedOrMissing,
			);
		}

		return GitUri.fromFile(file ?? fileName, repoPath, nextRef);
	}

	@log()
	async getPreviousDiffUris(
		repoPath: string,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
		firstParent: boolean = false,
	): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const fileName = GitUri.relativeTo(uri, repoPath);

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (ref == null || ref.length === 0) {
			// First, check the file status to see if there is anything staged
			const status = await this.getStatusForFile(repoPath, fileName);
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
							current: GitUri.fromFile(fileName, repoPath, undefined),
							previous: GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged),
						};
					}

					return {
						// Diff staged with HEAD (or prior if more skips)
						current: GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged),
						previous: await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent),
					};
				} else if (status.workingTreeStatus != null) {
					if (skip === 0) {
						return {
							current: GitUri.fromFile(fileName, repoPath, undefined),
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
					? GitUri.fromFile(fileName, repoPath, ref)
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
				? GitUri.fromFile(fileName, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1, undefined, firstParent))!;
		if (current == null || current.sha === GitRevision.deletedOrMissing) return undefined;

		return {
			current: current,
			previous: await this.getPreviousUri(repoPath, uri, ref, skip, undefined, firstParent),
		};
	}

	@log()
	async getPreviousLineDiffUris(
		repoPath: string,
		uri: Uri,
		editorLine: number,
		ref: string | undefined,
		skip: number = 0,
	): Promise<{ current: GitUri; previous: GitUri | undefined; line: number } | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		let fileName = GitUri.relativeTo(uri, repoPath);

		let previous;

		// If we are at the working tree (i.e. no ref), we need to dig deeper to figure out where to go
		if (ref == null || ref.length === 0) {
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
					const status = await this.getStatusForFile(repoPath, fileName);
					if (status != null) {
						// If the file is staged, diff working with staged (index)
						// If the file is not staged, diff working with HEAD
						if (status.indexStatus != null) {
							// Diff working with staged
							return {
								current: GitUri.fromFile(fileName, repoPath, undefined),
								previous: GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged),
								line: editorLine,
							};
						}
					}

					// Diff working with HEAD (or prior if more skips)
					return {
						current: GitUri.fromFile(fileName, repoPath, undefined),
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
				fileName = blameLine.commit.fileName || (blameLine.commit.originalFileName ?? fileName);
				uri = GitUri.resolve(fileName, repoPath);
				editorLine = blameLine.line.originalLine - 1;

				if (skip === 0 && blameLine.commit.previousSha) {
					previous = GitUri.fromFile(fileName, repoPath, blameLine.commit.previousSha);
				}
			}
		} else {
			if (GitRevision.isUncommittedStaged(ref)) {
				const current =
					skip === 0
						? GitUri.fromFile(fileName, repoPath, ref)
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
			fileName = blameLine.commit.fileName || (blameLine.commit.originalFileName ?? fileName);
			uri = GitUri.resolve(fileName, repoPath);
			editorLine = blameLine.line.originalLine - 1;

			if (skip === 0 && blameLine.commit.previousSha) {
				previous = GitUri.fromFile(fileName, repoPath, blameLine.commit.previousSha);
			}
		}

		const current =
			skip === 0
				? GitUri.fromFile(fileName, repoPath, ref)
				: (await this.getPreviousUri(repoPath, uri, ref, skip - 1, editorLine))!;
		if (current.sha === GitRevision.deletedOrMissing) return undefined;

		return {
			current: current,
			previous: previous ?? (await this.getPreviousUri(repoPath, uri, ref, skip, editorLine)),
			line: editorLine,
		};
	}

	@log()
	async getPreviousUri(
		repoPath: string,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		editorLine?: number,
		firstParent: boolean = false,
	): Promise<GitUri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const cc = Logger.getCorrelationContext();

		if (ref === GitRevision.uncommitted) {
			ref = undefined;
		}

		const fileName = GitUri.relativeTo(uri, repoPath);
		// TODO: Add caching
		let data;
		try {
			data = await Git.log__file(repoPath, fileName, ref, {
				firstParent: firstParent,
				format: 'simple',
				limit: skip + 2,
				ordering: this.container.config.advanced.commitOrdering,
				startLine: editorLine != null ? editorLine + 1 : undefined,
			});
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			// If the line count is invalid just fallback to the most recent commit
			if ((ref == null || GitRevision.isUncommittedStaged(ref)) && GitErrors.invalidLineCount.test(msg)) {
				if (ref == null) {
					const status = await this.getStatusForFile(repoPath, fileName);
					if (status?.indexStatus != null) {
						return GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged);
					}
				}

				ref = await Git.log__file_recent(repoPath, fileName, {
					ordering: this.container.config.advanced.commitOrdering,
				});
				return GitUri.fromFile(fileName, repoPath, ref ?? GitRevision.deletedOrMissing);
			}

			Logger.error(ex, cc);
			throw ex;
		}
		if (data == null || data.length === 0) return undefined;

		const [previousRef, file] = GitLogParser.parseSimple(data, skip, ref);
		// If the previous ref matches the ref we asked for assume we are at the end of the history
		if (ref != null && ref === previousRef) return undefined;

		return GitUri.fromFile(file ?? fileName, repoPath, previousRef ?? GitRevision.deletedOrMissing);
	}

	@log()
	async getIncomingActivity(
		repoPath: string,
		options?: { all?: boolean; branch?: string; limit?: number; ordering?: string | null; skip?: number },
	): Promise<GitReflog | undefined> {
		const cc = Logger.getCorrelationContext();

		const limit = options?.limit ?? this.container.config.advanced.maxListItems ?? 0;
		try {
			// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
			const data = await Git.reflog(repoPath, {
				ordering: this.container.config.advanced.commitOrdering,
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
			Logger.error(ex, cc);
			return undefined;
		}
	}

	private getReflogMoreFn(
		reflog: GitReflog,
		options?: { all?: boolean; branch?: string; limit?: number; ordering?: string | null; skip?: number },
	): (limit: number) => Promise<GitReflog> {
		return async (limit: number | undefined) => {
			limit = limit ?? this.container.config.advanced.maxSearchItems ?? 0;

			const moreLog = await this.getIncomingActivity(reflog.repoPath, {
				...options,
				limit: limit,
				skip: reflog.total,
			});
			if (moreLog == null) {
				// If we can't find any more, assume we have everything
				return { ...reflog, hasMore: false };
			}

			const mergedLog: GitReflog = {
				repoPath: reflog.repoPath,
				records: [...reflog.records, ...moreLog.records],
				count: reflog.count + moreLog.count,
				total: reflog.total + moreLog.total,
				limit: (reflog.limit ?? 0) + limit,
				hasMore: moreLog.hasMore,
			};
			mergedLog.more = this.getReflogMoreFn(mergedLog, options);

			return mergedLog;
		};
	}

	async getRichRemoteProvider(
		repoPath: string | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	async getRichRemoteProvider(
		remotes: GitRemote[],
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	@gate<LocalGitProvider['getRichRemoteProvider']>(
		(remotesOrRepoPath, options) =>
			`${typeof remotesOrRepoPath === 'string' ? remotesOrRepoPath : remotesOrRepoPath[0]?.repoPath}:${
				options?.includeDisconnected ?? false
			}`,
	)
	@log<LocalGitProvider['getRichRemoteProvider']>({
		args: {
			0: remotesOrRepoPath =>
				Array.isArray(remotesOrRepoPath) ? remotesOrRepoPath.map(r => r.name).join(',') : remotesOrRepoPath,
		},
	})
	async getRichRemoteProvider(
		remotesOrRepoPath: GitRemote[] | string | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined> {
		if (remotesOrRepoPath == null) return undefined;

		const cacheKey = typeof remotesOrRepoPath === 'string' ? remotesOrRepoPath : remotesOrRepoPath[0]?.repoPath;

		let richRemote = this._remotesWithApiProviderCache.get(cacheKey);
		if (richRemote != null) return richRemote;
		if (richRemote === null && !options?.includeDisconnected) return undefined;

		if (options?.includeDisconnected) {
			richRemote = this._remotesWithApiProviderCache.get(`disconnected|${cacheKey}`);
			if (richRemote !== undefined) return richRemote ?? undefined;
		}

		const remotes = (
			typeof remotesOrRepoPath === 'string' ? await this.getRemotes(remotesOrRepoPath) : remotesOrRepoPath
		).filter(
			(
				r: GitRemote<RemoteProvider | RichRemoteProvider | undefined>,
			): r is GitRemote<RemoteProvider | RichRemoteProvider> => r.provider != null,
		);

		if (remotes.length === 0) return undefined;

		let remote;
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

		if (!remote?.hasRichProvider()) {
			this._remotesWithApiProviderCache.set(cacheKey, null);
			return undefined;
		}

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (connected) {
			this._remotesWithApiProviderCache.set(cacheKey, remote);
		} else {
			this._remotesWithApiProviderCache.set(cacheKey, null);
			this._remotesWithApiProviderCache.set(`disconnected|${cacheKey}`, remote);

			if (!options?.includeDisconnected) return undefined;
		}

		return remote;
	}

	@log()
	async getRemotes(repoPath: string | undefined, options?: { sort?: boolean }): Promise<GitRemote<RemoteProvider>[]> {
		if (repoPath == null) return [];

		const repository = await this.container.git.getRepository(repoPath);
		const remotes = await (repository != null
			? repository.getRemotes(options)
			: this.getRemotesCore(repoPath, undefined, options));

		return remotes.filter(r => r.provider != null) as GitRemote<RemoteProvider>[];
	}

	async getRemotesCore(
		repoPath: string | undefined,
		providers?: RemoteProviders,
		options?: { sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		providers = providers ?? RemoteProviderFactory.loadProviders(configuration.get('remotes', null));

		try {
			const data = await Git.remote(repoPath);
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
	@debug()
	async getRepoPath(filePath: string, isDirectory?: boolean): Promise<string | undefined> {
		const cc = Logger.getCorrelationContext();

		let repoPath: string | undefined;
		try {
			let path: string;
			if (isDirectory) {
				path = filePath;
			} else {
				const stats = await new Promise<Stats | undefined>(resolve =>
					stat(filePath, (err, stats) => resolve(err == null ? stats : undefined)),
				);
				path = stats?.isDirectory() ? filePath : dirname(filePath);
			}

			repoPath = await Git.rev_parse__show_toplevel(path);
			if (repoPath == null) return repoPath;

			if (isWindows) {
				// On Git 2.25+ if you call `rev-parse --show-toplevel` on a mapped drive, instead of getting the mapped drive path back, you get the UNC path for the mapped drive.
				// So try to normalize it back to the mapped drive path, if possible

				const repoUri = Uri.file(repoPath);
				const pathUri = Uri.file(path);
				if (repoUri.authority.length !== 0 && pathUri.authority.length === 0) {
					const match = driveLetterRegex.exec(pathUri.path);
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
								return repoPath;
							}
						} catch {}
					}

					repoPath = normalizePath(pathUri.fsPath);
				}

				return repoPath;
			}

			// If we are not on Windows (symlinks don't seem to have the same issue on Windows), check if we are a symlink and if so, use the symlink path (not its resolved path)
			// This is because VS Code will provide document Uris using the symlinked path
			repoPath = await new Promise<string | undefined>(resolve => {
				realpath(path, { encoding: 'utf8' }, (err, resolvedPath) => {
					if (err != null) {
						Logger.debug(cc, `fs.realpath failed; repoPath=${repoPath}`);
						resolve(repoPath);
						return;
					}

					if (Strings.equalsIgnoreCase(path, resolvedPath)) {
						Logger.debug(cc, `No symlink detected; repoPath=${repoPath}`);
						resolve(repoPath);
						return;
					}

					const linkPath = normalizePath(resolvedPath);
					repoPath = repoPath!.replace(linkPath, path);
					Logger.debug(
						cc,
						`Symlink detected; repoPath=${repoPath}, path=${path}, resolvedPath=${resolvedPath}`,
					);
					resolve(repoPath);
				});
			});

			return repoPath;
		} catch (ex) {
			Logger.error(ex, cc);
			repoPath = undefined;
			return repoPath;
		} finally {
			if (repoPath) {
				void this.ensureProperWorkspaceCasing(repoPath, filePath);
			}
		}
	}

	@gate(() => '')
	private async ensureProperWorkspaceCasing(repoPath: string, filePath: string) {
		if (this.container.config.advanced.messages.suppressImproperWorkspaceCasingWarning) return;

		filePath = filePath.replace(/\\/g, '/');

		let regexPath;
		let testPath;
		if (filePath > repoPath) {
			regexPath = filePath;
			testPath = repoPath;
		} else {
			testPath = filePath;
			regexPath = repoPath;
		}

		let pathRegex = new RegExp(`^${regexPath}`);
		if (!pathRegex.test(testPath)) {
			pathRegex = new RegExp(pathRegex, 'i');
			if (pathRegex.test(testPath)) {
				await Messages.showIncorrectWorkspaceCasingWarningMessage();
			}
		}
	}

	@gate()
	@log()
	async getStash(repoPath: string | undefined): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		let stash = this.useCaching ? this._stashesCache.get(repoPath) : undefined;
		if (stash === undefined) {
			const data = await Git.stash__list(repoPath, {
				similarityThreshold: this.container.config.advanced.similarityThreshold,
			});
			stash = GitStashParser.parse(data, repoPath);

			if (this.useCaching) {
				this._stashesCache.set(repoPath, stash ?? null);

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._stashesCache.delete(repoPath);
					}
				});
			}
		}

		return stash ?? undefined;
	}

	@log()
	async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
		const porcelainVersion = (await Git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await Git.status__file(repoPath, fileName, porcelainVersion, {
			similarityThreshold: this.container.config.advanced.similarityThreshold,
		});
		const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
		if (status == null || !status.files.length) return undefined;

		return status.files[0];
	}

	@log()
	async getStatusForFiles(repoPath: string, path: string): Promise<GitStatusFile[] | undefined> {
		const porcelainVersion = (await Git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await Git.status__file(repoPath, path, porcelainVersion, {
			similarityThreshold: this.container.config.advanced.similarityThreshold,
		});
		const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
		if (status == null || !status.files.length) return [];

		return status.files;
	}

	@log()
	async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = (await Git.isAtLeastVersion('2.11')) ? 2 : 1;

		const data = await Git.status(repoPath, porcelainVersion, {
			similarityThreshold: this.container.config.advanced.similarityThreshold,
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
		options?: { filter?: (t: GitTag) => boolean; sort?: boolean | TagSortOptions },
	): Promise<PagedResult<GitTag>> {
		if (repoPath == null) return emptyPagedResult;

		let resultsPromise = this.useCaching ? this._tagsCache.get(repoPath) : undefined;
		if (resultsPromise == null) {
			async function load(this: LocalGitProvider): Promise<PagedResult<GitTag>> {
				try {
					const data = await Git.tag(repoPath!);
					return { values: GitTagParser.parse(data, repoPath!) ?? [] };
				} catch (ex) {
					this._tagsCache.delete(repoPath!);

					return emptyPagedResult;
				}
			}

			resultsPromise = load.call(this);

			if (this.useCaching) {
				this._tagsCache.set(repoPath, resultsPromise);

				queueMicrotask(async () => {
					if (!(await this.container.git.getRepository(repoPath))?.supportsChangeEvents) {
						this._tagsCache.delete(repoPath);
					}
				});
			}
		}

		let result = await resultsPromise;
		if (options?.filter != null) {
			result = {
				...result,
				values: result.values.filter(options.filter),
			};
		}

		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (options?.sort) {
			GitTag.sort(result.values, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return result;
	}

	@log()
	async getTreeEntryForRevision(repoPath: string, path: string, ref: string): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		const data = await Git.ls_tree(repoPath, ref, { fileName: path });
		const trees = GitTreeParser.parse(data);
		return trees?.length ? trees[0] : undefined;
	}

	@log()
	async getTreeForRevision(repoPath: string, ref: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		const data = await Git.ls_tree(repoPath, ref);
		return GitTreeParser.parse(data) ?? [];
	}

	@log()
	getRevisionContent(repoPath: string, path: string, ref: string): Promise<Uint8Array | undefined> {
		return Git.show<Buffer>(repoPath, path, ref, { encoding: 'buffer' });
	}

	@log()
	async getVersionedUri(repoPath: string, fileName: string, ref: string | undefined): Promise<Uri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		if (
			ref == null ||
			ref.length === 0 ||
			(GitRevision.isUncommitted(ref) && !GitRevision.isUncommittedStaged(ref))
		) {
			// Make sure the file exists in the repo
			let data = await Git.ls_files(repoPath, fileName);
			if (data != null) return GitUri.file(fileName);

			// Check if the file exists untracked
			data = await Git.ls_files(repoPath, fileName, { untracked: true });
			if (data != null) return GitUri.file(fileName);

			return undefined;
		}

		if (GitRevision.isUncommittedStaged(ref)) {
			return GitUri.git(fileName, repoPath);
		}

		return GitUri.toRevisionUri(ref, fileName, repoPath);
	}

	@log()
	async getWorkingUri(repoPath: string, uri: Uri) {
		let fileName = GitUri.relativeTo(uri, repoPath);

		let data;
		let ref;
		do {
			data = await Git.ls_files(repoPath, fileName);
			if (data != null) {
				fileName = Strings.splitSingle(data, '\n')[0];
				break;
			}

			// TODO: Add caching
			// Get the most recent commit for this file name
			ref = await Git.log__file_recent(repoPath, fileName, {
				ordering: this.container.config.advanced.commitOrdering,
				similarityThreshold: this.container.config.advanced.similarityThreshold,
			});
			if (ref == null) return undefined;

			// Now check if that commit had any renames
			data = await Git.log__file(repoPath, '.', ref, {
				filters: ['R', 'C', 'D'],
				format: 'simple',
				limit: 1,
				ordering: this.container.config.advanced.commitOrdering,
			});
			if (data == null || data.length === 0) break;

			const [foundRef, foundFile, foundStatus] = GitLogParser.parseSimpleRenamed(data, fileName);
			if (foundStatus === 'D' && foundFile != null) return undefined;
			if (foundRef == null || foundFile == null) break;

			fileName = foundFile;
		} while (true);

		uri = GitUri.resolve(fileName, repoPath);
		return (await fsExists(uri.fsPath)) ? uri : undefined;
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
	async hasRemotes(repoPath: string | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = await this.container.git.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasRemotes();
	}

	@log()
	async hasTrackingBranch(repoPath: string | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = await this.container.git.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasUpstreamBranch();
	}

	@log<LocalGitProvider['isActiveRepoPath']>({
		args: { 1: e => (e != null ? `TextEditor(${Logger.toLoggable(e.document.uri)})` : undefined) },
	})
	async isActiveRepoPath(repoPath: string | undefined, editor?: TextEditor): Promise<boolean> {
		if (repoPath == null) return false;

		editor = editor ?? window.activeTextEditor;
		if (editor == null) return false;

		const doc = await this.container.tracker.getOrAdd(editor.document.uri);
		return repoPath === doc?.uri.repoPath;
	}

	isTrackable(uri: Uri): boolean {
		return this.supportedSchemes.includes(uri.scheme);
	}

	private async isTracked(filePath: string, repoPath?: string, ref?: string): Promise<boolean>;
	private async isTracked(uri: GitUri): Promise<boolean>;
	@log<LocalGitProvider['isTracked']>({ exit: tracked => `returned ${tracked}` /*, singleLine: true }*/ })
	private async isTracked(filePathOrUri: string | GitUri, repoPath?: string, ref?: string): Promise<boolean> {
		let cacheKey: string;
		let relativeFilePath: string;

		if (typeof filePathOrUri === 'string') {
			if (ref === GitRevision.deletedOrMissing) return false;

			cacheKey = ref ? `${ref}:${normalizePath(filePathOrUri)}` : normalizePath(filePathOrUri);
			[relativeFilePath, repoPath] = splitPath(filePathOrUri, repoPath);
		} else {
			if (!this.isTrackable(filePathOrUri)) return false;

			// Always use the ref of the GitUri
			ref = filePathOrUri.sha;
			cacheKey = ref ? `${ref}:${normalizePath(filePathOrUri.fsPath)}` : normalizePath(filePathOrUri.fsPath);
			relativeFilePath = filePathOrUri.fsPath;
			repoPath = filePathOrUri.repoPath;
		}

		if (ref != null) {
			cacheKey = `${ref}:${cacheKey}`;
		}

		let tracked = this._trackedCache.get(cacheKey);
		if (tracked != null) return tracked;

		tracked = this.isTrackedCore(relativeFilePath, repoPath ?? '', ref);
		this._trackedCache.set(cacheKey, tracked);

		tracked = await tracked;
		this._trackedCache.set(cacheKey, tracked);
		return tracked;
	}

	@debug()
	private async isTrackedCore(fileName: string, repoPath: string, ref?: string) {
		if (ref === GitRevision.deletedOrMissing) return false;

		try {
			// Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
			let tracked = Boolean(await Git.ls_files(repoPath, fileName));
			if (!tracked && ref != null && !GitRevision.isUncommitted(ref)) {
				tracked = Boolean(await Git.ls_files(repoPath, fileName, { ref: ref }));
				// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
				if (!tracked) {
					tracked = Boolean(await Git.ls_files(repoPath, fileName, { ref: `${ref}^` }));
				}
			}
			return tracked;
		} catch (ex) {
			Logger.error(ex);
			return false;
		}
	}

	@log()
	async getDiffTool(repoPath?: string): Promise<string | undefined> {
		return (
			(await Git.config__get('diff.guitool', repoPath, { local: true })) ??
			Git.config__get('diff.tool', repoPath, { local: true })
		);
	}

	@log()
	async openDiffTool(
		repoPath: string,
		uri: Uri,
		options?: { ref1?: string; ref2?: string; staged?: boolean; tool?: string },
	): Promise<void> {
		try {
			let tool = options?.tool;
			if (!tool) {
				const cc = Logger.getCorrelationContext();

				tool = this.container.config.advanced.externalDiffTool || (await this.getDiffTool(repoPath));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(cc, `Using tool=${tool}`);
			}

			await Git.difftool(repoPath, uri.fsPath, tool, options);
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
			void Messages.showGenericErrorMessage('Unable to open compare');
		}
	}

	@log()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string): Promise<void> {
		try {
			if (!tool) {
				const cc = Logger.getCorrelationContext();

				tool = this.container.config.advanced.externalDirectoryDiffTool || (await this.getDiffTool(repoPath));
				if (tool == null) throw new Error('No diff tool found');

				Logger.log(cc, `Using tool=${tool}`);
			}

			await Git.difftool__dir_diff(repoPath, tool, ref1, ref2);
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
			void Messages.showGenericErrorMessage('Unable to open directory compare');
		}
	}

	async resolveReference(
		repoPath: string,
		ref: string,
		fileName?: string,
		options?: { timeout?: number },
	): Promise<string>;
	async resolveReference(repoPath: string, ref: string, uri?: Uri, options?: { timeout?: number }): Promise<string>;
	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		fileNameOrUri?: string | Uri,
		options?: { timeout?: number },
	) {
		if (ref == null || ref.length === 0 || ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) {
			return ref;
		}

		if (fileNameOrUri == null) {
			if (GitRevision.isSha(ref) || !GitRevision.isShaLike(ref) || ref.endsWith('^3')) return ref;

			return (await Git.rev_parse__verify(repoPath, ref)) ?? ref;
		}

		const fileName =
			typeof fileNameOrUri === 'string' ? fileNameOrUri : normalizePath(relative(repoPath, fileNameOrUri.fsPath));

		const blob = await Git.rev_parse__verify(repoPath, ref, fileName);
		if (blob == null) return GitRevision.deletedOrMissing;

		let promise: Promise<string | void | undefined> = Git.log__find_object(
			repoPath,
			blob,
			ref,
			this.container.config.advanced.commitOrdering,
			fileName,
		);
		if (options?.timeout != null) {
			promise = Promise.race([promise, Functions.wait(options.timeout)]);
		}

		return (await promise) ?? ref;
	}

	@log()
	validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		return Git.check_ref_format(ref, repoPath);
	}

	@log()
	async validateReference(repoPath: string, ref: string): Promise<boolean> {
		if (ref == null || ref.length === 0) return false;
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return true;

		return (await Git.rev_parse__verify(repoPath, ref)) != null;
	}

	stageFile(repoPath: string, fileName: string): Promise<void>;
	stageFile(repoPath: string, uri: Uri): Promise<void>;
	@log()
	async stageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<void> {
		await Git.add(
			repoPath,
			typeof fileNameOrUri === 'string' ? fileNameOrUri : splitPath(fileNameOrUri.fsPath, repoPath)[0],
		);
	}

	stageDirectory(repoPath: string, directory: string): Promise<void>;
	stageDirectory(repoPath: string, uri: Uri): Promise<void>;
	@log()
	async stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await Git.add(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri.fsPath, repoPath)[0],
		);
	}

	unStageFile(repoPath: string, fileName: string): Promise<void>;
	unStageFile(repoPath: string, uri: Uri): Promise<void>;
	@log()
	async unStageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<void> {
		await Git.reset(
			repoPath,
			typeof fileNameOrUri === 'string' ? fileNameOrUri : splitPath(fileNameOrUri.fsPath, repoPath)[0],
		);
	}

	unStageDirectory(repoPath: string, directory: string): Promise<void>;
	unStageDirectory(repoPath: string, uri: Uri): Promise<void>;
	@log()
	async unStageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<void> {
		await Git.reset(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : splitPath(directoryOrUri.fsPath, repoPath)[0],
		);
	}

	@log()
	async stashApply(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		try {
			await Git.stash__apply(repoPath, stashName, Boolean(options?.deleteAfter));
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
					throw new StashApplyError(
						'Unable to apply stash. Your working tree changes would be overwritten. Please commit or stash your changes before trying again',
						StashApplyErrorReason.WorkingChanges,
						ex,
					);
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

				throw new StashApplyError(
					`Unable to apply stash \u2014 ${msg.trim().replace(/\n+?/g, '; ')}`,
					undefined,
					ex,
				);
			}

			throw new StashApplyError(`Unable to apply stash \u2014 ${String(ex)}`, undefined, ex);
		}
	}

	@log()
	async stashDelete(repoPath: string, stashName: string, ref?: string): Promise<void> {
		await Git.stash__delete(repoPath, stashName, ref);
	}

	@log<LocalGitProvider['stashSave']>({ args: { 2: uris => uris?.length } })
	async stashSave(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean },
	): Promise<void> {
		if (uris == null) return Git.stash__push(repoPath, message, options);

		await this.ensureGitVersion(
			'2.13.2',
			'Stashing individual files',
			' Please retry by stashing everything or install a more recent version of Git and try again.',
		);

		const pathspecs = uris.map(u => `./${splitPath(u.fsPath, repoPath)[0]}`);

		const stdinVersion = '2.30.0';
		const stdin = await Git.isAtLeastVersion(stdinVersion);
		// If we don't support stdin, then error out if we are over the maximum allowed git cli length
		if (!stdin && Arrays.countStringLength(pathspecs) > maxGitCliLength) {
			await this.ensureGitVersion(
				stdinVersion,
				`Stashing so many files (${pathspecs.length}) at once`,
				' Please retry by stashing fewer files or install a more recent version of Git and try again.',
			);
		}

		return Git.stash__push(repoPath, message, {
			...options,
			pathspecs: pathspecs,
			stdin: stdin,
		});
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

	@log()
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const cc = Logger.getCorrelationContext();
		try {
			const gitApi = await this.getScmGitApi();
			return gitApi?.repositories ?? [];
		} catch (ex) {
			Logger.error(ex, cc);
			return [];
		}
	}

	@log()
	async getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const cc = Logger.getCorrelationContext();
		try {
			const gitApi = await this.getScmGitApi();
			if (gitApi?.openRepository != null) {
				return (await gitApi?.openRepository?.(Uri.file(repoPath))) ?? undefined;
			}

			return gitApi?.getRepository(Uri.file(repoPath)) ?? undefined;
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	@log()
	private async openScmRepository(repoPath: string): Promise<BuiltInGitRepository | undefined> {
		const cc = Logger.getCorrelationContext();
		try {
			const gitApi = await this.getScmGitApi();
			return (await gitApi?.openRepository?.(Uri.file(repoPath))) ?? undefined;
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	private async ensureGitVersion(version: string, prefix: string, suffix: string): Promise<void> {
		if (await Git.isAtLeastVersion(version)) return;

		throw new Error(
			`${prefix} requires a newer version of Git (>= ${version}) than is currently installed (${await Git.version()}).${suffix}`,
		);
	}
}
