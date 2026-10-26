import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { isDescendant, relative } from '@gitlens/utils/path.js';
import type { ResourceUsage } from '@gitlens/utils/resourceUsage.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import type { WatcherRepoChangeEvent } from './changeEvent.js';
import type { PollTarget } from './gitDirPoller.js';
import { GitDirPoller } from './gitDirPoller.js';
import type { GitIgnoreFilter } from './gitIgnoreFilter.js';
import type {
	FileWatcher,
	FileWatcherOptions,
	FileWatcherReliability,
	FileWatchEvent,
	FileWatchingProvider,
} from './provider.js';
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
	/** What the live watcher last reported; a re-created watcher starts over from its own report */
	reliability: FileWatcherReliability;
	/** The live watcher has yet to call the `onDidStart` its provider promised (see `callsOnDidStart`) */
	starting: boolean;
	/** Compares the host's working-tree fingerprint while the watcher isn't `reliable` */
	pollTarget?: PollTarget;
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

/**
 * A host whose watchers can report they can't be trusted (see `FileWatcherOptions.onDidChangeReliability`) passes
 * these to have core poll in their place. A `.git` directory is polled by statting the files its watchers read and
 * feeding each one that moved through the same interpretation as a watcher event; a working tree is never walked.
 */
export interface WatchPollingOptions {
	/**
	 * Reads a path's modification time (ms) and size; `undefined` when it doesn't exist. A rejection means unknown:
	 * the last reading stands, so it never counts as a change.
	 */
	readonly stat: (path: string) => Promise<{ readonly mtime: number; readonly size: number } | undefined>;
	/** Whether a poll is worth running now. Default: the service isn't suspended (`suspendAll`/`resumeAll`) */
	readonly isActive?: () => boolean;
	/** How often each untrusted watcher is polled. Default: 60000ms */
	readonly intervalMs?: number;
	/**
	 * How often `isActive` is looked at, which bounds how late the first poll after it turns true can be. Only with
	 * `isActive`: the default gate wakes only for a poll. Default: 5000ms
	 */
	readonly activeCheckMs?: number;
	/**
	 * Refs to poll for a repository beyond its subscribers' `relevantRefs`: one with none (a host listing every branch)
	 * still needs its checked-out branch's upstream, which a push moves without writing `FETCH_HEAD`
	 */
	readonly getRefs?: (repoPath: string) => Iterable<string>;
	/**
	 * Something that changes whenever the repository's working tree does (e.g. a digest of its status and the
	 * changed files' stats), compared at each poll while working-tree subscribers are watching a working tree whose
	 * watcher can't be trusted; a change is reported with no paths. `undefined` or a rejection skips that poll. With or
	 * without it, a working tree whose watcher is `unwatchable` is reported changed (no paths) whenever its index or
	 * `HEAD` changes.
	 */
	readonly getWorkingTreeFingerprint?: (repoPath: string) => Promise<string | undefined>;
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
	/**
	 * Returns the absolute, normalized folders whose worktrees are ignored (see `GitProvider.getIgnoredWorktreeRoots`):
	 * with a `readFile` and a `readDirectory`, the watcher's reports of their admin entries reach no session. Asked
	 * once per common git dir, when its first session starts watching, and never without both. When absent, empty or
	 * rejected, no admin entry is read.
	 */
	readonly getIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[]>;
	/**
	 * Returns the folders whose worktrees are ignored, relative to a repository's common git dir (see
	 * `GitProvider.getIgnoredWorktreeFolders`): the `.git` watchers whose tree holds the common git dir leave
	 * them unwatched. Asked once per common git dir, when its first session starts watching.
	 */
	readonly getIgnoredWorktreeFolders?: (repoPath: string) => readonly string[];
	/** Opts into polling the watchers that report they can't be trusted. When absent, no watcher is asked. */
	readonly polling?: WatchPollingOptions;
	/**
	 * Reads a file's bytes; a rejection means it couldn't be read. With it, each report of a repository's shared
	 * `.git/config` is classified by what changed in the file: a change confined to some branches' `branch.<name>`
	 * sections reaches only the subscribers following those branches, and carries no `remotes`. Without it, every
	 * config change concerns everyone, as before.
	 */
	readonly readFile?: (path: string) => Promise<Uint8Array>;
	/**
	 * Returns a directory's entries with their types, as the host file system's `readDirectory` does; only the
	 * directories count as admin entries (a stray `.DS_Store` is no worktree's). A rejection means it couldn't be
	 * listed, and one whose `code` is `ENOENT` or `FileNotFound` that the directory isn't there. With it and a
	 * `readFile`, the admin entries of a repository's worktrees are listed and read once as its first session starts
	 * watching, so the reports of an ignored worktree's (see `getIgnoredWorktreeRoots`) reach no session, and the others
	 * aren't held back.
	 */
	readonly readDirectory?: (path: string) => Promise<readonly (readonly [string, number])[]>;
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
	/** The mode {@link RepositoryWatchService.onDidChangeWatchMode} last announced; `'events'` while unwatched */
	watchMode: 'events' | 'poll';
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

	private readonly _onDidChangeWatchMode = new Emitter<{ repoPath: string; mode: 'events' | 'poll' }>();
	/**
	 * Fires as a watched repository starts being polled in place of a watcher (see {@link getWatchMode}), and with
	 * `'events'` as it is watched natively again. Never fires as the repository stops being watched; one watched again
	 * later starts from `'events'`.
	 */
	get onDidChangeWatchMode(): Event<{ repoPath: string; mode: 'events' | 'poll' }> {
		return this._onDidChangeWatchMode.event;
	}

	private readonly defaultRepoDelayMs?: number;
	private readonly defaultWorkingTreeDelayMs?: number;
	private readonly defaultRepoMaxWaitMs?: number;
	private readonly defaultWorkingTreeMaxWaitMs?: number;
	private readonly getIgnoreFilter?: (repoPath: string, gitDirPath: string) => GitIgnoreFilter | undefined;
	private readonly getIgnoredDirectories?: (repoPath: string) => Promise<readonly string[]>;
	private readonly getIgnoredWorktreeRoots?: (repoPath: string) => Promise<readonly string[]>;
	private readonly getIgnoredWorktreeFolders?: (repoPath: string) => readonly string[];
	private readonly provider: FileWatchingProvider;
	private readonly poller: GitDirPoller | undefined;
	private readonly readFile: ((path: string) => Promise<Uint8Array>) | undefined;
	private readonly readDirectory: ((path: string) => Promise<readonly (readonly [string, number])[]>) | undefined;

	private readonly sessionMap = new Map<string, SessionRecord>();
	private readonly watchGroups = new Map<string, WatchGroup>();
	private readonly wtWatchers = new Map<string, WorkingTreeWatcherEntry>();
	/**
	 * The last git-ignored directory read under each filter's current rules, kept across a working-tree watcher's
	 * stop and start so a restart can skip the read; dropped with the filter
	 */
	private readonly keptIgnoredDirectories = new WeakMap<GitIgnoreFilter, readonly string[]>();
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
		this.getIgnoredWorktreeRoots = options.getIgnoredWorktreeRoots;
		this.getIgnoredWorktreeFolders = options.getIgnoredWorktreeFolders;
		this.readFile = options.readFile;
		this.readDirectory = options.readDirectory;
		if (options.polling != null) {
			this.poller = new GitDirPoller(options.polling);
		}
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

		this.poller?.dispose();

		this._onDidChangeRepository.dispose();
		this._onDidChangeWorkingTree.dispose();
		this._onDidChangeFetchHead.dispose();
		this._onDidChangeWatchMode.dispose();
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
						const rec = this.sessionMap.get(repoPath);
						if (rec != null) {
							this.updateWatchMode(rec);
						}
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
				watchMode: 'events',
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

	/**
	 * Core announced one of its own writes for `repoPath`; the session watching it fires the announcement in place of
	 * the write's own `.git` events (see {@link RepositoryWatchSession.noteSelfWrite}); `refs` are the full ref names it
	 * moved, when it knows them, and `options.configConfinedToRefs` confines its `config` change to the sections of the
	 * local branches among them (see `GitServiceHooks.repository.onChanged`). A path no session watches is ignored.
	 */
	noteSelfWrite(
		repoPath: string,
		changes: readonly RepositoryChange[],
		refs?: readonly string[],
		options?: { readonly configConfinedToRefs?: boolean },
	): void {
		if (this._disposed) return;

		this.sessionMap.get(getRepositoryKey(repoPath))?.session.noteSelfWrite(changes, refs, options);
	}

	/** Get an existing session by repo path */
	getSession(repoPath: string): RepositoryWatchSession | undefined {
		return this.sessionMap.get(getRepositoryKey(repoPath))?.session;
	}

	/**
	 * Whether the working tree's watch has yet to go live, owing a rescan once it does (see
	 * `FileWatchingProvider.callsOnDidStart`). Not while it's `unwatchable`: it rescans when it comes back.
	 */
	isWorkingTreeStarting(repoPath: string): boolean {
		const entry = this.wtWatchers.get(getRepositoryKey(repoPath));
		return entry?.starting === true && entry.reliability !== 'unwatchable';
	}

	/**
	 * `'poll'` while a watcher the repository is watched through — its `.git` watchers or its working tree's — can't
	 * watch, and is polled instead; `'events'` while it is watched natively (polled beside an `unreliable` watcher
	 * included); `undefined` when nothing watches it, which {@link onDidChangeWatchMode} doesn't announce.
	 */
	getWatchMode(repoPath: string): 'events' | 'poll' | undefined {
		const record = this.sessionMap.get(getRepositoryKey(repoPath));
		return record != null ? this.computeWatchMode(record) : undefined;
	}

	/** Resource usage retained by repository watchers. */
	getResourceUsage(): ResourceUsage {
		const usage: ResourceUsage = {
			'watch.sessions.count': this.sessionMap.size,
			'watch.groups.count': this.watchGroups.size,
			'watch.workingTreeWatchers.count': this.wtWatchers.size,
		};
		if (this.poller != null) {
			usage['watch.pollTargets.count'] = this.poller.size;
		}
		return usage;
	}

	/** Suspend all sessions and mark the service suspended so late-joining sessions start suspended */
	suspendAll(): void {
		this._suspended = true;
		for (const record of this.sessionMap.values()) {
			record.session.suspend();
		}
		this.poller?.suspend();
	}

	/** Resume all sessions (clearing the global suspend state), with optional per-session delay */
	resumeAll(getDelay?: (session: RepositoryWatchSession) => number): void {
		this._suspended = false;
		for (const record of this.sessionMap.values()) {
			const delayMs = getDelay?.(record.session);
			record.session.resume(delayMs);
		}
		this.poller?.resume();
	}

	private getOrCreateWatchGroup(commonGitDir: string, repoPath: string): WatchGroup {
		let group = this.watchGroups.get(commonGitDir);
		if (group == null) {
			group = new WatchGroup(
				commonGitDir,
				this.provider,
				this.poller,
				this.readFile,
				this.readDirectory,
				// Only a group that can read the admin entries waits on the folders; asking otherwise reads for nothing,
				// and leaves a rejection unhandled
				this.readFile != null && this.readDirectory != null
					? this.getIgnoredWorktreeRoots?.(repoPath)
					: undefined,
				this.getIgnoredWorktreeFolders?.(repoPath),
			);
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
		const group = this.getOrCreateWatchGroup(commonGitDir, session.repoPath);

		const hooks: WatchGroupHooks = {
			onRepoChanged: (
				_repoPath: string,
				changes: RepositoryChange[],
				ref?: string | false,
				overflow?: boolean,
				configBranches?: ReadonlySet<string>,
			): void => {
				if (overflow) {
					session.pushUnfencedRepoChanges(changes);
				} else {
					session.pushRepoChanges(changes, ref, configBranches);
				}

				// A working tree nothing watches is read again whenever the index or HEAD says it may have moved
				if (
					this.poller != null &&
					(changes.includes('index') || changes.includes('head')) &&
					this.wtWatchers.get(session.repoPath)?.reliability === 'unwatchable'
				) {
					session.pushWorkingTreeChanges([], true);
				}
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
			getProbeRefs: (): Iterable<string> => {
				const refs = session.getRelevantRefs();
				for (const ref of this.poller?.options.getRefs?.(session.repoPath) ?? []) {
					refs.add(ref);
				}
				return refs;
			},
			onUnwatchableChanged: (): void => this.updateWatchMode(record),
		};

		group.addSession(session.repoPath, gitDir, hooks);
		this.updateWatchMode(record);
	}

	private disconnectFromWatchGroup(record: SessionRecord): void {
		const { session, gitDir } = record;
		const commonGitDir = (gitDir.commonUri ?? gitDir.uri).fsPath;
		const group = this.watchGroups.get(commonGitDir);
		if (group == null) return;

		group.removeSession(session.repoPath);
		this.maybeDisposeWatchGroup(commonGitDir);
		this.updateWatchMode(record);
	}

	private computeWatchMode(record: SessionRecord): 'events' | 'poll' | undefined {
		const repoPath = record.session.repoPath;
		const group = this.watchGroups.get((record.gitDir.commonUri ?? record.gitDir.uri).fsPath);
		const connected = group?.sessions.has(repoPath) ?? false;
		const wt = this.wtWatchers.get(repoPath);
		if (!connected && wt == null) return undefined;

		return group?.isUnwatchable(repoPath) || wt?.reliability === 'unwatchable' ? 'poll' : 'events';
	}

	private updateWatchMode(record: SessionRecord): void {
		if (this._disposed) return;

		const mode = this.computeWatchMode(record);
		if (mode == null) {
			record.watchMode = 'events';
			return;
		}
		if (mode === record.watchMode) return;

		record.watchMode = mode;
		this._onDidChangeWatchMode.fire({ repoPath: record.session.repoPath, mode: mode });
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

		// Ahead of `ready()`, so the replay below waits for rules that may have changed while nothing watched them
		const revalidated = filter?.revalidate();
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

		// An ignore rule changed (or may have): refresh the filter (unless it already reloaded) and the pruned set, and
		// notify the host
		const onIgnoreRulesChanged = (refreshFilter: boolean): void => {
			if (refreshFilter && filter != null) {
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
			// with any hook-fired `ignores` above, so open repos don't double. Unfenced: it comes from the working tree,
			// which a self-write never holds back.
			session.pushUnfencedRepoChanges(['ignores']);
		};

		const onEvent = (event: FileWatchEvent): void => {
			// Dropped events: nothing to filter or buffer, the whole tree needs a re-read. A `.gitignore` edit may be
			// among them, and a filter left on the old rules would keep dropping changes they used to ignore
			if (event.reason === 'overflow') {
				session.pushWorkingTreeChanges([], true);
				onIgnoreRulesChanged(true);
				return;
			}

			// Fast noise check (node_modules, .git, .watchman-cookie-)
			if (shouldIgnoreWorkingTreePath(event.path)) return;

			// Detect .gitignore changes (nested ones too, unless git skips them for sitting in an ignored directory).
			// The root .gitignore is only an ignore change; a nested one is also an ordinary working-tree change.
			const relativePath = isDescendant(event.path, repoPath) ? relative(repoPath, event.path) : undefined;
			if (relativePath === '.gitignore') {
				onIgnoreRulesChanged(true);
				return;
			}

			if (relativePath?.endsWith('/.gitignore') && !(filterReady && filter?.isIgnored(relativePath))) {
				onIgnoreRulesChanged(true);
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

		// A read from before the watch last stopped; should the rules have moved since, `revalidate` brings a re-read
		const kept = canPrune && filter != null ? this.keptIgnoredDirectories.get(filter) : undefined;
		const created = this.createWorkingTreeWatcher(
			repoPath,
			onEvent,
			kept != null ? [...workingTreeExcludes, ...kept] : workingTreeExcludes,
		);
		entry = {
			session: session,
			onEvent: onEvent,
			filter: filter,
			watcher: created.watcher,
			ignoredDirectories: kept ?? [],
			generation: 0,
			reading: false,
			rereadQueued: false,
			reliability: 'reliable',
			starting: created.starting,
		};
		this.wtWatchers.set(repoPath, entry);
		this.setWorkingTreeReliability(entry, created.reliability, true);

		if (canPrune && kept == null) {
			void this.refreshIgnoredDirectories(entry, repoPath);
		}

		// The kept read predates the rules either outcome lands on, so it goes even when the watch has stopped meanwhile
		void revalidated?.then(
			changed => {
				if (!changed) return;

				if (filter != null) {
					this.keptIgnoredDirectories.delete(filter);
				}
				if (this.wtWatchers.get(repoPath) === entry) {
					onIgnoreRulesChanged(false);
				}
			},
			() => {
				if (filter != null) {
					this.keptIgnoredDirectories.delete(filter);
				}
				if (this.wtWatchers.get(repoPath) === entry) {
					onIgnoreRulesChanged(true);
				}
			},
		);
	}

	private stopWorkingTreeWatcher(repoPath: string): void {
		const entry = this.wtWatchers.get(repoPath);
		if (entry == null) return;

		// Drops any read still in flight, and any refresh waiting on its debounce
		entry.generation++;
		clearTimeout(entry.refreshTimer);
		entry.refreshTimer = undefined;
		entry.watcher.dispose();
		if (entry.pollTarget != null) {
			this.poller?.delete(entry.pollTarget);
			entry.pollTarget = undefined;
		}
		this.wtWatchers.delete(repoPath);
	}

	/**
	 * Creates a working-tree watcher, with the reliability it reported before returning, and whether it has yet to call
	 * the `onDidStart` its provider promised
	 */
	private createWorkingTreeWatcher(
		repoPath: string,
		onEvent: (event: FileWatchEvent) => void,
		excludes: readonly string[],
	): { watcher: FileWatcher; reliability: FileWatcherReliability; starting: boolean } {
		let watcher: FileWatcher | undefined;
		let started = false;
		// Not given to `.git` watchers: a host places one for every checkout at startup, and each would cost a rescan
		const onDidStart = (): void => {
			if (started) return;

			started = true;
			// A watch that was live before `createWatcher` returned missed nothing
			if (watcher == null) return;

			// The same rescan as a watch coming back, and only for the live watcher, never one already replaced or stopped
			const entry = this.wtWatchers.get(repoPath);
			if (entry?.watcher === watcher) {
				entry.starting = false;
				entry.session.pushWorkingTreeChanges([], true);
			}
		};

		if (this.poller == null) {
			watcher = this.provider.createWatcher(repoPath, '**', onEvent, {
				excludes: excludes,
				onDidStart: onDidStart,
			});
			return {
				watcher: watcher,
				reliability: 'reliable',
				starting: this.provider.callsOnDidStart === true && !started,
			};
		}

		let reliability: FileWatcherReliability = 'reliable';
		const options: FileWatcherOptions = {
			excludes: excludes,
			onDidStart: onDidStart,
			onDidChangeReliability: state => {
				if (watcher == null) {
					reliability = state;
					return;
				}

				// Only the live watcher speaks for the working tree, never one already replaced
				const entry = this.wtWatchers.get(repoPath);
				if (entry?.watcher === watcher) {
					this.setWorkingTreeReliability(entry, state);
				}
			},
		};
		watcher = this.provider.createWatcher(repoPath, '**', onEvent, options);
		return {
			watcher: watcher,
			reliability: reliability,
			starting: this.provider.callsOnDidStart === true && !started,
		};
	}

	private setWorkingTreeReliability(
		entry: WorkingTreeWatcherEntry,
		state: FileWatcherReliability,
		initial?: boolean,
	): void {
		const previous = entry.reliability;
		if (previous === state) return;

		entry.reliability = state;
		this.updateWorkingTreePollTarget(entry);

		if ((state === 'unwatchable') === (previous === 'unwatchable')) return;

		// The watch went down or came back: whatever changed meanwhile went unseen. This rescan stands in for a start still
		// owed, which a provider that lost the watch may never report
		if (!initial) {
			entry.starting = false;
			entry.session.pushWorkingTreeChanges([], true);
		}
		const record = this.sessionMap.get(entry.session.repoPath);
		if (record != null) {
			this.updateWatchMode(record);
		}
	}

	/** Polls the host's working-tree fingerprint, when it gives one, while the watcher isn't `reliable` */
	private updateWorkingTreePollTarget(entry: WorkingTreeWatcherEntry): void {
		const poller = this.poller;
		const getFingerprint = poller?.options.getWorkingTreeFingerprint;
		if (poller == null || getFingerprint == null) return;

		if (entry.reliability === 'reliable') {
			if (entry.pollTarget != null) {
				poller.delete(entry.pollTarget);
				entry.pollTarget = undefined;
			}
			return;
		}
		if (entry.pollTarget != null) return;

		const repoPath = entry.session.repoPath;
		let last: string | undefined;
		const target: PollTarget = {
			poll: async (): Promise<void> => {
				let fingerprint: string | undefined;
				try {
					fingerprint = await getFingerprint(repoPath);
				} catch {
					return;
				}
				if (fingerprint == null || entry.pollTarget !== target) return;

				const moved = last != null && last !== fingerprint;
				last = fingerprint;
				// A fingerprint says the tree moved, not which files did
				if (moved) {
					entry.session.pushWorkingTreeChanges([], true);
				}
			},
		};
		entry.pollTarget = target;
		poller.add(target);
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
		// Read under the old rules, so a restart must read again even if the watcher stops before this re-read lands
		if (entry.filter != null) {
			this.keptIgnoredDirectories.delete(entry.filter);
		}
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
					if (entry.filter != null) {
						this.keptIgnoredDirectories.set(entry.filter, directories);
					}
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

		// New first, then the old one: the overlap can repeat an event (the session coalesces them), but never loses one.
		// A provider that places its watch asynchronously leaves a gap until it goes live, which its `onDidStart` rescans
		let created: { watcher: FileWatcher; reliability: FileWatcherReliability; starting: boolean };
		try {
			created = this.createWorkingTreeWatcher(repoPath, entry.onEvent, [...workingTreeExcludes, ...directories]);
		} catch {
			return;
		}

		const previousWatcher = entry.watcher;
		entry.watcher = created.watcher;
		// The replacement owes its own start
		entry.starting = created.starting;
		entry.ignoredDirectories = directories;
		previousWatcher.dispose();
		this.setWorkingTreeReliability(entry, created.reliability);

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
		// The working tree first: with it still up, leaving the group would read as a move back to `'events'` and
		// announce one for a repository that is going away
		this.stopWorkingTreeWatcher(record.session.repoPath);
		this.disconnectFromWatchGroup(record);
		this.updateWatchMode(record);
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
