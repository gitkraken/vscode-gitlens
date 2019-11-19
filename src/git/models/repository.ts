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
	WorkspaceFolder
} from 'vscode';
import { configuration } from '../../configuration';
import { StarredRepositories, WorkspaceState } from '../../constants';
import { Container } from '../../container';
import { Functions, gate, Iterables, log, logName } from '../../system';
import { GitBranch, GitContributor, GitDiffShortStat, GitRemote, GitStash, GitStatus, GitTag } from '../git';
import { GitUri } from '../gitUri';
import { RemoteProviderFactory, RemoteProviders, RemoteProviderWithApi } from '../remotes/factory';
import { Messages } from '../../messages';
import { Logger } from '../../logger';
import { runGitCommandInTerminal } from '../../terminal';

export enum RepositoryChange {
	Config = 'config',
	Closed = 'closed',
	// FileSystem = 'file-system',
	Remotes = 'remotes',
	Repository = 'repository',
	Stashes = 'stashes',
	Tags = 'tags'
}

export class RepositoryChangeEvent {
	constructor(public readonly repository?: Repository, public readonly changes: RepositoryChange[] = []) {}

	changed(change: RepositoryChange, solely: boolean = false) {
		if (solely) return this.changes.length === 1 && this.changes[0] === change;

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
		closed: boolean = false
	) {
		const relativePath = paths.relative(folder.uri.fsPath, path);
		if (root) {
			// Check if the repository is not contained by a workspace folder
			const repoFolder = workspace.getWorkspaceFolder(GitUri.fromRepoPath(path));
			if (repoFolder === undefined) {
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
}'
			)
		);
		this._disposable = Disposable.from(
			watcher,
			watcher.onDidChange(this.onRepositoryChanged, this),
			watcher.onDidCreate(this.onRepositoryChanged, this),
			watcher.onDidDelete(this.onRepositoryChanged, this),
			configuration.onDidChange(this.onConfigurationChanged, this)
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
		if (/\.git(?:\/|\\|$)/.test(uri.fsPath)) return;

		this.fireFileSystemChange(uri);
	}

	private onRepositoryChanged(uri: Uri | undefined) {
		if (uri !== undefined && uri.path.endsWith('refs/stash')) {
			this.fireChange(RepositoryChange.Stashes);

			return;
		}

		this._branch = undefined;

		if (uri !== undefined && uri.path.endsWith('refs/remotes')) {
			this.resetRemotesCache();
			this.fireChange(RepositoryChange.Remotes);

			return;
		}

		if (uri !== undefined && uri.path.endsWith('refs/tags')) {
			this.fireChange(RepositoryChange.Tags);

			return;
		}

		if (uri !== undefined && uri.path.endsWith('config')) {
			this.resetRemotesCache();
			this.fireChange(RepositoryChange.Config, RepositoryChange.Remotes);

			return;
		}

		this.fireChange(RepositoryChange.Repository);
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
	branchDelete(branches: GitBranch | GitBranch[], { force }: { force?: boolean } = {}) {
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
		}

		const remoteBranches = branches.filter(b => b.remote);
		if (remoteBranches.length !== 0) {
			for (const branch of remoteBranches) {
				this.runTerminalCommand('push', `${branch.getRemoteName()} :${branch.getName()}`);
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
			uri = uri.repoPath !== undefined ? GitUri.file(uri.repoPath) : uri.documentUri();
		}

		return this.folder === workspace.getWorkspaceFolder(uri);
	}

	@gate()
	@log()
	async fetch(options: { all?: boolean; progress?: boolean; prune?: boolean; remote?: string } = {}) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.fetchCore(opts);

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${this.formattedName}...`
			},
			() => this.fetchCore(opts)
		));
	}

	private async fetchCore(options: { all?: boolean; prune?: boolean; remote?: string } = {}) {
		try {
			void (await Container.git.fetch(this.path, options));

			this.fireChange(RepositoryChange.Repository);
		} catch (ex) {
			Logger.error(ex);
			Messages.showGenericErrorMessage('Unable to fetch repository');
		}
	}

	getBranch(): Promise<GitBranch | undefined> {
		if (this._branch === undefined || !this.supportsChangeEvents) {
			this._branch = Container.git.getBranch(this.path);
		}
		return this._branch;
	}

	getBranches(options: { filter?: (b: GitBranch) => boolean; sort?: boolean } = {}): Promise<GitBranch[]> {
		return Container.git.getBranches(this.path, options);
	}

	getBranchesAndOrTags(
		options: {
			filterBranches?: (b: GitBranch) => boolean;
			filterTags?: (t: GitTag) => boolean;
			include?: 'all' | 'branches' | 'tags';
			sort?: boolean;
		} = {}
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

	getRemotes(options: { sort?: boolean } = {}): Promise<GitRemote[]> {
		if (this._remotes === undefined || !this.supportsChangeEvents) {
			if (this._providers === undefined) {
				const remotesCfg = configuration.get('remotes', this.folder.uri);
				this._providers = RemoteProviderFactory.loadProviders(remotesCfg);
			}

			// Since we are caching the results, always sort
			this._remotes = Container.git.getRemotesCore(this.path, this._providers, { sort: true });
			this.subscribeToRemotes(this._remotes);
		}

		return this._remotes;
	}

	private resetRemotesCache() {
		this._remotes = undefined;
		if (this._remotesDisposable !== undefined) {
			this._remotesDisposable.dispose();
			this._remotesDisposable = undefined;
		}
	}

	private async subscribeToRemotes(remotes: Promise<GitRemote[]>) {
		if (this._remotesDisposable !== undefined) {
			this._remotesDisposable.dispose();
			this._remotesDisposable = undefined;
		}

		this._remotesDisposable = Disposable.from(
			...Iterables.filterMap(await remotes, r => {
				if (!(r.provider instanceof RemoteProviderWithApi)) return undefined;

				return r.provider.onDidChange(() => this.fireChange(RepositoryChange.Remotes));
			})
		);
	}

	getStashList(): Promise<GitStash | undefined> {
		return Container.git.getStashList(this.path);
	}

	getStatus(): Promise<GitStatus | undefined> {
		return Container.git.getStatusForRepo(this.path);
	}

	getTags(options?: { filter?: (t: GitTag) => boolean; sort?: boolean }): Promise<GitTag[]> {
		return Container.git.getTags(this.path, options);
	}

	async hasRemotes(): Promise<boolean> {
		const remotes = await this.getRemotes();
		return remotes !== undefined && remotes.length > 0;
	}

	async hasTrackingBranch(): Promise<boolean> {
		const branch = await this.getBranch();
		return branch !== undefined && branch.tracking !== undefined;
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
				title: `Pulling ${this.formattedName}...`
			},
			() => this.pullCore(opts)
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

			this.fireChange(RepositoryChange.Repository);
		} catch (ex) {
			Logger.error(ex);
			Messages.showGenericErrorMessage('Unable to pull repository');
		}
	}

	@gate()
	@log()
	async push(options: { force?: boolean; progress?: boolean } = {}) {
		const { force, progress } = { progress: true, ...options };
		if (!progress) return this.pushCore(force);

		return void (await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pushing ${this.formattedName}...`
			},
			() => this.pushCore(force)
		));
	}

	private async pushCore(force: boolean = false) {
		try {
			void (await commands.executeCommand(force ? 'git.pushForce' : 'git.push', this.path));

			this.fireChange(RepositoryChange.Repository);
		} catch (ex) {
			Logger.error(ex);
			Messages.showGenericErrorMessage('Unable to push repository');
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

		if (this._pendingChanges.repo !== undefined) {
			this._fireChangeDebounced!(this._pendingChanges.repo);
		}

		if (this._pendingChanges.fs !== undefined) {
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
		return starred !== undefined && starred[this.id] === true;
	}

	star() {
		return this.updateStarred(true);
	}

	@gate(() => '')
	@log()
	async stashApply(stashName: string, options: { deleteAfter?: boolean } = {}) {
		void (await Container.git.stashApply(this.path, stashName, options));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stashes);
		}
	}

	@gate(() => '')
	@log()
	async stashDelete(stashName: string) {
		void (await Container.git.stashDelete(this.path, stashName));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stashes);
		}
	}

	@gate(() => '')
	@log()
	async stashSave(message?: string, uris?: Uri[], options: { includeUntracked?: boolean; keepIndex?: boolean } = {}) {
		void (await Container.git.stashSave(this.path, message, uris, options));
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Stashes);
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
				cancellable: false
			},
			() => this.switchCore(ref, opts)
		));
	}

	private async switchCore(ref: string, options: { createBranch?: string } = {}) {
		try {
			void (await Container.git.checkout(this.path, ref, options));

			this.fireChange(RepositoryChange.Repository);
		} catch (ex) {
			Logger.error(ex);
			Messages.showGenericErrorMessage('Unable to switch to reference');
		}
	}

	unstar() {
		return this.updateStarred(false);
	}

	private async updateStarred(star: boolean) {
		let starred = Container.context.workspaceState.get<StarredRepositories>(WorkspaceState.StarredRepositories);
		if (starred === undefined) {
			starred = Object.create(null);
		}

		if (star) {
			starred![this.id] = true;
		} else {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { [this.id]: _, ...rest } = starred!;
			starred = rest;
		}
		await Container.context.workspaceState.update(WorkspaceState.StarredRepositories, starred);
	}

	startWatchingFileSystem() {
		this._fsWatchCounter++;
		if (this._fsWatcherDisposable !== undefined) return;

		// TODO: createFileSystemWatcher doesn't work unless the folder is part of the workspaceFolders
		// https://github.com/Microsoft/vscode/issues/3025
		const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.folder, '**'));
		this._fsWatcherDisposable = Disposable.from(
			watcher,
			watcher.onDidChange(this.onFileSystemChanged, this),
			watcher.onDidCreate(this.onFileSystemChanged, this),
			watcher.onDidDelete(this.onFileSystemChanged, this)
		);
	}

	stopWatchingFileSystem() {
		if (this._fsWatcherDisposable === undefined) return;
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
	tagDelete(tags: GitTag | GitTag[]) {
		if (!Array.isArray(tags)) {
			tags = [tags];
		}

		const args = ['--delete'];
		this.runTerminalCommand('tag', ...args, ...tags.map(t => t.ref));
	}

	private fireChange(...changes: RepositoryChange[]) {
		this.onAnyRepositoryChanged(this, new RepositoryChangeEvent(this, changes));

		if (this._fireChangeDebounced === undefined) {
			this._fireChangeDebounced = Functions.debounce(this.fireChangeCore.bind(this), 250);
		}

		if (this._pendingChanges.repo === undefined) {
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
		if (this._fireFileSystemChangeDebounced === undefined) {
			this._fireFileSystemChangeDebounced = Functions.debounce(this.fireFileSystemChangeCore.bind(this), 2500);
		}

		if (this._pendingChanges.fs === undefined) {
			this._pendingChanges.fs = { repository: this, uris: [] };
		}

		const e = this._pendingChanges.fs;
		e.uris.push(uri);

		if (this._suspended) return;

		this._fireFileSystemChangeDebounced(e);
	}

	private fireFileSystemChangeCore(e: RepositoryFileSystemChangeEvent) {
		this._pendingChanges.fs = undefined;

		this._onDidChangeFileSystem.fire(e);
	}

	private runTerminalCommand(command: string, ...args: string[]) {
		const parsedArgs = args.map(arg => (arg.startsWith('#') ? `"${arg}"` : arg));
		runGitCommandInTerminal(command, parsedArgs.join(' '), this.path, true);
		if (!this.supportsChangeEvents) {
			this.fireChange(RepositoryChange.Repository);
		}
	}
}
