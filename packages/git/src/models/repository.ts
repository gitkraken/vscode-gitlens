import { exhaustiveArray } from '@gitlens/utils/array.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { md5 } from '@gitlens/utils/crypto.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
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
	| 'gkConfig'
	| 'lastFetched';

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
	'lastFetched',
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
	protected _repoSubscription: RepositorySubscription | undefined;
	protected _watchHandle: WatchHandle | undefined;
	protected readonly _watchService: RepositoryWatchService;

	private _pendingWorkingTreeChange?: RepositoryWorkingTreeChangeEvent;
	private _pendingWorkingTreeFlush = false;
	private _repoChangeListener: UnifiedDisposable | undefined;
	/** Outstanding leases on the shared {@link _watchHandle} across `watch()` + `watchWorkingTree()`. */
	private _watchHandleRefs = 0;
	/** Outstanding `watch()` (repo-change) leases; drives the single shared bridge subscription. */
	private _watchRefs = 0;
	private _disposed = false;

	constructor(init: RepositoryInit) {
		({
			id: this.id,
			index: this.index,
			gitDir: this._gitDir,
			name: this._name = init.name ?? basename(init.uri.path),
			path: this.path,
			provider: this.provider,
			root: this.root,
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
	}

	dispose(): void {
		this._disposed = true;
		this._repoChangeListener?.dispose();
		this._repoChangeListener = undefined;
		this._repoSubscription?.dispose();
		this._repoSubscription = undefined;
		this._watchHandle?.dispose();
		this._watchHandle = undefined;
		this._watchHandleRefs = 0;
		this._watchRefs = 0;
		this._onDidChange.dispose();
		this._onDidChangeWorkingTree.dispose();
	}

	/** Indicates whether this repository currently has an active `watch()` (repo-change) lease. */
	get watching(): boolean {
		return this._watchRefs > 0;
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

	/**
	 * Starts watching this repository's `.git` directory for repo-change events (delivered via
	 * {@link onDidChange}) and returns a lease. Ref-counted: the underlying watch handle is acquired
	 * on the first lease (across `watch()` and {@link watchWorkingTree}) and released when the last
	 * is disposed. The model is inert until watched. No-ops (returns a disposable that does nothing)
	 * for repositories without a git directory (e.g. virtual repos).
	 */
	@trace({ onlyExit: true })
	watch(): UnifiedDisposable {
		const acquired = this.acquireWatchHandle();
		if (acquired == null) return createDisposable(() => {});

		if (this._watchRefs++ === 0) {
			const sub = acquired.handle.session.subscribe();
			this._repoSubscription = sub;
			this._repoChangeListener = sub.onDidChange(e => this.onSessionRepoChange(e));
		}

		return createDisposable(
			() => {
				// Repo already torn down — its handle/subscriptions are gone; skip to avoid a negative refcount
				if (this._disposed) return;

				if (--this._watchRefs === 0) {
					this._repoChangeListener?.dispose();
					this._repoChangeListener = undefined;
					this._repoSubscription?.dispose();
					this._repoSubscription = undefined;
				}
				acquired.lease.dispose();
			},
			{ once: true },
		);
	}

	@trace({ onlyExit: true })
	watchWorkingTree(delay: number = 2500): UnifiedDisposable {
		const acquired = this.acquireWatchHandle();
		if (acquired == null) return createDisposable(() => {});

		const sub = acquired.handle.session.subscribeToWorkingTree({ delayMs: delay });
		const listener = sub.onDidChangeWorkingTree(e => this.onWorkingTreeChanged(e.paths));

		return createDisposable(
			() => {
				listener.dispose();
				sub.dispose();
				acquired.lease.dispose();
			},
			{ once: true },
		);
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
		const lastArg = args.at(-1);
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

	/** Called when the watch service notifies of FETCH_HEAD changes. */
	protected onFetchHeadChanged(): void {
		// Don't reset `_lastFetched` here: the FS watcher can fire even when the on-disk mtime
		// hasn't advanced (atomic-rename / lock-file activity emits `change` events without an
		// mtime bump), and wiping would clobber a fresher value set by `markFetched()`.
		// `getLastFetched()` reconciles in-memory vs FS via `Math.max`. Force-fire so consumers
		// invalidate their caches and re-read.
		this.fireChange('lastFetched', true);
	}

	/**
	 * Marks the repository as having just been fetched. Use after a GitLens-initiated fetch/pull
	 * completes so the "last fetched" UI tracks the attempt even when git skipped rewriting
	 * `.git/FETCH_HEAD` (modern git omits the rewrite when all refs are up-to-date). The
	 * in-memory timestamp is reconciled with the on-disk mtime by {@link getLastFetched} via
	 * `Math.max`, so this is monotonic.
	 */
	markFetched(timestamp: number = Date.now()): void {
		const next = Math.max(this._lastFetched ?? 0, timestamp);
		if (next === this._lastFetched) return;

		this._lastFetched = next;
		this.fireChange('lastFetched', true);
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

	/**
	 * Called by every {@link watchWorkingTree} subscription when its debounced batch arrives. Each
	 * call to {@link watchWorkingTree} adds a separate bridge listener on the underlying watch
	 * session, so a single fs change can invoke this method multiple times in the same microtask —
	 * once per active subscription. We accumulate paths into a single pending event and defer the
	 * actual fire to a microtask so back-to-back synchronous bridge calls collapse into ONE
	 * `_onDidChangeWorkingTree` emission. Without this coalescing, every WIP-dependent listener
	 * (graph, file history, compare branch, etc.) would fire N times for N active subscriptions.
	 */
	protected onWorkingTreeChanged(paths: ReadonlySet<string>): void {
		this._updatedAt = Date.now();

		this._pendingWorkingTreeChange ??= { repository: this, uris: new Set<Uri>() };
		for (const p of paths) {
			(this._pendingWorkingTreeChange.uris as Set<Uri>).add(fileUri(p));
		}

		if (this._pendingWorkingTreeFlush) return;

		this._pendingWorkingTreeFlush = true;
		queueMicrotask(() => {
			this._pendingWorkingTreeFlush = false;
			const e = this._pendingWorkingTreeChange;
			if (e == null) return;

			this._pendingWorkingTreeChange = undefined;
			this._onDidChangeWorkingTree.fire(e);
		});
	}

	/**
	 * Lazily acquires (and ref-counts) the shared {@link _watchHandle} for this repository, returning
	 * the handle plus a one-shot lease whose disposal decrements the ref count (releasing the handle
	 * when the last lease is gone). Returns `undefined` for repositories without a git directory.
	 */
	private acquireWatchHandle(): { handle: WatchHandle; lease: UnifiedDisposable } | undefined {
		if (this._gitDir == null || this._disposed) return undefined;

		this._watchHandle ??= this._watchService.watch(this.path, this._gitDir, {
			onFetchHeadChanged: () => this.onFetchHeadChanged(),
			onGitIgnoreChanged: () => this.onGitIgnoreChanged(),
			onIgnoresChanged: () => this.onIgnoresChanged(),
		} satisfies WatchHooks);
		const handle = this._watchHandle;
		if (handle == null) return undefined;

		this._watchHandleRefs++;
		const lease = createDisposable(
			() => {
				// Repo already torn down — the handle is gone; skip to avoid a negative refcount
				if (this._disposed) return;

				if (--this._watchHandleRefs === 0) {
					this._watchHandle?.dispose();
					this._watchHandle = undefined;
				}
			},
			{ once: true },
		);

		return { handle: handle, lease: lease };
	}

	static is(repository: unknown): repository is Repository {
		return repository instanceof Repository;
	}
}
