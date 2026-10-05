import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { isDescendant, relative } from '@gitlens/utils/path.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';
import type { GitIgnoreFilter } from './gitIgnoreFilter.js';
import type { FileWatcher, FileWatchEvent, FileWatchingProvider } from './provider.js';
import { shouldIgnoreWorkingTreePath, workingTreeExcludes } from './watcherPatterns.js';
import type { WatchGroupHooks } from './watchGroup.js';
import { WatchGroup } from './watchGroup.js';
import { RepositoryWatchSession } from './watchSession.js';

/**
 * Cap on paths held while the gitignore filter loads. Higher than the session's own cap because these are
 * pre-filter — most of a build's output is typically gitignored and would be discarded on replay, so a
 * tighter bound here would mark batches incomplete when they filter down to almost nothing.
 */
const maxBufferedWorkingTreePaths = 5000;

/** Trailing debounce before the git-ignored directory set is re-read after an ignore rule changes */
const ignoredDirectoriesRefreshDelayMs = 500;

interface WorkingTreeWatcherEntry {
	readonly session: RepositoryWatchSession;
	/** The event handler shared by every watcher this entry has had — a re-created watcher reuses it */
	readonly onEvent: (event: FileWatchEvent) => void;
	readonly filter?: GitIgnoreFilter;
	watcher: FileWatcher;
	/** The git-ignored directories the live watcher was created excluding (on top of the static set) */
	ignoredDirectories: readonly string[];
	/** Bumped by every ignore-rule change and by stopping; a read that lands under a different value is stale */
	generation: number;
	reading: boolean;
	/** A refresh came due while a read was in flight */
	rereadQueued: boolean;
	refreshTimer?: ReturnType<typeof setTimeout>;
	/**
	 * Git-ignored directories (repo-relative) whose events reached the post-filter, so the watcher isn't pruning them —
	 * typically created after the last read (a first build's `dist/`). Each waits for a read that started after it.
	 */
	unpruned?: Set<string>;
	/**
	 * Directories a read showed git won't prune (they hold tracked files, or glob metacharacters in their names);
	 * cleared when ignore rules change
	 */
	unprunable?: Set<string>;
}

export interface WatchServiceOptions {
	readonly watchingProvider: FileWatchingProvider;
	/** Default debounce for repo changes when subscriber doesn't specify. Default: 250ms */
	readonly defaultRepoDelayMs?: number;
	/** Default debounce for working tree changes when subscriber doesn't specify. Default: 2500ms */
	readonly defaultWorkingTreeDelayMs?: number;
	/** Default cap on how long continuous repo activity can defer a flush. `Infinity` disables it. Default: 2000ms */
	readonly defaultRepoMaxWaitMs?: number;
	/** Default cap on how long continuous working tree activity can defer a flush. `Infinity` disables it. Default: 10000ms */
	readonly defaultWorkingTreeMaxWaitMs?: number;
	/** Returns a GitIgnoreFilter for a given repo. When absent or returns undefined, gitignore filtering is skipped. */
	readonly getIgnoreFilter?: (repoPath: string, gitDirPath: string) => GitIgnoreFilter | undefined;
	/**
	 * Returns the repo-relative directories an ignore rule matches, for a watching provider that prunes
	 * `excludes` natively (`supportsExcludes`). Never called for one that doesn't. A rejection keeps the static set.
	 */
	readonly getIgnoredDirectories?: (repoPath: string) => Promise<readonly string[]>;
}

export interface WatchHooks {
	/** Called when FETCH_HEAD changed (for last-fetched tracking) */
	readonly onFetchHeadChanged?: (repoPath: string) => void;
	/** Called when .git/info/exclude changed */
	readonly onIgnoresChanged?: (repoPath: string) => void;
	/** Called when .gitignore changed in the working tree (extension watches this separately) */
	readonly onGitIgnoreChanged?: (repoPath: string) => void;
}

export interface WatchHandle {
	readonly session: RepositoryWatchSession;
	dispose(): void;
}

interface SessionRecord {
	readonly session: RepositoryWatchSession;
	readonly gitDir: GitDir;
	/**
	 * Hooks contributed by all current `watch()` callers for this repo path. Earlier
	 * implementations stored just the first caller's hooks (`WatchHooks | undefined`) and
	 * silently dropped subsequent callers' hooks — that broke the case where a low-level
	 * subscriber (e.g. the Graph's secondary-worktree WIP watcher) opened the session
	 * first without hooks, and a later `Repository.watch()` for the same path lost
	 * its `markFetched` / `onIgnoresChanged` wiring. Each `watch()` call adds its hooks
	 * to this set and removes them on dispose; fire sites iterate the set.
	 */
	readonly watchHooks: Set<WatchHooks>;
	refCount: number;
}

/**
 * Global service that multiplexes repository watching across all repos.
 *
 * Manages:
 * - Session map: one `RepositoryWatchSession` per repo path (ref-counted)
 * - Watch groups: shared `.git` watchers across worktrees
 * - Working tree watchers: per-repo filesystem watchers with gitignore filtering
 *
 * Sessions and watch groups are created lazily on first `subscribe()`
 * within a session, and destroyed when the last subscriber leaves.
 */
export class RepositoryWatchService implements UnifiedDisposable {
	private readonly _onDidChangeRepository = new Emitter<WatcherRepoChangeEvent>();
	/** Global multiplexed event for ALL watched repos */
	get onDidChangeRepository(): Event<WatcherRepoChangeEvent> {
		return this._onDidChangeRepository.event;
	}

	private readonly _onDidChangeWorkingTree = new Emitter<string>();
	/** Global multiplexed working-tree change event (repo path) for ALL watched repos. Fires once per
	 *  debounced flush per session — the single point that drives the cache's status clock for working-tree edits. */
	get onDidChangeWorkingTree(): Event<string> {
		return this._onDidChangeWorkingTree.event;
	}

	private readonly _onDidChangeFetchHead = new Emitter<string>();
	/**
	 * Global FETCH_HEAD change event (repo path) for ALL watched repos, fired as each change is seen (no debounce).
	 * FETCH_HEAD maps to no {@link RepositoryChange} on the session, so this is how a host invalidates its cached
	 * last-fetched time — the standalone service bridges it to the cache's `lastFetched`.
	 */
	get onDidChangeFetchHead(): Event<string> {
		return this._onDidChangeFetchHead.event;
	}

	private readonly defaultRepoDelayMs?: number;
	private readonly defaultWorkingTreeDelayMs?: number;
	private readonly defaultRepoMaxWaitMs?: number;
	private readonly defaultWorkingTreeMaxWaitMs?: number;
	private readonly getIgnoreFilter?: (repoPath: string, gitDirPath: string) => GitIgnoreFilter | undefined;
	private readonly getIgnoredDirectories?: (repoPath: string) => Promise<readonly string[]>;
	private readonly provider: FileWatchingProvider;

	private readonly sessionMap = new Map<string, SessionRecord>();
	private readonly watchGroups = new Map<string, WatchGroup>();
	private readonly wtWatchers = new Map<string, WorkingTreeWatcherEntry>();
	private _disposed = false;
	/** Global suspend state (driven by window focus); inherited by sessions created via {@link watch}. */
	private _suspended = false;

	constructor(options: WatchServiceOptions) {
		this.provider = options.watchingProvider;
		this.defaultRepoDelayMs = options.defaultRepoDelayMs;
		this.defaultWorkingTreeDelayMs = options.defaultWorkingTreeDelayMs;
		this.defaultRepoMaxWaitMs = options.defaultRepoMaxWaitMs;
		this.defaultWorkingTreeMaxWaitMs = options.defaultWorkingTreeMaxWaitMs;
		this.getIgnoreFilter = options.getIgnoreFilter;
		this.getIgnoredDirectories = options.getIgnoredDirectories;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;

		this._disposed = true;

		for (const record of this.sessionMap.values()) {
			this.disposeSessionRecord(record);
		}
		this.sessionMap.clear();

		for (const group of this.watchGroups.values()) {
			group.dispose();
		}
		this.watchGroups.clear();

		for (const repoPath of [...this.wtWatchers.keys()]) {
			this.stopWorkingTreeWatcher(repoPath);
		}

		this._onDidChangeRepository.dispose();
		this._onDidChangeWorkingTree.dispose();
		this._onDidChangeFetchHead.dispose();
	}

	/**
	 * Start watching a repository. Reference-counted:
	 * same repoPath → same session (refCount++).
	 * Worktrees sharing a .git dir share the WatchGroup.
	 *
	 * Returns a handle with the session and a dispose function.
	 * Disposing the handle decrements the ref count.
	 *
	 * `repoPath` is keyed by {@link getRepositoryKey}, and every session, event and hook carries that key — the
	 * same one the cache fences status reads on — so a host passing `C:\repo\` and one passing `c:/repo` share
	 * a session and advance the same status clock.
	 */
	watch(repoPath: string, gitDir: GitDir, watchHooks?: WatchHooks): WatchHandle | undefined {
		if (this._disposed) return undefined;

		repoPath = getRepositoryKey(repoPath);

		let record = this.sessionMap.get(repoPath);
		if (record != null) {
			record.refCount++;
			if (watchHooks != null) {
				record.watchHooks.add(watchHooks);
			}
		} else {
			const session = new RepositoryWatchSession({
				repoPath: repoPath,
				defaultRepoDelayMs: this.defaultRepoDelayMs,
				defaultWorkingTreeDelayMs: this.defaultWorkingTreeDelayMs,
				defaultRepoMaxWaitMs: this.defaultRepoMaxWaitMs,
				defaultWorkingTreeMaxWaitMs: this.defaultWorkingTreeMaxWaitMs,
				suspended: this._suspended,
				lifecycle: {
					onFirstRepoSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.connectToWatchGroup(rec);
						}
					},
					onLastRepoSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.disconnectFromWatchGroup(rec);
						}
					},
					onFirstWorkingTreeSubscriber: (): void => {
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.startWorkingTreeWatcher(rec);
						}
					},
					onLastWorkingTreeSubscriber: (): void => {
						this.stopWorkingTreeWatcher(repoPath);
					},
				},
				onDidFireRepoChange: (event): void => {
					this._onDidChangeRepository.fire(event);
				},
				onDidFireWorkingTreeChange: (repoPath): void => {
					this._onDidChangeWorkingTree.fire(repoPath);
				},
			});

			const watchHooksSet = new Set<WatchHooks>();
			if (watchHooks != null) {
				watchHooksSet.add(watchHooks);
			}

			record = {
				session: session,
				gitDir: gitDir,
				watchHooks: watchHooksSet,
				refCount: 1,
			};
			this.sessionMap.set(repoPath, record);
		}

		const sessionRef = record.session;
		let handleDisposed = false;

		return {
			session: sessionRef,
			dispose: (): void => {
				if (handleDisposed) return;

				handleDisposed = true;

				const rec = this.sessionMap.get(repoPath);
				if (rec == null) return;

				rec.refCount--;
				if (watchHooks != null) {
					rec.watchHooks.delete(watchHooks);
				}
				if (rec.refCount <= 0) {
					this.sessionMap.delete(repoPath);
					this.disposeSessionRecord(rec);
				}
			},
		};
	}

	/** Get an existing session by repo path */
	getSession(repoPath: string): RepositoryWatchSession | undefined {
		return this.sessionMap.get(getRepositoryKey(repoPath))?.session;
	}

	/** Resource usage retained by repository watchers. */
	getResourceUsage(): ResourceUsage {
		return {
			'watch.sessions.count': this.sessionMap.size,
			'watch.groups.count': this.watchGroups.size,
			'watch.workingTreeWatchers.count': this.wtWatchers.size,
		};
	}

	/** Suspend all sessions and mark the service suspended so late-joining sessions start suspended */
	suspendAll(): void {
		this._suspended = true;
		for (const record of this.sessionMap.values()) {
			record.session.suspend();
		}
	}

	/** Resume all sessions (clearing the global suspend state), with optional per-session delay */
	resumeAll(getDelay?: (session: RepositoryWatchSession) => number): void {
		this._suspended = false;
		for (const record of this.sessionMap.values()) {
			const delayMs = getDelay?.(record.session);
			record.session.resume(delayMs);
		}
	}

	private getOrCreateWatchGroup(commonGitDir: string): WatchGroup {
		let group = this.watchGroups.get(commonGitDir);
		if (group == null) {
			group = new WatchGroup(commonGitDir, this.provider);
			this.watchGroups.set(commonGitDir, group);
		}
		return group;
	}

	private maybeDisposeWatchGroup(commonGitDir: string): void {
		const group = this.watchGroups.get(commonGitDir);
		if (group == null) return;

		if (group.sessions.size === 0) {
			group.dispose();
			this.watchGroups.delete(commonGitDir);
		}
	}

	private connectToWatchGroup(record: SessionRecord): void {
		const { session, gitDir, watchHooks } = record;
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const group = this.getOrCreateWatchGroup(commonGitDir);

		const hooks: WatchGroupHooks = {
			onRepoChanged: function (_repoPath: string, changes: RepositoryChange[], ref?: string): void {
				session.pushRepoChanges(changes, ref);
			},
			onFetchHeadChanged: (repoPath: string): void => {
				// Global first, so a host's cache drops its last-fetched time before any hook re-reads it
				this._onDidChangeFetchHead.fire(repoPath);
				// Iterate at fire time so callers that joined after the group was wired up
				// still receive events (e.g. a `Repository.watch()` whose hooks landed
				// after a hookless `GitRepositoryService.watch` registered first).
				for (const h of watchHooks) {
					h.onFetchHeadChanged?.(repoPath);
				}
			},
			onIgnoresChanged: (repoPath: string): void => {
				this.refreshWorkingTreeFilter(repoPath);
				for (const h of watchHooks) {
					h.onIgnoresChanged?.(repoPath);
				}
			},
		};

		group.addSession(session.repoPath, gitDir, hooks);
	}

	private disconnectFromWatchGroup(record: SessionRecord): void {
		const { session, gitDir } = record;
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const group = this.watchGroups.get(commonGitDir);
		if (group == null) return;

		group.removeSession(session.repoPath);
		this.maybeDisposeWatchGroup(commonGitDir);
	}

	private startWorkingTreeWatcher(record: SessionRecord): void {
		const { session, gitDir, watchHooks } = record;
		const repoPath = session.repoPath;
		if (this.wtWatchers.has(repoPath)) return;

		const canPrune = this.canPruneIgnoredDirectories();
		// Assigned once the first watcher exists; read by the handlers below instead of a map lookup per event
		let entry: WorkingTreeWatcherEntry | undefined;

		let filter: GitIgnoreFilter | undefined;
		if (this.getIgnoreFilter != null) {
			filter = this.getIgnoreFilter(repoPath, gitDir.uri.fsPath);
		}

		// Buffer events while the gitignore filter loads, then replay
		let filterReady = filter == null;
		let buffered: string[] | undefined = filter != null ? [] : undefined;
		let bufferIncomplete = false;

		if (filter != null) {
			void filter
				.ready()
				.then(() => {
					filterReady = true;
					if (buffered?.length) {
						const paths = filterWorkingTreePaths(buffered, repoPath, filter);
						if (paths.length > 0 || bufferIncomplete) {
							session.pushWorkingTreeChanges(paths, bufferIncomplete);
						}
					}
					buffered = undefined;
					bufferIncomplete = false;
				})
				.catch(() => {
					filterReady = true;
					buffered = undefined;
				});
		}

		// An ignore rule changed (or may have): refresh the filter and the pruned set, and notify the host
		const onIgnoreRulesChanged = (): void => {
			if (filter != null) {
				void filter.refresh();
			}
			if (entry != null) {
				this.scheduleIgnoredDirectoriesRefresh(entry);
			}
			// See `connectToWatchGroup` for the iterate-at-fire-time rationale.
			for (const h of watchHooks) {
				h.onGitIgnoreChanged?.(repoPath);
			}
			// Route the ignore-rule change through the repo channel as an `ignores` change (like `info/exclude`),
			// so it reaches EVERY session subscriber — including a closed secondary worktree's `watch()` `repoSub`,
			// which has no `onGitIgnoreChanged` hook and would otherwise keep a stale untracked-file list. Coalesces
			// with any hook-fired `ignores` above, so open repos don't double.
			session.pushRepoChanges(['ignores']);
		};

		const onEvent = (event: FileWatchEvent): void => {
			// Dropped events: nothing to filter or buffer, the whole tree needs a re-read. A `.gitignore` edit may be
			// among them, and a filter left on the old rules would keep dropping changes they used to ignore
			if (event.reason === 'overflow') {
				session.pushWorkingTreeChanges([], true);
				onIgnoreRulesChanged();
				return;
			}

			// Fast noise check (node_modules, .git, .watchman-cookie-)
			if (shouldIgnoreWorkingTreePath(event.path)) return;

			// Detect .gitignore changes (nested ones too, unless git skips them for sitting in an ignored directory).
			// The root .gitignore is only an ignore change; a nested one is also an ordinary working-tree change.
			const relativePath = isDescendant(event.path, repoPath) ? relative(repoPath, event.path) : undefined;
			if (relativePath === '.gitignore') {
				onIgnoreRulesChanged();
				return;
			}

			if (relativePath?.endsWith('/.gitignore') && !(filterReady && filter?.isIgnored(relativePath))) {
				onIgnoreRulesChanged();
			}

			if (!filterReady) {
				// Buffer until the gitignore filter is ready. Capped: `ready()` awaits a `core.excludesFile`
				// read, which queues behind every other git command, so this window can stay open for a long
				// time — and these paths haven't been gitignore-filtered yet, so a build's output all lands
				// here. Past the cap, stop retaining and mark the batch partial rather than growing.
				if (buffered != null && buffered.length >= maxBufferedWorkingTreePaths) {
					bufferIncomplete = true;
					return;
				}

				buffered?.push(event.path);
				return;
			}

			// Gitignore filter (sync after ready)
			if (filter != null && relativePath != null && filter.isIgnored(relativePath)) {
				if (canPrune && entry != null) {
					this.onIgnoredEvent(entry, filter, relativePath);
				}
				return;
			}

			session.pushWorkingTreeChanges([event.path]);
		};

		entry = {
			session: session,
			onEvent: onEvent,
			filter: filter,
			watcher: this.provider.createWatcher(repoPath, '**', onEvent, { excludes: workingTreeExcludes }),
			ignoredDirectories: [],
			generation: 0,
			reading: false,
			rereadQueued: false,
		};
		this.wtWatchers.set(repoPath, entry);

		if (canPrune) {
			void this.refreshIgnoredDirectories(entry, repoPath);
		}
	}

	private stopWorkingTreeWatcher(repoPath: string): void {
		const entry = this.wtWatchers.get(repoPath);
		if (entry == null) return;

		// Drops any read still in flight, and any refresh waiting on its debounce
		entry.generation++;
		clearTimeout(entry.refreshTimer);
		entry.refreshTimer = undefined;
		entry.watcher.dispose();
		this.wtWatchers.delete(repoPath);
	}

	private canPruneIgnoredDirectories(): boolean {
		return this.provider.supportsExcludes === true && this.getIgnoredDirectories != null;
	}

	/**
	 * An event the gitignore post-filter dropped. When its directory is itself ignored, the watcher is watching an
	 * ignored directory it could prune (one created after the last read), so the ignored set is read again. An ignored
	 * file in a watched directory (a root `.env`, `src/debug.log`) triggers nothing.
	 */
	private onIgnoredEvent(entry: WorkingTreeWatcherEntry, filter: GitIgnoreFilter, relativePath: string): void {
		// A refresh is already pending and reads the whole set; keep a flood of these events at two field checks
		if (entry.refreshTimer != null || entry.rereadQueued) return;

		// The outermost ignored directory above the path — the one a read would prune. Keyed on it (not the immediate
		// parent), so a directory git won't prune costs one read however many subdirectories it has
		let ignoredDir: string | undefined;
		for (let slash = relativePath.indexOf('/'); slash !== -1; slash = relativePath.indexOf('/', slash + 1)) {
			const dir = relativePath.slice(0, slash);
			if (entry.unpruned?.has(dir) || entry.unprunable?.has(dir)) return;
			if (filter.isIgnored(`${dir}/`)) {
				ignoredDir = dir;
				break;
			}
		}
		if (ignoredDir == null) return;

		entry.unpruned ??= new Set();
		entry.unpruned.add(ignoredDir);

		// Ignore rules didn't change, so a read in flight stays valid (no generation bump), but it may predate the
		// directory
		if (entry.reading) {
			entry.rereadQueued = true;
			return;
		}

		this.armIgnoredDirectoriesRefresh(entry);
	}

	/** Re-reads the git-ignored directories once ignore rules stop changing (trailing debounce, one timer per repo) */
	private scheduleIgnoredDirectoriesRefresh(entry: WorkingTreeWatcherEntry): void {
		if (!this.canPruneIgnoredDirectories()) return;

		// A read already in flight is now stale, and a directory git wouldn't prune may be prunable now
		entry.generation++;
		entry.unprunable = undefined;
		clearTimeout(entry.refreshTimer);
		this.armIgnoredDirectoriesRefresh(entry);
	}

	private armIgnoredDirectoriesRefresh(entry: WorkingTreeWatcherEntry): void {
		entry.refreshTimer = setTimeout(() => {
			entry.refreshTimer = undefined;
			const repoPath = entry.session.repoPath;
			if (this.wtWatchers.get(repoPath) !== entry) return;

			if (entry.reading) {
				entry.rereadQueued = true;
				return;
			}

			void this.refreshIgnoredDirectories(entry, repoPath);
		}, ignoredDirectoriesRefreshDelayMs);
	}

	/** Single-flight: reads the git-ignored directories and, when they changed, swaps in a watcher excluding them */
	private async refreshIgnoredDirectories(entry: WorkingTreeWatcherEntry, repoPath: string): Promise<void> {
		if (this.getIgnoredDirectories == null) return;

		entry.reading = true;
		try {
			const generation = entry.generation;
			// The unpruned directories seen so far; any seen during the read wait for the next one
			const unpruned = entry.unpruned?.size ? [...entry.unpruned] : undefined;

			let directories: readonly string[] | undefined;
			try {
				directories = await this.getIgnoredDirectories(repoPath);
			} catch {
				// Keep what the watcher has; the next ignore-rule change reads again
				directories = undefined;
			}

			if (entry.generation === generation) {
				if (directories != null) {
					this.swapWorkingTreeWatcher(entry, repoPath, directories);
				}
				if (unpruned != null) {
					this.settleUnprunedDirectories(entry, unpruned, directories);
				}
			}
		} finally {
			entry.reading = false;
		}

		if (entry.rereadQueued) {
			entry.rereadQueued = false;
			if (this.wtWatchers.get(repoPath) === entry) {
				void this.refreshIgnoredDirectories(entry, repoPath);
			}
		}
	}

	/**
	 * A directory the read left unexcluded is one git won't prune (or the read failed), so it never triggers a read
	 * again until ignore rules change — otherwise each of its events would spawn git.
	 */
	private settleUnprunedDirectories(
		entry: WorkingTreeWatcherEntry,
		unpruned: readonly string[],
		directories: readonly string[] | undefined,
	): void {
		for (const dir of unpruned) {
			entry.unpruned?.delete(dir);
			if (directories?.some(d => d === dir || dir.startsWith(`${d}/`))) continue;

			entry.unprunable ??= new Set();
			entry.unprunable.add(dir);
		}
	}

	private swapWorkingTreeWatcher(
		entry: WorkingTreeWatcherEntry,
		repoPath: string,
		directories: readonly string[],
	): void {
		const previous = entry.ignoredDirectories;
		if (previous.length === directories.length && previous.every(d => directories.includes(d))) return;

		// New first, then the old one: the overlap can repeat an event (the session coalesces them), but never loses one
		let watcher: FileWatcher;
		try {
			watcher = this.provider.createWatcher(repoPath, '**', entry.onEvent, {
				excludes: [...workingTreeExcludes, ...directories],
			});
		} catch {
			return;
		}

		const previousWatcher = entry.watcher;
		entry.watcher = watcher;
		entry.ignoredDirectories = directories;
		previousWatcher.dispose();

		// Files in a directory that is watched again changed while nothing was looking. A directory still covered by
		// a surviving ancestor entry isn't watched again.
		if (previous.some(d => !directories.some(n => n === d || d.startsWith(`${n}/`)))) {
			entry.session.pushWorkingTreeChanges([], true);
		}
	}

	private refreshWorkingTreeFilter(repoPath: string): void {
		const entry = this.wtWatchers.get(repoPath);
		if (entry == null) return;

		if (entry.filter != null) {
			void entry.filter.refresh();
		}
		this.scheduleIgnoredDirectoriesRefresh(entry);
	}

	private disposeSessionRecord(record: SessionRecord): void {
		this.disconnectFromWatchGroup(record);
		this.stopWorkingTreeWatcher(record.session.repoPath);
		record.session.dispose();
	}
}

function filterWorkingTreePaths(absolutePaths: string[], repoPath: string, filter: GitIgnoreFilter): string[] {
	const result: string[] = [];
	for (const p of absolutePaths) {
		if (!isDescendant(p, repoPath)) continue;

		const relativePath = relative(repoPath, p);
		if (!filter.isIgnored(relativePath)) {
			result.push(p);
		}
	}
	return result;
}
