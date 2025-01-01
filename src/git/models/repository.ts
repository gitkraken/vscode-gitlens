import { md5, uuid } from '@env/crypto';
import type { ConfigurationChangeEvent, Event, Uri, WorkspaceFolder } from 'vscode';
import { Disposable, EventEmitter, ProgressLocation, RelativePattern, window, workspace } from 'vscode';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import { Schemes } from '../../constants';
import type { Container } from '../../container';
import type { FeatureAccess, PlusFeatures } from '../../features';
import { showCreatePullRequestPrompt, showGenericErrorMessage } from '../../messages';
import type { RepoComparisonKey } from '../../repositories';
import { asRepoComparisonKey } from '../../repositories';
import { getScopedCounter } from '../../system/counter';
import { formatDate, fromNow } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug, log, logName } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { filter, groupByMap, join, min, some } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { updateRecordValue } from '../../system/object';
import { basename, normalizePath } from '../../system/path';
import { executeActionCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import type { GitProviderDescriptor, GitProviderRepository } from '../gitProvider';
import type { GitProviderService } from '../gitProviderService';
import type { GitBranch } from './branch';
import { getBranchNameWithoutRemote, getNameWithoutRemote, getRemoteNameFromBranchName } from './branch.utils';
import type { GitBranchReference, GitReference } from './reference';
import { isBranchReference } from './reference.utils';
import type { GitRemote } from './remote';
import type { GitWorktree } from './worktree';

type RemoveFirstArg<F> = F extends {
	(first: any, ...args: infer A1): infer R1;
	(first: any, ...args: infer A2): infer R2;
	(first: any, ...args: infer A3): infer R3;
	(first: any, ...args: infer A4): infer R4;
}
	? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3) & ((...args: A4) => R4)
	: F extends {
				(first: any, ...args: infer A1): infer R1;
				(first: any, ...args: infer A2): infer R2;
				(first: any, ...args: infer A3): infer R3;
	    }
	  ? ((...args: A1) => R1) & ((...args: A2) => R2) & ((...args: A3) => R3)
	  : F extends {
					(first: any, ...args: infer A1): infer R1;
					(first: any, ...args: infer A2): infer R2;
	      }
	    ? ((...args: A1) => R1) & ((...args: A2) => R2)
	    : F extends {
						(first: any, ...args: infer A1): infer R1;
	        }
	      ? (...args: A1) => R1
	      : never;

export type RepoGitProviderService = Pick<
	{
		[K in keyof GitProviderService]: RemoveFirstArg<GitProviderService[K]>;
	},
	| keyof GitProviderRepository
	| 'getBestRemoteWithProvider'
	| 'getBestRemotesWithProviders'
	| 'getBestRemoteWithIntegration'
	| 'getBranch'
	| 'getDefaultRemote'
	| 'getRemote'
	| 'getTag'
	| 'getWorktree'
	| 'supports'
>;

const millisecondsPerMinute = 60 * 1000;
const millisecondsPerHour = 60 * 60 * 1000;
const millisecondsPerDay = 24 * 60 * 60 * 1000;

const dotGitWatcherGlobFiles = 'index,HEAD,*_HEAD,MERGE_*,rebase-merge/**,sequencer/**';
const dotGitWatcherGlobWorktreeFiles =
	'worktrees/*,worktrees/**/index,worktrees/**/HEAD,worktrees/**/*_HEAD,worktrees/**/MERGE_*,worktrees/**/rebase-merge/**,worktrees/**/sequencer/**';

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
	/** Union of Cherry, Merge, and Rebase */
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
	Exclusive,
}

const defaultFileSystemChangeDelay = 2500;
const defaultRepositoryChangeDelay = 250;

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

const instanceCounter = getScopedCounter();

@logName<Repository>((r, name) => `${name}(${r.id}|${r.instance})`)
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

	private _onDidChange = new EventEmitter<RepositoryChangeEvent>();
	get onDidChange(): Event<RepositoryChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeFileSystem = new EventEmitter<RepositoryFileSystemChangeEvent>();
	get onDidChangeFileSystem(): Event<RepositoryFileSystemChangeEvent> {
		return this._onDidChangeFileSystem.event;
	}

	private _commonRepositoryName: string | undefined;
	get commonRepositoryName(): string | undefined {
		return this._commonRepositoryName;
	}

	get formattedName(): string {
		return this.name;
	}

	readonly id: RepoComparisonKey;
	readonly index: number;
	readonly instance = instanceCounter.next();

	private _name: string;
	get name(): string {
		return this._name;
	}

	private _idHash: string | undefined;
	get idHash() {
		if (this._idHash === undefined) {
			this._idHash = md5(this.id);
		}
		return this._idHash;
	}

	private readonly _disposable: Disposable;
	private _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _fireFileSystemChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _pendingFileSystemChange?: RepositoryFileSystemChangeEvent;
	private _pendingRepoChange?: RepositoryChangeEvent;
	private _suspended: boolean;

	constructor(
		private readonly container: Container,
		private readonly providerService: {
			readonly onDidRepositoryChange: EventEmitter<RepositoryChangeEvent>;
			readonly onRepositoryChanged: (repo: Repository, e: RepositoryChangeEvent) => void;
		},
		public readonly provider: GitProviderDescriptor,
		public readonly folder: WorkspaceFolder | undefined,
		public readonly uri: Uri,
		public readonly root: boolean,
		suspended: boolean,
		closed: boolean = false,
	) {
		if (folder != null) {
			if (root) {
				this._name = folder.name;
			} else {
				const relativePath = container.git.getRelativePath(uri, folder.uri);
				this._name = relativePath ? relativePath : folder.name;
			}
		} else {
			this._name = basename(uri.path);

			// TODO@eamodio should we create a fake workspace folder?
			// folder = {
			// 	uri: uri,
			// 	name: this.name,
			// 	index: container.git.repositoryCount,
			// };
		}

		// Update the name if it is a worktree
		void this.git.getGitDir().then(gd => {
			if (gd?.commonUri == null) return;

			let path = gd.commonUri.path;
			if (path.endsWith('/.git')) {
				path = path.substring(0, path.length - 5);
			}

			this._commonRepositoryName = basename(path);
			const prefix = `${this._commonRepositoryName}: `;
			if (!this._name.startsWith(prefix)) {
				this._name = `${prefix}${this._name}`;
			}
		});

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
		if (this._orderByLastFetched) {
			void this.getLastFetched();
		}
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
				watcher.onDidChange(e => this.onRepositoryChanged(e, uri, 'change')),
				watcher.onDidCreate(e => this.onRepositoryChanged(e, uri, 'create')),
				watcher.onDidDelete(e => this.onRepositoryChanged(e, uri, 'delete')),
			);
			return watcher;
		}

		const gitDir = await this.git.getGitDir();
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
		this.unWatchFileSystem(true);

		this._disposable.dispose();
	}

	toString(): string {
		return getLoggableName(this);
	}

	private _closed: boolean = false;
	get closed(): boolean {
		return this._closed;
	}
	set closed(value: boolean) {
		const changed = this._closed !== value;
		this._closed = value;
		if (changed) {
			Logger.debug(`Repository(${this.id}).closed(${value})`);
			this.fireChange(this._closed ? RepositoryChange.Closed : RepositoryChange.Opened);
		}
	}

	get etag(): number {
		return this._updatedAt;
	}

	@memoize()
	get git(): RepoGitProviderService {
		const uri = this.uri;
		return new Proxy(this.container.git, {
			get: (target, prop: keyof GitProviderService): any => {
				const value = target[prop];
				if (typeof value === 'function') {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-function-type
					return (...args: any[]) => (value as Function).call(target, uri, ...args);
				}
				return value;
			},
		}) as unknown as RepoGitProviderService;
	}

	get path(): string {
		return this.uri.scheme === Schemes.File ? normalizePath(this.uri.fsPath) : this.uri.toString();
	}

	private _orderByLastFetched = false;
	get orderByLastFetched(): boolean {
		return this._orderByLastFetched;
	}

	private _updatedAt: number = 0;
	get updatedAt(): number {
		return this._updatedAt;
	}

	get virtual(): boolean {
		return this.provider.virtual;
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'sortRepositoriesBy')) {
			this._orderByLastFetched = configuration.get('sortRepositoriesBy')?.startsWith('lastFetched:') ?? false;
		}

		if (e != null && configuration.changed(e, 'remotes', this.folder?.uri)) {
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
	private onRepositoryChanged(uri: Uri | undefined, base: Uri, _reason: 'create' | 'change' | 'delete') {
		// TODO@eamodio Revisit -- as I can't seem to get this to work as a negative glob pattern match when creating the watcher
		if (uri?.path.includes('/fsmonitor--daemon/')) {
			return;
		}

		this._lastFetched = undefined;
		if (this._orderByLastFetched) {
			void this.getLastFetched();
		}

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
					this.fireChange(RepositoryChange.Config, RepositoryChange.Remotes);
					return;

				case 'index':
					this.fireChange(RepositoryChange.Index);
					return;

				case 'FETCH_HEAD':
					// Ignore any changes to FETCH_HEAD as unless other things change, nothing changes that we care about
					return;

				case 'HEAD':
					this.fireChange(RepositoryChange.Head, RepositoryChange.Heads);
					return;

				case 'ORIG_HEAD':
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
					this.fireChange(RepositoryChange.Heads);
					return;

				case 'refs/remotes':
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

	@log()
	access(feature?: PlusFeatures): Promise<FeatureAccess> {
		return this.container.git.access(feature, this.uri);
	}

	// TODO: Can we remove this -- since no callers use the return value (though maybe they need that await?)
	@log()
	async addRemote(name: string, url: string, options?: { fetch?: boolean }): Promise<GitRemote | undefined> {
		await this.git.addRemote(name, url, options);
		const [remote] = await this.git.getRemotes({ filter: r => r.url === url });
		return remote;
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
			await this.git.fetch(options);

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to fetch repository');
		}
	}

	@gate()
	@log({ exit: true })
	async getCommonRepository(): Promise<Repository | undefined> {
		const gitDir = await this.git.getGitDir();
		if (gitDir?.commonUri == null) return this;

		// If the repository isn't already opened, then open it as a "closed" repo (won't show up in the UI)
		return this.container.git.getOrOpenRepository(gitDir.commonUri, {
			detectNested: false,
			force: true,
			closeOnOpen: true,
		});
	}

	@log({ exit: true })
	async getCommonRepositoryUri(): Promise<Uri | undefined> {
		const gitDir = await this.git.getGitDir();
		if (gitDir?.commonUri?.path.endsWith('/.git')) {
			return gitDir.commonUri.with({
				path: gitDir.commonUri.path.substring(0, gitDir.commonUri.path.length - 5),
			});
		}

		return gitDir?.commonUri;
	}

	private _lastFetched: number | undefined;
	get lastFetchedCached(): number | undefined {
		return this._lastFetched;
	}

	@gate()
	async getLastFetched(): Promise<number> {
		const lastFetched = await this.git.getLastFetchedTimestamp();
		// If we don't get a number, assume the fetch failed, and don't update the timestamp
		if (lastFetched != null) {
			this._lastFetched = lastFetched;
		}

		return this._lastFetched ?? 0;
	}

	// TODO: Move to GitProviderService?
	@log()
	async createWorktree(
		uri: Uri,
		options?: { commitish?: string; createBranch?: string; detach?: boolean; force?: boolean },
	): Promise<GitWorktree | undefined> {
		await this.git.createWorktree(uri.fsPath, options);
		const url = uri.toString();
		return this.git.getWorktree(w => w.uri.toString() === url);
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
			const withTags = configuration.getCore('git.pullTags', this.uri);
			if (configuration.getCore('git.fetchOnPull', this.uri)) {
				await this.git.fetch();
			}

			await this.git.pull({ ...options, tags: withTags });

			this.fireChange(RepositoryChange.Unknown);
		} catch (ex) {
			Logger.error(ex);
			void showGenericErrorMessage('Unable to pull repository');
		}
	}

	private async showCreatePullRequestPrompt(remoteName: string, branch: GitBranchReference) {
		if (!this.container.actionRunners.count('createPullRequest')) return;
		if (!(await showCreatePullRequestPrompt(branch.name))) return;

		const remote = await this.git.getRemote(remoteName);

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
		publish?: { remote: string };
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

	private async pushCore(options?: { force?: boolean; reference?: GitReference; publish?: { remote: string } }) {
		try {
			await this.git.push({
				reference: options?.reference,
				force: options?.force,
				publish: options?.publish,
			});

			if (isBranchReference(options?.reference) && options?.publish != null) {
				void this.showCreatePullRequestPrompt(options.publish.remote, options.reference);
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

	resume() {
		if (!this._suspended) return;

		this._suspended = false;

		// If we've come back into focus and we are dirty, fire the change events

		if (this._pendingRepoChange != null) {
			this._fireChangeDebounced!();
		}

		if (this._pendingFileSystemChange != null) {
			this._fireFileSystemChangeDebounced?.();
		}
	}

	@log()
	revert(...args: string[]) {
		void this.runTerminalCommand('revert', ...args);
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
		await this.git.applyStash(stashName, options);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashDelete(stashName: string, ref?: string) {
		await this.git.deleteStash(stashName, ref);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashRename(stashName: string, ref: string, message: string, stashOnRef?: string) {
		await this.git.renameStash(stashName, ref, message, stashOnRef);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashSave(
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		await this.git.saveStash(message, uris, options);

		this.fireChange(RepositoryChange.Stash);
	}

	@gate()
	@log()
	async stashSaveSnapshot(message?: string): Promise<void> {
		await this.git.saveStashSnapshot(message);

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
			await this.git.checkout(ref, options);

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

	suspend() {
		this._suspended = true;
	}

	private _fsWatcherDisposable: Disposable | undefined;
	private _fsWatchers = new Map<string, number>();
	private _fsChangeDelay: number = defaultFileSystemChangeDelay;

	watchFileSystem(delay: number = defaultFileSystemChangeDelay): Disposable {
		const id = uuid();
		this._fsWatchers.set(id, delay);
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

		this.ensureMinFileSystemChangeDelay();

		return { dispose: () => this.unWatchFileSystem(id) };
	}

	private unWatchFileSystem(forceOrId: true | string) {
		if (typeof forceOrId !== 'boolean') {
			this._fsWatchers.delete(forceOrId);
			if (this._fsWatchers.size !== 0) {
				this.ensureMinFileSystemChangeDelay();
				return;
			}
		}

		this._etagFileSystem = undefined;
		this._fsChangeDelay = defaultFileSystemChangeDelay;
		this._fsWatchers.clear();
		this._fsWatcherDisposable?.dispose();
		this._fsWatcherDisposable = undefined;
	}

	private ensureMinFileSystemChangeDelay() {
		const minDelay = min(this._fsWatchers.values());
		if (minDelay === this._fsChangeDelay) return;

		this._fsChangeDelay = minDelay;
		this._fireFileSystemChangeDebounced?.flush();
		this._fireFileSystemChangeDebounced?.cancel();
		this._fireFileSystemChangeDebounced = undefined;
	}

	@debug()
	private fireChange(...changes: RepositoryChange[]) {
		const scope = getLogScope();

		this._updatedAt = Date.now();

		if (this._fireChangeDebounced == null) {
			this._fireChangeDebounced = debounce(this.fireChangeCore.bind(this), defaultRepositoryChangeDelay);
		}

		this._pendingRepoChange = this._pendingRepoChange?.with(changes) ?? new RepositoryChangeEvent(this, changes);

		this.providerService.onRepositoryChanged(this, this._pendingRepoChange);

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
		try {
			this._onDidChange.fire(e);
		} finally {
			this.providerService.onDidRepositoryChange.fire(e);
		}
	}

	@debug()
	private fireFileSystemChange(uri: Uri) {
		const scope = getLogScope();

		this._updatedAt = Date.now();

		if (this._fireFileSystemChangeDebounced == null) {
			this._fireFileSystemChangeDebounced = debounce(
				this.fireFileSystemChangeCore.bind(this),
				this._fsChangeDelay,
			);
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

		const uris = await this.git.excludeIgnoredUris(e.uris);
		if (uris.length === 0) return;

		if (uris.length !== e.uris.length) {
			e = { ...e, uris: uris };
		}

		Logger.debug(`Repository(${this.id}) firing fs changes=${e.uris.map(u => u.fsPath).join(', ')}`);

		this._onDidChangeFileSystem.fire(e);
	}

	private async runTerminalCommand(command: string, ...args: string[]) {
		await this.git.runGitCommandViaTerminal?.(command, args, { execute: true });

		setTimeout(() => this.fireChange(RepositoryChange.Unknown), 2500);
	}
}

export function isRepository(repository: unknown): repository is Repository {
	return repository instanceof Repository;
}
