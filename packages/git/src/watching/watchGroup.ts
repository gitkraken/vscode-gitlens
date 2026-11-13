import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { some } from '@gitlens/utils/iterable.js';
import { isDescendant, joinPaths, normalizePath, relative } from '@gitlens/utils/path.js';
import { FileType } from '../context.js';
import type { GitDir, RepositoryChange } from '../models/repository.js';
import { getWorktreeAdminId, isIgnoredWorktreeEntry, parseWorktreeAdminPath } from '../utils/repository.utils.js';
import { allWatchedRepositoryChanges, classifyGitDirChange } from './classifyChange.js';
import type { GitConfigSections, GitConfigSectionsChange } from './configSections.js';
import { diffGitConfigSections, parseGitConfigBytes } from './configSections.js';
import type { GitDirPoller, GitDirProbe } from './gitDirPoller.js';
import { GitDirProbeTarget } from './gitDirPoller.js';
import type {
	FileWatcher,
	FileWatcherOptions,
	FileWatcherReliability,
	FileWatchEvent,
	FileWatchingProvider,
} from './provider.js';
import {
	dotGitGlobCombined,
	dotGitGlobCommon,
	dotGitGlobRoot,
	getGitDirRefProbes,
	getIgnoredWorktreeFolderExcludes,
	gitDirCommonProbes,
	gitDirExcludes,
	gitDirProbesByEmittedPath,
	gitDirRootProbes,
	isGitDirCommonPath,
	shouldIgnoreRepoPath,
} from './watcherPatterns.js';

/**
 * How long a read of the shared `.git/config`, or of the worktrees' admin entries, may take before it counts as failed.
 * Reads of each run one at a time, so one that never settles, as on a hung network or WSL mount, would otherwise hold
 * back every later report.
 */
const readTimeoutMs = 5000;

/**
 * How many removed admin entries are remembered. A watcher reports a removal once for each file it watched in the entry,
 * and a poll may report it too, so its reports outlive any single one of them
 */
const removedWorktreeIdsLimit = 64;

/**
 * How long after an admin entry's `gitdir` couldn't be read it is read once more. A watcher can report the entry before
 * git wrote its `gitdir`, and then miss the write itself (a new directory's files go unseen until it is watched)
 */
const worktreeRetryDelayMs = 250;

/**
 * How long a watcher on the common dir that another takes over from keeps delivering to linked sessions beside it. A
 * host may place a `.git` watch asynchronously, with no signal for when it is live, so the new watcher can miss what
 * changes at first
 */
const handOverOverlapMs = 5000;

function noop(): void {}

/**
 * Hooks that the WatchGroup fires when events are interpreted.
 * These are raw, un-debounced events — the session handles debouncing.
 */
export interface WatchGroupHooks {
	/**
	 * `ref` is the full ref name (or ref directory) or pseudo-ref (`HEAD`, `ORIG_HEAD`) whose file changed, with a
	 * trailing `.lock` stripped; `false` when config changed without moving refs, and `undefined` when ref movement
	 * is unknown. `overflow` marks the every-kind rescan of a watcher that dropped events, which no single write can
	 * account for. `configBranches`, with a `config` change, are the local branches (full ref names) whose
	 * `branch.<name>` sections are all that changed in the shared `.git/config`; without it, the config change may be
	 * anywhere. `movedWorktree`, with a `worktreeHead` change, is the admin id (the `<id>` of `worktrees/<id>`) of the
	 * linked worktree whose `HEAD` file changed, or whose admin entry was created or removed; without it, any linked
	 * worktree's HEAD may have moved.
	 */
	readonly onRepoChanged: (
		repoPath: string,
		changes: RepositoryChange[],
		ref?: string | false,
		overflow?: boolean,
		configBranches?: ReadonlySet<string>,
		movedWorktree?: string,
	) => void;
	readonly onFetchHeadChanged?: (repoPath: string) => void;
	readonly onIgnoresChanged?: (repoPath: string) => void;
	/** The refs whose loose files a poll stats for this session, read at each poll */
	readonly getProbeRefs?: () => Iterable<string>;
	/** A watcher this session hears through went `unwatchable`, or stopped being it (see {@link WatchGroup.isUnwatchable}) */
	readonly onUnwatchableChanged?: (repoPath: string) => void;
}

/**
 * Tracks one session's connection to a WatchGroup.
 * Each session has its own root watcher; linked sessions share the watch of the common files.
 */
interface SessionEntry {
	readonly repoPath: string;
	readonly gitDirPath: string;
	readonly rootWatcher: FileWatcher;
	/** True when the root watcher is on the common dir itself, so it sees every common file, for linked sessions too */
	readonly coversCommon: boolean;
	/** For a linked session, its `<n>` in `<common>/worktrees/<n>`; otherwise `undefined` */
	readonly worktreeId: string | undefined;
	readonly hooks: WatchGroupHooks;
	reliability: FileWatcherReliability;
	/** Polls in place of (or beside) the root watcher while it isn't `reliable` */
	target?: GitDirProbeTarget;
}

/**
 * Manages filesystem watchers for a single physical `.git` directory,
 * shared across all worktrees that reference it.
 *
 * Structure:
 * - N root watchers: one per session, on its own `.git` directory (index, HEAD, *_HEAD, etc.). A session rooted at the
 *   common dir (a main checkout) watches it with the combined glob, so it sees every common file too (config,
 *   refs/**, info/exclude, etc.), and linked sessions hear those through it.
 * - 1 common watcher on the common dir, for the common files only, while there are linked sessions and no session
 *   rooted at the common dir for them to hear those through. It delivers to linked sessions only. When one of the two
 *   takes the common files over from the other, the old one keeps delivering to linked sessions for a moment beside
 *   the new one (see {@link handOverOverlapMs}), however many hand-overs follow within it, so only once each such
 *   moment has passed is a single watcher left on the common dir.
 *
 * Given a `readFile`, the group keeps the shared `.git/config` as it last read it, section by section. A report of
 * that file (or its lock), from whichever watcher, is read and compared with it once, and every session hears what
 * changed: only some branches' `branch.<name>` sections (`config`, confined to them), anything else (`config` and
 * `remotes`, unconfined), or nothing at all, when an earlier report's read already delivered the change. Reads run
 * one at a time, so each compares with the one before it and none is skipped. The first read, taken as the group
 * starts, is the baseline and delivers nothing; a report arriving before it completes may describe a change it
 * already holds, so it is delivered unconfined. A read that fails or doesn't settle within a few seconds, or a file
 * git couldn't parse, is unconfined too.
 *
 * Given a `readFile`, a `readDirectory` (a directory's entries with their types, only the directories counting as
 * admin entries) and the folders whose worktrees the host has core ignore (a tool's throwaway worktrees, which no
 * host shows), the group reports no change of an ignored worktree's admin entry
 * (`<common>/worktrees/<id>`) to any session. Only registered folders count, since a user may keep real worktrees
 * anywhere, `.git` included. It lists the entries and reads each one's `gitdir` once as it starts, and again after a
 * watcher dropped events; a report arriving meanwhile is told at once, and decided once the listing settles, so what
 * is known of its entry catches up. From then on it reads an entry only when its `gitdir` may be new (the entry was
 * created, or its `gitdir` written, or it was removed before), so a real worktree's HEAD moves are told at once,
 * unread. Of two reads of one entry, the later decides both reports. An entry it doesn't know whose `gitdir` can't be
 * read (a watcher can report one before git writes it, and miss the write) is read once more a moment later, its
 * reports held until then, and told if it still can't be. Only the entry's directory or its `gitdir` going is a
 * removal; a deleted `HEAD` (a watcher may report git's lock file renamed over it as a delete) or `locked` is told as
 * the entry is known. Removing an entry deletes the `gitdir` a read needs, so a removal is told from what the entry was
 * known to be (before a read that couldn't read it, if one is waiting to read it again), and an entry it never knew is
 * told as real. Any other report of a removed entry but a delete is read, and one that can't be read is the removal's
 * own (a watcher may report the entry's directory changed beside each file it deletes), unless it creates the entry
 * again. A report of the `worktrees` directory itself (a coalesced
 * removal, a parent directory change, a poll, which sees nothing finer) lists it again: it is told to every session
 * when a real entry was added or removed since the last listing, and to none when only ignored ones were. Git removes
 * the directory with its last entry, so a directory that isn't there is an empty listing, as is a removal of it that
 * can't be listed. Since a listing (or a worktree moved into or out of a folder) changes what every session shows, it
 * is told to all of them; another report of the same change (a poll's) then finds nothing left to tell. Where only a
 * poll watches the common dir, it sees just the `worktrees` directory, so an entry removed and added again under the
 * same id between two polls, or an entry's HEAD or lock changed in place, goes untold.
 *
 * Given the folders, the watchers over the common dir leave each one unwatched, since a tool's checkout there would
 * otherwise have every directory of it watched; one that shares a top-level directory with what the `.git` watch reads
 * stays watched.
 */
export class WatchGroup implements UnifiedDisposable {
	private readonly _sessions = new Map<string, SessionEntry>();
	private _commonWatcher: FileWatcher | undefined;
	private _commonReliability: FileWatcherReliability = 'reliable';
	private _commonTarget: GitDirProbeTarget | undefined;
	/**
	 * The watchers on the common dir that were taken over from, each still delivering to linked sessions until its own
	 * overlap ends: a common watcher (with its poll, if any), or the root watcher of a session rooted at the common dir
	 * that went. A hand-over inside another's overlap leaves the earlier one running, since only it may be live yet
	 */
	private readonly _retiring = new Map<
		FileWatcher,
		{ readonly target: GitDirProbeTarget | undefined; readonly timer: ReturnType<typeof setTimeout> }
	>();
	private _disposed = false;

	/** The shared `.git/config`, by section, as the last read that could parse it found it */
	private _config: GitConfigSections | undefined;
	/** The baseline read is in flight */
	private _configBaselining = false;
	private _configReading = false;
	private _configRereadQueued = false;

	/**
	 * Settles once the latest baseline of the admin entries was taken; `undefined` when the group can't tell an
	 * ignored worktree's, so every report is told at once
	 */
	private _worktreesBaseline: Promise<void> | undefined;
	/** A baseline is pending, so a report waits for it */
	private _worktreesBaselining = false;
	private _worktreesRebaselineQueued = false;
	/** Set by the first baseline; while empty, nothing is ignored and every report is told at once */
	private _ignoredWorktreeRoots: readonly string[] = [];
	/** Listings run one at a time, so each compares with the one before it */
	private _worktreesQueue: Promise<void> = Promise.resolve();
	/** The `worktrees` directory's reports waiting on the queued listing; `undefined` while none is queued */
	private _worktreesRescanQueued:
		| {
				readonly delivers: (() => void)[];
				/** One of them is a removal of the directory */
				removal: boolean;
		  }
		| undefined;
	/** The admin entries the last listing found */
	private _listedWorktreeIds: ReadonlySet<string> = new Set();
	/** Admin entries known to exist, by id: whether each is an ignored worktree's */
	private readonly _worktreeIds = new Map<string, boolean>();
	/** What removed admin entries were, by id, oldest first */
	private readonly _removedWorktreeIds = new Map<string, boolean>();
	/**
	 * Each id's latest `gitdir` read, settling with what it found and what the id was known to be before it; only it
	 * may update what is known of the id. A removal of the entry drops it
	 */
	private readonly _worktreeReads = new Map<
		string,
		Promise<[ignored: boolean | undefined, previous: boolean | undefined]>
	>();
	/** Admin entries whose `gitdir` couldn't be read, by id, waiting to be read once more */
	private readonly _worktreeRetries = new Map<
		string,
		{
			readonly timer: ReturnType<typeof setTimeout>;
			/** The reports waiting on it, told unless the entry turns out to be an ignored worktree's */
			readonly delivers: (() => void)[];
			/**
			 * What the entry was known to be before its `gitdir` couldn't be read, so a move or a removal is still told
			 * as it was
			 */
			previous: boolean | undefined;
			/**
			 * Settles with whether the entry is an ignored worktree's; `undefined` when it still can't tell, or it was
			 * removed
			 */
			readonly decided: Promise<boolean | undefined>;
			readonly resolve: (ignored: boolean | undefined) => void;
		}
	>();
	/** The `.git` excludes of a watcher over the common git dir, with the ignored worktrees' folders it may leave out */
	private readonly _commonGitDirExcludes: readonly string[];

	constructor(
		readonly commonGitDir: string,
		private readonly provider: FileWatchingProvider,
		/** When given, a watcher that reports it can't be trusted is polled; otherwise none is asked */
		private readonly poller?: GitDirPoller,
		/**
		 * When given, reports of the shared `.git/config` are classified by what changed in it, and admin entries are
		 * read to tell an ignored worktree's (see above)
		 */
		private readonly readFile?: (path: string) => Promise<Uint8Array>,
		/**
		 * Returns a directory's entries with their types; with `readFile`, the admin entries are listed, only the
		 * directories counting (see above)
		 */
		private readonly readDirectory?: (path: string) => Promise<readonly (readonly [string, number])[]>,
		/** The absolute, normalized folders whose worktrees are ignored; none reads no admin entry */
		ignoredWorktreeRoots?: Promise<readonly string[]>,
		/** The folders whose worktrees are ignored, relative to the common git dir */
		ignoredWorktreeFolders?: readonly string[],
	) {
		const folders = getIgnoredWorktreeFolderExcludes(ignoredWorktreeFolders);
		this._commonGitDirExcludes = folders.length ? [...gitDirExcludes, ...folders] : gitDirExcludes;
		if (readFile != null) {
			void this.readConfigBaseline();
		}
		if (readFile != null && readDirectory != null && ignoredWorktreeRoots != null) {
			this.queueWorktreesBaseline(async () => {
				const roots = await this.withTimeout(() => Promise.resolve(ignoredWorktreeRoots));
				if (this._disposed || !Array.isArray(roots) || !roots.length) return;

				this._ignoredWorktreeRoots = roots;
				await this.listWorktrees('baseline');
			});
		}
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	/** Dispose the entire group (common watcher + all root watchers). */
	dispose(): void {
		if (this._disposed) return;

		this._disposed = true;

		for (const entry of this._sessions.values()) {
			entry.rootWatcher.dispose();
			this.stopPolling(entry);
		}
		this._sessions.clear();

		this.disposeCommonWatcher();
		this.endAllRetiring();

		for (const retry of this._worktreeRetries.values()) {
			clearTimeout(retry.timer);
			retry.resolve(undefined);
		}
		this._worktreeRetries.clear();
	}

	get sessions(): ReadonlyMap<string, SessionEntry> {
		return this._sessions;
	}

	/**
	 * True when a watcher the session hears through — its root watcher, or for a linked session the watch of the common
	 * files (see {@link getCommonReliability}) — can't watch
	 */
	isUnwatchable(repoPath: string): boolean {
		const entry = this._sessions.get(repoPath);
		if (entry == null) return false;

		return (
			entry.reliability === 'unwatchable' ||
			(!entry.coversCommon && this.getCommonReliability() === 'unwatchable')
		);
	}

	/** Add a session to this group. Creates the root watcher for the session's gitDir. */
	addSession(repoPath: string, gitDir: GitDir, hooks: WatchGroupHooks): void {
		if (this._disposed) return;
		if (this._sessions.has(repoPath)) return; // Already tracked

		// Determine the glob pattern for the root watcher
		const isStandard = gitDir.commonUri == null;
		const rootPattern = isStandard ? dotGitGlobCombined : dotGitGlobRoot;
		// What linked sessions hear the common files through until this session's root watcher takes them over
		const commonReliability = isStandard ? this.getCommonReliability() : undefined;

		// The watcher can report its reliability before `createWatcher` returns, so before the entry exists
		let entry: SessionEntry | undefined;
		let initialReliability: FileWatcherReliability = 'reliable';
		const rootWatcher = this.provider.createWatcher(
			gitDir.uri.fsPath,
			rootPattern,
			(event: FileWatchEvent) => {
				if (entry == null) return;

				// A session of the same path added again has a root watcher of its own
				if (this._sessions.get(repoPath) === entry) {
					if (event.reason !== 'overflow') {
						entry.target?.forget(event.path);
					}
					this.onRootEvent(event, entry);
				} else if (this._retiring.has(entry.rootWatcher)) {
					this.onCommonEvent(event, true);
				}
			},
			this.getWatcherOptions(gitDir.uri.fsPath, state => {
				if (entry == null) {
					initialReliability = state;
				} else if (this._sessions.get(repoPath) === entry) {
					this.setRootReliability(entry, state);
				}
			}),
		);

		const entryGitDirPath = gitDir.uri.fsPath;
		entry = {
			repoPath: repoPath,
			gitDirPath: entryGitDirPath,
			rootWatcher: rootWatcher,
			coversCommon: isStandard,
			worktreeId: isStandard ? undefined : this.getWorktreeId(entryGitDirPath),
			hooks: hooks,
			reliability: 'reliable',
		};

		this._sessions.set(repoPath, entry);
		if (initialReliability !== 'reliable') {
			this.setRootReliability(entry, initialReliability, true);
		}

		if (commonReliability != null) {
			// Its root watcher sees every common file, for linked sessions too, once its watch is live
			this.retireCommonWatcher();
			this.handOverCommon(commonReliability);
		} else if (!some(this._sessions.values(), e => e.coversCommon)) {
			this.ensureCommonWatcher();
		}
	}

	/** Remove a session from this group. Disposes its root watcher. */
	removeSession(repoPath: string): void {
		const entry = this._sessions.get(repoPath);
		if (entry == null) return;

		const commonReliability = entry.coversCommon ? this.getCommonReliability() : undefined;
		this._sessions.delete(repoPath);

		const linked = some(this._sessions.values(), e => !e.coversCommon);
		if (commonReliability != null && linked && !some(this._sessions.values(), e => e.coversCommon)) {
			// The root watcher, and its poll if it has one, keep telling linked sessions of the common files while the
			// common watcher's watch may not be live, or its own poll has yet to take a first reading
			this.ensureCommonWatcher(true);
			this.retire(entry.rootWatcher, entry.target);
		} else {
			this.stopPolling(entry);
			entry.rootWatcher.dispose();
		}

		if (!linked) {
			// Both deliver to linked sessions only
			this.disposeCommonWatcher();
			this.endAllRetiring();
		} else if (commonReliability != null) {
			this.handOverCommon(commonReliability);
		}
	}

	private getWorktreeId(gitDirPath: string): string | undefined {
		return getWorktreeAdminId(gitDirPath, this.commonGitDir);
	}

	/** `handingOver`: it takes the common files over from a session's root watcher, which tells linked sessions itself */
	private ensureCommonWatcher(handingOver?: boolean): void {
		if (this._commonWatcher != null || this._disposed) return;

		// The watcher can report its reliability before `createWatcher` returns
		let watcher: FileWatcher | undefined;
		let initialReliability: FileWatcherReliability = 'reliable';
		const options = this.getWatcherOptions(this.commonGitDir, state => {
			if (watcher == null) {
				initialReliability = state;
			} else if (this._commonWatcher === watcher) {
				this.setCommonReliability(state);
			}
		});

		watcher = this.provider.createWatcher(
			this.commonGitDir,
			dotGitGlobCommon,
			(event: FileWatchEvent) => {
				if (event.reason !== 'overflow') {
					this._commonTarget?.forget(event.path);
				}
				this.onCommonEvent(event);
			},
			options,
		);
		this._commonWatcher = watcher;
		if (initialReliability !== 'reliable') {
			if (handingOver) {
				this.setCommonPolling(initialReliability);
			} else {
				this.setCommonReliability(initialReliability, true);
			}
		}
	}

	/** The common watcher keeps delivering to linked sessions until a root watcher's watch on the common dir is live */
	private retireCommonWatcher(): void {
		const watcher = this._commonWatcher;
		if (watcher == null) return;

		const target = this._commonTarget;
		this._commonWatcher = undefined;
		this._commonTarget = undefined;
		this._commonReliability = 'reliable';
		this.retire(watcher, target);
	}

	/**
	 * Keeps `watcher` (and its poll) delivering to linked sessions for {@link handOverOverlapMs}, beside any earlier one
	 * still in its own overlap. A watcher retires once: the group never makes one current again
	 */
	private retire(watcher: FileWatcher, target: GitDirProbeTarget | undefined): void {
		const timer = setTimeout(() => {
			if (this._retiring.get(watcher)?.timer === timer) {
				this.endRetiring(watcher);
			}
		}, handOverOverlapMs);
		// An overlap alone must not keep a (Node) process alive; in the browser timers are numbers
		if (typeof timer !== 'number') {
			timer.unref();
		}
		this._retiring.set(watcher, { target: target, timer: timer });
	}

	private endRetiring(watcher: FileWatcher): void {
		const retiring = this._retiring.get(watcher);
		if (retiring == null) return;

		this._retiring.delete(watcher);
		clearTimeout(retiring.timer);
		watcher.dispose();
		if (retiring.target != null) {
			this.poller?.delete(retiring.target);
		}
	}

	private endAllRetiring(): void {
		for (const watcher of [...this._retiring.keys()]) {
			this.endRetiring(watcher);
		}
	}

	private isRetiringTarget(target: GitDirProbeTarget): boolean {
		return some(this._retiring.values(), r => r.target === target);
	}

	private disposeCommonWatcher(): void {
		this._commonWatcher?.dispose();
		this._commonWatcher = undefined;
		this._commonReliability = 'reliable';
		if (this._commonTarget != null) {
			this.poller?.delete(this._commonTarget);
			this._commonTarget = undefined;
		}
	}

	/** Hosts that didn't opt into polling get exactly the options they always had */
	private getWatcherOptions(
		basePath: string,
		onDidChangeReliability: (state: FileWatcherReliability) => void,
	): FileWatcherOptions {
		const excludes = this.getExcludes(basePath);
		return this.poller != null
			? { excludes: excludes, onDidChangeReliability: onDidChangeReliability }
			: { excludes: excludes };
	}

	/**
	 * The ignored worktrees' folders join the `.git` excludes of a watcher over the common git dir: a tool that keeps its
	 * throwaway checkouts inside the git dir would otherwise have each one's every directory watched, and every file it
	 * writes reported. Every other watcher sits on a linked worktree's admin entry, which holds none of them
	 */
	private getExcludes(basePath: string): readonly string[] {
		if (this._commonGitDirExcludes === gitDirExcludes) return gitDirExcludes;

		return normalizePath(basePath) === normalizePath(this.commonGitDir)
			? this._commonGitDirExcludes
			: gitDirExcludes;
	}

	private setRootReliability(entry: SessionEntry, state: FileWatcherReliability, initial?: boolean): void {
		const previous = entry.reliability;
		if (previous === state || this.poller == null) return;

		// Linked sessions hear the common files through it; its first report reaches them with the hand-over that adds it
		const commonPrevious = entry.coversCommon && !initial ? this.getCommonReliability() : undefined;
		entry.reliability = state;
		if (state === 'reliable') {
			this.stopPolling(entry);
		} else if (entry.target == null) {
			const target = new GitDirProbeTarget(
				entry.gitDirPath,
				this.poller,
				() => this.getRootProbes(entry),
				gitDirProbesByEmittedPath,
				(event, probe) => {
					if (entry.target !== target) return;

					if (this._sessions.get(entry.repoPath) !== entry) {
						if (this.isRetiringTarget(target)) {
							this.onCommonEvent(event, true);
						}
						return;
					}

					this.onRootEvent(event, entry);
					if (probe.path === 'logs/HEAD' && !entry.coversCommon) {
						this.onLinkedHeadMoved();
					}
				},
			);
			entry.target = target;
			this.poller.add(target);
		}

		if ((state === 'unwatchable') === (previous === 'unwatchable')) return;

		// The watch went down or came back: whatever changed meanwhile went unseen
		if (!initial) {
			this.deliverOverflow(entry);
			if (entry.coversCommon) {
				this.rebaselineWorktrees();
			}
		}
		entry.hooks.onUnwatchableChanged?.(entry.repoPath);

		if (
			commonPrevious != null &&
			(commonPrevious === 'unwatchable') !== (this.getCommonReliability() === 'unwatchable')
		) {
			this.tellLinkedUnwatchableChanged();
		}
	}

	private setCommonReliability(state: FileWatcherReliability, initial?: boolean): void {
		const previous = this._commonReliability;
		if (previous === state || this.poller == null) return;

		this.setCommonPolling(state);
		if ((state === 'unwatchable') === (previous === 'unwatchable')) return;

		this.tellLinkedUnwatchableChanged(initial);
	}

	/** Polls the common dir in place of (or beside) the common watcher while it isn't `reliable` */
	private setCommonPolling(state: FileWatcherReliability): void {
		const poller = this.poller;
		if (poller == null) return;

		this._commonReliability = state;
		if (state === 'reliable') {
			if (this._commonTarget != null) {
				poller.delete(this._commonTarget);
				this._commonTarget = undefined;
			}
		} else if (this._commonTarget == null) {
			const target = new GitDirProbeTarget(
				this.commonGitDir,
				poller,
				() => this.getCommonProbes(),
				gitDirProbesByEmittedPath,
				event => {
					if (this._commonTarget === target || this.isRetiringTarget(target)) {
						this.onCommonEvent(event);
					}
				},
			);
			this._commonTarget = target;
			poller.add(target);
		}
	}

	/** The watch linked sessions hear the common files through went down or came back: whatever changed meanwhile went unseen */
	private tellLinkedUnwatchableChanged(initial?: boolean): void {
		for (const entry of this._sessions.values()) {
			if (entry.coversCommon) continue;

			if (!initial) {
				this.deliverOverflow(entry);
			}
			entry.hooks.onUnwatchableChanged?.(entry.repoPath);
		}
		if (!initial) {
			this.rebaselineWorktrees();
		}
	}

	/**
	 * How much of the common files linked sessions hear: what the root watcher of a session rooted at the common dir
	 * reports while there is one (the most reliable, should there be several), the common watcher's otherwise. A watcher
	 * kept delivering beside the one that took over from it doesn't count: it is about to go
	 */
	private getCommonReliability(): FileWatcherReliability {
		let reliability: FileWatcherReliability | undefined;
		for (const entry of this._sessions.values()) {
			if (!entry.coversCommon) continue;
			if (entry.reliability === 'reliable') return 'reliable';

			if (reliability !== 'unreliable') {
				reliability = entry.reliability;
			}
		}
		return reliability ?? this._commonReliability;
	}

	/**
	 * Linked sessions now hear the common files through another watcher than one that was `previous`. Where either isn't
	 * `reliable`, what changed between the two may have gone unseen (a poll's first pass only records), so each rescans,
	 * and hears whether the watch went down or came back
	 */
	private handOverCommon(previous: FileWatcherReliability): void {
		const current = this.getCommonReliability();
		if (previous === 'reliable' && current === 'reliable') return;

		const unwatchableChanged = (previous === 'unwatchable') !== (current === 'unwatchable');
		let told = false;
		for (const entry of this._sessions.values()) {
			if (entry.coversCommon) continue;

			told = true;
			this.deliverOverflow(entry);
			if (unwatchableChanged) {
				entry.hooks.onUnwatchableChanged?.(entry.repoPath);
			}
		}
		if (told) {
			this.rebaselineWorktrees();
		}
	}

	private stopPolling(entry: SessionEntry): void {
		if (entry.target == null) return;

		this.poller?.delete(entry.target);
		entry.target = undefined;
	}

	/**
	 * A session rooted at the common dir polls the common files too, with the refs of every session in the group: its
	 * combined watcher would hear them all, for linked sessions too
	 */
	private getRootProbes(entry: SessionEntry): readonly GitDirProbe[] {
		if (!entry.coversCommon) return gitDirRootProbes;

		const refs = new Set<string>();
		for (const e of this._sessions.values()) {
			for (const ref of e.hooks.getProbeRefs?.() ?? []) {
				refs.add(ref);
			}
		}
		return [...gitDirRootProbes, ...gitDirCommonProbes, ...getGitDirRefProbes(refs)];
	}

	/**
	 * A linked worktree's `logs/HEAD` moved — a commit or reset there, on a branch a polled session rooted at the common
	 * dir may not probe — so each such session hears a `heads` change its combined watcher would have heard
	 */
	private onLinkedHeadMoved(): void {
		for (const entry of this._sessions.values()) {
			if (!entry.coversCommon || entry.target == null) continue;

			entry.hooks.onRepoChanged(entry.repoPath, ['heads']);
		}
	}

	/** The common files, with the refs of every linked session (the only ones the common watcher delivers to) */
	private getCommonProbes(): GitDirProbe[] {
		const refs = new Set<string>();
		for (const entry of this._sessions.values()) {
			if (entry.coversCommon) continue;

			for (const ref of entry.hooks.getProbeRefs?.() ?? []) {
				refs.add(ref);
			}
		}
		return [...gitDirCommonProbes, ...getGitDirRefProbes(refs)];
	}

	/**
	 * An event of a watcher on the common dir that delivers to linked sessions only: the common watcher, or a root watcher
	 * whose session went (`sharedOnly`, since it watched that session's own files too)
	 */
	private onCommonEvent(event: FileWatchEvent, sharedOnly?: boolean): void {
		if (event.reason === 'overflow') {
			for (const entry of this._sessions.values()) {
				if (entry.coversCommon) continue;

				this.deliverOverflow(entry);
			}
			this.rebaselineWorktrees();
			return;
		}

		// Compute relative path from common git dir
		if (!isDescendant(event.path, this.commonGitDir)) return;

		const relativePath = relative(this.commonGitDir, event.path);
		if (shouldIgnoreRepoPath(relativePath)) return;
		if (sharedOnly && !isGitDirCommonPath(relativePath)) return;

		this.onGitDirChanged(relativePath, event.reason, undefined, true, true);
	}

	private deliverOverflow(entry: SessionEntry): void {
		// Every kind, no ref (ref kinds stay unnamed). Never `'unknown'` — the cache would unregister the path
		entry.hooks.onRepoChanged(entry.repoPath, [...allWatchedRepositoryChanges], undefined, true);
		entry.hooks.onFetchHeadChanged?.(entry.repoPath);
		entry.hooks.onIgnoresChanged?.(entry.repoPath);
	}

	private onRootEvent(event: FileWatchEvent, entry: SessionEntry): void {
		if (event.reason === 'overflow') {
			this.deliverOverflow(entry);
			if (entry.coversCommon) {
				for (const e of this._sessions.values()) {
					if (e.coversCommon) continue;

					this.deliverOverflow(e);
				}
				this.rebaselineWorktrees();
			}
			return;
		}

		if (!isDescendant(event.path, entry.gitDirPath)) return;

		const relativePath = relative(entry.gitDirPath, event.path);
		if (shouldIgnoreRepoPath(relativePath)) return;

		// Linked sessions hear a common file through a root watcher on the common dir, and nothing else it sees
		this.onGitDirChanged(
			relativePath,
			event.reason,
			entry,
			entry.coversCommon && isGitDirCommonPath(relativePath),
			entry.coversCommon,
		);
	}

	/**
	 * Tells `entry`, and the linked sessions when `linked`, of a change at `relativePath`, relative to the `.git`
	 * directory whose watcher (or poll) reported it; `common` when that is the common dir
	 */
	private onGitDirChanged(
		relativePath: string,
		reason: FileWatchEvent['reason'],
		entry: SessionEntry | undefined,
		linked: boolean,
		common: boolean,
	): void {
		if (relativePath === 'FETCH_HEAD') {
			// Each worktree updates its last-fetched state
			this.callHook(entry, linked, 'onFetchHeadChanged');
			return;
		}

		// A linked worktree's git dir isn't the common one, so no file there is the shared config
		if (common && this.readFile != null && isConfigFile(relativePath)) {
			this.onConfigReported();
			return;
		}

		const changes = withWorktreeEntryHead(classifyGitDirChange(relativePath), relativePath, reason);
		if (changes != null) {
			const ref = getChangedRef(relativePath);
			// A linked worktree's git dir isn't the common one, so no path there is a worktree's admin entry
			const movedWorktree = common ? getReportedWorktreeId(relativePath, changes) : undefined;
			// `worktrees/<n>/HEAD`: the owner hears its own HEAD from its root watcher. Its `locked` and `gitdir` aren't in
			// the root glob, so the owner hears those only from here
			const ownerId = common ? getMovedWorktreeId(relativePath) : undefined;

			if (common && this.isWorktreesReport(changes)) {
				const reached: SessionEntry[] = [];
				if (entry != null && (ownerId == null || entry.worktreeId !== ownerId)) {
					reached.push(entry);
				}
				if (linked) {
					for (const e of this._sessions.values()) {
						if (e.coversCommon || (ownerId != null && e.worktreeId === ownerId)) continue;

						reached.push(e);
					}
				}
				this.onWorktreesReported(relativePath, reason, () => {
					for (const e of reached) {
						if (this._disposed || this._sessions.get(e.repoPath) !== e) continue;

						deliverRepoChanged(e, changes, ref, movedWorktree);
					}
				});
			} else {
				if (entry != null && (ownerId == null || entry.worktreeId !== ownerId)) {
					deliverRepoChanged(entry, changes, ref, movedWorktree);
				}
				if (linked) {
					for (const e of this._sessions.values()) {
						if (e.coversCommon || (ownerId != null && e.worktreeId === ownerId)) continue;

						deliverRepoChanged(e, changes, ref, movedWorktree);
					}
				}
			}
		}

		if (relativePath === 'info/exclude') {
			this.callHook(entry, linked, 'onIgnoresChanged');
		}
	}

	/** Calls `hook` of `entry`, and of the linked sessions when `linked` */
	private callHook(
		entry: SessionEntry | undefined,
		linked: boolean,
		hook: 'onFetchHeadChanged' | 'onIgnoresChanged',
	): void {
		if (entry != null) {
			entry.hooks[hook]?.(entry.repoPath);
		}
		if (!linked) return;

		for (const e of this._sessions.values()) {
			if (e.coversCommon) continue;

			e.hooks[hook]?.(e.repoPath);
		}
	}

	/** A report of the `worktrees` directory, an admin entry or a file in it, once the group may tell them apart */
	private isWorktreesReport(changes: readonly RepositoryChange[]): boolean {
		return (
			this._worktreesBaseline != null &&
			changes.includes('worktrees') &&
			changes.every(c => c === 'worktrees' || c === 'worktreeHead')
		);
	}

	/** `deliver` tells the sessions the report reaches of it, should the report concern them (see above) */
	private onWorktreesReported(relativePath: string, reason: FileWatchEvent['reason'], deliver: () => void): void {
		if (this._worktreesBaselining && this._worktreesBaseline != null) {
			// The baseline may have read the entry before the change reported, so the report is told; it is still decided
			// once the baseline settles, so what is known of the entry catches up with it
			deliver();
			void this._worktreesBaseline.then(() => this.decideWorktreesReport(relativePath, reason, noop));
			return;
		}

		this.decideWorktreesReport(relativePath, reason, deliver);
	}

	private decideWorktreesReport(relativePath: string, reason: FileWatchEvent['reason'], deliver: () => void): void {
		if (this._disposed) return;
		if (!this._ignoredWorktreeRoots.length) {
			deliver();
			return;
		}

		if (relativePath === 'worktrees') {
			this.queueWorktreesRescan(reason, deliver);
			return;
		}

		const entry = parseWorktreeAdminPath(relativePath);
		if (entry == null) {
			deliver();
			return;
		}

		const { id, file } = entry;

		// Only the entry or its `gitdir` going is a removal: an unlock deletes `locked` from an entry that stays, and a
		// watcher may report git's lock file renamed over `HEAD` as `HEAD` deleted and created again
		if (reason === 'delete' && (file == null || file === 'gitdir')) {
			if (this.forgetWorktreeId(id) !== true) {
				deliver();
			}
			return;
		}

		// What a removed entry was decides the removal's other reports. Any other report of its id is read: one that finds
		// the entry is of an entry created again, which may be another worktree's. One that can't is the removal's own
		// unless it creates the entry, since a watcher may report the entry's directory changed beside each file the
		// removal deletes
		const removed = this._worktreeIds.has(id) ? undefined : this._removedWorktreeIds.get(id);
		const known = this._worktreeIds.get(id) ?? (reason === 'delete' ? removed : undefined);
		// Only a new entry or a written `gitdir` can name another worktree; anything else is told as the id is known
		if (known != null && file !== 'gitdir' && !(file == null && reason === 'create')) {
			if (!known) {
				deliver();
			}
			return;
		}

		const retry = removed == null || reason === 'create';
		void this.readWorktreeId(id, retry).then(([ignored, previous]) => {
			if (this._disposed) return;

			if (ignored == null) {
				if (retry) {
					void this.waitForWorktreeRetry(id, deliver);
				} else if (removed === false) {
					deliver();
				}
				return;
			}

			// Moved into or out of an ignored folder: every session's list gained or lost it
			if (previous != null && ignored !== previous) {
				this.deliverWorktreesChange();
				return;
			}

			if (!ignored) {
				deliver();
			}
		});
	}

	/**
	 * Reads the entry's `gitdir`: whether it names an ignored worktree (`undefined` when it can't be read), and what the
	 * id was known to be when this read replaced it. Reads of one id can settle out of order (a slow one from before the
	 * worktree moved out of the folder), so only the latest updates what is known of it; an earlier one settles with
	 * what the latest finds, without what the id was, since the latest tells a move itself, or once the entry was removed
	 * since, with what the removal found it was. One that can't read the entry forgets what it was known to be, since git
	 * may be writing its `gitdir` again, and reads it once more a moment later, unless `retry` is false (it then leaves
	 * what is known as it was); one that can settles that read, if pending.
	 */
	private readWorktreeId(
		id: string,
		retry: boolean = true,
	): Promise<[ignored: boolean | undefined, previous: boolean | undefined]> {
		const read: Promise<[ignored: boolean | undefined, previous: boolean | undefined]> = this.readIgnoredWorktree(
			id,
		).then(ignored => {
			const latest = this._worktreeReads.get(id);
			if (latest !== read) {
				if (latest == null) return [this._removedWorktreeIds.get(id), undefined];

				return latest.then(([found]): [boolean | undefined, undefined] => {
					// A later read that couldn't read the entry may not read it again, but this one's report may be of
					// the entry created again, unless it was removed since
					if (found == null && retry && this._worktreeReads.has(id)) {
						this.scheduleWorktreeRetry(id, undefined);
					}
					return [found, undefined];
				});
			}

			const previous = this._worktreeIds.get(id);
			if (ignored == null) {
				if (!retry) return [undefined, previous];

				this._removedWorktreeIds.delete(id);
				this._worktreeIds.delete(id);
				this.scheduleWorktreeRetry(id, previous);
				return [undefined, previous];
			}

			this._removedWorktreeIds.delete(id);
			this._worktreeIds.set(id, ignored);
			this.settleWorktreeRetry(id, ignored);
			return [ignored, previous];
		});
		this._worktreeReads.set(id, read);
		return read;
	}

	/** Reads the entry once more a moment later, unless that is already pending; `previous` is what it was known to be */
	private scheduleWorktreeRetry(id: string, previous: boolean | undefined): void {
		if (this._disposed) return;

		const pending = this._worktreeRetries.get(id);
		if (pending != null) {
			pending.previous ??= previous;
			return;
		}

		let resolve!: (ignored: boolean | undefined) => void;
		const decided = new Promise<boolean | undefined>(r => {
			resolve = r;
		});
		const timer = setTimeout(() => {
			void this.readWorktreeId(id).then(([ignored]) => {
				// A removal, or a later read that could read the entry, may have settled it meanwhile
				if (this._worktreeRetries.get(id)?.decided === decided) {
					this.settleWorktreeRetry(id, ignored);
				}
			});
		}, worktreeRetryDelayMs);
		this._worktreeRetries.set(id, {
			timer: timer,
			delivers: [],
			previous: previous,
			decided: decided,
			resolve: resolve,
		});
	}

	/**
	 * A report whose read couldn't read the entry waits on the entry's next read, and `deliver` is told then, unless that
	 * read finds an ignored worktree's; one still unreadable is told. One change of an entry can be reported more than
	 * once (by a watcher and a poll, or for each file it touched), so the reports of one id wait on one read. Resolves
	 * with what it found, as {@link settleWorktreeRetry} does
	 */
	private waitForWorktreeRetry(id: string, deliver?: () => void): Promise<boolean | undefined> {
		// A later read may already have found what the entry is
		const known = this._worktreeIds.get(id);
		if (known != null) {
			if (!known) {
				deliver?.();
			}
			return Promise.resolve(known);
		}

		// None is pending only when the entry was removed since, and the removal is told itself
		const retry = this._worktreeRetries.get(id);
		if (retry == null) return Promise.resolve(undefined);

		if (deliver != null) {
			retry.delivers.push(deliver);
		}
		return retry.decided;
	}

	/**
	 * Tells the reports waiting on the id's retry what the entry turned out to be: nothing when an ignored worktree's,
	 * every session when it moved into or out of an ignored folder, and the reports' own sessions otherwise, `ignored`
	 * being `undefined` when it still couldn't be read
	 */
	private settleWorktreeRetry(id: string, ignored: boolean | undefined): void {
		const pending = this._worktreeRetries.get(id);
		if (pending == null) return;

		this._worktreeRetries.delete(id);
		clearTimeout(pending.timer);
		// Settled before any session is told: a listing waits on it, and a hook that throws would otherwise hold back
		// every later listing for good
		pending.resolve(ignored);
		if (ignored != null && pending.previous != null && ignored !== pending.previous) {
			this.deliverWorktreesChange();
		} else if (ignored !== true) {
			for (const deliver of pending.delivers) {
				deliver();
			}
		}
	}

	/**
	 * Takes `id` as removed, remembering what it was for the removal's other reports; returns that, or `undefined` when
	 * the id was never known
	 */
	private forgetWorktreeId(id: string): boolean | undefined {
		// A read still in flight read the entry before it went, and would bring the removed id back as known
		this._worktreeReads.delete(id);

		let ignored = this._worktreeIds.get(id);
		// The reports waiting to read the entry again are dropped: the removal is told for what the id was, which only
		// the retry still knows once a read couldn't read the entry
		const retry = this._worktreeRetries.get(id);
		if (retry != null) {
			this._worktreeRetries.delete(id);
			clearTimeout(retry.timer);
			retry.resolve(undefined);
			ignored ??= retry.previous;
		}

		if (ignored == null) return this._removedWorktreeIds.get(id);

		this._worktreeIds.delete(id);
		this._removedWorktreeIds.delete(id);
		this._removedWorktreeIds.set(id, ignored);
		if (this._removedWorktreeIds.size > removedWorktreeIdsLimit) {
			const [oldest] = this._removedWorktreeIds.keys();
			this._removedWorktreeIds.delete(oldest);
		}
		return ignored;
	}

	/** Whether the entry's `gitdir` names an ignored worktree, or `undefined` when it can't be read. Never rejects */
	private async readIgnoredWorktree(id: string): Promise<boolean | undefined> {
		const adminDir = joinPaths(this.commonGitDir, 'worktrees', id);
		const content = await this.readWithTimeout(joinPaths(adminDir, 'gitdir'));
		return isIgnoredWorktreeEntry(adminDir, content, this._ignoredWorktreeRoots);
	}

	private queueWorktreesBaseline(take: () => Promise<void>): void {
		this._worktreesBaselining = true;
		const baseline: Promise<void> = this._worktreesQueue
			.then(take)
			.catch(() => {})
			.finally(() => {
				if (this._worktreesBaseline === baseline) {
					this._worktreesBaselining = false;
				}
			});
		this._worktreesBaseline = baseline;
		this._worktreesQueue = baseline;
	}

	/** A watcher of the `worktrees` directory dropped events: whatever changed meanwhile went unseen */
	private rebaselineWorktrees(): void {
		if (this._worktreesBaseline == null || this._worktreesRebaselineQueued || this._disposed) return;
		// The first baseline found no folder to ignore, and none is asked for again, so there is nothing to retake
		if (!this._worktreesBaselining && !this._ignoredWorktreeRoots.length) return;

		this._worktreesRebaselineQueued = true;
		this.queueWorktreesBaseline(async () => {
			this._worktreesRebaselineQueued = false;
			if (this._disposed || !this._ignoredWorktreeRoots.length) return;

			await this.listWorktrees('rebaseline');
		});
	}

	/** The watchers' reports of the directory pile onto one queued listing, which tells them apart */
	private queueWorktreesRescan(reason: FileWatchEvent['reason'], deliver: () => void): void {
		const queued = this._worktreesRescanQueued;
		if (queued != null) {
			queued.delivers.push(deliver);
			queued.removal ||= reason === 'delete';
			return;
		}

		const rescan = { delivers: [deliver], removal: reason === 'delete' };
		this._worktreesRescanQueued = rescan;
		this._worktreesQueue = this._worktreesQueue
			.then(() => {
				this._worktreesRescanQueued = undefined;
				return this.listWorktrees('rescan', rescan.delivers, rescan.removal);
			})
			.catch(() => {});
	}

	/**
	 * Lists the admin entries and compares them with the last listing. A baseline (or a rebaseline, after a watcher
	 * dropped events) reads every entry; a rescan only those it doesn't know, reading one it can't read once more a
	 * moment later. Git removes the directory with its last entry, so a directory that isn't there is an empty listing,
	 * whatever the reports said of it (a poll sees its removal as a change). A listing that fails otherwise is a
	 * baseline's empty directory, and a rescan's too when one of its reports (`delivers`) removed the directory. For any
	 * other rescan, it is a change it can't rule out, told to the reports' own sessions
	 */
	private async listWorktrees(
		mode: 'baseline' | 'rebaseline' | 'rescan',
		delivers?: readonly (() => void)[],
		removal?: boolean,
	): Promise<void> {
		const readDirectory = this.readDirectory;
		if (readDirectory == null) return;

		const entries = await this.withTimeout(() =>
			readDirectory(joinPaths(this.commonGitDir, 'worktrees')).catch((ex: unknown) => {
				if (isNotFound(ex)) return [];

				throw ex;
			}),
		);
		if (this._disposed) return;

		// An admin entry is a directory, so a stray file such as `.DS_Store` is none
		const names = entries?.filter(([, type]) => type & FileType.Directory).map(([name]) => name);

		if (names == null && mode === 'rescan' && !removal) {
			for (const deliver of delivers ?? []) {
				deliver();
			}
			return;
		}

		const listing = new Set(names);
		const previous = this._listedWorktreeIds;
		this._listedWorktreeIds = listing;

		let changed = false;
		if (mode !== 'baseline') {
			// An entry known only from its own reports since the last listing may be gone too
			for (const id of new Set([...previous, ...this._worktreeIds.keys()])) {
				if (listing.has(id)) continue;

				if (this.forgetWorktreeId(id) !== true) {
					changed = true;
				}
			}
		}

		const reads = await Promise.all(
			[...listing]
				.filter(id => mode !== 'rescan' || (!previous.has(id) && !this._worktreeIds.has(id)))
				.map(async id => {
					const [ignored, known] = await this.readWorktreeId(id);
					if (ignored != null || mode !== 'rescan' || this._disposed) return [id, [ignored, known]] as const;

					// An entry listed before its `gitdir` is written won't be listed as new again
					return [id, [await this.waitForWorktreeRetry(id), undefined]] as const;
				}),
		);
		if (this._disposed || mode === 'baseline') return;

		const read = new Map(reads);
		for (const id of listing) {
			const result = read.get(id);
			if (!previous.has(id)) {
				// An entry whose `gitdir` still can't be read counts as real
				if ((result != null ? result[0] : this._worktreeIds.get(id)) !== true) {
					changed = true;
				}
			} else if (result?.[0] != null && result[1] != null && result[0] !== result[1]) {
				changed = true;
			}
		}

		if (changed) {
			this.deliverWorktreesChange();
		}
	}

	private deliverWorktreesChange(): void {
		for (const entry of this._sessions.values()) {
			entry.hooks.onRepoChanged(entry.repoPath, ['worktrees', 'worktreeHead'], undefined);
		}
	}

	private onConfigReported(): void {
		// The baseline may already hold the change reported, which comparing with it would lose
		if (this._configBaselining) {
			this.deliverConfigChange(undefined);
			return;
		}
		if (this._configReading) {
			this._configRereadQueued = true;
			return;
		}

		void this.readConfigChanges();
	}

	private async readConfigBaseline(): Promise<void> {
		this._configBaselining = true;
		this._configReading = true;
		try {
			const config = await this.readConfig();
			if (this._disposed) return;

			this._config = config;
		} finally {
			this._configBaselining = false;
			this._configReading = false;
		}
	}

	/** Reads and compares until no report came in during the last read: it may describe a change the read missed */
	private async readConfigChanges(): Promise<void> {
		this._configReading = true;
		try {
			do {
				this._configRereadQueued = false;
				const config = await this.readConfig();
				if (this._disposed) return;

				const previous = this._config;
				if (config == null || previous == null) {
					// Unreadable now, or never readable before: the change may be anywhere. A failed read keeps the last
					// snapshot, so the next read still compares with what every session was told
					this._config ??= config;
					this.deliverConfigChange(undefined);
					continue;
				}

				this._config = config;
				const change = diffGitConfigSections(previous, config);
				if (change != null) {
					this.deliverConfigChange(change);
				}
			} while (this._configRereadQueued);
		} finally {
			this._configReading = false;
		}
	}

	/** `undefined` when the file couldn't be read or parsed, or the read didn't settle in time */
	private async readConfig(): Promise<GitConfigSections | undefined> {
		const data = await this.readWithTimeout(joinPaths(this.commonGitDir, 'config'));
		try {
			return data != null ? parseGitConfigBytes(data) : undefined;
		} catch {
			return undefined;
		}
	}

	/** `undefined` when the file couldn't be read, or the read didn't settle in time */
	private readWithTimeout(path: string): Promise<Uint8Array | undefined> {
		const readFile = this.readFile;
		if (readFile == null) return Promise.resolve(undefined);

		return this.withTimeout(() => readFile(path));
	}

	/** `undefined` when `read` rejects, or doesn't settle in time */
	private async withTimeout<T>(read: () => Promise<T>): Promise<T | undefined> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				read(),
				new Promise<undefined>(resolve => {
					timer = setTimeout(resolve, readTimeoutMs, undefined);
				}),
			]);
		} catch {
			return undefined;
		} finally {
			clearTimeout(timer);
		}
	}

	/**
	 * Tells every session of a change to the shared `.git/config`: confined to some branches' sections, or (`undefined`,
	 * or a change outside them) anywhere, which may have changed a remote's settings too. Either way no ref moved
	 */
	private deliverConfigChange(change: GitConfigSectionsChange | undefined): void {
		for (const entry of this._sessions.values()) {
			if (change?.confined) {
				entry.hooks.onRepoChanged(entry.repoPath, ['config'], false, false, change.branches);
			} else {
				entry.hooks.onRepoChanged(entry.repoPath, ['config', 'remotes'], false);
			}
		}
	}
}

/**
 * `changes` with `worktreeHead` for a report that can stand for an entry's HEAD created or deleted with it: the
 * `worktrees` directory, an entry created or deleted, or its `gitdir` deleted. A watcher may coalesce the subtree a
 * removal deletes into one report of its parent, so no report of the HEAD comes. An entry's directory merely changed
 * stays `worktrees` alone: a watcher may report it beside each file in it, a lock's `locked` included
 */
function withWorktreeEntryHead(
	changes: RepositoryChange[] | undefined,
	relativePath: string,
	reason: FileWatchEvent['reason'],
): RepositoryChange[] | undefined {
	if (changes?.length !== 1 || changes[0] !== 'worktrees') return changes;
	if (relativePath === 'worktrees') return ['worktrees', 'worktreeHead'];

	const idEnd = relativePath.indexOf('/', 10);
	if (idEnd === -1) return reason === 'create' || reason === 'delete' ? ['worktrees', 'worktreeHead'] : changes;

	return reason === 'delete' && relativePath.substring(idEnd + 1) === 'gitdir'
		? ['worktrees', 'worktreeHead']
		: changes;
}

/** The admin id of the linked worktree whose `HEAD` file `relativePath` (relative to the common git dir) is */
function getMovedWorktreeId(relativePath: string): string | undefined {
	const entry = parseWorktreeAdminPath(relativePath);
	return entry?.file === 'HEAD' ? entry.id : undefined;
}

/**
 * The admin id of the linked worktree a `worktreeHead` among `changes` is for: the entry `relativePath` (relative to the
 * common git dir) is, or is a file of
 */
function getReportedWorktreeId(
	relativePath: string,
	changes: readonly RepositoryChange[] | undefined,
): string | undefined {
	return changes?.includes('worktreeHead') ? parseWorktreeAdminPath(relativePath)?.id : undefined;
}

/** Tells `entry` of `changes`, naming the linked worktree whose HEAD moved only when the report knows it */
function deliverRepoChanged(
	entry: SessionEntry,
	changes: RepositoryChange[],
	ref: string | false | undefined,
	movedWorktree: string | undefined,
): void {
	if (movedWorktree != null) {
		entry.hooks.onRepoChanged(entry.repoPath, changes, ref, undefined, undefined, movedWorktree);
	} else {
		entry.hooks.onRepoChanged(entry.repoPath, changes, ref);
	}
}

/** The path doesn't exist: Node's error, or the one VS Code's file system raises */
export function isNotFound(ex: unknown): boolean {
	const code = (ex as { code?: unknown } | undefined)?.code;
	return code === 'ENOENT' || code === 'FileNotFound';
}

/** The shared `.git/config` (or the lock git writes it through), relative to the common git dir */
function isConfigFile(relativePath: string): boolean {
	return relativePath === 'config' || relativePath === 'config.lock';
}

/**
 * The ref a `.git`-relative path names: a loose ref (or ref directory) under `refs/`, or the `HEAD`/`ORIG_HEAD`
 * pseudo-refs. A lock file names the ref it locks; the only ones classification lets through are the pseudo-refs' and
 * `refs/stash.lock`.
 */
function getChangedRef(relativePath: string): string | false | undefined {
	const ref = relativePath.endsWith('.lock') ? relativePath.substring(0, relativePath.length - 5) : relativePath;
	// Remote config still invalidates remote and branch caches, but doesn't itself move any ref.
	if (ref === 'config' || ref === 'config.worktree') return false;

	return ref.startsWith('refs/') || ref === 'HEAD' || ref === 'ORIG_HEAD' ? ref : undefined;
}
