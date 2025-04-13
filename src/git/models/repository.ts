/* eslint-disable @typescript-eslint/no-restricted-imports */ /* TODO need to deal with sharing rich class shapes to webviews */
import type { ConfigurationChangeEvent, Event, Uri, WorkspaceFolder } from 'vscode';
import { Disposable, EventEmitter, ProgressLocation, RelativePattern, window, workspace } from 'vscode';
import { md5, uuid } from '@env/crypto';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import { Schemes } from '../../constants';
import type { Container } from '../../container';
import type { FeatureAccess, PlusFeatures } from '../../features';
import { showCreatePullRequestPrompt, showGenericErrorMessage } from '../../messages';
import type { RepoComparisonKey } from '../../repositories';
import { asRepoComparisonKey } from '../../repositories';
import { executeActionCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { UriSet } from '../../system/-webview/uriMap';
import { exists } from '../../system/-webview/vscode/uris';
import { getScopedCounter } from '../../system/counter';
import { gate } from '../../system/decorators/-webview/gate';
import { memoize } from '../../system/decorators/-webview/memoize';
import { debug, log, logName } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function/debounce';
import { debounce } from '../../system/function/debounce';
import { filter, groupByMap, join, map, min, some } from '../../system/iterable';
import { getLoggableName, Logger } from '../../system/logger';
import { getLogScope, startLogScope } from '../../system/logger.scope';
import { updateRecordValue } from '../../system/object';
import { basename, normalizePath } from '../../system/path';
import type { GitProviderDescriptor, GitRepositoryProvider } from '../gitProvider';
import type { GitProviderService } from '../gitProviderService';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../utils/branch.utils';
import { getReferenceNameWithoutRemote, isBranchReference } from '../utils/reference.utils';
import type { GitBranch } from './branch';
import type { GitBranchReference, GitReference } from './reference';

type GitProviderRepoKeys =
	| keyof GitRepositoryProvider
	| 'getBestRevisionUri'
	| 'getRevisionUri'
	| 'getWorkingUri'
	| 'supports';

export type GitProviderServiceForRepo = Pick<
	{
		[K in keyof GitProviderService]: RemoveFirstArg<GitProviderService[K]>;
	},
	GitProviderRepoKeys
>;

const dotGitWatcherGlobFiles = 'index,HEAD,*_HEAD,MERGE_*,rebase-apply/**,rebase-merge/**,sequencer/**';
const dotGitWatcherGlobWorktreeFiles =
	'worktrees/*,worktrees/**/index,worktrees/**/HEAD,worktrees/**/*_HEAD,worktrees/**/MERGE_*,worktrees/**/rebase-merge/**,worktrees/**/rebase-apply/**,worktrees/**/sequencer/**';

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
	/** Effectively a union of Cherry, Merge, Rebase, and Revert */
	PausedOperationStatus = 8,
	CherryPick = 9,
	Merge = 10,
	Rebase = 11,
	Revert = 12,

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

	changed(...args: [...RepositoryChange[], RepositoryChangeComparisonMode]): boolean {
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
				affected.includes(RepositoryChange.Rebase) ||
				affected.includes(RepositoryChange.Revert)
			) {
				if (!affected.includes(RepositoryChange.PausedOperationStatus)) {
					affected.push(RepositoryChange.PausedOperationStatus);
				}
			} else if (affected.includes(RepositoryChange.PausedOperationStatus)) {
				changes = new Set(changes);
				changes.delete(RepositoryChange.CherryPick);
				changes.delete(RepositoryChange.Merge);
				changes.delete(RepositoryChange.Rebase);
				changes.delete(RepositoryChange.Revert);
			}
		}

		const intersection = [...filter(changes, c => affected.includes(c))];
		return mode === RepositoryChangeComparisonMode.Exclusive
			? intersection.length === changes.size
			: intersection.length === affected.length;
	}

	with(changes: RepositoryChange[]): RepositoryChangeEvent {
		return new RepositoryChangeEvent(this.repository, [...this._changes, ...changes]);
	}
}

export interface RepositoryFileSystemChangeEvent {
	readonly repository: Repository;
	readonly uris: UriSet;
}

const instanceCounter = getScopedCounter();

@logName<Repository>((r, name) => `${name}(${r.id}|${r.instance})`)
export class Repository implements Disposable {
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
	get idHash(): string {
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
		void this.git
			.config()
			.getGitDir?.()
			.then(gd => {
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
			this._onDidChange,
			this._onDidChangeFileSystem,
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
					if (e.data.types?.includes('providers')) {
						this.fireChange(RepositoryChange.RemoteProviders);
					}
				}
			}),
			this.container.events.on('git:repo:change', e => {
				if (e.data.repoPath === this.path) {
					this.fireChange(...e.data.changes);
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

		const gitDir = await this.git.config().getGitDir?.();
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

	dispose(): void {
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
			using scope = startLogScope(`${getLoggableName(this)}.closed`, false);
			Logger.debug(scope, `setting closed=${value}`);
			this.fireChange(this._closed ? RepositoryChange.Closed : RepositoryChange.Opened);
		}
	}

	get etag(): number {
		return this._updatedAt;
	}

	@memoize()
	get git(): GitProviderServiceForRepo {
		const uri = this.uri;
		return new Proxy(this.container.git, {
			get: (target, prop: GitProviderRepoKeys): unknown => {
				const value = target[prop];
				if (typeof value === 'function') {
					return (...args: unknown[]) =>
						// The extra `satisfies` here is to catch type errors, but we still need the `as` to satisfy TypeScript
						(
							value satisfies (repoPath: string | Uri, ...args: any[]) => unknown as (
								repoPath: string | Uri,
								...args: any[]
							) => unknown
						).call(target, uri, ...args);
				}
				return value;
			},
		}) as unknown as GitProviderServiceForRepo;
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
		// Ignore node_modules and .git changes
		if (/(?:(?:\/|\\)node_modules|\.git)(?:\/|\\|$)/.test(uri.fsPath)) return;

		this._etagFileSystem = Date.now();
		this.fireFileSystemChange(uri);
	}

	@debug()
	private onGitIgnoreChanged(_uri: Uri) {
		this.fireChange(RepositoryChange.Ignores);
	}

	@debug()
	private onRepositoryChanged(uri: Uri | undefined, base: Uri, _reason: 'create' | 'change' | 'delete') {
		// VS Code won't work with negative glob pattern match when creating the watcher, so we have to ignore it here
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
				  /(worktrees|index|HEAD|FETCH_HEAD|ORIG_HEAD|CHERRY_PICK_HEAD|MERGE_HEAD|REBASE_HEAD|rebase-merge|rebase-apply|REVERT_HEAD|config|refs\/(?:heads|remotes|stash|tags))/.exec(
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
					this.fireChange(RepositoryChange.CherryPick, RepositoryChange.PausedOperationStatus);
					return;

				case 'MERGE_HEAD':
					this.fireChange(RepositoryChange.Merge, RepositoryChange.PausedOperationStatus);
					return;

				case 'REBASE_HEAD':
				case 'rebase-merge':
				case 'rebase-apply':
					this.fireChange(RepositoryChange.Rebase, RepositoryChange.PausedOperationStatus);
					return;

				case 'REVERT_HEAD':
					this.fireChange(RepositoryChange.Revert, RepositoryChange.PausedOperationStatus);
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

	@log()
	branchDelete(
		branches: GitBranchReference | GitBranchReference[],
		options?: { force?: boolean; remote?: boolean },
	): void {
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
				void this.runTerminalCommand(
					'push',
					'-d',
					remote,
					...branches.map(b => getReferenceNameWithoutRemote(b)),
				);
			}
		}
	}

	containsUri(uri: Uri): boolean {
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
	}): Promise<void> {
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
		const gitDir = await this.git.config().getGitDir?.();
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
		const gitDir = await this.git.config().getGitDir?.();
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

	@log()
	merge(...args: string[]): void {
		void this.runTerminalCommand('merge', ...args);
	}

	@gate()
	@log()
	async pull(options?: { progress?: boolean; rebase?: boolean }): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pullCore(opts);

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

		const remote = await this.git.remotes().getRemote(remoteName);

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
	}): Promise<void> {
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
	rebase(configs: string[] | undefined, ...args: string[]): void {
		void this.runTerminalCommand(
			configs != null && configs.length !== 0 ? `${configs.join(' ')} rebase` : 'rebase',
			...args,
		);
	}

	resume(): void {
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
	revert(...args: string[]): void {
		void this.runTerminalCommand('revert', ...args);
	}

	get starred(): boolean {
		const starred = this.container.storage.getWorkspace('starred:repositories');
		return starred != null && starred[this.id] === true;
	}

	star(branch?: GitBranch): Promise<void> {
		return this.updateStarred(true, branch);
	}

	@gate()
	@log()
	async switch(ref: string, options?: { createBranch?: string | undefined; progress?: boolean }): Promise<void> {
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

	async getAbsoluteOrBestRevisionUri(path: string, rev: string | undefined): Promise<Uri | undefined> {
		const uri = this.container.git.getAbsoluteUri(path, this.uri);
		if (uri != null && this.containsUri(uri) && (await exists(uri))) return uri;

		return rev != null ? this.git.getBestRevisionUri(path, rev) : undefined;
	}

	unstar(branch?: GitBranch): Promise<void> {
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

	suspend(): void {
		this._suspended = true;
	}

	waitForRepoChange(timeoutMs: number): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			let timeoutId: NodeJS.Timeout | undefined;
			let listener: Disposable | undefined;

			const cleanup = () => {
				if (timeoutId != null) {
					clearTimeout(timeoutId);
					timeoutId = undefined;
				}
				listener?.dispose();
				listener = undefined;
			};

			const timeoutPromise = new Promise<false>(r => {
				timeoutId = setTimeout(() => {
					cleanup();
					r(false);
				}, timeoutMs);
			});

			const changePromise = new Promise<true>(r => {
				listener = this.onDidChange(() => {
					cleanup();
					r(true);
				});
			});

			void Promise.race([timeoutPromise, changePromise]).then(result => resolve(result));
		});
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

		this._fireChangeDebounced ??= debounce(this.fireChangeCore.bind(this), defaultRepositoryChangeDelay);

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

		using scope = startLogScope(`${getLoggableName(this)}.fireChangeCore`, false);
		Logger.debug(scope, `firing ${e.toString(true)}`);
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

		this._fireFileSystemChangeDebounced ??= debounce(this.fireFileSystemChangeCore.bind(this), this._fsChangeDelay);

		this._pendingFileSystemChange ??= { repository: this, uris: new UriSet() };
		const e = this._pendingFileSystemChange;
		e.uris.add(uri);

		if (this._suspended) {
			Logger.debug(
				scope,
				`queueing suspended fs changes=${join(
					map(e.uris, u => u.fsPath),
					', ',
				)}`,
			);
			return;
		}

		this._fireFileSystemChangeDebounced();
	}

	private async fireFileSystemChangeCore() {
		let e = this._pendingFileSystemChange;
		if (e == null) return;

		this._pendingFileSystemChange = undefined;

		const uris = await this.git.excludeIgnoredUris([...e.uris]);
		if (!uris.length) return;

		if (uris.length !== e.uris.size) {
			e = { ...e, uris: new UriSet(uris) };
		}

		using scope = startLogScope(`${getLoggableName(this)}.fireChangeCore`, false);
		Logger.debug(
			scope,
			`firing fs changes=${join(
				map(e.uris, u => u.fsPath),
				', ',
			)}`,
		);

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
