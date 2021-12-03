'use strict';
import {
	ConfigurationChangeEvent,
	Disposable,
	Event,
	EventEmitter,
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
import { resetAvatarCache } from '../avatars';
import { configuration } from '../configuration';
import { BuiltInGitConfiguration, ContextKeys, DocumentSchemes, GlyphChars, setContext } from '../constants';
import { Container } from '../container';
import { setEnabled } from '../extension';
import { Logger } from '../logger';
import { Arrays, debug, gate, Iterables, log, Paths, Promises, Strings } from '../system';
import { vslsUriPrefixRegex } from '../vsls/vsls';
import { ProviderNotFoundError } from './errors';
import {
	Authentication,
	BranchDateFormatting,
	BranchSortOptions,
	CommitDateFormatting,
	Git,
	GitBlame,
	GitBlameLine,
	GitBlameLines,
	GitBranch,
	GitBranchReference,
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
	GitTree,
	GitUser,
	PullRequest,
	PullRequestDateFormatting,
	PullRequestState,
	Repository,
	RepositoryChange,
	RepositoryChangeComparisonMode,
	RepositoryChangeEvent,
	SearchPattern,
	TagSortOptions,
} from './git';
import { GitProvider, GitProviderDescriptor, GitProviderId, ScmRepository } from './gitProvider';
import { GitUri } from './gitUri';
import { RemoteProvider, RemoteProviders, RichRemoteProvider } from './remotes/factory';

export type { GitProviderDescriptor, GitProviderId };

const slash = '/';

const maxDefaultBranchWeight = 100;
const weightedDefaultBranches = new Map<string, number>([
	['master', maxDefaultBranchWeight],
	['main', 15],
	['default', 10],
	['develop', 5],
	['development', 1],
]);

export type GitProvidersChangedEvent = {
	readonly added: readonly GitProvider[];
	readonly removed: readonly GitProvider[];
};

export type RepositoriesChangedEvent = {
	readonly added: readonly Repository[];
	readonly removed: readonly Repository[];
};

export class GitProviderService implements Disposable {
	private readonly _onDidChangeProviders = new EventEmitter<GitProvidersChangedEvent>();
	get onDidChangeProviders(): Event<GitProvidersChangedEvent> {
		return this._onDidChangeProviders.event;
	}

	private _onDidChangeRepositories = new EventEmitter<RepositoriesChangedEvent>();
	get onDidChangeRepositories(): Event<RepositoriesChangedEvent> {
		return this._onDidChangeRepositories.event;
	}

	private readonly _onDidChangeRepository = new EventEmitter<RepositoryChangeEvent>();
	get onDidChangeRepository(): Event<RepositoryChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private readonly _disposable: Disposable;
	private readonly _providers = new Map<GitProviderId, GitProvider>();
	private readonly _repositories = new Map<string, Repository>();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			workspace.onDidChangeWorkspaceFolders(this.onWorkspaceFoldersChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
			Authentication.onDidChange(e => {
				if (e.reason === 'connected') {
					resetAvatarCache('failed');
				}

				this.resetCaches('providers');
				void this.updateContext(this._repositories);
			}),
		);

		BranchDateFormatting.reset();
		CommitDateFormatting.reset();
		PullRequestDateFormatting.reset();

		void this.updateContext(this._repositories);
	}

	dispose() {
		this._disposable.dispose();
		this._providers.clear();

		this._repositories.forEach(r => r.dispose());
		this._repositories.clear();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, 'defaultDateFormat') ||
			configuration.changed(e, 'defaultDateSource') ||
			configuration.changed(e, 'defaultDateStyle')
		) {
			BranchDateFormatting.reset();
			CommitDateFormatting.reset();
			PullRequestDateFormatting.reset();
		}

		if (configuration.changed(e, 'views.contributors.showAllBranches')) {
			this.resetCaches('contributors');
		}
	}

	@debug()
	private onWindowStateChanged(e: WindowState) {
		if (e.focused) {
			this._repositories.forEach(r => r.resume());
		} else {
			this._repositories.forEach(r => r.suspend());
		}
	}

	private onWorkspaceFoldersChanged(e: WorkspaceFoldersChangeEvent) {
		if (e.added.length) {
			const autoRepositoryDetection =
				configuration.getAny<boolean | 'subFolders' | 'openEditors'>(
					BuiltInGitConfiguration.AutoRepositoryDetection,
				) ?? true;
			if (autoRepositoryDetection !== false) {
				void this.discoverRepositories(e.added);
			}
		}

		if (e.removed.length) {
			const removed: Repository[] = [];

			for (const folder of e.removed) {
				const key = asKey(folder.uri);

				for (const repository of this._repositories.values()) {
					if (key === asKey(repository.folder.uri)) {
						this._repositories.delete(repository.path);
						removed.push(repository);
					}
				}
			}

			if (removed.length) {
				void this.updateContext(this._repositories);

				// Defer the event trigger enough to let everything unwind
				queueMicrotask(() => {
					this._onDidChangeRepositories.fire({ added: [], removed: removed });
					removed.forEach(r => r.dispose());
				});
			}
		}
	}

	private async updateContext(repositories: Map<string, Repository>) {
		const hasRepositories = this.openRepositoryCount !== 0;
		await setEnabled(hasRepositories);

		// Don't block for the remote context updates (because it can block other downstream requests during initialization)
		async function updateRemoteContext() {
			let hasRemotes = false;
			let hasRichRemotes = false;
			let hasConnectedRemotes = false;
			if (hasRepositories) {
				for (const repo of repositories.values()) {
					if (!hasConnectedRemotes) {
						hasConnectedRemotes = await repo.hasRichRemote(true);

						if (hasConnectedRemotes) {
							hasRichRemotes = true;
							hasRemotes = true;
						}
					}

					if (!hasRichRemotes) {
						hasRichRemotes = await repo.hasRichRemote();
					}

					if (!hasRemotes) {
						hasRemotes = await repo.hasRemotes();
					}

					if (hasRemotes && hasRichRemotes && hasConnectedRemotes) break;
				}
			}

			await Promise.all([
				setContext(ContextKeys.HasRemotes, hasRemotes),
				setContext(ContextKeys.HasRichRemotes, hasRichRemotes),
				setContext(ContextKeys.HasConnectedRemotes, hasConnectedRemotes),
			]);
		}

		void updateRemoteContext();

		// If we have no repositories setup a watcher in case one is initialized
		if (!hasRepositories) {
			for (const provider of this._providers.values()) {
				const watcher = provider.createRepositoryInitWatcher?.();
				if (watcher != null) {
					const disposable = Disposable.from(
						watcher,
						watcher.onDidCreate(uri => {
							const f = workspace.getWorkspaceFolder(uri);
							if (f == null) return;

							void this.discoverRepositories([f], { force: true }).then(() => {
								if (Iterables.some(this.repositories, r => r.folder === f)) {
									disposable.dispose();
								}
							});
						}),
					);
				}
			}
		}
	}

	get hasProviders(): boolean {
		return this._providers.size !== 0;
	}

	get registeredProviders(): GitProviderDescriptor[] {
		return [...Iterables.map(this._providers.values(), p => ({ ...p.descriptor }))];
	}

	get openRepositories(): Repository[] {
		const repositories = [...Iterables.filter(this.repositories, r => !r.closed)];
		if (repositories.length === 0) return repositories;

		return Repository.sort(repositories);
	}

	get openRepositoryCount(): number {
		return Iterables.count(this.repositories, r => !r.closed);
	}

	get repositories(): Iterable<Repository> {
		return this._repositories.values();
	}

	get repositoryCount(): number {
		return this._repositories.size;
	}

	get highlander(): Repository | undefined {
		if (this.repositoryCount === 1) {
			return this._repositories.values().next().value;
		}
		return undefined;
	}

	@log()
	get highlanderRepoPath(): string | undefined {
		return this.highlander?.path;
	}

	// get readonly() {
	// 	return true;
	// 	// return this.container.vsls.readonly;
	// }

	// get useCaching() {
	// 	return this.container.config.advanced.caching.enabled;
	// }

	getCachedRepository(repoPath: string): Repository | undefined {
		return this._repositories.get(repoPath);
	}

	/**
	 * Registers a {@link GitProvider}
	 * @param id A unique indentifier for the provider
	 * @param name A name for the provider
	 * @param provider A provider for handling git operations
	 * @returns A disposable to unregister the {@link GitProvider}
	 */
	register(id: GitProviderId, provider: GitProvider): Disposable {
		if (this._providers.has(id)) throw new Error(`Provider '${id}' has already been registered`);

		this._providers.set(id, provider);
		const disposable = provider.onDidChangeRepository(e => {
			if (e.changed(RepositoryChange.Closed, RepositoryChangeComparisonMode.Any)) {
				void this.updateContext(this._repositories);

				// Send a notification that the repositories changed
				queueMicrotask(() => this._onDidChangeRepositories.fire({ added: [], removed: [e.repository] }));
			}

			this._onDidChangeRepository.fire(e);
		});

		this._onDidChangeProviders.fire({ added: [provider], removed: [] });

		void this.onWorkspaceFoldersChanged({ added: workspace.workspaceFolders ?? [], removed: [] });

		return {
			dispose: () => {
				disposable.dispose();
				this._providers.delete(id);

				const removed: Repository[] = [];

				for (const [key, repository] of [...this._repositories]) {
					if (repository?.provider.id === id) {
						this._repositories.delete(key);
						removed.push(repository);
					}
				}

				void this.updateContext(this._repositories);

				if (removed.length) {
					// Defer the event trigger enough to let everything unwind
					queueMicrotask(() => {
						this._onDidChangeRepositories.fire({ added: [], removed: removed });
						removed.forEach(r => r.dispose());
					});
				}

				this._onDidChangeProviders.fire({ added: [], removed: [provider] });
			},
		};
	}

	private _discoveredWorkspaceFolders = new Map<WorkspaceFolder, Promise<Repository[]>>();

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

		const repositories = Iterables.flatMap<PromiseFulfilledResult<Repository[]>, Repository>(
			Iterables.filter<PromiseSettledResult<Repository[]>, PromiseFulfilledResult<Repository[]>>(
				results,
				(r): r is PromiseFulfilledResult<Repository[]> => r.status === 'fulfilled',
			),
			r => r.value,
		);

		const added: Repository[] = [];

		for (const repository of repositories) {
			if (this._repositories.has(repository.path)) continue;

			added.push(repository);
			this._repositories.set(repository.path, repository);
		}

		if (added.length === 0) return;

		void this.updateContext(this._repositories);
		// Defer the event trigger enough to let everything unwind
		queueMicrotask(() => this._onDidChangeRepositories.fire({ added: added, removed: [] }));
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

	static getProviderId(repoPath: string | Uri): GitProviderId {
		if (typeof repoPath !== 'string' && repoPath.scheme === DocumentSchemes.VirtualFS) {
			if (repoPath.authority.startsWith('github')) {
				return GitProviderId.GitHub;
			}

			throw new Error(`Unsupported scheme: ${repoPath.scheme}`);
		}

		return GitProviderId.Git;
	}

	private getProvider(repoPath: string | Uri): { provider: GitProvider; path: string } {
		const id = GitProviderService.getProviderId(repoPath);

		const provider = this._providers.get(id);
		if (provider == null) throw new ProviderNotFoundError(id);

		switch (id) {
			case GitProviderId.Git:
				return {
					provider: provider,
					path: typeof repoPath === 'string' ? repoPath : repoPath.fsPath,
				};

			default:
				return {
					provider: provider,
					path: typeof repoPath === 'string' ? repoPath : repoPath.toString(),
				};
		}
	}

	@log()
	addRemote(repoPath: string | Uri, name: string, url: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.addRemote(path, name, url);
	}

	@log()
	pruneRemote(repoPath: string | Uri, remoteName: string): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.pruneRemote(path, remoteName);
	}

	@log()
	async applyChangesToWorkingFile(uri: GitUri, ref1?: string, ref2?: string): Promise<void> {
		const { provider } = this.getProvider(uri);
		return provider.applyChangesToWorkingFile(uri, ref1, ref2);
	}

	@log()
	async branchContainsCommit(repoPath: string | Uri, name: string, ref: string): Promise<boolean> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.branchContainsCommit(path, name, ref);
	}

	@log()
	async checkout(
		repoPath: string,
		ref: string,
		options?: { createBranch?: string } | { fileName?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.checkout(path, ref, options);
	}

	@log()
	resetCaches(
		...cache: ('branches' | 'contributors' | 'providers' | 'remotes' | 'stashes' | 'status' | 'tags')[]
	): void {
		const repoCache = cache.filter((c): c is 'branches' | 'remotes' => c === 'branches' || c === 'remotes');
		// Delegate to the repos, if we are clearing everything or one of the per-repo caches
		if (cache.length === 0 || repoCache.length > 0) {
			for (const repo of this.repositories) {
				repo.resetCaches(...repoCache);
			}
		}

		void Promise.allSettled([...this._providers.values()].map(provider => provider.resetCaches(...cache)));
	}

	@log({
		args: {
			0: (repoPath: string) => repoPath,
			1: (uris: Uri[]) => `${uris.length}`,
		},
	})
	async excludeIgnoredUris(repoPath: string, uris: Uri[]): Promise<Uri[]> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.excludeIgnoredUris(path, uris);
	}

	@gate()
	@log()
	async fetch(
		repoPath: string,
		options?: { all?: boolean; branch?: GitBranchReference; prune?: boolean; pull?: boolean; remote?: string },
	): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.fetch(path, options);
	}

	@gate<GitProviderService['fetchAll']>(
		(repos, opts) => `${repos == null ? '' : repos.map(r => r.id).join(',')}|${JSON.stringify(opts)}`,
	)
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
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
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
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
	@log({
		args: {
			0: (repos?: Repository[]) => (repos == null ? false : repos.map(r => r.name).join(', ')),
		},
	})
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
			const doc = await this.container.tracker.getOrAdd(editor.document.uri);
			if (doc != null) {
				repoPath = doc.uri.repoPath;
			}
		}

		if (repoPath != null) return repoPath;

		return this.highlanderRepoPath;
	}

	@log()
	async getBlameForFile(uri: GitUri): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForFile(uri);
	}

	@log({
		args: {
			1: _contents => '<contents>',
		},
	})
	async getBlameForFileContents(uri: GitUri, contents: string): Promise<GitBlame | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForFileContents(uri, contents);
	}

	@log()
	async getBlameForLine(
		uri: GitUri,
		editorLine: number, // editor lines are 0-based
		options?: { skipCache?: boolean },
	): Promise<GitBlameLine | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForLine(uri, editorLine, options);
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
		options?: { skipCache?: boolean },
	): Promise<GitBlameLine | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForLineContents(uri, editorLine, contents, options);
	}

	@log()
	async getBlameForRange(uri: GitUri, range: Range): Promise<GitBlameLines | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRange(uri, range);
	}

	@log({
		args: {
			2: _contents => '<contents>',
		},
	})
	async getBlameForRangeContents(uri: GitUri, range: Range, contents: string): Promise<GitBlameLines | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRangeContents(uri, range, contents);
	}

	@log({
		args: {
			0: _blame => '<blame>',
		},
	})
	getBlameForRangeSync(blame: GitBlame, uri: GitUri, range: Range): GitBlameLines | undefined {
		const { provider } = this.getProvider(uri);
		return provider.getBlameForRangeSync(blame, uri, range);
	}

	@log()
	async getBranch(repoPath: string | Uri | undefined): Promise<GitBranch | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getBranch(path);
	}

	@log({
		args: {
			0: b => b.name,
		},
	})
	async getBranchAheadRange(branch: GitBranch): Promise<string | undefined> {
		if (branch.state.ahead > 0) {
			return GitRevision.createRange(branch.upstream?.name, branch.ref);
		}

		if (branch.upstream == null) {
			// If we have no upstream branch, try to find a best guess branch to use as the "base"
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

				const possibleBranch = weightedBranch!.branch.upstream?.name ?? weightedBranch!.branch.ref;
				if (possibleBranch !== branch.ref) {
					return GitRevision.createRange(possibleBranch, branch.ref);
				}
			}
		}

		return undefined;
	}

	@log({
		args: {
			1: () => false,
		},
	})
	async getBranches(
		repoPath: string | Uri | undefined,
		options?: {
			filter?: (b: GitBranch) => boolean;
			sort?: boolean | BranchSortOptions;
		},
	): Promise<GitBranch[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getBranches(path, options);
	}

	@log({
		args: {
			1: () => false,
		},
	})
	async getBranchesAndOrTags(
		repoPath: string | Uri | undefined,
		{
			filter,
			include,
			sort,
			...options
		}: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
			include?: 'all' | 'branches' | 'tags';
			sort?: boolean | { branches?: BranchSortOptions; tags?: TagSortOptions };
		} = {},
	): Promise<(GitBranch | GitTag)[] | GitBranch[] | GitTag[]> {
		const [branches, tags] = await Promise.all([
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

		return branches ?? tags ?? [];
	}

	@log()
	async getBranchesAndTagsTipsFn(
		repoPath: string | Uri | undefined,
		currentName?: string,
	): Promise<
		(sha: string, options?: { compact?: boolean | undefined; icons?: boolean | undefined }) => string | undefined
	> {
		const [branches, tags] = await Promise.all([this.getBranches(repoPath), this.getTags(repoPath)]);

		const branchesAndTagsBySha = Arrays.groupByFilterMap(
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
	async getChangedFilesCount(repoPath: string | Uri, ref?: string): Promise<GitDiffShortStat | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getChangedFilesCount(path, ref);
	}

	@log()
	async getCommit(repoPath: string | Uri, ref: string): Promise<GitLogCommit | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommit(path, ref);
	}

	@log()
	async getCommitBranches(
		repoPath: string | Uri,
		ref: string,
		options?: { mode?: 'contains' | 'pointsAt'; remotes?: boolean },
	): Promise<string[]> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitBranches(path, ref, options);
	}

	@log()
	getAheadBehindCommitCount(
		repoPath: string | Uri,
		refs: string[],
	): Promise<{ ahead: number; behind: number } | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getAheadBehindCommitCount(path, refs);
	}

	@log()
	getCommitCount(repoPath: string | Uri, ref: string): Promise<number | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitCount(path, ref);
	}

	@log()
	async getCommitForFile(
		repoPath: string | Uri | undefined,
		fileName: string,
		options?: { ref?: string; firstIfNotFound?: boolean; range?: Range; reverse?: boolean },
	): Promise<GitLogCommit | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getCommitForFile(path, fileName, options);
	}

	@log()
	async getOldestUnpushedRefForFile(repoPath: string | Uri, fileName: string): Promise<string | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getOldestUnpushedRefForFile(path, fileName);
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	@log()
	async getConfig(_key: string, _repoPath?: string): Promise<string | undefined> {
		// return Git.config__get(key, repoPath);
		return undefined;
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

	@log()
	@gate()
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
	async getDiffForFile(
		uri: GitUri,
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiff | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForFile(uri, ref1, ref2, originalFileName);
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
		const { provider } = this.getProvider(uri);
		return provider.getDiffForFile(uri, ref, contents, originalFileName);
	}

	@log()
	async getDiffForLine(
		uri: GitUri,
		editorLine: number, // editor lines are 0-based
		ref1: string | undefined,
		ref2?: string,
		originalFileName?: string,
	): Promise<GitDiffHunkLine | undefined> {
		const { provider } = this.getProvider(uri);
		return provider.getDiffForLine(uri, editorLine, ref1, ref2, originalFileName);
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
	async getFileStatusForCommit(repoPath: string | Uri, fileName: string, ref: string): Promise<GitFile | undefined> {
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getFileStatusForCommit(path, fileName, ref);
	}

	@log()
	async getLog(
		repoPath: string | Uri,
		options?: {
			all?: boolean;
			authors?: string[];
			limit?: number;
			merges?: boolean;
			ordering?: string | null;
			ref?: string;
			reverse?: boolean;
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
			authors?: string[];
			limit?: number;
			merges?: boolean;
			ordering?: string | null;
			ref?: string;
			reverse?: boolean;
			since?: string;
		},
	): Promise<Set<string> | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLogRefsOnly(path, options);
	}

	@log()
	async getLogForSearch(
		repoPath: string | Uri,
		search: SearchPattern,
		options?: { limit?: number; ordering?: string | null; skip?: number },
	): Promise<GitLog | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getLogForSearch(path, search, options);
	}

	@log()
	async getLogForFile(
		repoPath: string | Uri | undefined,
		fileName: string,
		options?: {
			all?: boolean;
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
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getLogForFile(path, fileName, options);
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
	async getNextDiffUris(
		repoPath: string | Uri,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
	): Promise<{ current: GitUri; next: GitUri | undefined; deleted?: boolean } | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (ref == null || ref.length === 0) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getNextDiffUris(path, uri, ref, skip);
	}

	@log()
	async getNextUri(
		repoPath: string | Uri,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		// editorLine?: number
	): Promise<GitUri | undefined> {
		// If we have no ref (or staged ref) there is no next commit
		if (ref == null || ref.length === 0 || GitRevision.isUncommittedStaged(ref)) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getNextUri(path, uri, ref, skip);
	}

	@log()
	async getPreviousDiffUris(
		repoPath: string | Uri,
		uri: Uri,
		ref: string | undefined,
		skip: number = 0,
		firstParent: boolean = false,
	): Promise<{ current: GitUri; previous: GitUri | undefined } | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getPreviousDiffUris(path, uri, ref, skip, firstParent);
	}

	@log()
	async getPreviousLineDiffUris(
		repoPath: string | Uri,
		uri: Uri,
		editorLine: number,
		ref: string | undefined,
		skip: number = 0,
	): Promise<{ current: GitUri; previous: GitUri | undefined; line: number } | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getPreviousLineDiffUris(path, uri, editorLine, ref, skip);
	}

	@log()
	async getPreviousUri(
		repoPath: string | Uri,
		uri: Uri,
		ref?: string,
		skip: number = 0,
		editorLine?: number,
		firstParent: boolean = false,
	): Promise<GitUri | undefined> {
		if (ref === GitRevision.deletedOrMissing) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getPreviousUri(path, uri, ref, skip, editorLine, firstParent);
	}

	async getPullRequestForBranch(
		branch: string,
		remote: GitRemote,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	async getPullRequestForBranch(
		branch: string,
		provider: RichRemoteProvider,
		options?: { avatarSize?: number; include?: PullRequestState[]; limit?: number; timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate<GitProviderService['getPullRequestForBranch']>((ref, remoteOrProvider, options) => {
		const provider = GitRemote.is(remoteOrProvider) ? remoteOrProvider.provider : remoteOrProvider;
		return `${ref}${provider != null ? `|${provider.id}:${provider.domain}/${provider.path}` : ''}${
			options != null ? `|${options.limit ?? -1}:${options.include?.join(',')}` : ''
		}`;
	})
	@debug<GitProviderService['getPullRequestForBranch']>({
		args: {
			1: (remoteOrProvider: GitRemote | RichRemoteProvider) => remoteOrProvider.name,
		},
	})
	async getPullRequestForBranch(
		branch: string,
		remoteOrProvider: GitRemote | RichRemoteProvider,
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
		provider: RichRemoteProvider,
		options?: { timeout?: number },
	): Promise<PullRequest | undefined>;
	@gate<GitProviderService['getPullRequestForCommit']>((ref, remoteOrProvider, options) => {
		const provider = GitRemote.is(remoteOrProvider) ? remoteOrProvider.provider : remoteOrProvider;
		return `${ref}${provider != null ? `|${provider.id}:${provider.domain}/${provider.path}` : ''}|${
			options?.timeout
		}`;
	})
	@debug<GitProviderService['getPullRequestForCommit']>({
		args: {
			1: (remoteOrProvider: GitRemote | RichRemoteProvider) => remoteOrProvider.name,
		},
	})
	async getPullRequestForCommit(
		ref: string,
		remoteOrProvider: GitRemote | RichRemoteProvider,
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
		repoPath: string | Uri,
		options?: { all?: boolean; branch?: string; limit?: number; ordering?: string | null; skip?: number },
	): Promise<GitReflog | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getIncomingActivity(path, options);
	}

	async getRichRemoteProvider(
		repoPath: string | Uri | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	async getRichRemoteProvider(
		remotes: GitRemote[],
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined>;
	@gate<GitProviderService['getRichRemoteProvider']>(
		(remotesOrRepoPath, options) =>
			`${typeof remotesOrRepoPath === 'string' ? remotesOrRepoPath : remotesOrRepoPath[0]?.repoPath}:${
				options?.includeDisconnected ?? false
			}`,
	)
	@log({ args: { 0: () => false } })
	async getRichRemoteProvider(
		remotesOrRepoPath: GitRemote[] | string | Uri | undefined,
		options?: { includeDisconnected?: boolean },
	): Promise<GitRemote<RichRemoteProvider> | undefined> {
		if (remotesOrRepoPath == null) return undefined;

		if (Array.isArray(remotesOrRepoPath)) {
			if (remotesOrRepoPath.length === 0) return undefined;

			const repoPath = remotesOrRepoPath[0].repoPath;

			const { provider } = this.getProvider(repoPath);
			return provider.getRichRemoteProvider(remotesOrRepoPath, options);
		}

		const { provider, path } = this.getProvider(remotesOrRepoPath);
		return provider.getRichRemoteProvider(path, options);
	}

	@log()
	async getRemotes(
		repoPath: string | Uri | undefined,
		options?: { sort?: boolean },
	): Promise<GitRemote<RemoteProvider>[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getRemotes(path, options);
	}

	async getRemotesCore(
		repoPath: string | Uri | undefined,
		providers?: RemoteProviders,
		options?: { sort?: boolean },
	): Promise<GitRemote[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getRemotesCore(path, providers, options);
	}

	async getRepoPath(filePath: string, options?: { ref?: string }): Promise<string | undefined>;
	async getRepoPath(uri: Uri | undefined, options?: { ref?: string }): Promise<string | undefined>;
	@log<GitProviderService['getRepoPath']>({
		exit: path => `returned ${path}`,
	})
	async getRepoPath(
		filePathOrUri: string | Uri | undefined,
		options?: { ref?: string },
	): Promise<string | undefined> {
		if (filePathOrUri == null) return this.highlanderRepoPath;
		if (GitUri.is(filePathOrUri)) return filePathOrUri.repoPath;

		const cc = Logger.getCorrelationContext();

		// Don't save the tracking info to the cache, because we could be looking in the wrong place (e.g. looking in the root when the file is in a submodule)
		let repo = await this.getRepository(filePathOrUri, { ...options, skipCacheUpdate: true });
		if (repo != null) return repo.path;

		const { provider, path } = this.getProvider(filePathOrUri);
		const rp = await provider.getRepoPath(path, false);

		// const rp = await this.getRepoPathCore(
		// 	typeof filePathOrUri === 'string' ? filePathOrUri : filePathOrUri.fsPath,
		// 	false,
		// );
		if (rp == null) return undefined;

		// Recheck this._repositoryTree.get(rp) to make sure we haven't already tried adding this due to awaits
		if (this._repositories.get(rp) != null) return rp;

		const isVslsScheme =
			typeof filePathOrUri === 'string' ? undefined : filePathOrUri.scheme === DocumentSchemes.Vsls;

		// If this new repo is inside one of our known roots and we we don't already know about, add it
		const root = this.findRepositoryForPath(rp, isVslsScheme);

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
					index: this.container.git.repositoryCount,
				};
			}
		}

		Logger.log(cc, `Repository found in '${rp}'`);
		repo = provider.createRepository(folder, rp, false);
		this._repositories.set(rp, repo);

		void this.updateContext(this._repositories);
		// Send a notification that the repositories changed
		queueMicrotask(() => this._onDidChangeRepositories.fire({ added: [repo!], removed: [] }));

		return rp;
	}

	@log()
	async getRepoPathOrActive(uri: Uri | undefined, editor: TextEditor | undefined) {
		const repoPath = await this.getRepoPath(uri);
		if (repoPath) return repoPath;

		return this.getActiveRepoPath(editor);
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
	@log<GitProviderService['getRepository']>({
		exit: repo => `returned ${repo != null ? `${repo.path}` : 'undefined'}`,
	})
	async getRepository(
		repoPathOrUri: string | Uri,
		options: { ref?: string; skipCacheUpdate?: boolean } = {},
	): Promise<Repository | undefined> {
		let isVslsScheme;

		let path: string;
		if (typeof repoPathOrUri === 'string') {
			const repo = this._repositories.get(repoPathOrUri);
			if (repo != null) return repo;

			path = repoPathOrUri;
			isVslsScheme = undefined;
		} else {
			if (GitUri.is(repoPathOrUri)) {
				if (repoPathOrUri.repoPath) {
					const repo = this._repositories.get(repoPathOrUri.repoPath);
					if (repo != null) return repo;
				}

				path = repoPathOrUri.fsPath;
			} else {
				path = repoPathOrUri.fsPath;
			}

			isVslsScheme = repoPathOrUri.scheme === DocumentSchemes.Vsls;
		}

		const repo = this.findRepositoryForPath(path, isVslsScheme);
		if (repo == null) return undefined;

		// Make sure the file is tracked in this repo before returning -- it could be from a submodule
		if (!(await this.isTracked(path, repo.path, options))) return undefined;
		return repo;
	}

	@debug()
	private findRepositoryForPath(path: string, isVslsScheme: boolean | undefined): Repository | undefined {
		if (this._repositories.size === 0) return undefined;

		function findBySubPath(repositories: Map<string, Repository>, path: string) {
			const repos = [...repositories.values()].sort((a, b) => a.path.length - b.path.length);
			for (const repo of repos) {
				if (Paths.isDescendent(path, repo.path)) return repo;
			}

			return undefined;
		}

		let repo = findBySubPath(this._repositories, path);
		// If we can't find the repo and we are a guest, check if we are a "root" workspace
		if (repo == null && isVslsScheme !== false && this.container.vsls.isMaybeGuest) {
			if (!vslsUriPrefixRegex.test(path)) {
				path = Strings.normalizePath(path);
				const vslsPath = `/~0${path.startsWith(slash) ? path : `/${path}`}`;
				repo = findBySubPath(this._repositories, vslsPath);
			}
		}
		return repo;
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
	async getStatusForFile(repoPath: string | Uri, fileName: string): Promise<GitStatusFile | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForFile(path, fileName);
	}

	@log()
	async getStatusForFiles(repoPath: string | Uri, pathOrGlob: string): Promise<GitStatusFile[] | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForFiles(path, pathOrGlob);
	}

	@log()
	async getStatusForRepo(repoPath: string | Uri | undefined): Promise<GitStatus | undefined> {
		if (repoPath == null) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getStatusForRepo(path);
	}

	@log({
		args: {
			1: () => false,
		},
	})
	async getTags(
		repoPath: string | Uri | undefined,
		options?: { filter?: (t: GitTag) => boolean; sort?: boolean | TagSortOptions },
	): Promise<GitTag[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getTags(path, options);
	}

	@log()
	async getTreeFileForRevision(
		repoPath: string | Uri | undefined,
		fileName: string,
		ref: string,
	): Promise<GitTree | undefined> {
		if (repoPath == null || fileName == null || fileName.length === 0) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getTreeFileForRevision(path, fileName, ref);
	}

	@log()
	async getTreeForRevision(repoPath: string | Uri | undefined, ref: string): Promise<GitTree[]> {
		if (repoPath == null) return [];

		const { provider, path } = this.getProvider(repoPath);
		return provider.getTreeForRevision(path, ref);
	}

	@log()
	getVersionedFileBuffer(repoPath: string | Uri, fileName: string, ref: string) {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getVersionedFileBuffer(path, fileName, ref);
	}

	@log()
	async getVersionedUri(
		repoPath: string | Uri | undefined,
		fileName: string,
		ref: string | undefined,
	): Promise<Uri | undefined> {
		if (repoPath == null || ref === GitRevision.deletedOrMissing) return undefined;

		const { provider, path } = this.getProvider(repoPath);
		return provider.getVersionedUri(path, fileName, ref);
	}

	@log()
	async getWorkingUri(repoPath: string | Uri, uri: Uri) {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getWorkingUri(path, uri);
	}

	@log()
	async hasBranchesAndOrTags(
		repoPath: string | Uri | undefined,
		{
			filter,
		}: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		} = {},
	): Promise<boolean> {
		const [branches, tags] = await Promise.all([
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
	async hasRemotes(repoPath: string | Uri | undefined): Promise<boolean> {
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

		return repository.hasUpstreamBranch();
	}

	@log({
		args: {
			1: (editor: TextEditor) =>
				editor != null ? `TextEditor(${Logger.toLoggable(editor.document.uri)})` : 'undefined',
		},
	})
	async isActiveRepoPath(repoPath: string | undefined, editor?: TextEditor): Promise<boolean> {
		if (repoPath == null) return false;

		editor = editor ?? window.activeTextEditor;
		if (editor == null) return false;

		const doc = await this.container.tracker.getOrAdd(editor.document.uri);
		return repoPath === doc?.uri.repoPath;
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
			scheme === DocumentSchemes.Vsls ||
			scheme === DocumentSchemes.VirtualFS
		);
	}

	async isTracked(uri: GitUri): Promise<boolean>;
	async isTracked(
		fileName: string,
		repoPath: string | Uri,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<boolean>;
	@log<GitProviderService['isTracked']>({
		exit: tracked => `returned ${tracked}`,
		singleLine: true,
	})
	async isTracked(
		fileNameOrUri: string | GitUri,
		repoPath?: string | Uri,
		options?: { ref?: string; skipCacheUpdate?: boolean },
	): Promise<boolean> {
		if (options?.ref === GitRevision.deletedOrMissing) return false;

		const { provider, path } = this.getProvider(
			repoPath ?? (typeof fileNameOrUri === 'string' ? undefined! : fileNameOrUri),
		);
		return provider.isTracked(fileNameOrUri, path, options);
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
		fileName?: string,
		options?: { timeout?: number },
	): Promise<string>;
	async resolveReference(repoPath: string, ref: string, uri?: Uri, options?: { timeout?: number }): Promise<string>;
	@log()
	async resolveReference(
		repoPath: string | Uri,
		ref: string,
		fileNameOrUri?: string | Uri,
		options?: { timeout?: number },
	) {
		if (ref == null || ref.length === 0 || ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) {
			return ref;
		}

		const { provider, path } = this.getProvider(repoPath);
		return provider.resolveReference(path, ref, fileNameOrUri, options);
	}

	@log()
	validateBranchOrTagName(repoPath: string | Uri, ref: string): Promise<boolean> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.validateBranchOrTagName(path, ref);
	}

	@log()
	async validateReference(repoPath: string | Uri, ref: string) {
		if (ref == null || ref.length === 0) return false;
		if (ref === GitRevision.deletedOrMissing || GitRevision.isUncommitted(ref)) return true;

		const { provider, path } = this.getProvider(repoPath);
		return provider.validateReference(path, ref);
	}

	stageFile(repoPath: string | Uri, fileName: string): Promise<void>;
	stageFile(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	stageFile(repoPath: string | Uri, fileNameOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stageFile(path, fileNameOrUri);
	}

	stageDirectory(repoPath: string | Uri, directory: string): Promise<void>;
	stageDirectory(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	stageDirectory(repoPath: string | Uri, directoryOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.stageDirectory(path, directoryOrUri);
	}

	unStageFile(repoPath: string | Uri, fileName: string): Promise<void>;
	unStageFile(repoPath: string | Uri, uri: Uri): Promise<void>;
	@log()
	unStageFile(repoPath: string | Uri, fileNameOrUri: string | Uri): Promise<void> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.unStageFile(path, fileNameOrUri);
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

	@log()
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
	async getOpenScmRepositories(): Promise<ScmRepository[]> {
		const results = await Promise.allSettled([...this._providers.values()].map(p => p.getOpenScmRepositories()));
		const repositories = Iterables.flatMap<PromiseFulfilledResult<ScmRepository[]>, ScmRepository>(
			Iterables.filter<PromiseSettledResult<ScmRepository[]>, PromiseFulfilledResult<ScmRepository[]>>(
				results,
				(r): r is PromiseFulfilledResult<ScmRepository[]> => r.status === 'fulfilled',
			),
			r => r.value,
		);
		return [...repositories];
	}

	@log()
	async getOrOpenScmRepository(repoPath: string): Promise<ScmRepository | undefined> {
		const { provider, path } = this.getProvider(repoPath);
		return provider.getOrOpenScmRepository(path);
	}

	static getEncoding(repoPath: string, fileName: string): string;
	static getEncoding(uri: Uri): string;
	static getEncoding(repoPathOrUri: string | Uri, fileName?: string): string {
		const uri = typeof repoPathOrUri === 'string' ? GitUri.resolveToUri(fileName!, repoPathOrUri) : repoPathOrUri;
		return Git.getEncoding(configuration.getAny<string>('files.encoding', uri));
	}
}

export function asKey(uri: Uri): string;
export function asKey(uri: Uri | undefined): string | undefined;
export function asKey(uri: Uri | undefined): string | undefined {
	if (uri === undefined) return undefined;
	const hasTrailingSlash = uri.path.endsWith('/');
	if (!hasTrailingSlash && !uri.fragment) return uri.toString();

	return uri.with({ path: hasTrailingSlash ? uri.path.slice(0, -1) : uri.path, fragment: '' }).toString();
}
