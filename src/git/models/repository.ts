'use strict';
import * as paths from 'path';
import {
	commands,
	ConfigurationChangeEvent,
	Disposable,
	Event,
	EventEmitter,
	ProgressLocation,
	RelativePattern,
	Uri,
	window,
	workspace,
	WorkspaceFolder,
} from 'vscode';
import { configuration } from '../../configuration';
import { StarredRepositories, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { GitBranch, GitContributor, GitDiffShortStat, GitRemote, GitStash, GitStatus, GitTag } from '../git';
import { GitService } from '../gitService';
import { GitUri } from '../gitUri';
import { Logger } from '../../logger';
import { Messages } from '../../messages';
import { GitBranchReference, GitReference, GitTagReference } from './models';
import { RemoteProviderFactory, RemoteProviders, RemoteProviderWithApi } from '../remotes/factory';
import { Arrays, Functions, gate, Iterables, log, logName } from '../../system';
import { runGitCommandInTerminal } from '../../terminal';

const ignoreGitRegex = /\.git(?:\/|\\|$)/;
const refsRegex = /\.git\/refs\/(heads|remotes|tags)/;

export enum RepositoryChange {
	Config = 'config',
	Closed = 'closed',
	// FileSystem = 'file-system',
	Heads = 'heads',
	Index = 'index',
	Ignores = 'ignores',
	Remotes = 'remotes',
	Stash = 'stash',
	Tags = 'tags',
	Unknown = 'unknown',
}

export class RepositoryChangeEvent {
	constructor(public readonly repository?: Repository, public readonly changes: RepositoryChange[] = []) {}

	changed(change: RepositoryChange, only: boolean = false) {
		if (only) return this.changes.length === 1 && this.changes[0] === change;

		return this.changes.includes(change);

		// const changed = this.changes.includes(change);
		// if (changed) return true;

		// if (change === RepositoryChange.Repository) {
		//     return this.changes.includes(RepositoryChange.Stashes);
		// }

		// return false;
	}
}

export interface RepositoryFileSystemChangeEvent {
	readonly repository?: Repository;
	readonly uris: Uri[];
}

@logName<Repository>((r, name) => `${name}(${r.id})`)
export class Repository implements Disposable {
	static sort(repositories: Repository[]) {
		return repositories.sort((a, b) => (a.starred ? -1 : 1) - (b.starred ? -1 : 1) || a.index - b.index);
	}

	private _onDidChange = new EventEmitter<RepositoryChangeEvent>();
	get onDidChange(): Event<RepositoryChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeFileSystem = new EventEmitter<RepositoryFileSystemChangeEvent>();
	get onDidChangeFileSystem(): Event<RepositoryFileSystemChangeEvent> {
		return this._onDidChangeFileSystem.event;
	}

	readonly formattedName: string;
	readonly id: string;
	readonly index: number;
	readonly name: string;
	readonly normalizedPath: string;
	readonly supportsChangeEvents: boolean = true;

	private _branch: Promise<GitBranch | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _fireChangeDebounced: ((e: RepositoryChangeEvent) => void) | undefined = undefined;
	private _fireFileSystemChangeDebounced: ((e: RepositoryFileSystemChangeEvent) => void) | undefined = undefined;
	private _fsWatchCounter = 0;
	private _fsWatcherDisposable: Disposable | undefined;
	private _pendingChanges: { repo?: RepositoryChangeEvent; fs?: RepositoryFileSystemChangeEvent } = {};
	private _providers: RemoteProviders | undefined;
	private _remotes: Promise<GitRemote[]> | undefined;
	private _remotesDisposable: Disposable | undefined;
	private _suspended: boolean;

	constructor(
		public readonly folder: WorkspaceFolder,
		public readonly path: string,
		public readonly root: boolean,
		private readonly onAnyRepositoryChanged: (repo: Repository, e: RepositoryChangeEvent) => void,
		suspended: boolean,
		closed: boolean = false,
	) {
		const relativePath = paths.relative(folder.uri.fsPath, path);
		if (root) {
			// Check if the repository is not contained by a workspace folder
			const repoFolder = workspace.getWorkspaceFolder(GitUri.fromRepoPath(path));
			if (repoFolder == null) {
				// If it isn't within a workspace folder we can't get change events, see: https://github.com/Microsoft/vscode/issues/3025
				this.supportsChangeEvents = false;
				this.formattedName = this.name = paths.basename(path);
			} else {
				this.formattedName = this.name = folder.name;
			}
		} else {
			this.formattedName = relativePath ? `${folder.name} (${relativePath})` : folder.name;
			this.name = folder.name;
		}
		this.index = folder.index;

		this.normalizedPath = (path.endsWith('/') ? path : `${path}/`).toLowerCase();
		this.id = this.normalizedPath;

		this._suspended = suspended;
		this._closed = closed;

		// TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
		// https://github.com/Microsoft/vscode/issues/3025
		const watcher = workspace.createFileSystemWatcher(
			new RelativePattern(
				folder,
				'{\
**/.git/config,\
**/.git/index,\
**/.git/HEAD,\
**/.git/refs/stash,\
**/.git/refs/heads/**,\
**/.git/refs/remotes/**,\
**/.git/refs/tags/**,\
**/.gitignore\
}',
			),
		);
		this._disposable = Disposable.from(
			watcher,
			watcher.onDidChange(this.onRepositoryChanged, this),
			watcher.onDidCreate(this.onRepositoryChanged, this),
			watcher.onDidDelete(this.onRepositoryChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this.stopWatchingFileSystem();

		// // Clean up any disposables in storage
		// for (const item of this.storage.values()) {
		//     if (item != null && typeof item.dispose === 'function') {
		//         item.dispose();
		//     }
		// }

		this._remotesDisposable?.dispose();
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'remotes', this.folder.uri)) {
			this._providers = RemoteProviderFactory.loadProviders(configuration.get('remotes', this.folder.uri));

			if (!configuration.initializing(e)) {
				this.resetRemotesCache();
				this.fireChange(RepositoryChange.Remotes);
			}
		}
	}

	private onFileSystemChanged(uri: Uri) {
		// Ignore .git changes
		if (ignoreGitRegex.test(uri.fsPath)) return;

		this.fireFileSystemChange(uri);
	}

	private onRepositoryChanged(uri: Uri | undefined) {
		if (uri == null) {
			this.fireChange(RepositoryChange.Unknown);

			return;
		}

		if (uri.path.endsWith('.git/config')) {
			this._branch = undefined;
			this.resetRemotesCache();
			this.fireChange(RepositoryChange.Config, RepositoryChange.Remotes);

			return;
		}

		if (uri.path.endsWith('.git/index')) {
			this.fireChange(RepositoryChange.Index);

			return;
		}

		if (uri.path.endsWith('.git/HEAD') || uri.path.endsWith('.git/ORIG_HEAD')) {
			this._branch = undefined;
			this.fireChange(RepositoryChange.Heads);

			return;
		}

		if (uri.path.endsWith('.git/refs/stash')) {
			this.fireChange(RepositoryChange.Stash);

			return;
		}

		if (uri.path.endsWith('/.gitignore')) {
			this.fireChange(RepositoryChange.Ignores);

			return;
		}

		const match = refsRegex.exec(uri.path);
		if (match != null) {
			switch (match[1]) {
				case 'heads':
					this._branch = undefined;
					this.fireChange(RepositoryChange.Heads);

					return;
				case 'remotes':
					this._branch = undefined;
					this.resetRemotesCache();
					this.fireChange(RepositoryChange.Remotes);

					return;
				case 'tags':
					this.fireChange(RepositoryChange.Tags);

					return;
			}
		}

		this.fireChange(RepositoryChange.Unknown);
	}

	private _closed: boolean = false;
	get closed(): boolean {
		return this._closed;
	}
	set closed(value: boolean) {
		const changed = this._closed !== value;
		this._closed = value;
		if (changed) {
			this.fireChange(RepositoryChange.Closed);
		}
	}

	@gate()
	@log()
	branch(...args: string[]) {
		this.runTerminalCommand('branch', ...args);
	}

	@gate()
	@log()
	branchDelete(
		branches: GitBranchReference | GitBranchReference[],
		{ force, remote }: { force?: boolean; remote?: boolean } = {},
	) {
		if (!Array.isArray(branches)) {
			branches = [branches];
		}

		const localBranches = branches.filter(b => !b.remote);
		if (localBranches.length !== 0) {
			const args = ['--delete'];
			if (force) {
				args.push('--force');
			}
			this.runTerminalCommand('branch', ...args, ...branches.map(b => b.ref));

			if (remote) {
				const trackingBranches = localBranches.filter(b => b.tracking != null);
				if (trackingBranches.length !== 0) {
					const branchesByOrigin = Arrays.groupByMap(trackingBranches, b => GitBranch.getRemote(b.tracking!));

					for (const [remote, branches] of branchesByOrigin.entries()) {
						this.runTerminalCommand(
							'push',
							'-d',
							remote,
							...branches.map(b => GitBranch.getNameWithoutRemote(b.tracking!)),
						);
					}
				}
			}
		}

		const remoteBranches = branches.filter(b => b.remote);
		if (remoteBranches.length !== 0) {
			const branchesByOrigin = Arrays.groupByMap(remoteBranches, b => GitBranch.getRemote(b.name));

			for (const [remote, branches] of branchesByOrigin.entries()) {
				this.runTerminalCommand(
					'push',
					'-d',
					remote,
					...branches.map(b => GitReference.getNameWithoutRemote(b)),
				);
			}
		}
	}

	@gate(() => '')
	@log()
	cherryPick(...args: string[]) {
		this.runTerminalCommand('cherry-pick', ...args);
	}

	containsUri(uri: Uri) {
		if (GitUri.is(uri)) {
			uri = uri.repoPath != null ? GitUri.file(uri.repoPath) : uri.documentUri();
		}

		return this.folder === workspace.getWorkspaceFolder(uri);
	}

	@gate()
	@log()
	async fetch(
		options: {
			all?: boolean;
			branch?: GitBranchReference;
			progress?: boolean;
			prune?: boolean;
			remote?: string;
		} = {},
	) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.fetchCore(opts);

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: opts.branch
					? `Pulling ${opts.branch.name}...`
					: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${this.formattedName}...`,
			},
			() => this.fetchCore(opts),
		));
	}

	private async fetchCore(
		options: { all?: boolean; branch?: GitBranchReference; prune?: boolean; remote?: string } = {},
	) {
		try {
			void (await Container.git.fetch(this.path, options));

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void Messages.showGenericErrorMessage('Unable to fetch repository');
		}
	}

	async getBranch(name?: string): Promise<GitBranch | undefined> {
		if (name) {
			const [branch] = await this.getBranches({ filter: b => b.name === name });
			return branch;
		}

		if (this._branch == null || !this.supportsChangeEvents) {
			this._branch = Container.git.getBranch(this.path);
		}
		return this._branch;
	}

	getBranches(
		options: { filter?: (b: GitBranch) => boolean; sort?: boolean | { current: boolean } } = {},
	): Promise<GitBranch[]> {
		return Container.git.getBranches(this.path, options);
	}

	getBranchesAndOrTags(
		options: {
			filterBranches?: (b: GitBranch) => boolean;
			filterTags?: (t: GitTag) => boolean;
			include?: 'all' | 'branches' | 'tags';
			sort?: boolean | { current: boolean };
		} = {},
	) {
		return Container.git.getBranchesAndOrTags(this.path, options);
	}

	getChangedFilesCount(sha?: string): Promise<GitDiffShortStat | undefined> {
		return Container.git.getChangedFilesCount(this.path, sha);
	}

	getContributors(): Promise<GitContributor[]> {
		return Container.git.getContributors(this.path);
	}

	async getLastFetched(): Promise<number> {
		const hasRemotes = await this.hasRemotes();
		if (!hasRemotes || Container.vsls.isMaybeGuest) return 0;

		try {
			const stat = await workspace.fs.stat(Uri.file(paths.join(this.path, '.git/FETCH_HEAD')));
			return stat.mtime;
		} catch {
			return 0;
		}
	}

	getRemotes(_options: { sort?: boolean } = {}): Promise<GitRemote[]> {
		if (this._remotes == null || !this.supportsChangeEvents) {
			if (this._providers == null) {
				const remotesCfg = configuration.get('remotes', this.folder.uri);
				this._providers = RemoteProviderFactory.loadProviders(remotesCfg);
			}

			// Since we are caching the results, always sort
			this._remotes = Container.git.getRemotesCore(this.path, this._providers, { sort: true });
			void this.subscribeToRemotes(this._remotes);
		}

		return this._remotes;
	}

	private resetRemotesCache() {
		this._remotes = undefined;
		this._remotesDisposable?.dispose();
		this._remotesDisposable = undefined;
	}

	private async subscribeToRemotes(remotes: Promise<GitRemote[]>) {
		this._remotesDisposable?.dispose();
		this._remotesDisposable = undefined;

		this._remotesDisposable = Disposable.from(
			...Iterables.filterMap(await remotes, r => {
				if (!(r.provider instanceof RemoteProviderWithApi)) return undefined;

				return r.provider.onDidChange(() => this.fireChange(RepositoryChange.Remotes));
			}),
		);
	}

	getStash(): Promise<GitStash | undefined> {
		return Container.git.getStash(this.path);
	}

	getStatus(): Promise<GitStatus | undefined> {
		return Container.git.getStatusForRepo(this.path);
	}

	getTags(options?: { filter?: (t: GitTag) => boolean; sort?: boolean }): Promise<GitTag[]> {
		return Container.git.getTags(this.path, options);
	}

	async hasRemotes(): Promise<boolean> {
		const remotes = await this.getRemotes();
		return remotes?.length > 0;
	}

	async hasConnectedRemotes(): Promise<boolean> {
		const remotes = await this.getRemotes();
		const remote = await Container.git.getRemoteWithApiProvider(remotes);
		return remote?.provider != null;
	}

	async hasTrackingBranch(): Promise<boolean> {
		const branch = await this.getBranch();
		return branch?.tracking != null;
	}

	@gate(() => '')
	@log()
	merge(...args: string[]) {
		this.runTerminalCommand('merge', ...args);
	}

	@gate()
	@log()
	async pull(options: { progress?: boolean; rebase?: boolean } = {}) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pullCore();

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${this.formattedName}...`,
			},
			() => this.pullCore(opts),
		));
	}

	private async pullCore(options: { rebase?: boolean } = {}) {
		try {
			const tracking = await this.hasTrackingBranch();
			if (tracking) {
				void (await commands.executeCommand(options.rebase ? 'git.pullRebase' : 'git.pull', this.path));
			} else if (configuration.getAny<boolean>('git.fetchOnPull', Uri.file(this.path))) {
				void (await Container.git.fetch(this.path));
			}

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void Messages.showGenericErrorMessage('Unable to pull repository');
		}
	}

	@gate()
	@log()
	async push(
		options: {
			force?: boolean;
			progress?: boolean;
			reference?: GitReference;
			publish?: {
				remote: string;
			};
		} = {},
	) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pushCore(opts);

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: GitReference.isBranch(opts.reference)
					? `${opts.publish ? 'Publishing ' : 'Pushing '}${opts.reference.name}...`
					: `Pushing ${this.formattedName}...`,
			},
			() => this.pushCore(opts),
		));
	}

	private async pushCore(
		options: {
			force?: boolean;
			reference?: GitReference;
			publish?: {
				remote: string;
			};
		} = {},
	) {
		try {
			if (GitReference.isBranch(options.reference)) {
				const repo = await GitService.getBuiltInGitRepository(this.path);
				if (repo == null) return;

				if (options.publish != null) {
					await repo?.push(options.publish.remote, options.reference.name, true);
				} else {
					const branch = await this.getBranch(options.reference.name);
					if (branch == null) return;

					await repo?.push(branch.getRemoteName(), branch.name);
				}
			} else if (options.reference != null) {
				const repo = await GitService.getBuiltInGitRepository(this.path);
				if (repo == null) return;

				const branch = await this.getBranch();
				if (branch == null) return;

				await repo?.push(branch.getRemoteName(), `${options.reference.ref}:${branch.getNameWithoutRemote()}`);
			} else {
				void (await commands.executeCommand(options.force ? 'git.pushForce' : 'git.push', this.path));
			}

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void Messages.showGenericErrorMessage('Unable to push repository');
		}
	}

	@gate(() => '')
	@log()
	rebase(...args: string[]) {
		this.runTerminalCommand('rebase', ...args);
	}

	@gate(() => '')
	@log()
	reset(...args: string[]) {
		this.runTerminalCommand('reset', ...args);
	}

	resume() {
		if (!this._suspended) return;

		this._suspended = false;

		// If we've come back into focus and we are dirty, fire the change events

		if (this._pendingChanges.repo != null) {
			this._fireChangeDebounced!(this._pendingChanges.repo);
		}

		if (this._pendingChanges.fs != null) {
			this._fireFileSystemChangeDebounced!(this._pendingChanges.fs);
		}
	}

	@gate()
	@log()
	revert(...args: string[]) {
		this.runTerminalCommand('revert', ...args);
	}

	get starred() {
		const starred = Container.context.workspaceState.get<StarredRepositories>(WorkspaceState.StarredRepositories);
		return starred != null && starred[this.id] === true;
	}

	star() {
		return this.updateStarred(true);
	}

	@gate(() => '')
	@log()
	async stashApply(stashName: string, options: { deleteAfter?: boolean } = {}) {
		void (await Container.git.stashApply(this.path, stashName, options));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stash);
		}
	}

	@gate(() => '')
	@log()
	async stashDelete(stashName: string, ref?: string) {
		void (await Container.git.stashDelete(this.path, stashName, ref));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stash);
		}
	}

	@gate(() => '')
	@log()
	async stashSave(message?: string, uris?: Uri[], options: { includeUntracked?: boolean; keepIndex?: boolean } = {}) {
		void (await Container.git.stashSave(this.path, message, uris, options));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stash);
		}
	}

	@gate()
	@log()
	async switch(ref: string, options: { createBranch?: string | undefined; progress?: boolean } = {}) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.switchCore(ref, opts);

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${this.formattedName} to ${ref}...`,
				cancellable: false,
			},
			() => this.switchCore(ref, opts),
		));
	}

	private async switchCore(ref: string, options: { createBranch?: string } = {}) {
		try {
			void (await Container.git.checkout(this.path, ref, options));

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void Messages.showGenericErrorMessage('Unable to switch to reference');
		}
	}

	toAbsoluteUri(path: string, options?: { validate?: boolean }): Uri | undefined {
		const uri = Uri.joinPath(GitUri.file(this.path), path);
		return !(options?.validate ?? true) || this.containsUri(uri) ? uri : undefined;
	}

	unstar() {
		return this.updateStarred(false);
	}

	private async updateStarred(star: boolean) {
		let starred = Container.context.workspaceState.get<StarredRepositories>(WorkspaceState.StarredRepositories);
		if (starred == null) {
			starred = Object.create(null) as StarredRepositories;
		}

		if (star) {
			starred[this.id] = true;
		} else {
			const { [this.id]: _, ...rest } = starred;
			starred = rest;
		}
		await Container.context.workspaceState.update(WorkspaceState.StarredRepositories, starred);
	}

	startWatchingFileSystem() {
		this._fsWatchCounter++;
		if (this._fsWatcherDisposable != null) return;

		// TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
		// https://github.com/Microsoft/vscode/issues/3025
		const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.folder, '**'));
		this._fsWatcherDisposable = Disposable.from(
			watcher,
			watcher.onDidChange(this.onFileSystemChanged, this),
			watcher.onDidCreate(this.onFileSystemChanged, this),
			watcher.onDidDelete(this.onFileSystemChanged, this),
		);
	}

	stopWatchingFileSystem() {
		if (this._fsWatcherDisposable == null) return;
		if (--this._fsWatchCounter > 0) return;

		this._fsWatcherDisposable.dispose();
		this._fsWatcherDisposable = undefined;
	}

	suspend() {
		this._suspended = true;
	}

	@gate()
	@log()
	tag(...args: string[]) {
		this.runTerminalCommand('tag', ...args);
	}

	@gate()
	@log()
	tagDelete(tags: GitTagReference | GitTagReference[]) {
		if (!Array.isArray(tags)) {
			tags = [tags];
		}

		const args = ['--delete'];
		this.runTerminalCommand('tag', ...args, ...tags.map(t => t.ref));
	}

	private fireChange(...changes: RepositoryChange[]) {
		this.onAnyRepositoryChanged(this, new RepositoryChangeEvent(this, changes));

		if (this._fireChangeDebounced == null) {
			this._fireChangeDebounced = Functions.debounce(this.fireChangeCore.bind(this), 250);
		}

		if (this._pendingChanges.repo == null) {
			this._pendingChanges.repo = new RepositoryChangeEvent(this);
		}

		const e = this._pendingChanges.repo;

		for (const reason of changes) {
			if (!e.changes.includes(reason)) {
				e.changes.push(reason);
			}
		}

		if (this._suspended) return;

		this._fireChangeDebounced(e);
	}

	private fireChangeCore(e: RepositoryChangeEvent) {
		this._pendingChanges.repo = undefined;

		this._onDidChange.fire(e);
	}

	private fireFileSystemChange(uri: Uri) {
		if (this._fireFileSystemChangeDebounced == null) {
			this._fireFileSystemChangeDebounced = Functions.debounce(this.fireFileSystemChangeCore.bind(this), 2500);
		}

		if (this._pendingChanges.fs == null) {
			this._pendingChanges.fs = { repository: this, uris: [] };
		}

		const e = this._pendingChanges.fs;
		e.uris.push(uri);

		if (this._suspended) return;

		this._fireFileSystemChangeDebounced(e);
	}

	private async fireFileSystemChangeCore(e: RepositoryFileSystemChangeEvent) {
		this._pendingChanges.fs = undefined;

		const uris = await Container.git.excludeIgnoredUris(this.path, e.uris);
		if (uris.length === 0) return;

		if (uris.length !== e.uris.length) {
			e = { ...e, uris: uris };
		}

		this._onDidChangeFileSystem.fire(e);
	}

	private runTerminalCommand(command: string, ...args: string[]) {
		const parsedArgs = args.map(arg => (arg.startsWith('#') ? `"${arg}"` : arg));
		runGitCommandInTerminal(command, parsedArgs.join(' '), this.path, true);
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Unknown);
		}
	}
}
