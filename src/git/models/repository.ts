import type { CancellationToken, ConfigurationChangeEvent, Event, Uri, WorkspaceFolder } from 'vscode';
import { Disposable, EventEmitter, ProgressLocation, RelativePattern, window, workspace } from 'vscode';
import { md5 } from '@env/crypto';
import { ForcePushMode } from '../../@types/vscode.git.enums';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import type { CoreGitConfiguration } from '../../constants';
import { Schemes } from '../../constants';
import type { Container } from '../../container';
import type { FeatureAccess, Features, PlusFeatures } from '../../features';
import { showCreatePullRequestPrompt, showGenericErrorMessage } from '../../messages';
import { asRepoComparisonKey } from '../../repositories';
import { groupByMap } from '../../system/array';
import { executeActionCommand, executeCoreGitCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug, log, logName } from '../../system/decorators/log';
import { debounce } from '../../system/function';
import { filter, join, some } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { updateRecordValue } from '../../system/object';
import { basename, normalizePath } from '../../system/path';
import type { GitDir, GitProviderDescriptor, GitRepositoryCaches } from '../gitProvider';
import type { RichRemoteProvider } from '../remotes/richRemoteProvider';
import type { GitSearch, SearchQuery } from '../search';
import type { BranchSortOptions, GitBranch } from './branch';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from './branch';
import type { GitCommit } from './commit';
import type { GitContributor } from './contributor';
import type { GitDiffShortStat } from './diff';
import type { GitLog } from './log';
import type { GitMergeStatus } from './merge';
import type { GitRebaseStatus } from './rebase';
import type { GitBranchReference, GitReference, GitTagReference } from './reference';
import { getNameWithoutRemote, isBranchReference } from './reference';
import type { GitRemote } from './remote';
import type { GitStash } from './stash';
import type { GitStatus } from './status';
import type { GitTag, TagSortOptions } from './tag';
import type { GitWorktree } from './worktree';

const emptyArray = Object.freeze([]) as unknown as any[];

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const dotGitWatcherGlobFiles = 'index,HEAD,*_HEAD,MERGE_*,rebase-merge/**,sequencer/**';
const dotGitWatcherGlobWorktreeFiles =
	'worktrees/**/index,worktrees/**/HEAD,worktrees/**/*_HEAD,worktrees/**/MERGE_*,worktrees/**/rebase-merge/**,worktrees/**/sequencer/**';

const dotGitWatcherGlobRoot = `{${dotGitWatcherGlobFiles}}`;
const dotGitWatcherGlobCommon = `{config,refs/**,${dotGitWatcherGlobWorktreeFiles}}`;
const dotGitWatcherGlobCombined = `{${dotGitWatcherGlobFiles},config,refs/**,${dotGitWatcherGlobWorktreeFiles}}`;

export const enum RepositoryChange {
	Unknown = -1,

	// File watching required
	Index = 0,
	Head = 1,
	Heads = 2,
	Tags = 3,
	Stash = 4,
	Remotes = 5,
	Worktrees = 6,
	Config = 7,
	/*
	 * Union of Cherry, Merge, and Rebase
	 */
	Status = 8,
	CherryPick = 9,
	Merge = 10,
	Rebase = 11,

	// No file watching required
	Closed = 100,
	Ignores = 101,
	RemoteProviders = 102,
	Starred = 103,
	Opened = 104,
}

export const enum RepositoryChangeComparisonMode {
	Any,
	All,
	Exclusive,
}

export class RepositoryChangeEvent {
	private readonly _changes: Set<RepositoryChange>;

	constructor(
		public readonly repository: Repository,
		changes: RepositoryChange[],
	) {
		this._changes = new Set(changes);
	}

	toString(changesOnly: boolean = false): string {
		return changesOnly
			? `changes=${join(this._changes, ', ')}`
			: `{ repository: ${this.repository?.name ?? ''}, changes: ${join(this._changes, ', ')} }`;
	}

	changed(...args: [...RepositoryChange[], RepositoryChangeComparisonMode]) {
		const affected = args.slice(0, -1) as RepositoryChange[];
		const mode = args[args.length - 1] as RepositoryChangeComparisonMode;

		if (mode === RepositoryChangeComparisonMode.Any) {
			return some(this._changes, c => affected.includes(c));
		}

		let changes = this._changes;

		if (mode === RepositoryChangeComparisonMode.Exclusive) {
			if (
				affected.includes(RepositoryChange.CherryPick) ||
				affected.includes(RepositoryChange.Merge) ||
				affected.includes(RepositoryChange.Rebase)
			) {
				if (!affected.includes(RepositoryChange.Status)) {
					affected.push(RepositoryChange.Status);
				}
			} else if (affected.includes(RepositoryChange.Status)) {
				changes = new Set(changes);
				changes.delete(RepositoryChange.CherryPick);
				changes.delete(RepositoryChange.Merge);
				changes.delete(RepositoryChange.Rebase);
			}
		}

		const intersection = [...filter(changes, c => affected.includes(c))];
		return mode === RepositoryChangeComparisonMode.Exclusive
			? intersection.length === changes.size
			: intersection.length === affected.length;
	}

	with(changes: RepositoryChange[]) {
		return new RepositoryChangeEvent(this.repository, [...this._changes, ...changes]);
	}
}

export interface RepositoryFileSystemChangeEvent {
	readonly repository?: Repository;
	readonly uris: Uri[];
}

@logName<Repository>((r, name) => `${name}(${r.id})`)
export class Repository implements Disposable {
	static formatLastFetched(lastFetched: number, short: boolean = true): string {
		const date = new Date(lastFetched);
		if (Date.now() - lastFetched < millisecondsPerDay) {
			return fromNow(date);
		}

		if (short) {
			return formatDate(date, configuration.get('defaultDateShortFormat') ?? 'short');
		}

		let format =
			configuration.get('defaultDateFormat') ??
			`dddd, MMMM Do, YYYY [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
		if (!/[hHm]/.test(format)) {
			format += ` [at] ${configuration.get('defaultTimeFormat') ?? 'h:mma'}`;
		}
		return formatDate(date, format);
	}

	static getLastFetchedUpdateInterval(lastFetched: number): number {
		const timeDiff = Date.now() - lastFetched;
		return timeDiff < millisecondsPerDay
			? (timeDiff < millisecondsPerHour ? millisecondsPerMinute : millisecondsPerHour) / 2
			: 0;
	}

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

	get formattedName(): string {
		// return this.isMaybeWorktree() === true ? `${this.name} (worktree)` : this.name;
		return this.name;
	}

	readonly id: string;
	readonly index: number;
	readonly name: string;

	private _idHash: string | undefined;
	get idHash() {
		if (this._idHash === undefined) {
			this._idHash = md5(this.id);
		}
		return this._idHash;
	}

	private _branch: Promise<GitBranch | undefined> | undefined;
	private readonly _disposable: Disposable;
	private _fireChangeDebounced: (() => void) | undefined = undefined;
	private _fireFileSystemChangeDebounced: (() => void) | undefined = undefined;
	private _fsWatchCounter = 0;
	private _fsWatcherDisposable: Disposable | undefined;
	private _pendingFileSystemChange?: RepositoryFileSystemChangeEvent;
	private _pendingRepoChange?: RepositoryChangeEvent;
	private _suspended: boolean;

	constructor(
		private readonly container: Container,
		private readonly onDidRepositoryChange: (repo: Repository, e: RepositoryChangeEvent) => void,
		public readonly provider: GitProviderDescriptor,
		public readonly folder: WorkspaceFolder | undefined,
		public readonly uri: Uri,
		public readonly root: boolean,
		suspended: boolean,
		closed: boolean = false,
	) {
		folder = workspace.getWorkspaceFolder(uri) ?? folder;
		if (folder != null) {
			if (root) {
				this.name = folder.name;
			} else {
				const relativePath = container.git.getRelativePath(uri, folder.uri);
				this.name = relativePath ? relativePath : folder.name;
			}
		} else {
			this.name = basename(uri.path);

			// TODO@eamodio should we create a fake workspace folder?
			// folder = {
			// 	uri: uri,
			// 	name: this.name,
			// 	index: container.git.repositoryCount,
			// };
		}
		this.index = folder?.index ?? container.git.repositoryCount;

		this.id = asRepoComparisonKey(uri);

		this._suspended = suspended;
		this._closed = closed;

		this._disposable = Disposable.from(
			this.setupRepoWatchers(),
			configuration.onDidChange(this.onConfigurationChanged, this),
			// Sending this event in the `'git:cache:reset'` below to avoid unnecessary work. While we will refresh more than needed, this doesn't happen often
			// container.richRemoteProviders.onAfterDidChangeConnectionState(async e => {
			// 	const uniqueKeys = new Set<string>();
			// 	for (const remote of await this.getRemotes()) {
			// 		if (remote.provider?.hasRichIntegration()) {
			// 			uniqueKeys.add(remote.provider.key);
			// 		}
			// 	}

			// 	if (uniqueKeys.has(e.key)) {
			// 		this.fireChange(RepositoryChange.RemoteProviders);
			// 	}
			// }),
		);

		this.onConfigurationChanged();
	}

	private setupRepoWatchers() {
		let disposable: Disposable | undefined;

		void this.setupRepoWatchersCore().then(d => (disposable = d));

		return {
			dispose: () => void disposable?.dispose(),
		};
	}

	@debug({ singleLine: true })
	private async setupRepoWatchersCore() {
		const scope = getLogScope();

		const disposables: Disposable[] = [];

		disposables.push(
			this.container.events.on('git:cache:reset', e => {
				if (!e.data.repoPath || e.data.repoPath === this.path) {
					this.resetCaches(...(e.data.caches ?? emptyArray));

					if (e.data.caches?.includes('providers')) {
						this.fireChange(RepositoryChange.RemoteProviders);
					}
				}
			}),
		);

		const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.uri, '**/.gitignore'));
		disposables.push(
			watcher,
			watcher.onDidChange(this.onGitIgnoreChanged, this),
			watcher.onDidCreate(this.onGitIgnoreChanged, this),
			watcher.onDidDelete(this.onGitIgnoreChanged, this),
		);

		function watch(this: Repository, uri: Uri, pattern: string) {
			Logger.debug(scope, `watching '${uri.toString(true)}' for repository changes`);

			const watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, pattern));

			disposables.push(
				watcher,
				watcher.onDidChange(e => this.onRepositoryChanged(e, uri)),
				watcher.onDidCreate(e => this.onRepositoryChanged(e, uri)),
				watcher.onDidDelete(e => this.onRepositoryChanged(e, uri)),
			);
			return watcher;
		}

		const gitDir = await this.getGitDir();
		if (gitDir != null) {
			if (gitDir?.commonUri == null) {
				watch.call(this, gitDir.uri, dotGitWatcherGlobCombined);
			} else {
				watch.call(this, gitDir.uri, dotGitWatcherGlobRoot);
				watch.call(this, gitDir.commonUri, dotGitWatcherGlobCommon);
			}
		}

		return Disposable.from(...disposables);
	}

	dispose() {
		this.stopWatchingFileSystem();

		this._disposable.dispose();
	}

	toString(): string {
		return `${getLoggableName(this)}(${this.id})`;
	}

	get virtual(): boolean {
		return this.provider.virtual;
	}

	get path(): string {
		return this.uri.scheme === Schemes.File ? normalizePath(this.uri.fsPath) : this.uri.toString();
	}

	get etag(): number {
		return this._updatedAt;
	}

	private _updatedAt: number = 0;
	get updatedAt(): number {
		return this._updatedAt;
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (e != null && configuration.changed(e, 'remotes', this.folder?.uri)) {
			this.resetCaches('remotes');
			this.fireChange(RepositoryChange.Remotes);
		}
	}

	private onFileSystemChanged(uri: Uri) {
		// Ignore .git changes
		if (/\.git(?:\/|\\|$)/.test(uri.fsPath)) return;

		this._etagFileSystem = Date.now();
		this.fireFileSystemChange(uri);
	}

	@debug()
	private onGitIgnoreChanged(_uri: Uri) {
		this.fireChange(RepositoryChange.Ignores);
	}

	@debug()
	private onRepositoryChanged(uri: Uri | undefined, base: Uri) {
		// TODO@eamodio Revisit -- as I can't seem to get this to work as a negative glob pattern match when creating the watcher
		if (uri?.path.includes('/fsmonitor--daemon/')) {
			return;
		}

		this._lastFetched = undefined;

		const match =
			uri != null
				? // Move worktrees first, since if it is in a worktree it isn't affecting this repo directly
				  /(worktrees|index|HEAD|FETCH_HEAD|ORIG_HEAD|CHERRY_PICK_HEAD|MERGE_HEAD|REBASE_HEAD|rebase-merge|config|refs\/(?:heads|remotes|stash|tags))/.exec(
						this.container.git.getRelativePath(uri, base),
				  )
				: undefined;

		if (match != null) {
			switch (match[1]) {
				case 'config':
					this.resetCaches();
					this.fireChange(RepositoryChange.Config, RepositoryChange.Remotes);
					return;

				case 'index':
					this.fireChange(RepositoryChange.Index);
					return;

				case 'FETCH_HEAD':
					// Ignore any changes to FETCH_HEAD as unless other things change, nothing changes that we care about
					return;

				case 'HEAD':
					this.resetCaches('branches');
					this.fireChange(RepositoryChange.Head, RepositoryChange.Heads);
					return;

				case 'ORIG_HEAD':
					this.resetCaches('branches');
					this.fireChange(RepositoryChange.Heads);
					return;

				case 'CHERRY_PICK_HEAD':
					this.fireChange(RepositoryChange.CherryPick, RepositoryChange.Status);
					return;

				case 'MERGE_HEAD':
					this.fireChange(RepositoryChange.Merge, RepositoryChange.Status);
					return;

				case 'REBASE_HEAD':
				case 'rebase-merge':
					this.fireChange(RepositoryChange.Rebase, RepositoryChange.Status);
					return;

				case 'refs/heads':
					this.resetCaches('branches');
					this.fireChange(RepositoryChange.Heads);
					return;

				case 'refs/remotes':
					this.resetCaches();
					this.fireChange(RepositoryChange.Remotes);
					return;

				case 'refs/stash':
					this.fireChange(RepositoryChange.Stash);
					return;

				case 'refs/tags':
					this.fireChange(RepositoryChange.Tags);
					return;

				case 'worktrees':
					this.fireChange(RepositoryChange.Worktrees);
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
			this.fireChange(this._closed ? RepositoryChange.Closed : RepositoryChange.Opened);
		}
	}

	@log()
	access(feature?: PlusFeatures): Promise<FeatureAccess> {
		return this.container.git.access(feature, this.uri);
	}

	@log()
	supports(feature: Features): Promise<boolean> {
		return this.container.git.supports(this.uri, feature);
	}

	@log()
	async addRemote(name: string, url: string, options?: { fetch?: boolean }): Promise<GitRemote | undefined> {
		await this.container.git.addRemote(this.uri, name, url, options);
		const [remote] = await this.getRemotes({ filter: r => r.url === url });
		return remote;
	}

	@log()
	pruneRemote(name: string): Promise<void> {
		return this.container.git.pruneRemote(this.uri, name);
	}

	@log()
	removeRemote(name: string): Promise<void> {
		return this.container.git.removeRemote(this.uri, name);
	}

	@log()
	branch(...args: string[]) {
		void this.runTerminalCommand('branch', ...args);
	}

	@log()
	branchDelete(branches: GitBranchReference | GitBranchReference[], options?: { force?: boolean; remote?: boolean }) {
		if (!Array.isArray(branches)) {
			branches = [branches];
		}

		const localBranches = branches.filter(b => !b.remote);
		if (localBranches.length !== 0) {
			const args = ['--delete'];
			if (options?.force) {
				args.push('--force');
			}
			void this.runTerminalCommand('branch', ...args, ...branches.map(b => b.ref));

			if (options?.remote) {
				const trackingBranches = localBranches.filter(b => b.upstream != null);
				if (trackingBranches.length !== 0) {
					const branchesByOrigin = groupByMap(trackingBranches, b =>
						getRemoteNameFromBranchName(b.upstream!.name),
					);

					for (const [remote, branches] of branchesByOrigin.entries()) {
						void this.runTerminalCommand(
							'push',
							'-d',
							remote,
							...branches.map(b => getBranchNameWithoutRemote(b.upstream!.name)),
						);
					}
				}
			}
		}

		const remoteBranches = branches.filter(b => b.remote);
		if (remoteBranches.length !== 0) {
			const branchesByOrigin = groupByMap(remoteBranches, b => getRemoteNameFromBranchName(b.name));

			for (const [remote, branches] of branchesByOrigin.entries()) {
				void this.runTerminalCommand('push', '-d', remote, ...branches.map(b => getNameWithoutRemote(b)));
			}
		}
	}

	@log()
	cherryPick(...args: string[]) {
		void this.runTerminalCommand('cherry-pick', ...args);
	}

	containsUri(uri: Uri) {
		return this === this.container.git.getRepository(uri);
	}

	@gate()
	@log()
	async fetch(options?: {
		all?: boolean;
		branch?: GitBranchReference;
		progress?: boolean;
		prune?: boolean;
		pull?: boolean;
		remote?: string;
	}) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.fetchCore(opts);

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title:
					opts.branch != null
						? `${opts.pull ? 'Pulling' : 'Fetching'} ${opts.branch.name}...`
						: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${this.formattedName}...`,
			},
			() => this.fetchCore(opts),
		);
	}

	private async fetchCore(options?: {
		all?: boolean;
		branch?: GitBranchReference;
		prune?: boolean;
		pull?: boolean;
		remote?: string;
	}) {
		try {
			if (options?.branch != null || configuration.get('experimental.nativeGit')) {
				await this.container.git.fetch(this.uri, options);
			} else {
				void (await executeCoreGitCommand('git.fetch', this.path));
			}

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to fetch repository');
		}
	}

	async getBranch(name?: string): Promise<GitBranch | undefined> {
		if (name) {
			const {
				values: [branch],
			} = await this.getBranches({ filter: b => b.name === name });
			return branch;
		}

		if (this._branch == null) {
			this._branch = this.container.git.getBranch(this.uri);
		}
		return this._branch;
	}

	getBranches(options?: {
		filter?: (b: GitBranch) => boolean;
		paging?: { cursor?: string; limit?: number };
		sort?: boolean | BranchSortOptions;
	}) {
		return this.container.git.getBranches(this.uri, options);
	}

	getChangedFilesCount(ref?: string): Promise<GitDiffShortStat | undefined> {
		return this.container.git.getChangedFilesCount(this.uri, ref);
	}

	getCommit(ref: string): Promise<GitCommit | undefined> {
		return this.container.git.getCommit(this.uri, ref);
	}

	getContributors(options?: { all?: boolean; ref?: string; stats?: boolean }): Promise<GitContributor[]> {
		return this.container.git.getContributors(this.uri, options);
	}

	private _gitDir: GitDir | undefined;
	private _gitDirPromise: Promise<GitDir | undefined> | undefined;
	private getGitDir(): Promise<GitDir | undefined> {
		if (this._gitDirPromise == null) {
			this._gitDirPromise = this.container.git.getGitDir(this.uri).then(gd => (this._gitDir = gd));
		}
		return this._gitDirPromise;
	}

	private _lastFetched: number | undefined;
	@gate()
	async getLastFetched(): Promise<number> {
		if (this._lastFetched == null) {
			if (!(await this.hasRemotes())) return 0;
		}

		try {
			const lastFetched = await this.container.git.getLastFetchedTimestamp(this.uri);
			// If we don't get a number, assume the fetch failed, and don't update the timestamp
			if (lastFetched != null) {
				this._lastFetched = lastFetched;
			}
		} catch {
			this._lastFetched = undefined;
		}

		return this._lastFetched ?? 0;
	}

	@gate()
	@log({ exit: true })
	async getMainRepository(): Promise<Repository | undefined> {
		const gitDir = await this.getGitDir();
		if (gitDir?.commonUri == null) return this;

		// If the repository isn't already opened, then open it as a "closed" repo (won't show up in the UI)
		return this.container.git.getOrOpenRepository(gitDir.commonUri, {
			detectNested: false,
			force: true,
			closeOnOpen: true,
		});
	}

	getMergeStatus(): Promise<GitMergeStatus | undefined> {
		return this.container.git.getMergeStatus(this.uri);
	}

	getRebaseStatus(): Promise<GitRebaseStatus | undefined> {
		return this.container.git.getRebaseStatus(this.uri);
	}

	async getRemote(remote: string): Promise<GitRemote | undefined> {
		return (await this.getRemotes()).find(r => r.name === remote);
	}

	async getRemotes(options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean }): Promise<GitRemote[]> {
		const remotes = await this.container.git.getRemotes(
			this.uri,
			options?.sort != null ? { sort: options.sort } : undefined,
		);
		return options?.filter != null ? remotes.filter(options.filter) : remotes;
	}

	async getRichRemote(connectedOnly: boolean = false): Promise<GitRemote<RichRemoteProvider> | undefined> {
		return this.container.git.getBestRemoteWithRichProvider(this.uri, { includeDisconnected: !connectedOnly });
	}

	getStash(): Promise<GitStash | undefined> {
		return this.container.git.getStash(this.uri);
	}

	getStatus(): Promise<GitStatus | undefined> {
		return this.container.git.getStatusForRepo(this.uri);
	}

	async getTag(name: string): Promise<GitTag | undefined> {
		const {
			values: [tag],
		} = await this.getTags({ filter: b => b.name === name });
		return tag;
	}

	getTags(options?: { filter?: (t: GitTag) => boolean; sort?: boolean | TagSortOptions }) {
		return this.container.git.getTags(this.uri, options);
	}

	@log()
	async createWorktree(
		uri: Uri,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined> {
		await this.container.git.createWorktree(this.uri, uri.fsPath, options);
		const url = uri.toString();
		return this.container.git.getWorktree(this.uri, w => w.uri.toString() === url);
	}

	getWorktrees(): Promise<GitWorktree[]> {
		return this.container.git.getWorktrees(this.uri);
	}

	async getWorktreesDefaultUri(): Promise<Uri | undefined> {
		return this.container.git.getWorktreesDefaultUri(this.uri);
	}

	deleteWorktree(uri: Uri, options?: { force?: boolean }): Promise<void> {
		return this.container.git.deleteWorktree(this.uri, uri.fsPath, options);
	}

	async hasRemotes(): Promise<boolean> {
		const remotes = await this.getRemotes();
		return remotes?.length > 0;
	}

	async hasRichRemote(connectedOnly: boolean = false): Promise<boolean> {
		const remote = await this.getRichRemote(connectedOnly);
		return remote?.provider != null;
	}

	async hasUpstreamBranch(): Promise<boolean> {
		const branch = await this.getBranch();
		return branch?.upstream != null;
	}

	isMaybeWorktree(): boolean | undefined {
		if (this._gitDir == null) return undefined;

		return this._gitDir.commonUri != null;
	}

	async isWorktree(): Promise<boolean> {
		return (await this.getGitDir())?.commonUri != null;
	}

	@log()
	merge(...args: string[]) {
		void this.runTerminalCommand('merge', ...args);
	}

	@gate()
	@log()
	async pull(options?: { progress?: boolean; rebase?: boolean }) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pullCore();

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${this.formattedName}...`,
			},
			() => this.pullCore(opts),
		);
	}

	private async pullCore(options?: { rebase?: boolean }) {
		try {
			if (configuration.get('experimental.nativeGit')) {
				const withTags = configuration.getAny<CoreGitConfiguration, boolean>('git.pullTags', this.uri);
				if (configuration.getAny<CoreGitConfiguration, boolean>('git.fetchOnPull', this.uri)) {
					await this.container.git.fetch(this.uri);
				}

				await this.container.git.pull(this.uri, { ...options, tags: withTags });
			} else {
				const upstream = await this.hasUpstreamBranch();
				if (upstream) {
					void (await executeCoreGitCommand(options?.rebase ? 'git.pullRebase' : 'git.pull', this.path));
				} else if (configuration.getAny<CoreGitConfiguration, boolean>('git.fetchOnPull', this.uri)) {
					await this.container.git.fetch(this.uri);
				}
			}

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to pull repository');
		}
	}

	private async showCreatePullRequestPrompt(remoteName: string, branch: GitBranchReference) {
		if (!this.container.actionRunners.count('createPullRequest')) return;
		if (!(await showCreatePullRequestPrompt(branch.name))) return;

		const remote = await this.getRemote(remoteName);

		void executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
			repoPath: this.path,
			remote:
				remote != null
					? {
							name: remote.name,
							provider:
								remote.provider != null
									? {
											id: remote.provider.id,
											name: remote.provider.name,
											domain: remote.provider.domain,
									  }
									: undefined,
							url: remote.url,
					  }
					: { name: remoteName },
			branch: {
				name: branch.name,
				isRemote: branch.remote,
				upstream: branch.upstream?.name,
			},
		});
	}

	@gate()
	@log()
	async push(options?: {
		force?: boolean;
		progress?: boolean;
		reference?: GitReference;
		publish?: {
			remote: string;
		};
	}) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pushCore(opts);

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: isBranchReference(opts.reference)
					? `${opts.publish != null ? 'Publishing ' : 'Pushing '}${opts.reference.name}...`
					: `Pushing ${this.formattedName}...`,
			},
			() => this.pushCore(opts),
		);
	}

	private async pushCore(options?: {
		force?: boolean;
		reference?: GitReference;
		publish?: {
			remote: string;
		};
	}) {
		try {
			if (configuration.get('experimental.nativeGit')) {
				const branch = await this.getBranch(options?.reference?.name);
				await this.container.git.push(this.uri, {
					force: options?.force,
					branch: isBranchReference(options?.reference) ? options?.reference : branch,
					...(options?.publish && { publish: options.publish }),
				});
			} else if (isBranchReference(options?.reference)) {
				const repo = await this.container.git.getOrOpenScmRepository(this.uri);
				if (repo == null) return;

				if (options?.publish != null) {
					await repo?.push(options.publish.remote, options.reference.name, true);
					void this.showCreatePullRequestPrompt(options.publish.remote, options.reference);
				} else {
					const branch = await this.getBranch(options?.reference.name);
					if (branch == null) return;

					await repo?.push(
						branch.getRemoteName(),
						branch.name,
						undefined,
						options?.force ? ForcePushMode.ForceWithLease : undefined,
					);
				}
			} else if (options?.reference != null) {
				const repo = await this.container.git.getOrOpenScmRepository(this.uri);
				if (repo == null) return;

				const branch = await this.getBranch();
				if (branch == null) return;

				await repo?.push(
					branch.getRemoteName(),
					`${options.reference.ref}:${branch.getNameWithoutRemote()}`,
					undefined,
					options?.force ? ForcePushMode.ForceWithLease : undefined,
				);
			} else {
				void (await executeCoreGitCommand(options?.force ? 'git.pushForce' : 'git.push', this.path));
			}

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to push repository');
		}
	}

	@log()
	rebase(configs: string[] | undefined, ...args: string[]) {
		void this.runTerminalCommand(
			configs != null && configs.length !== 0 ? `${configs.join(' ')} rebase` : 'rebase',
			...args,
		);
	}

	@log()
	reset(...args: string[]) {
		void this.runTerminalCommand('reset', ...args);
	}

	@log({ singleLine: true })
	private resetCaches(...caches: GitRepositoryCaches[]) {
		if (caches.length === 0 || caches.includes('branches')) {
			this._branch = undefined;
		}

		// if (caches.length === 0 || caches.includes('remotes')) {
		// 	this._remotes = undefined;
		// 	this._remotesDisposable?.dispose();
		// 	this._remotesDisposable = undefined;
		// }
	}

	resume() {
		if (!this._suspended) return;

		this._suspended = false;

		// If we've come back into focus and we are dirty, fire the change events

		if (this._pendingRepoChange != null) {
			this._fireChangeDebounced!();
		}

		if (this._pendingFileSystemChange != null) {
			this._fireFileSystemChangeDebounced!();
		}
	}

	@log()
	revert(...args: string[]) {
		void this.runTerminalCommand('revert', ...args);
	}

	@debug()
	richSearchCommits(
		search: SearchQuery,
		options?: { limit?: number; ordering?: 'date' | 'author-date' | 'topo'; skip?: number },
	): Promise<GitLog | undefined> {
		return this.container.git.richSearchCommits(this.uri, search, options);
	}

	@debug()
	searchCommits(
		search: SearchQuery,
		options?: { cancellation?: CancellationToken; limit?: number; ordering?: 'date' | 'author-date' | 'topo' },
	): Promise<GitSearch> {
		return this.container.git.searchCommits(this.uri, search, options);
	}

	async setRemoteAsDefault(remote: GitRemote, value: boolean = true) {
		await this.container.storage.storeWorkspace('remote:default', value ? remote.name : undefined);

		this.fireChange(RepositoryChange.Remotes, RepositoryChange.RemoteProviders);
	}

	get starred() {
		const starred = this.container.storage.getWorkspace('starred:repositories');
		return starred != null && starred[this.id] === true;
	}

	star(branch?: GitBranch) {
		return this.updateStarred(true, branch);
	}

	@gate()
	@log()
	async stashApply(stashName: string, options?: { deleteAfter?: boolean }) {
		await this.container.git.stashApply(this.uri, stashName, options);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashDelete(stashName: string, ref?: string) {
		await this.container.git.stashDelete(this.uri, stashName, ref);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashRename(stashName: string, ref: string, message: string, stashOnRef?: string) {
		await this.container.git.stashRename(this.uri, stashName, ref, message, stashOnRef);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashSave(
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	) {
		await this.container.git.stashSave(this.uri, message, uris, options);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async switch(ref: string, options?: { createBranch?: string | undefined; progress?: boolean }) {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.switchCore(ref, opts);

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${this.formattedName} to ${ref}...`,
				cancellable: false,
			},
			() => this.switchCore(ref, opts),
		);
	}

	private async switchCore(ref: string, options?: { createBranch?: string }) {
		try {
			await this.container.git.checkout(this.uri, ref, options);

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to switch to reference');
		}
	}

	toAbsoluteUri(path: string, options?: { validate?: boolean }): Uri | undefined {
		const uri = this.container.git.getAbsoluteUri(path, this.uri);
		return !(options?.validate ?? true) || this.containsUri(uri) ? uri : undefined;
	}

	unstar(branch?: GitBranch) {
		return this.updateStarred(false, branch);
	}

	private async updateStarred(star: boolean, branch?: GitBranch) {
		if (branch != null) {
			await this.updateStarredCore('branches', branch.id, star);
		} else {
			await this.updateStarredCore('repositories', this.id, star);
		}

		this.fireChange(RepositoryChange.Starred);
	}

	private async updateStarredCore(key: 'branches' | 'repositories', id: string, star: boolean) {
		const storageKey = `starred:${key}` as const;
		let starred = this.container.storage.getWorkspace(storageKey);
		starred = updateRecordValue(starred, id, star);
		await this.container.storage.storeWorkspace(storageKey, starred);

		this.fireChange(RepositoryChange.Starred);
	}

	private _etagFileSystem: number | undefined;
	get etagFileSystem(): number | undefined {
		return this._etagFileSystem;
	}

	startWatchingFileSystem(): Disposable {
		this._fsWatchCounter++;
		if (this._fsWatcherDisposable == null) {
			const watcher = workspace.createFileSystemWatcher(new RelativePattern(this.uri, '**'));
			this._fsWatcherDisposable = Disposable.from(
				watcher,
				watcher.onDidChange(this.onFileSystemChanged, this),
				watcher.onDidCreate(this.onFileSystemChanged, this),
				watcher.onDidDelete(this.onFileSystemChanged, this),
			);

			this._etagFileSystem = Date.now();
		}

		return { dispose: () => this.stopWatchingFileSystem() };
	}

	stopWatchingFileSystem(force: boolean = false) {
		if (this._fsWatcherDisposable == null) return;
		if (--this._fsWatchCounter > 0 && !force) return;

		this._etagFileSystem = undefined;
		this._fsWatchCounter = 0;
		this._fsWatcherDisposable.dispose();
		this._fsWatcherDisposable = undefined;
	}

	suspend() {
		this._suspended = true;
	}

	@log()
	tag(...args: string[]) {
		void this.runTerminalCommand('tag', ...args);
	}

	@log()
	tagDelete(tags: GitTagReference | GitTagReference[]) {
		if (!Array.isArray(tags)) {
			tags = [tags];
		}

		const args = ['--delete'];
		void this.runTerminalCommand('tag', ...args, ...tags.map(t => t.ref));
	}

	@debug()
	private fireChange(...changes: RepositoryChange[]) {
		const scope = getLogScope();

		this._updatedAt = Date.now();

		if (this._fireChangeDebounced == null) {
			this._fireChangeDebounced = debounce(this.fireChangeCore.bind(this), 250);
		}

		this._pendingRepoChange = this._pendingRepoChange?.with(changes) ?? new RepositoryChangeEvent(this, changes);

		this.onDidRepositoryChange(this, new RepositoryChangeEvent(this, changes));

		if (this._suspended) {
			Logger.debug(scope, `queueing suspended ${this._pendingRepoChange.toString(true)}`);

			return;
		}

		this._fireChangeDebounced();
	}

	private fireChangeCore() {
		const e = this._pendingRepoChange;
		if (e == null) return;

		this._pendingRepoChange = undefined;

		Logger.debug(`Repository(${this.id}) firing ${e.toString(true)}`);
		this._onDidChange.fire(e);
	}

	@debug()
	private fireFileSystemChange(uri: Uri) {
		const scope = getLogScope();

		this._updatedAt = Date.now();

		if (this._fireFileSystemChangeDebounced == null) {
			this._fireFileSystemChangeDebounced = debounce(this.fireFileSystemChangeCore.bind(this), 2500);
		}

		if (this._pendingFileSystemChange == null) {
			this._pendingFileSystemChange = { repository: this, uris: [] };
		}

		const e = this._pendingFileSystemChange;
		e.uris.push(uri);

		if (this._suspended) {
			Logger.debug(scope, `queueing suspended fs changes=${e.uris.map(u => u.fsPath).join(', ')}`);
			return;
		}

		this._fireFileSystemChangeDebounced();
	}

	private async fireFileSystemChangeCore() {
		let e = this._pendingFileSystemChange;
		if (e == null) return;

		this._pendingFileSystemChange = undefined;

		const uris = await this.container.git.excludeIgnoredUris(this.uri, e.uris);
		if (uris.length === 0) return;

		if (uris.length !== e.uris.length) {
			e = { ...e, uris: uris };
		}

		Logger.debug(`Repository(${this.id}) firing fs changes=${e.uris.map(u => u.fsPath).join(', ')}`);

		this._onDidChangeFileSystem.fire(e);
	}

	private async runTerminalCommand(command: string, ...args: string[]) {
		await this.container.git.runGitCommandViaTerminal?.(this.uri, command, args, { execute: true });

		setTimeout(() => this.fireChange(RepositoryChange.Unknown), 2500);
	}
}

export function isRepository(repository: unknown): repository is Repository {
	return repository instanceof Repository;
}
