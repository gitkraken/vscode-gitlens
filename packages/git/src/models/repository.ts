import { exhaustiveArray } from '@gitlens/utils/array.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { basename, normalizePath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { GitProviderDescriptor } from '../providers/types.js';
import { getCommonRepositoryUri } from '../utils/repository.utils.js';
import type { WatcherRepoChangeEvent } from '../watching/changeEvent.js';
import type { RepositoryWatchService, WatchHandle, WatchHooks } from '../watching/watchService.js';
import type { RepositorySubscription } from '../watching/watchSession.js';
import { RepositoryChangeEvent } from './repositoryChangeEvent.js';

const instanceCounter = getScopedCounter();

export interface GitDir {
	readonly uri: Uri;
	/** The common git directory for worktrees */
	readonly commonUri?: Uri;
	/** The parent (superproject) directory for submodules */
	readonly parentUri?: Uri;
}

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

export const repositoryChanges = exhaustiveArray<RepositoryChange>()([
	'unknown',
	'index',
	'head',
	'heads',
	'tags',
	'stash',
	'remotes',
	'worktrees',
	'config',
	'pausedOp',
	'cherryPick',
	'merge',
	'rebase',
	'revert',
	'closed',
	'ignores',
	'remoteProviders',
	'starred',
	'opened',
	'gkConfig',
]);

export interface RepositoryInit {
	readonly id: string;
	readonly path: string;
	readonly uri: Uri;
	readonly name: string;
	readonly provider: GitProviderDescriptor;
	readonly gitDir: GitDir | undefined;
	readonly index: number;
	readonly root: boolean;
	readonly closed?: boolean;
	readonly suspended?: boolean;
	readonly watchService: RepositoryWatchService;
}

export interface RepositoryWorkingTreeChangeEvent {
	readonly repository: Repository;
	/** URIs of changed files */
	readonly uris: ReadonlySet<Uri>;
}

export class Repository {
	private readonly _onDidChange = new Emitter<RepositoryChangeEvent>();
	get onDidChange(): Event<RepositoryChangeEvent> {
		return this._onDidChange.event;
	}

	private readonly _onDidChangeWorkingTree = new Emitter<RepositoryWorkingTreeChangeEvent>();
	get onDidChangeWorkingTree(): Event<RepositoryWorkingTreeChangeEvent> {
		return this._onDidChangeWorkingTree.event;
	}

	readonly commonPath: string | undefined;
	readonly commonRepositoryName: string | undefined;
	readonly commonUri: Uri | undefined;
	readonly id: string;
	readonly index: number;
	readonly instance = instanceCounter.next();
	readonly path: string;
	readonly uri: Uri;
	readonly provider: GitProviderDescriptor;
	readonly root: boolean;

	protected readonly _gitDir: GitDir | undefined;
	protected _pendingResumeTimer: ReturnType<typeof setTimeout> | undefined;
	protected _repoSubscription: RepositorySubscription | undefined;
	protected _suspended: boolean;
	protected _watchHandle: WatchHandle | undefined;
	protected readonly _watchService: RepositoryWatchService;

	private _pendingWorkingTreeChange?: RepositoryWorkingTreeChangeEvent;
	private _repoChangeListener: UnifiedDisposable | undefined;

	constructor(init: RepositoryInit) {
		({
			closed: this._closed = init.closed ?? false,
			id: this.id,
			index: this.index,
			gitDir: this._gitDir,
			name: this._name = init.name ?? basename(init.uri.path),
			path: this.path,
			provider: this.provider,
			root: this.root,
			suspended: this._suspended = init.suspended ?? false,
			uri: this.uri,
			watchService: this._watchService,
		} = init);

		// Pre-compute common* properties from gitDir
		const commonGitDirUri = this._gitDir?.commonUri;
		this.commonUri = commonGitDirUri != null ? getCommonRepositoryUri(commonGitDirUri) : undefined;
		this.commonPath = this.commonUri != null ? normalizePath(this.commonUri.path) : undefined;
		this.commonRepositoryName = this.commonPath != null ? basename(this.commonPath) : undefined;

		// Apply commonRepositoryName prefix
		if (this.commonRepositoryName) {
			const prefix = `${this.commonRepositoryName}: `;
			if (!this._name.startsWith(prefix)) {
				this._name = `${prefix}${this._name}`;
			}
		}

		this.setupWatching();
	}

	dispose(): void {
		clearTimeout(this._pendingResumeTimer);
		this._repoChangeListener?.dispose();
		this._repoChangeListener = undefined;
		this._repoSubscription?.dispose();
		this._repoSubscription = undefined;
		this._watchHandle?.dispose();
		this._watchHandle = undefined;
		this._onDidChange.dispose();
		this._onDidChangeWorkingTree.dispose();
	}

	protected _closed: boolean;
	get closed(): boolean {
		return this._closed;
	}
	set closed(value: boolean) {
		const changed = this._closed !== value;
		this._closed = value;
		if (changed) {
			if (this._closed) {
				// When closing, fire immediately even if suspended
				this.fireChange('closed', true);

				this._repoChangeListener?.dispose();
				this._repoChangeListener = undefined;
				this._repoSubscription?.dispose();
				this._repoSubscription = undefined;
			} else {
				this.setupWatching();
				this.fireChange('opened');
			}

			this.onClosedChanged(value);
		}
	}

	get etag(): number {
		return this._updatedAt;
	}

	get etagWorkingTree(): number | undefined {
		const etag = this._watchHandle?.session.etagWorkingTree;
		return etag != null && etag > 0 ? etag : undefined;
	}

	get hasPendingChanges(): boolean {
		return this._watchHandle?.session.hasPendingChanges ?? false;
	}

	@memoize()
	get idHash(): string {
		return md5(this.id);
	}

	/** Indicates whether this repository is a submodule */
	get isSubmodule(): boolean {
		return this._gitDir?.parentUri != null;
	}

	/** Indicates whether this repository is a worktree */
	get isWorktree(): boolean {
		return this._gitDir?.commonUri != null;
	}

	protected _lastFetched: number | undefined;
	get lastFetchedCached(): number | undefined {
		return this._lastFetched;
	}

	protected readonly _name: string;
	get name(): string {
		return this._name;
	}

	/** The parent repository URI (for submodules) */
	get parentUri(): Uri | undefined {
		return this._gitDir?.parentUri;
	}

	protected _updatedAt: number = 0;
	get updatedAt(): number {
		return this._updatedAt;
	}

	get virtual(): boolean {
		return this.provider.virtual;
	}

	@trace({ onlyExit: true })
	suspend(): void {
		this._suspended = true;
		this._watchHandle?.session.suspend();

		if (this._pendingResumeTimer != null) {
			clearTimeout(this._pendingResumeTimer);
			this._pendingResumeTimer = undefined;
		}
	}

	@trace({ onlyExit: true })
	resume(delayMs?: number): void {
		if (delayMs) {
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
		this._watchHandle?.session.resume();
	}

	waitForRepoChange(timeoutMs: number): Promise<boolean> {
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		let listener: UnifiedDisposable | undefined;

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

	@trace({ onlyExit: true })
	watchWorkingTree(delay: number = 2500): UnifiedDisposable {
		const sub = this._watchHandle?.session.subscribeToWorkingTree({ delayMs: delay });
		if (sub == null) return createDisposable(() => {});

		const listener = sub.onDidChangeWorkingTree(e => this.onWorkingTreeChanged(e.paths));

		return createDisposable(() => {
			listener.dispose();
			sub.dispose();
		});
	}

	/**
	 * Creates a RepositoryChangeEvent for this repository.
	 * Override in subclass to return a subclass-specific event type.
	 */
	protected createChangeEvent(changes: RepositoryChange[]): RepositoryChangeEvent {
		return new RepositoryChangeEvent(this, changes);
	}

	protected fireChange(...changes: RepositoryChange[]): void;
	protected fireChange(change: RepositoryChange, force: boolean): void;
	@trace()
	protected fireChange(...args: RepositoryChange[] | [RepositoryChange, boolean]): void {
		const lastArg = args[args.length - 1];
		const force = typeof lastArg === 'boolean' ? lastArg : false;
		const changes = (force ? args.slice(0, -1) : args) as RepositoryChange[];

		this._updatedAt = Date.now();

		if (force) {
			const e = this.createChangeEvent(changes);
			this._onDidChange.fire(e);
			return;
		}

		this._watchHandle?.session.fireChange(...changes);
	}

	/** Called when the closed state changes. Override to add behavior (e.g., branch access tracking). */
	protected onClosedChanged(_closed: boolean): void {}

	/** Called when the watch service notifies of FETCH_HEAD changes. */
	protected onFetchHeadChanged(): void {
		this._lastFetched = undefined;
	}

	/** Called when .gitignore changes in the working tree. */
	protected onGitIgnoreChanged(): void {
		this.fireChange('ignores');
	}

	/** Called by the watch service when info/exclude changes. */
	protected onIgnoresChanged(): void {}

	/** Called by the session when a debounced repo change event fires */
	private onSessionRepoChange(e: WatcherRepoChangeEvent): void {
		this._updatedAt = Date.now();

		const extEvent = this.createChangeEvent([...e.changes]);
		this._onDidChange.fire(extEvent);
	}

	/** Called by the session when debounced working tree changes arrive */
	protected onWorkingTreeChanged(paths: ReadonlySet<string>): void {
		this._updatedAt = Date.now();

		this._pendingWorkingTreeChange ??= { repository: this, uris: new Set<Uri>() };
		for (const p of paths) {
			(this._pendingWorkingTreeChange.uris as Set<Uri>).add(fileUri(p));
		}

		if (this._suspended) return;

		const e = this._pendingWorkingTreeChange;
		this._pendingWorkingTreeChange = undefined;
		this._onDidChangeWorkingTree.fire(e);
	}

	@trace({ onlyExit: true })
	private setupWatching(): void {
		if (this._gitDir == null || this._closed) return;
		if (this._repoSubscription != null) return;

		const scope = getScopedLogger();

		this._watchHandle ??= this._watchService.watch(this.path, this._gitDir, {
			onFetchHeadChanged: () => this.onFetchHeadChanged(),
			onGitIgnoreChanged: () => this.onGitIgnoreChanged(),
			onIgnoresChanged: () => this.onIgnoresChanged(),
		} satisfies WatchHooks);
		if (this._watchHandle == null) return;

		const sub = this._watchHandle.session.subscribe();
		this._repoSubscription = sub;
		this._repoChangeListener = sub.onDidChange(e => this.onSessionRepoChange(e));

		scope?.trace(`subscribed to repo changes for '${this.uri.toString()}'`);
	}

	static is(repository: unknown): repository is Repository {
		return repository instanceof Repository;
	}
}
