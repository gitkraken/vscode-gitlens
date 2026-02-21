/* eslint-disable @typescript-eslint/no-restricted-imports -- TODO need to deal with sharing rich class shapes to webviews */
import type { ConfigurationChangeEvent, Event, Uri, WorkspaceFolder } from 'vscode';
import { Disposable, EventEmitter, ProgressLocation, RelativePattern, window, workspace } from 'vscode';
import { md5, uuid } from '@env/crypto.js';
import type { CreatePullRequestActionContext } from '../../api/gitlens.d.js';
import type { Container } from '../../container.js';
import type { FeatureAccess, PlusFeatures } from '../../features.js';
import { showCreatePullRequestPrompt, showGitErrorMessage } from '../../messages.js';
import type { RepoComparisonKey } from '../../repositories.js';
import { asRepoComparisonKey } from '../../repositories.js';
import { executeActionCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { UriSet } from '../../system/-webview/uriMap.js';
import { exists } from '../../system/-webview/vscode/uris.js';
import { getScopedCounter } from '../../system/counter.js';
import { gate } from '../../system/decorators/gate.js';
import { debug, loggable, logName, trace } from '../../system/decorators/log.js';
import { memoize } from '../../system/decorators/memoize.js';
import type { Deferrable } from '../../system/function/debounce.js';
import { debounce } from '../../system/function/debounce.js';
import { filter, groupByMap, join, map, min, some } from '../../system/iterable.js';
import { getLoggableName, Logger } from '../../system/logger.js';
import { getScopedLogger, maybeStartLoggableScope } from '../../system/logger.scope.js';
import { updateRecordValue } from '../../system/object.js';
import { basename, normalizePath } from '../../system/path.js';
import { CheckoutError, FetchError, PullError, PushError } from '../errors.js';
import type { GitDir, GitProviderDescriptor } from '../gitProvider.js';
import type { GitRepositoryService } from '../gitRepositoryService.js';
import { getCommonRepositoryUri, getRepositoryOrWorktreePath } from '../utils/-webview/repository.utils.js';
import { getBranchNameWithoutRemote, getRemoteNameFromBranchName } from '../utils/branch.utils.js';
import { getReferenceNameWithoutRemote, isBranchReference } from '../utils/reference.utils.js';
import type { GitBranch } from './branch.js';
import type { GitBranchReference, GitReference } from './reference.js';

const ignoredFsPathRegex = /(?:(?:\/|\\)node_modules|\.git(?:\/index\.lock)?|\.watchman-cookie-)(?:\/|\\|$)/;
const repoChangeRegex =
	/(worktrees|index|HEAD|FETCH_HEAD|ORIG_HEAD|CHERRY_PICK_HEAD|MERGE_HEAD|REBASE_HEAD|rebase-merge|rebase-apply|sequencer|REVERT_HEAD|config|gk\/config|info\/exclude|refs\/(?:heads|remotes|stash|tags))/;

const dotGitWatcherGlobFiles =
	'index,HEAD,*_HEAD,MERGE_*,rebase-apply,rebase-apply/**,rebase-merge,rebase-merge/**,sequencer,sequencer/**';
const dotGitWatcherGlobWorktreeFiles =
	'worktrees/*,worktrees/**/index,worktrees/**/HEAD,worktrees/**/*_HEAD,worktrees/**/MERGE_*,worktrees/**/rebase-merge,worktrees/**/rebase-merge/**,worktrees/**/rebase-apply,worktrees/**/rebase-apply/**,worktrees/**/sequencer,worktrees/**/sequencer/**';

const dotGitWatcherGlobRoot = `{${dotGitWatcherGlobFiles}}`;
const dotGitWatcherGlobCommon = `{config,gk/config,refs/**,info/exclude,${dotGitWatcherGlobWorktreeFiles}}`;
const dotGitWatcherGlobCombined = `{${dotGitWatcherGlobFiles},config,gk/config,refs/**,info/exclude,${dotGitWatcherGlobWorktreeFiles}}`;

const gitIgnoreGlob = '.gitignore';

export type RepositoryChange =
	| 'unknown'
	| 'index'
	| 'head'
	| 'heads'
	| 'tags'
	| 'stash'
	| 'remotes'
	| 'worktrees'
	| 'config'
	| 'pausedOp'
	| 'cherryPick'
	| 'merge'
	| 'rebase'
	| 'revert'
	| 'closed'
	| 'ignores'
	| 'remoteProviders'
	| 'starred'
	| 'opened'
	| 'gkConfig';

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

	changed(...affected: RepositoryChange[]): boolean {
		return some(this._changes, c => affected.includes(c));
	}

	changedExclusive(...affected: RepositoryChange[]): boolean {
		let changes = this._changes;

		if (
			affected.includes('cherryPick') ||
			affected.includes('merge') ||
			affected.includes('rebase') ||
			affected.includes('revert')
		) {
			if (!affected.includes('pausedOp')) {
				affected.push('pausedOp');
			}
		} else if (affected.includes('pausedOp')) {
			changes = new Set(changes);
			changes.delete('cherryPick');
			changes.delete('merge');
			changes.delete('rebase');
			changes.delete('revert');
		}

		const intersection = [...filter(changes, c => affected.includes(c))];
		return intersection.length === changes.size;
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

@logName(r => `Repository(${r.id}|${r.instance})`)
@loggable()
export class Repository implements Disposable {
	private _onDidChange = new EventEmitter<RepositoryChangeEvent>();
	get onDidChange(): Event<RepositoryChangeEvent> {
		if (this._closed) {
			// Closed repositories generally won't fire change events, so we should check to make sure this is correct
			debugger;
		}
		return this._onDidChange.event;
	}

	private _onDidChangeFileSystem = new EventEmitter<RepositoryFileSystemChangeEvent>();
	get onDidChangeFileSystem(): Event<RepositoryFileSystemChangeEvent> {
		return this._onDidChangeFileSystem.event;
	}

	readonly id: RepoComparisonKey;
	readonly index: number;
	readonly instance = instanceCounter.next();

	private readonly _disposable: Disposable;
	private _fireChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _fireFileSystemChangeDebounced: Deferrable<() => void> | undefined = undefined;
	private _pendingFileSystemChange?: RepositoryFileSystemChangeEvent;
	private _pendingRepoChange?: RepositoryChangeEvent;
	private _pendingResumeTimer?: ReturnType<typeof setTimeout>;
	private _repoWatchersDisposable: Disposable | undefined;
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
		private readonly _gitDir: GitDir | undefined,
		public readonly root: boolean,
		closed: boolean = false,
	) {
		this.id = asRepoComparisonKey(uri);
		this.index = folder?.index ?? container.git.repositoryCount;
		this._suspended = !window.state.focused;
		this._closed = closed;

		if (folder != null) {
			if (root) {
				this._name = folder.name;
			} else {
				const relativePath = container.git.getRelativePath(uri, folder.uri);
				this._name = relativePath ? relativePath : folder.name;
			}
		} else {
			this._name = basename(uri.path);
		}

		const { commonRepositoryName } = this;
		if (commonRepositoryName) {
			const prefix = `${commonRepositoryName}: `;
			if (!this._name.startsWith(prefix)) {
				this._name = `${prefix}${this._name}`;
			}
		}

		this.setupRepoWatchers(_gitDir);

		this._disposable = Disposable.from(
			this._onDidChange,
			this._onDidChangeFileSystem,
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.events.on('git:cache:reset', e => {
				if (!e.data.repoPath || e.data.repoPath === this.path) {
					if (e.data.types?.includes('providers')) {
						this.fireChange('remoteProviders');
					}
				}
			}),
			this.container.events.on('git:repo:change', e => {
				if (e.data.repoPath === this.path) {
					this.fireChange(...e.data.changes);
				}
			}),
		);

		this.onConfigurationChanged();
		if (this._orderByLastFetched) {
			void this.getLastFetched();
		}

		// Track initial access when repository is opened (not closed)
		if (!closed) {
			queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());
		}
	}

	dispose(): void {
		clearTimeout(this._pendingResumeTimer);
		this.unWatchFileSystem(true);
		this._repoWatchersDisposable?.dispose();
		this._disposable.dispose();
	}

	private _closed: boolean = false;
	get closed(): boolean {
		return this._closed;
	}
	set closed(value: boolean) {
		const changed = this._closed !== value;
		this._closed = value;
		if (changed) {
			using scope = maybeStartLoggableScope(`${getLoggableName(this)}.closed`);
			scope?.trace(`setting closed=${value}`);
			this.setupRepoWatchers(this._gitDir);

			if (this._closed) {
				// When closing, fire the event immediately even if suspended
				// This ensures views can clean up nodes for closed repositories before VS Code tries to render them
				this.fireChange('closed', true);
			} else {
				// Track access when repository is reopened
				queueMicrotask(() => void this.git.branches.onCurrentBranchAccessed?.());

				this.fireChange('opened');
			}
		}
	}

	@memoize()
	get commonPath(): string | undefined {
		const { commonUri } = this;
		return commonUri && normalizePath(commonUri.path);
	}

	@memoize()
	get commonRepositoryName(): string | undefined {
		const { commonPath } = this;
		return commonPath && basename(commonPath);
	}

	@memoize()
	get commonUri(): Uri | undefined {
		const uri = this._gitDir?.commonUri;
		return uri && getCommonRepositoryUri(uri);
	}

	get etag(): number {
		return this._updatedAt;
	}

	@memoize()
	get git(): GitRepositoryService {
		return this.container.git.getRepositoryService(this.uri);
	}

	private _idHash: string | undefined;
	get idHash(): string {
		this._idHash ??= md5(this.id);
		return this._idHash;
	}

	/** Indicates whether this repository is a submodule */
	get isSubmodule(): boolean {
		return this._gitDir?.parentUri != null;
	}

	/** Indicates whether this repository is a worktree */
	get isWorktree(): boolean {
		return this._gitDir?.commonUri != null;
	}

	private _name: string;
	get name(): string {
		return this._name;
	}

	/** The parent repository URI (for submodules) */
	get parentUri(): Uri | undefined {
		return this._gitDir?.parentUri;
	}

	get path(): string {
		return getRepositoryOrWorktreePath(this.uri);
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
			this.fireChange('remotes');
		}
	}

	private onFileSystemChanged(uri: Uri) {
		// Ignore node_modules, .git, index.lock, and watchman cookie files
		if (ignoredFsPathRegex.test(uri.fsPath)) return;

		// If filter not ready yet, buffer the event for later processing
		if (this._fsBufferedEvents != null) {
			this._fsBufferedEvents.push(uri);
			return;
		}

		// Sync filter using .gitignore rules
		if (this._fsIsIgnored?.(uri)) return;

		this._etagFileSystem = Date.now();
		this.fireFileSystemChange(uri);
	}

	@trace()
	private onGitIgnoreChanged(_uri: Uri) {
		// Refresh the ignore filter if FS watching is active
		if (this._fsWatcherDisposable != null) {
			this.ensureIgnoredUrisFilter();
		}

		this.fireChange('ignores');
	}

	@trace()
	private onRepositoryChanged(uri: Uri | undefined, base: Uri, _reason: 'create' | 'change' | 'delete') {
		// VS Code won't work with negative glob pattern match when creating the watcher, so we have to ignore it here
		if (uri?.path.includes('/fsmonitor--daemon/')) {
			return;
		}

		const match =
			uri != null
				? // Move worktrees first, since if it is in a worktree it isn't affecting this repo directly
					repoChangeRegex.exec(this.container.git.getRelativePath(uri, base))
				: undefined;

		if (match != null) {
			switch (match[1]) {
				case 'config':
					this.fireChange('config', 'remotes');
					return;

				case 'gk/config':
					this.fireChange('gkConfig');
					return;

				case 'info/exclude':
					// Refresh the ignore filter if FS watching is active
					if (this._fsWatcherDisposable != null) {
						this.ensureIgnoredUrisFilter();
					}
					this.fireChange('ignores');
					return;

				case 'index':
					this.fireChange('index');
					return;

				case 'FETCH_HEAD':
					this._lastFetched = undefined;
					if (this._orderByLastFetched) {
						setTimeout(() => void this.getLastFetched(), 1);
					}
					return;

				case 'HEAD':
					this.fireChange('head', 'heads');
					return;

				case 'ORIG_HEAD':
					this.fireChange('heads');
					return;

				case 'CHERRY_PICK_HEAD':
					this.fireChange('cherryPick', 'pausedOp');
					return;

				case 'MERGE_HEAD':
					this.fireChange('merge', 'pausedOp');
					return;

				case 'REBASE_HEAD':
				case 'rebase-merge':
				case 'rebase-apply':
					this.fireChange('rebase', 'pausedOp');
					return;

				case 'REVERT_HEAD':
					this.fireChange('revert', 'pausedOp');
					return;

				case 'sequencer':
					this.fireChange('pausedOp');
					return;

				case 'refs/heads':
					this.fireChange('heads');
					return;

				case 'refs/remotes':
					this.fireChange('remotes');
					return;

				case 'refs/stash':
					this.fireChange('stash');
					return;

				case 'refs/tags':
					this.fireChange('tags');
					return;

				case 'worktrees':
					this.fireChange('worktrees');
					return;
			}
		}

		this.fireChange('unknown');
	}

	@debug()
	access(feature?: PlusFeatures): Promise<FeatureAccess> {
		return this.container.git.access(feature, this.uri);
	}

	@debug()
	async branchDelete(
		branches: GitBranchReference | GitBranchReference[],
		options?: { force?: boolean; remote?: boolean },
	): Promise<void> {
		if (!Array.isArray(branches)) {
			branches = [branches];
		}

		const localBranches = branches.filter(b => !b.remote);
		if (localBranches.length !== 0) {
			await this.git.branches.deleteLocalBranch?.(
				localBranches.map(b => b.name),
				{ force: options?.force },
			);

			if (options?.remote) {
				const trackingBranches = localBranches.filter(b => b.upstream != null);
				if (trackingBranches.length !== 0) {
					const branchesByOrigin = groupByMap(trackingBranches, b =>
						getRemoteNameFromBranchName(b.upstream!.name),
					);

					for (const [remote, branches] of branchesByOrigin.entries()) {
						await this.git.branches.deleteRemoteBranch?.(
							branches.map(b => getBranchNameWithoutRemote(b.upstream!.name)),
							remote,
						);
					}
				}
			}
		}

		const remoteBranches = branches.filter(b => b.remote);
		if (remoteBranches.length !== 0) {
			const branchesByOrigin = groupByMap(remoteBranches, b => getRemoteNameFromBranchName(b.name));

			for (const [remote, branches] of branchesByOrigin.entries()) {
				await this.git.branches.deleteRemoteBranch?.(
					branches.map(b => getReferenceNameWithoutRemote(b)),
					remote,
				);
			}
		}
	}

	containsUri(uri: Uri): boolean {
		return this === this.container.git.getRepository(uri);
	}

	@gate()
	@debug()
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
						: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${this.name}...`,
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
			await this.git.ops?.fetch(options);

			this.fireChange('unknown');
		} catch (ex) {
			Logger.error(ex);

			if (FetchError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to fetch');
			}
		}
	}

	@debug({ exit: true })
	getCommonRepository(): Repository | undefined {
		const { commonUri } = this;
		if (commonUri == null) return this;

		return this.container.git.getRepository(commonUri);
	}

	@gate()
	@debug({ exit: true })
	async getOrOpenCommonRepository(): Promise<Repository | undefined> {
		const { commonUri } = this;
		if (commonUri == null) return this;

		// If the repository isn't already opened, then open it as a "closed" repo (won't show up in the UI)
		return this.container.git.getOrOpenRepository(commonUri, {
			detectNested: false,
			force: true,
			closeOnOpen: true,
		});
	}

	private _lastFetched: number | undefined;
	get lastFetchedCached(): number | undefined {
		return this._lastFetched;
	}

	async getLastFetched(): Promise<number> {
		const lastFetched = await this.git.getLastFetchedTimestamp();
		// If we don't get a number, assume the fetch failed, and don't update the timestamp
		if (lastFetched != null) {
			this._lastFetched = lastFetched;
		}

		return this._lastFetched ?? 0;
	}

	@gate()
	@debug()
	async pull(options?: { progress?: boolean; rebase?: boolean }): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pullCore(opts);

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${this.name}...`,
			},
			() => this.pullCore(opts),
		);
	}

	private async pullCore(options?: { rebase?: boolean }) {
		try {
			const withTags = configuration.getCore('git.pullTags', this.uri);
			if (configuration.getCore('git.fetchOnPull', this.uri)) {
				await this.git.ops?.fetch();
			}

			await this.git.ops?.pull({ ...options, tags: withTags });

			this.fireChange('unknown');
		} catch (ex) {
			Logger.error(ex);

			if (PullError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to pull');
			}
		}
	}

	private async showCreatePullRequestPrompt(remoteName: string, branch: GitBranchReference) {
		if (!this.container.actionRunners.count('createPullRequest')) return;
		if (!(await showCreatePullRequestPrompt(branch.name))) return;

		const remote = await this.git.remotes.getRemote(remoteName);

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
	@debug()
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
					: `Pushing ${this.name}...`,
			},
			() => this.pushCore(opts),
		);
	}

	private async pushCore(options?: { force?: boolean; reference?: GitReference; publish?: { remote: string } }) {
		try {
			await this.git.ops?.push({
				reference: options?.reference,
				force: options?.force,
				publish: options?.publish,
			});

			if (isBranchReference(options?.reference) && options?.publish != null) {
				void this.showCreatePullRequestPrompt(options.publish.remote, options.reference);
			}

			this.fireChange('unknown');
		} catch (ex) {
			Logger.error(ex);

			if (PushError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to push');
			}
		}
	}

	/**
	 * Resumes the repository, optionally after a delay.
	 * Delayed resumes are automatically cancelled if suspend() is called.
	 */
	@trace({ onlyExit: true })
	resume(delayMs?: number): void {
		// If a delay is specified, schedule the resume and return
		if (delayMs) {
			// Cancel any existing pending resume
			if (this._pendingResumeTimer != null) {
				clearTimeout(this._pendingResumeTimer);
			}
			this._pendingResumeTimer = setTimeout(() => {
				this._pendingResumeTimer = undefined;
				this.resume();
			}, delayMs);
			return;
		}

		const scope = getScopedLogger();

		if (!this._suspended) {
			scope?.addExitInfo('ignored; not suspended');
			return;
		}

		this._suspended = false;

		// If we've come back into focus and we are dirty, fire the change events

		if (this._pendingRepoChange != null) {
			scope?.trace(`Firing pending repo ${this._pendingRepoChange.toString(true)}`);
			this.fireChangeCore();
		}

		if (this._pendingFileSystemChange != null) {
			scope?.trace(`Firing pending file system changes`);
			this.fireFileSystemChangeCore();
		}
	}

	get starred(): boolean {
		const starred = this.container.storage.getWorkspace('starred:repositories');
		return starred?.[this.id] === true;
	}

	@debug({ args: branch => ({ branch: branch?.name }) })
	star(branch?: GitBranch): Promise<void> {
		return this.updateStarred(true, branch);
	}

	@gate()
	@debug()
	async switch(ref: string, options?: { createBranch?: string | undefined; progress?: boolean }): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.switchCore(ref, opts);

		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${this.name} to ${ref}...`,
				cancellable: false,
			},
			() => this.switchCore(ref, opts),
		);
	}

	private async switchCore(ref: string, options?: { createBranch?: string }) {
		try {
			await this.git.ops?.checkout(ref, options);

			this.fireChange('unknown');
		} catch (ex) {
			Logger.error(ex);

			if (CheckoutError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to switch to reference');
			}
		}
	}

	async getAbsoluteOrBestRevisionUri(path: string, rev: string | undefined): Promise<Uri | undefined> {
		const uri = this.git.getAbsoluteUri(path, this.uri);
		if (uri != null && this.containsUri(uri) && (await exists(uri))) return uri;

		return rev != null ? this.git.getBestRevisionUri(path, rev) : undefined;
	}

	@debug({ args: branch => ({ branch: branch?.name }) })
	unstar(branch?: GitBranch): Promise<void> {
		return this.updateStarred(false, branch);
	}

	private async updateStarred(star: boolean, branch?: GitBranch) {
		if (branch != null) {
			await this.updateStarredCore('branches', branch.id, star);
		} else {
			await this.updateStarredCore('repositories', this.id, star);
		}

		this.fireChange('starred');
	}

	private async updateStarredCore(key: 'branches' | 'repositories', id: string, star: boolean) {
		const storageKey = `starred:${key}` as const;
		let starred = this.container.storage.getWorkspace(storageKey);
		starred = updateRecordValue(starred, id, star);
		await this.container.storage.storeWorkspace(storageKey, starred);

		this.fireChange('starred');
	}

	private _etagFileSystem: number | undefined;
	get etagFileSystem(): number | undefined {
		return this._etagFileSystem;
	}

	get hasPendingChanges(): boolean {
		return this._pendingRepoChange != null;
	}

	@trace({ onlyExit: true })
	suspend(): void {
		this._suspended = true;

		// Cancel any pending delayed resume
		if (this._pendingResumeTimer != null) {
			clearTimeout(this._pendingResumeTimer);
			this._pendingResumeTimer = undefined;
		}
	}

	waitForRepoChange(timeoutMs: number): Promise<boolean> {
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

		return Promise.race([
			new Promise<false>(r => {
				timeoutId = setTimeout(() => {
					cleanup();
					r(false);
				}, timeoutMs);
			}),
			new Promise<true>(r => {
				listener = this.onDidChange(() => {
					cleanup();
					r(true);
				});
			}),
		]);
	}

	private _fsBufferedEvents: Uri[] | undefined;
	private _fsChangeDelay: number = defaultFileSystemChangeDelay;
	private _fsIsIgnored: ((uri: Uri) => boolean) | undefined;
	private _fsWatcherDisposable: Disposable | undefined;
	private _fsWatchers = new Map<string, number>();

	private ensureIgnoredUrisFilter(): void {
		// Clear stale filter and start buffering until new filter is ready
		this._fsIsIgnored = undefined;
		this._fsBufferedEvents = [];

		void this.git.getIgnoredUrisFilter().then(filter => {
			this._fsIsIgnored = filter;

			const buffered = this._fsBufferedEvents;
			this._fsBufferedEvents = undefined;

			if (buffered?.length) {
				for (const uri of buffered) {
					this.onFileSystemChanged(uri);
				}
			}
		});
	}

	@trace({ onlyExit: true })
	watchFileSystem(delay: number = defaultFileSystemChangeDelay): Disposable {
		const id = uuid();
		this._fsWatchers.set(id, delay);
		if (this._fsWatcherDisposable == null) {
			this.ensureIgnoredUrisFilter();

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
		this._fsBufferedEvents = undefined;
		this._fsChangeDelay = defaultFileSystemChangeDelay;
		this._fsIsIgnored = undefined;
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

	private fireChange(...changes: RepositoryChange[]): void;
	private fireChange(change: RepositoryChange, force: boolean): void;
	@trace()
	private fireChange(...args: RepositoryChange[] | [RepositoryChange, boolean]): void {
		const scope = getScopedLogger();

		// Extract force flag if present (last argument is boolean)
		const lastArg = args[args.length - 1];
		const force = typeof lastArg === 'boolean' ? lastArg : false;
		const changes = (force ? args.slice(0, -1) : args) as RepositoryChange[];

		this._updatedAt = Date.now();

		if (force) {
			// Cancel any pending debounced fire and clear the queue
			this._fireChangeDebounced?.cancel();
			this._fireChangeDebounced = undefined;

			// Set the pending change and fire immediately, bypassing suspension
			this._pendingRepoChange = new RepositoryChangeEvent(this, changes);

			this.providerService.onRepositoryChanged(this, this._pendingRepoChange);
			this.fireChangeCore();

			return;
		}

		this._fireChangeDebounced ??= debounce(this.fireChangeCore.bind(this), defaultRepositoryChangeDelay);
		this._pendingRepoChange = this._pendingRepoChange?.with(changes) ?? new RepositoryChangeEvent(this, changes);

		this.providerService.onRepositoryChanged(this, this._pendingRepoChange);

		if (this._suspended) {
			scope?.trace(`SUSPENDED: queueing repo ${this._pendingRepoChange.toString(true)}`);
			return;
		}

		this._fireChangeDebounced();
	}

	private fireChangeCore() {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.fireChangeCore`);

		const e = this._pendingRepoChange;
		if (e == null) {
			scope?.trace('No pending repo changes');
			return;
		}

		this._pendingRepoChange = undefined;

		scope?.trace(`firing repo ${e.toString(true)}`);
		try {
			this._onDidChange.fire(e);
		} finally {
			this.providerService.onDidRepositoryChange.fire(e);
		}
	}

	@trace()
	private fireFileSystemChange(uri: Uri) {
		const scope = getScopedLogger();

		this._updatedAt = Date.now();

		this._fireFileSystemChangeDebounced ??= debounce(this.fireFileSystemChangeCore.bind(this), this._fsChangeDelay);

		this._pendingFileSystemChange ??= { repository: this, uris: new UriSet() };
		const e = this._pendingFileSystemChange;
		e.uris.add(uri);

		if (this._suspended) {
			scope?.trace(
				`SUSPENDED: queueing fs changes=${join(
					map(e.uris, u => u.fsPath),
					', ',
				)}`,
			);
			return;
		}

		this._fireFileSystemChangeDebounced();
	}

	private fireFileSystemChangeCore() {
		using scope = maybeStartLoggableScope(`${getLoggableName(this)}.fireFileSystemChangeCore`);

		const e = this._pendingFileSystemChange;
		if (e == null) {
			scope?.trace('No pending fs changes');
			return;
		}

		this._pendingFileSystemChange = undefined;

		scope?.trace(
			`firing fs changes=${join(
				map(e.uris, u => u.fsPath),
				', ',
			)}`,
		);

		queueMicrotask(() => this.git.branches.onCurrentBranchModified?.());

		this._onDidChangeFileSystem.fire(e);
	}

	@trace({ onlyExit: true })
	private setupRepoWatchers(gitDir: GitDir | undefined): void {
		if (gitDir == null) return;

		const scope = getScopedLogger();

		if (this.closed) {
			if (this._repoWatchersDisposable != null) {
				scope?.trace(`(closed) stop watching '${this.uri.toString(true)}' for repository changes`);
				this._repoWatchersDisposable.dispose();
				this._repoWatchersDisposable = undefined;
			}

			return;
		}

		if (this._repoWatchersDisposable != null) return;

		const disposables: Disposable[] = [];

		// Limit watching to only the .gitignore file at the root of the repository for performance reasons
		scope?.trace(`watching '${this.uri.toString(true)}/${gitIgnoreGlob}' for .gitignore changes`);

		const ignoreWatcher = workspace.createFileSystemWatcher(new RelativePattern(this.uri, gitIgnoreGlob));
		disposables.push(
			ignoreWatcher,
			ignoreWatcher.onDidChange(this.onGitIgnoreChanged, this),
			ignoreWatcher.onDidCreate(this.onGitIgnoreChanged, this),
			ignoreWatcher.onDidDelete(this.onGitIgnoreChanged, this),
		);

		function watch(this: Repository, uri: Uri, pattern: string) {
			scope?.trace(`watching '${uri.toString(true)}/${pattern}' for repository changes`);

			const watcher = workspace.createFileSystemWatcher(new RelativePattern(uri, pattern));

			disposables.push(
				watcher,
				watcher.onDidChange(e => this.onRepositoryChanged(e, uri, 'change')),
				watcher.onDidCreate(e => this.onRepositoryChanged(e, uri, 'create')),
				watcher.onDidDelete(e => this.onRepositoryChanged(e, uri, 'delete')),
			);
			return watcher;
		}

		if (gitDir?.commonUri == null) {
			watch.call(this, gitDir.uri, dotGitWatcherGlobCombined);
		} else {
			watch.call(this, gitDir.uri, dotGitWatcherGlobRoot);
			watch.call(this, gitDir.commonUri, dotGitWatcherGlobCommon);
		}

		this._repoWatchersDisposable = Disposable.from(...disposables);
	}
}

export function isRepository(repository: unknown): repository is Repository {
	return repository instanceof Repository;
}
