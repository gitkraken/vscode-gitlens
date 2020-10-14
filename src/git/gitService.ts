'use strict';
import * as fs from 'fs';
import * as paths from 'path';
import {
	ConfigurationChangeEvent,
	Disposable,
	Event,
	EventEmitter,
	Extension,
	extensions,
	ProgressLocation,
	Range,
	TextEditor,
	Uri,
	window,
	WindowState,
	workspace,
	WorkspaceFolder,
	WorkspaceFoldersChangeEvent,
} from 'vscode';
import { API as BuiltInGitApi, Repository as BuiltInGitRepository, GitExtension } from '../@types/git';
import { BranchSorting, configuration, TagSorting } from '../configuration';
import { CommandContext, DocumentSchemes, GlyphChars, setCommandContext } from '../constants';
import { Container } from '../container';
import { LogCorrelationContext, Logger } from '../logger';
import { Messages } from '../messages';
import {
	Arrays,
	debug,
	Functions,
	gate,
	Iterables,
	log,
	Objects,
	Promises,
	Strings,
	TernarySearchTree,
	Versions,
} from '../system';
import { CachedBlame, CachedDiff, CachedLog, GitDocumentState, TrackedDocument } from '../trackers/gitDocumentTracker';
import { vslsUriPrefixRegex } from '../vsls/vsls';
import {
	BranchDateFormatting,
	CommitDateFormatting,
	Git,
	GitAuthor,
	GitBlame,
	GitBlameCommit,
	GitBlameLine,
	GitBlameLines,
	GitBlameParser,
	GitBranch,
	GitBranchParser,
	GitBranchReference,
	GitCommitType,
	GitContributor,
	GitDiff,
	GitDiffFilter,
	GitDiffHunkLine,
	GitDiffParser,
	GitDiffShortStat,
	GitErrors,
	GitFile,
	GitLog,
	GitLogCommit,
	GitLogParser,
	GitReference,
	GitReflog,
	GitRemote,
	GitRemoteParser,
	GitRevision,
	GitStash,
	GitStashParser,
	GitStatus,
	GitStatusFile,
	GitStatusParser,
	GitTag,
	GitTagParser,
	GitTree,
	GitTreeParser,
	PullRequest,
	PullRequestDateFormatting,
	PullRequestState,
	Repository,
	RepositoryChange,
	RepositoryChangeEvent,
	SearchPattern,
} from './git';
import { GitUri } from './gitUri';
import { RemoteProvider, RemoteProviderFactory, RemoteProviders, RemoteProviderWithApi } from './remotes/factory';
import { GitReflogParser, GitShortLogParser } from './parsers/parsers';
import { fsExists, isWindows } from './shell';

const emptyStr = '';
const slash = '/';

const RepoSearchWarnings = {
	doesNotExist: /no such file or directory/i,
};

const doubleQuoteRegex = /"/g;
const driveLetterRegex = /(?<=^\/?)([a-zA-Z])(?=:\/)/;
const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

const emptyPromise: Promise<GitBlame | GitDiff | GitLog | undefined> = Promise.resolve(undefined);
const reflogCommands = ['merge', 'pull'];

const maxDefaultBranchWeight = 100;
const weightedDefaultBranches = new Map<string, number>([
	['master', maxDefaultBranchWeight],
	['main', 15],
	['default', 10],
	['develop', 5],
	['development', 1],
]);

export class GitService implements Disposable {
	private _onDidChangeRepositories = new EventEmitter<void>();
	get onDidChangeRepositories(): Event<void> {
		return this._onDidChangeRepositories.event;
	}

	private readonly _disposable: Disposable;
	private readonly _repositoryTree: TernarySearchTree<Repository>;
	private _repositoriesLoadingPromise: Promise<void> | undefined;
	private _suspended: boolean = false;

	private readonly _branchesCache = new Map<string, GitBranch[]>();
	private readonly _tagsCache = new Map<string, GitTag[]>();
	private readonly _trackedCache = new Map<string, boolean | Promise<boolean>>();
	private readonly _userMapCache = new Map<string, { name?: string; email?: string } | null>();

	constructor() {
		this._repositoryTree = TernarySearchTree.forPaths();

		this._disposable = Disposable.from(
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
		this.onConfigurationChanged(configuration.initializingChangeEvent);

		this._repositoriesLoadingPromise = this.onWorkspaceFoldersChanged();
	}

	dispose() {
		this._repositoryTree.forEach(r => r.dispose());
		this._branchesCache.clear();
		this._tagsCache.clear();
		this._trackedCache.clear();
		this._userMapCache.clear();

		this._disposable.dispose();
	}

	@log()
	static async initialize(): Promise<void> {
		// Try to use the same git as the built-in vscode git extension
		let gitPath;
		const gitApi = await GitService.getBuiltInGitApi();
		if (gitApi != null) {
			gitPath = gitApi.git.path;
		}

		await Git.setOrFindGitPath(gitPath ?? configuration.getAny<string | string[]>('git.path'));
	}

	get readonly() {
		return Container.vsls.readonly;
	}

	get useCaching() {
		return Container.config.advanced.caching.enabled;
	}

	private onAnyRepositoryChanged(repo: Repository, e: RepositoryChangeEvent) {
		if (e.changed(RepositoryChange.Stash, true)) return;

		this._branchesCache.delete(repo.path);
		this._tagsCache.delete(repo.path);
		this._trackedCache.clear();

		if (e.changed(RepositoryChange.Config)) {
			this._userMapCache.delete(repo.path);
		}

		if (e.changed(RepositoryChange.Closed)) {
			// Send a notification that the repositories changed
			setImmediate(async () => {
				await this.updateContext(this._repositoryTree);

				this.fireRepositoriesChanged();
			});
		}
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateSource') ||
			configuration.changed(e, 'defaultDateStyle')
		) {
			BranchDateFormatting.reset();
			CommitDateFormatting.reset();
			PullRequestDateFormatting.reset();
		}
	}

	private onWindowStateChanged(e: WindowState) {
		if (e.focused) {
			this._repositoryTree.forEach(r => r.resume());
		} else {
			this._repositoryTree.forEach(r => r.suspend());
		}

		this._suspended = !e.focused;
	}

	private async onWorkspaceFoldersChanged(e?: WorkspaceFoldersChangeEvent) {
		let initializing = false;
		if (e == null) {
			initializing = true;
			e = {
				added: workspace.workspaceFolders ?? [],
				removed: [],
			};

			Logger.log(`Starting repository search in ${e.added.length} folders`);
		}

		for (const f of e.added) {
			const { scheme } = f.uri;
			if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Vsls) continue;

			if (scheme === DocumentSchemes.Vsls) {
				if (Container.vsls.isMaybeGuest) {
					const guest = await Container.vsls.guest();
					if (guest != null) {
						const repositories = await guest.getRepositoriesInFolder(
							f,
							this.onAnyRepositoryChanged.bind(this),
						);
						for (const r of repositories) {
							this._repositoryTree.set(r.path, r);
						}
					}
				}
			} else {
				// Search for and add all repositories (nested and/or submodules)
				const repositories = await this.repositorySearch(f);
				for (const r of repositories) {
					this._repositoryTree.set(r.path, r);
				}
			}
		}

		for (const f of e.removed) {
			const { fsPath, scheme } = f.uri;
			if (scheme !== DocumentSchemes.File && scheme !== DocumentSchemes.Vsls) continue;

			const repos = this._repositoryTree.findSuperstr(fsPath);
			const reposToDelete =
				repos != null
					? // Since the filtered tree will have keys that are relative to the fsPath, normalize to the full path
					  [...Iterables.map<Repository, [Repository, string]>(repos, r => [r, r.path])]
					: [];

			// const filteredTree = this._repositoryTree.findSuperstr(fsPath);
			// const reposToDelete =
			//     filteredTree != null
			//         ? // Since the filtered tree will have keys that are relative to the fsPath, normalize to the full path
			//           [
			//               ...Iterables.map<[Repository, string], [Repository, string]>(
			//                   filteredTree.entries(),
			//                   ([r, k]) => [r, path.join(fsPath, k)]
			//               )
			//           ]
			//         : [];

			const repo = this._repositoryTree.get(fsPath);
			if (repo != null) {
				reposToDelete.push([repo, fsPath]);
			}

			for (const [r, k] of reposToDelete) {
				this._repositoryTree.delete(k);
				r.dispose();
			}
		}

		await this.updateContext(this._repositoryTree);

		if (!initializing) {
			// Defer the event trigger enough to let everything unwind
			setImmediate(() => this.fireRepositoriesChanged());
		}
	}

	@log<GitService['repositorySearch']>({
		args: false,
		singleLine: true,
		prefix: (context, folder) => `${context.prefix}(${folder.uri.fsPath})`,
		exit: result =>
			`returned ${result.length} repositories${
				result.length !== 0 ? ` (${result.map(r => r.path).join(', ')})` : emptyStr
			}`,
	})
	private async repositorySearch(folder: WorkspaceFolder): Promise<Repository[]> {
		const cc = Logger.getCorrelationContext();
		const { uri } = folder;
		const depth = configuration.get('advanced', 'repositorySearchDepth', uri);

		Logger.log(cc, `searching (depth=${depth})...`);

		const repositories: Repository[] = [];
		const anyRepoChangedFn = this.onAnyRepositoryChanged.bind(this);

		const rootPath = await this.getRepoPathCore(uri.fsPath, true);
		if (rootPath != null) {
			Logger.log(cc, `found root repository in '${rootPath}'`);
			repositories.push(new Repository(folder, rootPath, true, anyRepoChangedFn, this._suspended));
		}

		if (depth <= 0) return repositories;

		// Get any specified excludes -- this is a total hack, but works for some simple cases and something is better than nothing :)
		let excludes = {
			...configuration.getAny<Record<string, boolean>>('files.exclude', uri, {}),
			...configuration.getAny<Record<string, boolean>>('search.exclude', uri, {}),
		};

		const excludedPaths = [
			...Iterables.filterMap(Objects.entries(excludes), ([key, value]) => {
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
			const msg: string = ex?.toString() ?? emptyStr;
			if (RepoSearchWarnings.doesNotExist.test(msg)) {
				Logger.log(cc, `FAILED${msg ? ` Error: ${msg}` : emptyStr}`);
			} else {
				Logger.error(ex, cc, 'FAILED');
			}

			return repositories;
		}

		for (let p of repoPaths) {
			p = paths.dirname(p);
			// If we are the same as the root, skip it
			if (Strings.normalizePath(p) === rootPath) continue;

			Logger.log(cc, `searching in '${p}'...`);

			const rp = await this.getRepoPathCore(p, true);
			if (rp == null) continue;

			Logger.log(cc, `found repository in '${rp}'`);
			repositories.push(new Repository(folder, rp, false, anyRepoChangedFn, this._suspended));
		}

		return repositories;
	}

	@debug({
		args: {
			0: (root: string) => root,
			1: (depth: number) => `${depth}`,
			2: () => false,
			3: () => false,
		},
	})
	private repositorySearchCore(
		root: string,
		depth: number,
		excludes: Record<string, boolean>,
		repositories: string[] = [],
	): Promise<string[]> {
		const cc = Logger.getCorrelationContext();

		return new Promise<string[]>((resolve, reject) => {
			fs.readdir(root, { withFileTypes: true }, async (err, files) => {
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
						repositories.push(paths.resolve(root, f.name));
					} else if (depth >= 0 && excludes[f.name] !== true) {
						try {
							await this.repositorySearchCore(paths.resolve(root, f.name), depth, excludes, repositories);
						} catch (ex) {
							Logger.error(ex, cc, 'FAILED');
						}
					}
				}

				resolve(repositories);
			});
		});
	}

	private async updateContext(repositoryTree: TernarySearchTree<Repository>) {
		const hasRepository = repositoryTree.any();
		await setCommandContext(CommandContext.Enabled, hasRepository);

		let hasRemotes = false;
		let hasConnectedRemotes = false;
		if (hasRepository) {
			for (const repo of repositoryTree.values()) {
				if (!hasConnectedRemotes) {
					hasConnectedRemotes = await repo.hasConnectedRemotes();
				}

				if (!hasRemotes) {
					hasRemotes = hasConnectedRemotes || (await repo.hasRemotes());
				}

				if (hasRemotes && hasConnectedRemotes) break;
			}
		}

		await setCommandContext(CommandContext.HasRemotes, hasRemotes);
		await setCommandContext(CommandContext.HasConnectedRemotes, hasConnectedRemotes);

		// If we have no repositories setup a watcher in case one is initialized
		if (!hasRepository) {
			const watcher = workspace.createFileSystemWatcher('**/.git', false, true, true);
			const disposable = Disposable.from(
				watcher,
				watcher.onDidCreate(async uri => {
					const f = workspace.getWorkspaceFolder(uri);
					if (f == null) return;

					// Search for and add all repositories (nested and/or submodules)
					const repositories = await this.repositorySearch(f);
					if (repositories.length === 0) return;

					disposable.dispose();

					for (const r of repositories) {
						this._repositoryTree.set(r.path, r);
					}

					await this.updateContext(this._repositoryTree);

					// Defer the event trigger enough to let everything unwind
					setImmediate(() => this.fireRepositoriesChanged());
				}, this),
			);
		}
	}

	private fireRepositoriesChanged() {
		this._onDidChangeRepositories.fire();
	}

	@log()
	addRemote(repoPath: string, name: string, url: string) {
		return Git.remote__add(repoPath, name, url);
	}

	@log()
	pruneRemote(repoPath: string, remoteName: string) {
		return Git.remote__prune(repoPath, remoteName);
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
			patch = await Git.diff(uri.repoPath, uri.fsPath, ref1, ref2, {
				similarityThreshold: Container.config.advanced.similarityThreshold,
			});
			void (await Git.apply(uri.repoPath, patch));
		} catch (ex) {
			const msg: string = ex?.toString() ?? emptyStr;
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
		let data = await Git.branch__contains(repoPath, ref, { name: name });
		data = data?.trim();
		return Boolean(data);
	}

	@log()
	async checkout(repoPath: string, ref: string, options: { createBranch?: string } | { fileName?: string } = {}) {
		const cc = Logger.getCorrelationContext();

		try {
			return await Git.checkout(repoPath, ref, options);
		} catch (ex) {
			const msg: string = ex?.toString() ?? emptyStr;
			if (/overwritten by checkout/i.test(msg)) {
				void Messages.showGenericErrorMessage(
					`Unable to checkout '${ref}'. Please commit or stash your changes before switching branches`,
				);
				return undefined;
			}

			Logger.error(ex, cc);
			void void Messages.showGenericErrorMessage(`Unable to checkout '${ref}'`);
			return undefined;
		}
	}

	@log()
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const paths = new Map<string, Uri>(uris.map(u => [Strings.normalizePath(u.fsPath), u]));

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
		options: { all?: boolean; branch?: GitBranchReference; prune?: boolean; remote?: string } = {},
	): Promise<void> {
		const { branch: branchRef, ...opts } = options;
		if (GitReference.isBranch(branchRef)) {
			const repo = await this.getRepository(repoPath);
			const branch = await repo?.getBranch(branchRef?.name);
			if (branch?.tracking == null) return undefined;

			return Git.fetch(repoPath, {
				branch: branch.name,
				remote: branch.getRemoteName()!,
				upstream: branch.getTrackingWithoutRemote()!,
			});
		}

		return Git.fetch(repoPath, opts);
	}

	@gate<GitService['fetchAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
	async fetchAll(repositories?: Repository[], options: { all?: boolean; prune?: boolean } = {}) {
		if (repositories == null) {
			repositories = await this.getOrderedRepositories();
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

	@gate<GitService['pullAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
	async pullAll(repositories?: Repository[], options: { rebase?: boolean } = {}) {
		if (repositories == null) {
			repositories = await this.getOrderedRepositories();
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

	@gate<GitService['pushAll']>(repos => `${repos == null ? '' : repos.map(r => r.id).join(',')}`)
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
	async pushAll(
		repositories?: Repository[],
		options: {
			force?: boolean;
			reference?: GitReference;
			publish?: {
				remote: string;
			};
		} = {},
	) {
		if (repositories == null) {
			repositories = await this.getOrderedRepositories();
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

	@log({
		args: {
			0: (editor: TextEditor) =>
				editor != null ? `TextEditor(${Logger.toLoggable(editor.document.uri)})` : 'undefined',
		},
	})
	async getActiveRepository(editor?: TextEditor): Promise<Repository | undefined> {
		const repoPath = await this.getActiveRepoPath(editor);
		if (repoPath == null) return undefined;

		return this.getRepository(repoPath);
	}

	@log({
		args: {
			0: (editor: TextEditor) =>
				editor != null ? `TextEditor(${Logger.toLoggable(editor.document.uri)})` : 'undefined',
		},
	})
	async getActiveRepoPath(editor?: TextEditor): Promise<string | undefined> {
		editor = editor ?? window.activeTextEditor;

		let repoPath;
		if (editor != null) {
			const doc = await Container.tracker.getOrAdd(editor.document.uri);
			if (doc != null) {
				repoPath = doc.uri.repoPath;
			}
		}

		if (repoPath != null) return repoPath;

		return this.getHighlanderRepoPath();
	}

	@log()
	getHighlanderRepoPath(): string | undefined {
		const entry = this._repositoryTree.highlander();
		if (entry == null) return undefined;

		const [repo] = entry;
		return repo.path;
	}

	@log()
	async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
		const cc = Logger.getCorrelationContext();

		let key = 'blame';
		if (uri.sha != null) {
			key += `:${uri.sha}`;
		}

		const doc = await Container.tracker.getOrAdd(uri);
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

		const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

		try {
			const data = await Git.blame(root, file, uri.sha, {
				args: Container.config.advanced.blame.customArguments,
				ignoreWhitespace: Container.config.blame.ignoreWhitespace,
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

	@log({
		args: {
			1: _contents => '<contents>',
		},
	})
	async getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const cc = Logger.getCorrelationContext();

		const key = `blame:${Strings.sha1(contents)}`;

		const doc = await Container.tracker.getOrAdd(uri);
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

	async getBlameForFileContentsCore(
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

		const [file, root] = Git.splitPath(uri.fsPath, uri.repoPath, false);

		try {
			const data = await Git.blame__contents(root, file, contents, {
				args: Container.config.advanced.blame.customArguments,
				correlationKey: `:${key}`,
				ignoreWhitespace: Container.config.blame.ignoreWhitespace,
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
		editorLine: number, // editor lines are 0-based
		options: { skipCache?: boolean } = {},
	): Promise<GitBlameLine | undefined> {
		if (!options.skipCache && this.useCaching) {
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
				args: Container.config.advanced.blame.customArguments,
				ignoreWhitespace: Container.config.blame.ignoreWhitespace,
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

	@log({
		args: {
			2: _contents => '<contents>',
		},
	})
	async getBlameForLineContents(
		uri: GitUri,
		editorLine: number, // editor lines are 0-based
		contents: string,
		options: { skipCache?: boolean } = {},
	): Promise<GitBlameLine | undefined> {
		if (!options.skipCache && this.useCaching) {
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
				args: Container.config.advanced.blame.customArguments,
				ignoreWhitespace: Container.config.blame.ignoreWhitespace,
				startLine: lineToBlame,
				endLine: lineToBlame,
			});
			const currentUser = await this.getCurrentUser(uri.repoPath!);
			const blame = GitBlameParser.parse(data, uri.repoPath, fileName, currentUser);
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

	@log({
		args: {
			2: _contents => '<contents>',
		},
	})
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
		const blame = await this.getBlameForFileContents(uri, contents);
		if (blame == null) return undefined;

		return this.getBlameForRangeSync(blame, uri, range);
	}

	@log({
		args: {
			0: _blame => '<blame>',
		},
	})
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
	async getBranch(repoPath: string | undefined): Promise<GitBranch | undefined> {
		if (repoPath == null) return undefined;

		let [branch] = await this.getBranches(repoPath, { filter: b => b.current });
		if (branch != null) return branch;

		const data = await Git.rev_parse__currentBranch(repoPath);
		if (data == null) return undefined;

		const [name, tracking] = data[0].split('\n');
		if (GitBranch.isDetached(name)) {
			const committerDate = await Git.log__recent_committerdate(repoPath);

			branch = new GitBranch(
				repoPath,
				name,
				false,
				true,
				committerDate == null ? undefined : new Date(Number(committerDate) * 1000),
				data[1],
				tracking,
			);
		}

		return branch;
	}

	@log({
		args: {
			0: b => b.name,
		},
	})
	async getBranchAheadRange(branch: GitBranch) {
		if (branch.state.ahead > 0) {
			return GitRevision.createRange(branch.tracking, branch.ref);
		}

		if (!branch.tracking) {
			// If we have no tracking branch, try to find a best guess branch to use as the "base"
			const branches = await this.getBranches(branch.repoPath, {
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

				return GitRevision.createRange(weightedBranch!.branch.ref, branch.ref);
			}
		}

		return undefined;
	}

	@log()
	async getBranches(
		repoPath: string | undefined,
		options: {
			filter?: (b: GitBranch) => boolean;
			sort?: boolean | { current?: boolean; orderBy?: BranchSorting };
		} = {},
	): Promise<GitBranch[]> {
		if (repoPath == null) return [];

		let branches = this.useCaching ? this._branchesCache.get(repoPath) : undefined;
		if (branches == null) {
			const data = await Git.for_each_ref__branch(repoPath, { all: true });
			// If we don't get any data, assume the repo doesn't have any commits yet so check if we have a current branch
			if (data == null || data.length === 0) {
				let current;

				const data = await Git.rev_parse__currentBranch(repoPath);
				if (data != null) {
					const committerDate = await Git.log__recent_committerdate(repoPath);

					const [name, tracking] = data[0].split('\n');
					current = new GitBranch(
						repoPath,
						name,
						false,
						true,
						committerDate == null ? undefined : new Date(Number(committerDate) * 1000),
						data[1],
						tracking,
					);
				}

				branches = current != null ? [current] : [];
			} else {
				branches = GitBranchParser.parse(data, repoPath);
			}

			if (this.useCaching) {
				const repo = await this.getRepository(repoPath);
				if (repo?.supportsChangeEvents) {
					this._branchesCache.set(repoPath, branches);
				}
			}
		}

		if (options.filter != null) {
			branches = branches.filter(options.filter);
		}

		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (options.sort) {
			GitBranch.sort(branches, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return branches;
	}

	@log()
	async getBranchesAndOrTags(
		repoPath: string | undefined,
		{
			filter,
			include,
			sort,
			...options
		}: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
			include?: 'all' | 'branches' | 'tags';
			sort?:
				| boolean
				| { branches?: { current?: boolean; orderBy?: BranchSorting }; tags?: { orderBy?: TagSorting } };
		} = {},
	) {
		const [branches, tags] = await Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
			include == null || include === 'all' || include === 'branches'
				? this.getBranches(repoPath, {
						...options,
						filter: filter?.branches,
						sort: typeof sort === 'boolean' ? undefined : sort?.branches,
				  })
				: undefined,
			include == null || include === 'all' || include === 'tags'
				? this.getTags(repoPath, {
						...options,
						filter: filter?.tags,
						sort: typeof sort === 'boolean' ? undefined : sort?.tags,
				  })
				: undefined,
		]);

		if (branches != null && tags != null) {
			return [...branches.filter(b => !b.remote), ...tags, ...branches.filter(b => b.remote)];
		}

		return branches ?? tags;
	}

	@log()
	async getBranchesAndTagsTipsFn(repoPath: string | undefined, currentName?: string) {
		const [branches, tags] = await Promise.all([this.getBranches(repoPath), this.getTags(repoPath)]);

		const branchesAndTagsBySha = Arrays.groupByFilterMap(
			(branches as (GitBranch | GitTag)[]).concat(tags as (GitBranch | GitTag)[]),
			bt => bt.sha,
			bt => {
				if (currentName) {
					if (bt.name === currentName) return undefined;
					if (bt.refType === 'branch' && bt.getNameWithoutRemote() === currentName) {
						return { name: bt.name, compactName: bt.getRemoteName() };
					}
				}

				return { name: bt.name };
			},
		);

		return (sha: string, compact?: boolean): string | undefined => {
			const branchesAndTags = branchesAndTagsBySha.get(sha);
			if (branchesAndTags == null || branchesAndTags.length === 0) return undefined;

			if (!compact) return branchesAndTags.map(bt => bt.name).join(', ');

			if (branchesAndTags.length > 1) {
				return [branchesAndTags[0], { name: GlyphChars.Ellipsis }]
					.map(bt => bt.compactName ?? bt.name)
					.join(', ');
			}

			return branchesAndTags.map(bt => bt.compactName ?? bt.name).join(', ');
		};
	}

	@log()
	async getChangedFilesCount(repoPath: string, ref?: string): Promise<GitDiffShortStat | undefined> {
		const data = await Git.diff__shortstat(repoPath, ref);
		return GitDiffParser.parseShortStat(data);
	}

	@log()
	async getCommit(repoPath: string, ref: string): Promise<GitLogCommit | undefined> {
		const log = await this.getLog(repoPath, { limit: 2, ref: ref });
		if (log == null) return undefined;

		return log.commits.get(ref) ?? Iterables.first(log.commits.values());
	}

	@log()
	async getCommitBranches(repoPath: string, ref: string, options?: { remotes?: boolean }): Promise<string[]> {
		const data = await Git.branch__contains(repoPath, ref, options);
		if (!data) return [];

		return data
			.split('\n')
			.map(b => b.substr(2).trim())
			.filter(<T>(i?: T): i is T => Boolean(i));
	}

	@log()
	getAheadBehindCommitCount(
		repoPath: string,
		refs: string[],
	): Promise<{ ahead: number; behind: number } | undefined> {
		return Git.rev_list(repoPath, refs);
	}

	@log()
	async getCommitForFile(
		repoPath: string | undefined,
		fileName: string,
		options: { ref?: string; firstIfNotFound?: boolean; reverse?: boolean } = {},
	): Promise<GitLogCommit | undefined> {
		const log = await this.getLogForFile(repoPath, fileName, {
			limit: 2,
			ref: options.ref,
			reverse: options.reverse,
		});
		if (log == null) return undefined;

		const commit = options.ref ? log.commits.get(options.ref) : undefined;
		if (commit == null && !options.firstIfNotFound && options.ref) {
			// If the ref isn't a valid sha we will never find it, so let it fall through so we return the first
			if (GitRevision.isSha(options.ref) || GitRevision.isUncommitted(options.ref)) return undefined;
		}

		return commit ?? Iterables.first(log.commits.values());
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string, fileName: string): Promise<string | undefined> {
		const data = await Git.log__file(repoPath, fileName, '@{push}..', {
			format: 'refs',
			renames: true,
		});
		if (data == null || data.length === 0) return undefined;

		return GitLogParser.parseLastRefOnly(data);
	}

	@log()
	getConfig(key: string, repoPath?: string): Promise<string | undefined> {
		return Git.config__get(key, repoPath);
	}

	@log()
	async getContributors(repoPath: string): Promise<GitContributor[]> {
		if (repoPath == null) return [];

		const data = await Git.shortlog(repoPath);
		const shortlog = GitShortLogParser.parse(data, repoPath);
		if (shortlog == null) return [];

		// Mark the current user
		const currentUser = await Container.git.getCurrentUser(repoPath);
		if (currentUser != null) {
			const index = shortlog.contributors.findIndex(
				c => currentUser.email === c.email && currentUser.name === c.name,
			);
			if (index !== -1) {
				const c = shortlog.contributors[index];
				shortlog.contributors.splice(index, 1, new GitContributor(c.repoPath, c.name, c.email, c.count, true));
			}
		}

		return shortlog.contributors;
	}

	@log()
	async getCurrentUser(repoPath: string) {
		let user = this._userMapCache.get(repoPath);
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		const data = await Git.config__get_regex('user.(name|email)', repoPath, { local: true });
		if (!data) {
			// If we found no user data, mark it so we won't bother trying again
			this._userMapCache.set(repoPath, null);
			return undefined;
		}

		user = { name: undefined, email: undefined };

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

		const author = `${user.name} <${user.email}>`;
		// Check if there is a mailmap for the current user
		const mappedAuthor = await Git.check_mailmap(repoPath, author);
		if (mappedAuthor != null && mappedAuthor.length !== 0 && author !== mappedAuthor) {
			match = mappedAuthorRegex.exec(mappedAuthor);
			if (match != null) {
				[, user.name, user.email] = match;
			}
		}

		this._userMapCache.set(repoPath, user);
		return user;
	}

	@log()
	async getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiff | undefined> {
		const cc = Logger.getCorrelationContext();

		let key = 'diff';
		if (ref1 != null) {
			key += `:${ref1}`;
		}
		if (ref2 != null) {
			key += `:${ref2}`;
		}

		const doc = await Container.tracker.getOrAdd(uri);
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
			originalFileName,
			{ encoding: GitService.getEncoding(uri) },
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
		originalFileName: string | undefined,
		options: { encoding?: string },
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitDiff | undefined> {
		const [file, root] = Git.splitPath(fileName, repoPath, false);

		try {
			// let data;
			// if (ref2 == null && ref1 != null && !GitRevision.isUncommittedStaged(ref1)) {
			// 	data = await Git.show__diff(root, file, ref1, originalFileName, {
			// 		similarityThreshold: Container.config.advanced.similarityThreshold,
			// 	});
			// } else {
			const data = await Git.diff(root, file, ref1, ref2, {
				...options,
				filters: ['M'],
				similarityThreshold: Container.config.advanced.similarityThreshold,
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

	@log({
		args: {
			1: _contents => '<contents>',
		},
	})
	async getDiffForFileContents(
		uri: GitUri,
		ref: string,
		contents: string,
		originalFileName?: string,
	): Promise<GitDiff | undefined> {
		const cc = Logger.getCorrelationContext();

		const key = `diff:${Strings.sha1(contents)}`;

		const doc = await Container.tracker.getOrAdd(uri);
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
			originalFileName,
			{ encoding: GitService.getEncoding(uri) },
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

	async getDiffForFileContentsCore(
		repoPath: string | undefined,
		fileName: string,
		ref: string,
		contents: string,
		originalFileName: string | undefined,
		options: { encoding?: string },
		document: TrackedDocument<GitDocumentState>,
		key: string,
		cc: LogCorrelationContext | undefined,
	): Promise<GitDiff | undefined> {
		const [file, root] = Git.splitPath(fileName, repoPath, false);

		try {
			const data = await Git.diff__contents(root, file, ref, contents, {
				...options,
				filters: ['M'],
				similarityThreshold: Container.config.advanced.similarityThreshold,
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
		editorLine: number, // editor lines are 0-based
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiffHunkLine | undefined> {
		try {
			const diff = await this.getDiffForFile(uri, ref1, ref2, originalFileName);
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
		options: { filters?: GitDiffFilter[]; similarityThreshold?: number } = {},
	): Promise<GitFile[] | undefined> {
		try {
			const data = await Git.diff__name_status(repoPath, ref1, ref2, {
				similarityThreshold: Container.config.advanced.similarityThreshold,
				...options,
			});
			const files = GitDiffParser.parseNameStatus(data, repoPath);
			return files == null || files.length === 0 ? undefined : files;
		} catch (ex) {
			return undefined;
		}
	}

	@log()
	async getFileStatusForCommit(repoPath: string, fileName: string, ref: string): Promise<GitFile | undefined> {
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return undefined;

		const data = await Git.show__name_status(repoPath, fileName, ref);
		if (!data) return undefined;

		const files = GitDiffParser.parseNameStatus(data, repoPath);
		if (files == null || files.length === 0) return undefined;

		return files[0];
	}

	@log()
	async getLog(
		repoPath: string,
		{
			ref,
			...options
		}: {
			authors?: string[];
			limit?: number;
			merges?: boolean;
			ref?: string;
			reverse?: boolean;
			since?: string;
		} = {},
	): Promise<GitLog | undefined> {
		const limit = options.limit ?? Container.config.advanced.maxListItems ?? 0;

		try {
			const data = await Git.log(repoPath, ref, {
				authors: options.authors,
				limit: limit,
				merges: options.merges == null ? true : options.merges,
				reverse: options.reverse,
				similarityThreshold: Container.config.advanced.similarityThreshold,
				since: options.since,
			});
			const log = GitLogParser.parse(
				data,
				GitCommitType.Log,
				repoPath,
				undefined,
				ref,
				await this.getCurrentUser(repoPath),
				limit,
				options.reverse!,
				undefined,
			);

			if (log != null) {
				const opts = { ...options, ref: ref };
				log.query = (limit: number | undefined) => this.getLog(repoPath, { ...opts, limit: limit });
				if (log.hasMore) {
					log.more = this.getLogMoreFn(log, opts);
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
		{
			ref,
			...options
		}: {
			authors?: string[];
			limit?: number;
			merges?: boolean;
			ref?: string;
			reverse?: boolean;
			since?: string;
		} = {},
	): Promise<Set<string> | undefined> {
		const limit = options.limit ?? Container.config.advanced.maxListItems ?? 0;

		try {
			const data = await Git.log(repoPath, ref, {
				authors: options.authors,
				format: 'refs',
				limit: limit,
				merges: options.merges == null ? true : options.merges,
				reverse: options.reverse,
				similarityThreshold: Container.config.advanced.similarityThreshold,
				since: options.since,
			});
			const commits = GitLogParser.parseRefsOnly(data);
			return new Set(commits);
		} catch (ex) {
			return undefined;
		}
	}

	private getLogMoreFn(
		log: GitLog,
		options: { authors?: string[]; limit?: number; merges?: boolean; ref?: string; reverse?: boolean },
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && Iterables.some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? Container.config.advanced.maxSearchItems ?? 0;

			// If the log is for a range, then just get everything prior + more
			if (GitRevision.isRange(log.sha)) {
				const moreLog = await this.getLog(log.repoPath, {
					...options,
					limit: moreLimit === 0 ? 0 : (options.limit ?? 0) + moreLimit,
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
		options: { limit?: number; skip?: number } = {},
	): Promise<GitLog | undefined> {
		search = { matchAll: false, matchCase: false, matchRegex: true, ...search };

		try {
			const limit = options.limit ?? Container.config.advanced.maxSearchItems ?? 0;
			const similarityThreshold = Container.config.advanced.similarityThreshold;

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
								searchArgs.add(`--grep=${value.replace(doubleQuoteRegex, '\\b')}`);
							}

							break;

						case 'author:':
							searchArgs.add('-m');
							for (const value of values) {
								searchArgs.add(`--author=${value.replace(doubleQuoteRegex, '\\b')}`);
							}

							break;

						case 'change:':
							for (const value of values) {
								searchArgs.add(`-G${value}`);
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

			const data = await Git.log__search(repoPath, args, { ...options, limit: limit, useShow: useShow });
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
		options: { limit?: number },
	): (limit: number | undefined) => Promise<GitLog> {
		return async (limit: number | undefined) => {
			limit = limit ?? Container.config.advanced.maxSearchItems ?? 0;

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
		options: {
			all?: boolean;
			limit?: number;
			range?: Range;
			ref?: string;
			renames?: boolean;
			reverse?: boolean;
			since?: string;
			skip?: number;
		} = {},
	): Promise<GitLog | undefined> {
		if (repoPath != null && repoPath === Strings.normalizePath(fileName)) {
			throw new Error(`File name cannot match the repository path; fileName=${fileName}`);
		}

		const cc = Logger.getCorrelationContext();

		options = { reverse: false, ...options };

		if (options.renames == null) {
			options.renames = Container.config.advanced.fileHistoryFollowsRenames;
		}

		let key = 'log';
		if (options.ref != null) {
			key += `:${options.ref}`;
		}

		if (options.all == null) {
			options.all = Container.config.advanced.fileHistoryShowAllBranches;
		}
		if (options.all) {
			key += ':all';
		}

		options.limit = options.limit == null ? Container.config.advanced.maxListItems || 0 : options.limit;
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

		const doc = await Container.tracker.getOrAdd(GitUri.fromFile(fileName, repoPath!, options.ref));
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
						`log${options.renames ? ':follow' : emptyStr}${options.reverse ? ':reverse' : emptyStr}`,
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
											if (ref !== options.ref) return undefined;
											skip = false;
										}

										i++;
										if (options.limit != null && i > options.limit) {
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
			limit?: number;
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
		if (!(await this.isTracked(fileName, repoPath, { ref: ref }))) {
			Logger.log(cc, `Skipping log; '${fileName}' is not tracked`);
			return emptyPromise as Promise<GitLog>;
		}

		const [file, root] = Git.splitPath(fileName, repoPath, false);

		try {
			if (range != null && range.start.line > range.end.line) {
				range = new Range(range.end, range.start);
			}

			const data = await Git.log__file(root, file, ref, {
				...options,
				startLine: range == null ? undefined : range.start.line + 1,
				endLine: range == null ? undefined : range.end.line + 1,
			});
			const log = GitLogParser.parse(
				data,
				GitCommitType.LogFile,
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
		options: { all?: boolean; limit?: number; range?: Range; ref?: string; renames?: boolean; reverse?: boolean },
	): (limit: number | { until: string } | undefined) => Promise<GitLog> {
		return async (limit: number | { until: string } | undefined) => {
			const moreUntil = limit != null && typeof limit === 'object' ? limit.until : undefined;
			let moreLimit = typeof limit === 'number' ? limit : undefined;

			if (moreUntil && Iterables.some(log.commits.values(), c => c.ref === moreUntil)) {
				return log;
			}

			moreLimit = moreLimit ?? Container.config.advanced.maxSearchItems ?? 0;

			const ref = Iterables.last(log.commits.values())?.ref;
			const moreLog = await this.getLogForFile(log.repoPath, fileName, {
				...options,
				limit: moreUntil == null ? moreLimit : 0,
				ref: options.all ? undefined : moreUntil == null ? `${ref}^` : `${moreUntil}^..${ref}^`,
				skip: options.all ? log.count : undefined,
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
				limit: moreUntil == null ? (log.limit ?? 0) + moreLimit : undefined,
				hasMore: moreUntil == null ? moreLog.hasMore : true,
				query: (limit: number | undefined) =>
					this.getLogForFile(log.repoPath, fileName, { ...options, limit: limit }),
			};
			mergedLog.more = this.getLogForFileMoreFn(mergedLog, fileName, options);

			return mergedLog;
		};
	}

	@log()
	async getMergeBase(repoPath: string, ref1: string, ref2: string, options: { forkPoint?: boolean } = {}) {
		const cc = Logger.getCorrelationContext();

		try {
			const data = await Git.merge_base(repoPath, ref1, ref2, options);
			if (data == null) return undefined;

			return data.split('\n')[0];
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
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
			limit: skip + 1,
			// startLine: editorLine != null ? editorLine + 1 : undefined,
			reverse: true,
			format: 'simple',
		});
		if (data == null || data.length === 0) return undefined;

		const [nextRef, file, status] = GitLogParser.parseSimple(data, skip);
		// If the file was deleted, check for a possible rename
		if (status === 'D') {
			data = await Git.log__file(repoPath, '.', nextRef, {
				filters: ['R', 'C'],
				limit: 1,
				// startLine: editorLine != null ? editorLine + 1 : undefined
				format: 'simple',
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
				uri = GitUri.resolveToUri(fileName, repoPath);
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
			uri = GitUri.resolveToUri(fileName, repoPath);
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
				limit: skip + 2,
				firstParent: firstParent,
				format: 'simple',
				startLine: editorLine != null ? editorLine + 1 : undefined,
			});
		} catch (ex) {
			const msg: string = ex?.toString() ?? emptyStr;
			// If the line count is invalid just fallback to the most recent commit
			if ((ref == null || GitRevision.isUncommittedStaged(ref)) && GitErrors.invalidLineCount.test(msg)) {
				if (ref == null) {
					const status = await this.getStatusForFile(repoPath, fileName);
					if (status?.indexStatus != null) {
						return GitUri.fromFile(fileName, repoPath, GitRevision.uncommittedStaged);
					}
				}

				ref = await Git.log__file_recent(repoPath, fileName);
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

	async getPullRequestForBranch(
		branch: string,
		remote: GitRemote,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	async getPullRequestForBranch(
		branch: string,
		provider: RemoteProviderWithApi,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate()
	@debug<GitService['getPullRequestForBranch']>({
		args: {
			1: (remoteOrProvider: GitRemote | RemoteProviderWithApi) => remoteOrProvider.name,
		},
	})
	async getPullRequestForBranch(
		branch: string,
		remoteOrProvider: GitRemote | RemoteProviderWithApi,
		{
			timeout,
			...options
		}: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number } = {},
	): Promise<PullRequest | undefined> {
		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasApi()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let promiseOrPR = provider.getPullRequestForBranch(branch, options);
		if (promiseOrPR == null || !Promises.is(promiseOrPR)) {
			return promiseOrPR;
		}

		if (timeout != null && timeout > 0) {
			promiseOrPR = Promises.cancellable(promiseOrPR, timeout);
		}

		try {
			return await promiseOrPR;
		} catch (ex) {
			if (ex instanceof Promises.CancellationError) {
				throw ex;
			}

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
		provider: RemoteProviderWithApi,
		options?: { timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate()
	@debug({
		args: {
			1: (remoteOrProvider: GitRemote | RemoteProviderWithApi) => remoteOrProvider.name,
		},
	})
	async getPullRequestForCommit(
		ref: string,
		remoteOrProvider: GitRemote | RemoteProviderWithApi,
		{ timeout }: { timeout?: number } = {},
	): Promise<PullRequest | undefined> {
		if (GitRevision.isUncommitted(ref)) return undefined;

		let provider;
		if (GitRemote.is(remoteOrProvider)) {
			({ provider } = remoteOrProvider);
			if (!provider?.hasApi()) return undefined;
		} else {
			provider = remoteOrProvider;
		}

		let promiseOrPR = provider.getPullRequestForCommit(ref);
		if (promiseOrPR == null || !Promises.is(promiseOrPR)) {
			return promiseOrPR;
		}

		if (timeout != null && timeout > 0) {
			promiseOrPR = Promises.cancellable(promiseOrPR, timeout);
		}

		try {
			return await promiseOrPR;
		} catch (ex) {
			if (ex instanceof Promises.CancellationError) {
				throw ex;
			}

			return undefined;
		}
	}

	@log()
	async getIncomingActivity(
		repoPath: string,
		{ limit, ...options }: { all?: boolean; branch?: string; limit?: number; skip?: number } = {},
	): Promise<GitReflog | undefined> {
		const cc = Logger.getCorrelationContext();

		limit = limit ?? Container.config.advanced.maxListItems ?? 0;
		try {
			// Pass a much larger limit to reflog, because we aggregate the data and we won't know how many lines we'll need
			const data = await Git.reflog(repoPath, { ...options, limit: limit * 100 });
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
		options: { all?: boolean; branch?: string; limit?: number; skip?: number },
	): (limit: number) => Promise<GitReflog> {
		return async (limit: number | undefined) => {
			limit = limit ?? Container.config.advanced.maxSearchItems ?? 0;

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

	async getRemoteWithApiProvider(
		repoPath: string | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RemoteProviderWithApi> | undefined>;
	async getRemoteWithApiProvider(
		remotes: GitRemote[],
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RemoteProviderWithApi> | undefined>;
	@log({ args: { 0: () => false } })
	async getRemoteWithApiProvider(
		remotesOrRepoPath: GitRemote[] | string | undefined,
		{ includeDisconnected }: { includeDisconnected?: boolean } = {},
	): Promise<GitRemote<RemoteProviderWithApi> | undefined> {
		if (remotesOrRepoPath == null) return undefined;

		const remotes = (typeof remotesOrRepoPath === 'string'
			? await this.getRemotes(remotesOrRepoPath)
			: remotesOrRepoPath
		).filter(r => r.provider != null);

		const remote =
			remotes.length === 1 ? remotes[0] : remotes.find(r => r.default) ?? remotes.find(r => r.name === 'origin');
		if (!remote?.provider?.hasApi()) return undefined;

		const { provider } = remote;
		if (!includeDisconnected) {
			const connected = provider.maybeConnected ?? (await provider.isConnected());
			if (!connected) return undefined;
		}

		return remote as GitRemote<RemoteProviderWithApi>;
	}

	@log()
	async getRemotes(
		repoPath: string | undefined,
		options: { sort?: boolean } = {},
	): Promise<GitRemote<RemoteProvider>[]> {
		if (repoPath == null) return [];

		const repository = await this.getRepository(repoPath);
		const remotes = await (repository != null
			? repository.getRemotes({ sort: options.sort })
			: this.getRemotesCore(repoPath, undefined, { sort: options.sort }));

		return remotes.filter(r => r.provider != null) as GitRemote<RemoteProvider>[];
	}

	async getRemotesCore(
		repoPath: string | undefined,
		providers?: RemoteProviders,
		options: { sort?: boolean } = {},
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		providers = providers ?? RemoteProviderFactory.loadProviders(configuration.get('remotes', null));

		try {
			const data = await Git.remote(repoPath);
			const remotes = GitRemoteParser.parse(data, repoPath, RemoteProviderFactory.factory(providers));
			if (remotes == null) return [];

			if (options.sort) {
				GitRemote.sort(remotes);
			}

			return remotes;
		} catch (ex) {
			Logger.error(ex);
			return [];
		}
	}

	async getRepoPath(filePath: string, options?: { ref?: string }): Promise<string | undefined>;
	async getRepoPath(uri: Uri | undefined, options?: { ref?: string }): Promise<string | undefined>;
	@log<GitService['getRepoPath']>({
		exit: path => `returned ${path}`,
	})
	async getRepoPath(
		filePathOrUri: string | Uri | undefined,
		options: { ref?: string } = {},
	): Promise<string | undefined> {
		if (filePathOrUri == null) return this.getHighlanderRepoPath();
		if (GitUri.is(filePathOrUri)) return filePathOrUri.repoPath;

		const cc = Logger.getCorrelationContext();

		// Don't save the tracking info to the cache, because we could be looking in the wrong place (e.g. looking in the root when the file is in a submodule)
		let repo = await this.getRepository(filePathOrUri, { ...options, skipCacheUpdate: true });
		if (repo != null) return repo.path;

		const rp = await this.getRepoPathCore(
			typeof filePathOrUri === 'string' ? filePathOrUri : filePathOrUri.fsPath,
			false,
		);
		if (rp == null) return undefined;

		// Recheck this._repositoryTree.get(rp) to make sure we haven't already tried adding this due to awaits
		if (this._repositoryTree.get(rp) != null) return rp;

		const isVslsScheme =
			typeof filePathOrUri === 'string' ? undefined : filePathOrUri.scheme === DocumentSchemes.Vsls;

		// If this new repo is inside one of our known roots and we we don't already know about, add it
		const root = this.findRepositoryForPath(this._repositoryTree, rp, isVslsScheme);

		let folder;
		if (root != null) {
			// Not sure why I added this for vsls (I can't see a reason for it anymore), but if it is added it will break submodules
			// rp = root.path;
			folder = root.folder;
		} else {
			folder = workspace.getWorkspaceFolder(GitUri.file(rp, isVslsScheme));
			if (folder == null) {
				const parts = rp.split(slash);
				folder = {
					uri: GitUri.file(rp, isVslsScheme),
					name: parts[parts.length - 1],
					index: this._repositoryTree.count(),
				};
			}
		}

		Logger.log(cc, `Repository found in '${rp}'`);
		repo = new Repository(folder, rp, false, this.onAnyRepositoryChanged.bind(this), this._suspended);
		this._repositoryTree.set(rp, repo);

		// Send a notification that the repositories changed
		setImmediate(async () => {
			await this.updateContext(this._repositoryTree);

			this.fireRepositoriesChanged();
		});

		return rp;
	}

	@debug()
	private async getRepoPathCore(filePath: string, isDirectory: boolean): Promise<string | undefined> {
		const cc = Logger.getCorrelationContext();

		try {
			const path = isDirectory ? filePath : paths.dirname(filePath);

			let repoPath = await Git.rev_parse__show_toplevel(path);
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
							const networkPath = await new Promise<string>(resolve =>
								fs.realpath.native(`${letter}:`, { encoding: 'utf8' }, (err, resolvedPath) =>
									resolve(err != null ? undefined : resolvedPath),
								),
							);
							if (networkPath != null) {
								return Strings.normalizePath(
									repoUri.fsPath.replace(
										networkPath,
										`${letter.toLowerCase()}:${networkPath.endsWith('\\') ? '\\' : ''}`,
									),
								);
							}
						} catch {}
					}

					return Strings.normalizePath(pathUri.fsPath);
				}

				return repoPath;
			}

			// If we are not on Windows (symlinks don't seem to have the same issue on Windows), check if we are a symlink and if so, use the symlink path (not its resolved path)
			// This is because VS Code will provide document Uris using the symlinked path
			return await new Promise<string>(resolve => {
				fs.realpath(path, { encoding: 'utf8' }, (err, resolvedPath) => {
					if (err != null) {
						Logger.debug(cc, `fs.realpath failed; repoPath=${repoPath}`);
						resolve(repoPath);
						return;
					}

					if (path.toLowerCase() === resolvedPath.toLowerCase()) {
						Logger.debug(cc, `No symlink detected; repoPath=${repoPath}`);
						resolve(repoPath);
						return;
					}

					const linkPath = Strings.normalizePath(resolvedPath, { stripTrailingSlash: true });
					repoPath = repoPath!.replace(linkPath, path);
					Logger.debug(
						cc,
						`Symlink detected; repoPath=${repoPath}, path=${path}, resolvedPath=${resolvedPath}`,
					);
					resolve(repoPath);
				});
			});
		} catch (ex) {
			Logger.error(ex, cc);
			return undefined;
		}
	}

	@log()
	async getRepoPathOrActive(uri: Uri | undefined, editor: TextEditor | undefined) {
		const repoPath = await this.getRepoPath(uri);
		if (repoPath) return repoPath;

		return this.getActiveRepoPath(editor);
	}

	@log()
	async getRepositories(predicate?: (repo: Repository) => boolean): Promise<Iterable<Repository>> {
		const repositoryTree = await this.getRepositoryTree();

		const values = repositoryTree.values();
		return predicate != null ? Iterables.filter(values, predicate) : values;
	}

	@log()
	async getOrderedRepositories(): Promise<Repository[]> {
		const repositories = [...(await this.getRepositories())];
		if (repositories.length === 0) return repositories;

		return Repository.sort(repositories.filter(r => !r.closed));
	}

	private async getRepositoryTree(): Promise<TernarySearchTree<Repository>> {
		if (this._repositoriesLoadingPromise != null) {
			await this._repositoriesLoadingPromise;
			this._repositoriesLoadingPromise = undefined;
		}

		return this._repositoryTree;
	}

	async getRepository(
		repoPath: string,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<Repository | undefined>;
	async getRepository(
		uri: Uri,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<Repository | undefined>;
	async getRepository(
		repoPathOrUri: string | Uri,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<Repository | undefined>;
	@log<GitService['getRepository']>({
		exit: repo => `returned ${repo != null ? `${repo.path}` : 'undefined'}`,
	})
	async getRepository(
		repoPathOrUri: string | Uri,
		options: { ref?: string; skipCacheUpdate?: boolean } = {},
	): Promise<Repository | undefined> {
		const repositoryTree = await this.getRepositoryTree();

		let isVslsScheme;

		let path: string;
		if (typeof repoPathOrUri === 'string') {
			const repo = repositoryTree.get(repoPathOrUri);
			if (repo != null) return repo;

			path = repoPathOrUri;
			isVslsScheme = undefined;
		} else {
			if (GitUri.is(repoPathOrUri)) {
				if (repoPathOrUri.repoPath) {
					const repo = repositoryTree.get(repoPathOrUri.repoPath);
					if (repo != null) return repo;
				}

				path = repoPathOrUri.fsPath;
			} else {
				path = repoPathOrUri.fsPath;
			}

			isVslsScheme = repoPathOrUri.scheme === DocumentSchemes.Vsls;
		}

		const repo = this.findRepositoryForPath(repositoryTree, path, isVslsScheme);
		if (repo == null) return undefined;

		// Make sure the file is tracked in this repo before returning -- it could be from a submodule
		if (!(await this.isTracked(path, repo.path, options))) return undefined;
		return repo;
	}

	private findRepositoryForPath(
		repositoryTree: TernarySearchTree<Repository>,
		path: string,
		isVslsScheme: boolean | undefined,
	): Repository | undefined {
		let repo = repositoryTree.findSubstr(path);
		// If we can't find the repo and we are a guest, check if we are a "root" workspace
		if (repo == null && isVslsScheme !== false && Container.vsls.isMaybeGuest) {
			if (!vslsUriPrefixRegex.test(path)) {
				path = Strings.normalizePath(path);
				const vslsPath = `/~0${path.startsWith(slash) ? path : `/${path}`}`;
				repo = repositoryTree.findSubstr(vslsPath);
			}
		}
		return repo;
	}

	async getLocalInfoFromRemoteUri(
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		for (const repo of await this.getRepositories()) {
			for (const remote of await repo.getRemotes()) {
				const local = await remote?.provider?.getLocalInfoFromRemoteUri(repo, uri, options);
				if (local != null) return local;
			}
		}

		return undefined;
	}

	async getRepositoryCount(): Promise<number> {
		const repositoryTree = await this.getRepositoryTree();
		return repositoryTree.count();
	}

	@log()
	async getStash(repoPath: string | undefined): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		const data = await Git.stash__list(repoPath, {
			similarityThreshold: Container.config.advanced.similarityThreshold,
		});
		const stash = GitStashParser.parse(data, repoPath);
		return stash;
	}

	@log()
	async getStatusForFile(repoPath: string, fileName: string): Promise<GitStatusFile | undefined> {
		const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

		const data = await Git.status__file(repoPath, fileName, porcelainVersion, {
			similarityThreshold: Container.config.advanced.similarityThreshold,
		});
		const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
		if (status == null || !status.files.length) return undefined;

		return status.files[0];
	}

	@log()
	async getStatusForRepo(repoPath: string | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const porcelainVersion = Git.validateVersion(2, 11) ? 2 : 1;

		const data = await Git.status(repoPath, porcelainVersion, {
			similarityThreshold: Container.config.advanced.similarityThreshold,
		});
		const status = GitStatusParser.parse(data, repoPath, porcelainVersion);
		return status;
	}

	@log()
	async getTags(
		repoPath: string | undefined,
		options: { filter?: (t: GitTag) => boolean; sort?: boolean | { orderBy?: TagSorting } } = {},
	): Promise<GitTag[]> {
		if (repoPath == null) return [];

		let tags = this.useCaching ? this._tagsCache.get(repoPath) : undefined;
		if (tags == null) {
			const data = await Git.tag(repoPath);
			tags = GitTagParser.parse(data, repoPath) ?? [];

			const repo = await this.getRepository(repoPath);
			if (repo?.supportsChangeEvents) {
				this._tagsCache.set(repoPath, tags);
			}
		}

		if (options.filter != null) {
			tags = tags.filter(options.filter);
		}

		// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (options.sort) {
			GitTag.sort(tags, typeof options.sort === 'boolean' ? undefined : options.sort);
		}

		return tags;
	}

	@log()
	async getTreeFileForRevision(repoPath: string, fileName: string, ref: string): Promise<GitTree | undefined> {
		if (repoPath == null || fileName == null || fileName.length === 0) return undefined;

		const data = await Git.ls_tree(repoPath, ref, { fileName: fileName });
		const trees = GitTreeParser.parse(data);
		return trees?.length ? trees[0] : undefined;
	}

	@log()
	async getTreeForRevision(repoPath: string, ref: string): Promise<GitTree[]> {
		if (repoPath == null) return [];

		const data = await Git.ls_tree(repoPath, ref);
		return GitTreeParser.parse(data) ?? [];
	}

	@log()
	getVersionedFileBuffer(repoPath: string, fileName: string, ref: string) {
		return Git.show<Buffer>(repoPath, fileName, ref, { encoding: 'buffer' });
	}

	@log()
	async getVersionedUri(
		repoPath: string | undefined,
		fileName: string,
		ref: string | undefined,
	): Promise<Uri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		if (
			ref == null ||
			ref.length === 0 ||
			(GitRevision.isUncommitted(ref) && !GitRevision.isUncommittedStaged(ref))
		) {
			// Make sure the file exists in the repo
			let data = await Git.ls_files(repoPath!, fileName);
			if (data != null) return GitUri.file(fileName);

			// Check if the file exists untracked
			data = await Git.ls_files(repoPath!, fileName, { untracked: true });
			if (data != null) return GitUri.file(fileName);

			return undefined;
		}

		if (GitRevision.isUncommittedStaged(ref)) {
			return GitUri.git(fileName, repoPath);
		}

		return GitUri.toRevisionUri(ref, fileName, repoPath!);
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
				similarityThreshold: Container.config.advanced.similarityThreshold,
			});
			if (ref == null) return undefined;

			// Now check if that commit had any renames
			data = await Git.log__file(repoPath, '.', ref, {
				filters: ['R', 'C', 'D'],
				limit: 1,
				format: 'simple',
			});
			if (data == null || data.length === 0) break;

			const [foundRef, foundFile, foundStatus] = GitLogParser.parseSimpleRenamed(data, fileName);
			if (foundStatus === 'D' && foundFile != null) return undefined;
			if (foundRef == null || foundFile == null) break;

			fileName = foundFile;
		} while (true);

		uri = GitUri.resolveToUri(fileName, repoPath);
		return (await fsExists(uri.fsPath)) ? uri : undefined;
	}

	@log()
	async hasBranchesAndOrTags(
		repoPath: string | undefined,
		{
			filter,
		}: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		} = {},
	) {
		const [branches, tags] = await Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
			this.getBranches(repoPath, {
				filter: filter?.branches,
				sort: false,
			}),
			this.getTags(repoPath, {
				filter: filter?.tags,
				sort: false,
			}),
		]);

		return (branches != null && branches.length !== 0) || (tags != null && tags.length !== 0);
	}

	@log()
	async hasRemotes(repoPath: string | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = await this.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasRemotes();
	}

	@log()
	async hasTrackingBranch(repoPath: string | undefined): Promise<boolean> {
		if (repoPath == null) return false;

		const repository = await this.getRepository(repoPath);
		if (repository == null) return false;

		return repository.hasTrackingBranch();
	}

	isTrackable(scheme: string): boolean;
	isTrackable(uri: Uri): boolean;
	isTrackable(schemeOruri: string | Uri): boolean {
		const scheme = typeof schemeOruri === 'string' ? schemeOruri : schemeOruri.scheme;
		return (
			scheme === DocumentSchemes.File ||
			scheme === DocumentSchemes.Git ||
			scheme === DocumentSchemes.GitLens ||
			scheme === DocumentSchemes.PRs ||
			scheme === DocumentSchemes.Vsls
		);
	}

	async isTracked(
		fileName: string,
		repoPath?: string,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<boolean>;
	async isTracked(uri: GitUri): Promise<boolean>;
	@log<GitService['isTracked']>({
		exit: tracked => `returned ${tracked}`,
		singleLine: true,
	})
	async isTracked(
		fileNameOrUri: string | GitUri,
		repoPath?: string,
		options: { ref?: string; skipCacheUpdate?: boolean } = {},
	): Promise<boolean> {
		if (options.ref === GitRevision.deletedOrMissing) return false;

		let ref = options.ref;
		let cacheKey: string;
		let fileName: string;
		if (typeof fileNameOrUri === 'string') {
			[fileName, repoPath] = Git.splitPath(fileNameOrUri, repoPath);
			cacheKey = GitUri.toKey(fileNameOrUri);
		} else {
			if (!this.isTrackable(fileNameOrUri)) return false;

			fileName = fileNameOrUri.fsPath;
			repoPath = fileNameOrUri.repoPath;
			ref = fileNameOrUri.sha;
			cacheKey = GitUri.toKey(fileName);
		}

		if (ref != null) {
			cacheKey += `:${ref}`;
		}

		let tracked = this._trackedCache.get(cacheKey);
		if (tracked != null) {
			tracked = await tracked;

			return tracked;
		}

		tracked = this.isTrackedCore(fileName, repoPath == null ? emptyStr : repoPath, ref);
		if (options.skipCacheUpdate) {
			tracked = await tracked;

			return tracked;
		}

		this._trackedCache.set(cacheKey, tracked);
		tracked = await tracked;
		this._trackedCache.set(cacheKey, tracked);

		return tracked;
	}

	private async isTrackedCore(fileName: string, repoPath: string, ref?: string) {
		if (ref === GitRevision.deletedOrMissing) return false;

		try {
			// Even if we have a ref, check first to see if the file exists (that way the cache will be better reused)
			let tracked = Boolean(await Git.ls_files(repoPath == null ? emptyStr : repoPath, fileName));
			if (!tracked && ref != null) {
				tracked = Boolean(await Git.ls_files(repoPath == null ? emptyStr : repoPath, fileName, { ref: ref }));
				// If we still haven't found this file, make sure it wasn't deleted in that ref (i.e. check the previous)
				if (!tracked) {
					tracked = Boolean(
						await Git.ls_files(repoPath == null ? emptyStr : repoPath, fileName, {
							ref: `${ref}^`,
						}),
					);
				}
			}
			return tracked;
		} catch (ex) {
			Logger.error(ex);
			return false;
		}
	}

	@log()
	async getDiffTool(repoPath?: string) {
		return (
			(await Git.config__get('diff.guitool', repoPath, { local: true })) ??
			Git.config__get('diff.tool', repoPath, { local: true })
		);
	}

	@log()
	async openDiffTool(
		repoPath: string,
		uri: Uri,
		options: { ref1?: string; ref2?: string; staged?: boolean; tool?: string } = {},
	) {
		if (!options.tool) {
			const cc = Logger.getCorrelationContext();

			options.tool = await this.getDiffTool(repoPath);
			if (options.tool == null) throw new Error('No diff tool found');

			Logger.log(cc, `Using tool=${options.tool}`);
		}

		const { tool, ...opts } = options;
		return Git.difftool(repoPath, uri.fsPath, tool, opts);
	}

	@log()
	async openDirectoryCompare(repoPath: string, ref1: string, ref2?: string, tool?: string) {
		if (!tool) {
			const cc = Logger.getCorrelationContext();

			tool = await this.getDiffTool(repoPath);
			if (tool == null) throw new Error('No diff tool found');

			Logger.log(cc, `Using tool=${tool}`);
		}

		return Git.difftool__dir_diff(repoPath, tool, ref1, ref2);
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
			typeof fileNameOrUri === 'string'
				? fileNameOrUri
				: Strings.normalizePath(paths.relative(repoPath, fileNameOrUri.fsPath));

		const blob = await Git.rev_parse__verify(repoPath, ref, fileName);
		if (blob == null) return GitRevision.deletedOrMissing;

		let promise: Promise<string | void | undefined> = Git.log__find_object(repoPath, blob, ref, fileName);
		if (options?.timeout != null) {
			promise = Promise.race([promise, Functions.wait(options.timeout)]);
		}

		return (await promise) ?? ref;
	}

	@log()
	validateBranchOrTagName(ref: string, repoPath?: string): Promise<boolean> {
		return Git.check_ref_format(ref, repoPath);
	}

	@log()
	async validateReference(repoPath: string, ref: string) {
		if (ref == null || ref.length === 0) return false;
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return true;

		return (await Git.rev_parse__verify(repoPath, ref)) != null;
	}

	stageFile(repoPath: string, fileName: string): Promise<string>;
	stageFile(repoPath: string, uri: Uri): Promise<string>;
	@log()
	stageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<string> {
		return Git.add(
			repoPath,
			typeof fileNameOrUri === 'string' ? fileNameOrUri : Git.splitPath(fileNameOrUri.fsPath, repoPath)[0],
		);
	}

	stageDirectory(repoPath: string, directory: string): Promise<string>;
	stageDirectory(repoPath: string, uri: Uri): Promise<string>;
	@log()
	stageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<string> {
		return Git.add(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : Git.splitPath(directoryOrUri.fsPath, repoPath)[0],
		);
	}

	unStageFile(repoPath: string, fileName: string): Promise<string>;
	unStageFile(repoPath: string, uri: Uri): Promise<string>;
	@log()
	unStageFile(repoPath: string, fileNameOrUri: string | Uri): Promise<string> {
		return Git.reset(
			repoPath,
			typeof fileNameOrUri === 'string' ? fileNameOrUri : Git.splitPath(fileNameOrUri.fsPath, repoPath)[0],
		);
	}

	unStageDirectory(repoPath: string, directory: string): Promise<string>;
	unStageDirectory(repoPath: string, uri: Uri): Promise<string>;
	@log()
	unStageDirectory(repoPath: string, directoryOrUri: string | Uri): Promise<string> {
		return Git.reset(
			repoPath,
			typeof directoryOrUri === 'string' ? directoryOrUri : Git.splitPath(directoryOrUri.fsPath, repoPath)[0],
		);
	}

	@log()
	stashApply(repoPath: string, stashName: string, { deleteAfter }: { deleteAfter?: boolean } = {}) {
		return Git.stash__apply(repoPath, stashName, Boolean(deleteAfter));
	}

	@log()
	stashDelete(repoPath: string, stashName: string, ref?: string) {
		return Git.stash__delete(repoPath, stashName, ref);
	}

	@log()
	stashSave(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options: { includeUntracked?: boolean; keepIndex?: boolean } = {},
	) {
		if (uris == null) return Git.stash__push(repoPath, message, options);

		GitService.ensureGitVersion('2.13.2', 'Stashing individual files');

		const pathspecs = uris.map(u => `./${Git.splitPath(u.fsPath, repoPath)[0]}`);
		return Git.stash__push(repoPath, message, { ...options, pathspecs: pathspecs });
	}

	static compareGitVersion(version: string) {
		return Versions.compare(Versions.fromString(Git.getGitVersion()), Versions.fromString(version));
	}

	static ensureGitVersion(version: string, feature: string): void {
		const gitVersion = Git.getGitVersion();
		if (Versions.compare(Versions.fromString(gitVersion), Versions.fromString(version)) === -1) {
			throw new Error(
				`${feature} requires a newer version of Git (>= ${version}) than is currently installed (${gitVersion}). Please install a more recent version of Git to use this GitLens feature.`,
			);
		}
	}

	@log()
	static async getBuiltInGitApi(): Promise<BuiltInGitApi | undefined> {
		try {
			const extension = extensions.getExtension('vscode.git') as Extension<GitExtension>;
			if (extension != null) {
				const gitExtension = extension.isActive ? extension.exports : await extension.activate();

				return gitExtension.getAPI(1);
			}
		} catch {}

		return undefined;
	}

	@log()
	static async getBuiltInGitRepository(repoPath: string): Promise<BuiltInGitRepository | undefined> {
		const gitApi = await GitService.getBuiltInGitApi();
		if (gitApi == null) return undefined;

		const normalizedPath = Strings.normalizePath(repoPath, { stripTrailingSlash: true }).toLowerCase();

		const repo = gitApi.repositories.find(
			r => Strings.normalizePath(r.rootUri.fsPath, { stripTrailingSlash: true }).toLowerCase() === normalizedPath,
		);

		return repo;
	}

	static getEncoding(repoPath: string, fileName: string): string;
	static getEncoding(uri: Uri): string;
	static getEncoding(repoPathOrUri: string | Uri, fileName?: string): string {
		const uri = typeof repoPathOrUri === 'string' ? GitUri.resolveToUri(fileName!, repoPathOrUri) : repoPathOrUri;
		return Git.getEncoding(configuration.getAny<string>('files.encoding', uri));
	}
}
