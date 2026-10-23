import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { RepositoryChange } from '../models/repository.js';
import type { RefChangeKind, WorkingTreeChangeEvent } from './changeEvent.js';
import { findCoveringRefName, getRefChangeKind, isRefChangeKind, WatcherRepoChangeEvent } from './changeEvent.js';
import { allWatchedRepositoryChanges } from './classifyChange.js';

export interface RepositorySubscription extends UnifiedDisposable {
	readonly onDidChange: Event<WatcherRepoChangeEvent>;
}

export interface WorkingTreeSubscription extends UnifiedDisposable {
	readonly onDidChangeWorkingTree: Event<WorkingTreeChangeEvent>;
}

/**
 * Lifecycle callbacks fired by the session when subscriber counts
 * cross the 0↔1 boundary. The host (WatchService) uses these to
 * lazily create/destroy watchers.
 */
export interface WatchSessionLifecycle {
	/** Called when the first repo-change subscriber joins */
	onFirstRepoSubscriber?(): void;
	/** Called when the last repo-change subscriber leaves */
	onLastRepoSubscriber?(): void;
	/** Called when the first working-tree subscriber joins */
	onFirstWorkingTreeSubscriber?(): void;
	/** Called when the last working-tree subscriber leaves */
	onLastWorkingTreeSubscriber?(): void;
}

export interface WatchSessionOptions {
	readonly repoPath: string;
	/** Default debounce for repo changes. Default: 250ms */
	readonly defaultRepoDelayMs?: number;
	/** Default debounce for working tree changes. Default: 2500ms */
	readonly defaultWorkingTreeDelayMs?: number;
	/**
	 * Default cap on how long repo changes can be held back by continuous activity — a flush happens at most this long
	 * after the first pending change, however long the burst lasts. `Infinity` disables the cap. Default: 2000ms
	 */
	readonly defaultRepoMaxWaitMs?: number;
	/** Default cap on how long working tree changes can be held back by continuous activity. `Infinity` disables the cap. Default: 10000ms */
	readonly defaultWorkingTreeMaxWaitMs?: number;
	readonly lifecycle?: WatchSessionLifecycle;
	/** Initial suspended state — new sessions inherit the service-global suspend state. Default: false */
	readonly suspended?: boolean;
	/**
	 * Called whenever a debounced repo change event is dispatched to subscribers.
	 * Does NOT count as a subscriber — used by WatchService for
	 * global event forwarding without affecting lifecycle callbacks.
	 */
	readonly onDidFireRepoChange?: (event: WatcherRepoChangeEvent) => void;
	/**
	 * Called whenever a debounced working-tree change is dispatched to subscribers. Like
	 * {@link onDidFireRepoChange}, does NOT count as a subscriber — used by WatchService for global
	 * event forwarding (the single point that drives the cache's status clock for working-tree edits).
	 */
	readonly onDidFireWorkingTreeChange?: (repoPath: string) => void;
}

const defaultRepoDelay = 250;
const defaultWorkingTreeDelay = 2500;
const defaultRepoMaxWait = 2000;
const defaultWorkingTreeMaxWait = 10000;

/** Largest delay `setTimeout` honors (a signed 32-bit int); anything longer fires immediately */
const maxTimerDelay = 0x7fffffff;

interface DebounceTiming {
	readonly delayMs: number;
	readonly maxWaitMs: number;
}

/**
 * Trailing-deadline debounce with a max-wait, shared by the repo and working-tree pipelines.
 *
 * Recording an event costs a `performance.now()` and, only when no timer is armed, one `setTimeout` — never a
 * `clearTimeout`/`setTimeout` pair per event, which is what made a busy repo allocate (and starve) on every raw
 * watcher event. The armed timer is a deadline, not a countdown: when it fires it recomputes the due time from the
 * latest timestamps and either flushes or re-arms for the remainder. The due time is
 * `min(lastEventAt + delay, firstPendingAt + maxWait)`, so continuous activity is flushed at the max-wait instead of
 * never. Monotonic time, so a wall-clock change can't push a deadline out.
 */
class DebounceClock {
	private active = false;
	private paused = false;
	private firstAt = 0;
	private lastAt = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private timerDueAt = 0;
	/** Absolute flush time set by {@link resume}; dropped by the next event, which returns to normal debounce */
	private resumeDueAt: number | undefined;

	constructor(
		private readonly getDelayMs: () => number,
		private readonly getMaxWaitMs: () => number,
		private readonly onDue: () => void,
	) {}

	/** Records an event; arms the timer only if none is armed. Cheap enough to call per raw event. */
	note(): void {
		const now = performance.now();
		if (!this.active) {
			this.active = true;
			this.firstAt = now;
		}
		this.lastAt = now;

		if (this.paused) return;

		if (this.resumeDueAt != null) {
			// The first event after a resume goes back to normal debounce — which may be due sooner than the resume deadline
			this.resumeDueAt = undefined;
			this.rearmIfEarlier();
		}

		if (this.timer == null) {
			this.arm(this.getDueAt(), now);
		}
	}

	/** Moves the armed timer earlier when the due time shrank (a subscriber joined with a shorter delay or max-wait) */
	rearmIfEarlier(): void {
		if (!this.active || this.paused || this.timer == null) return;

		const dueAt = this.getDueAt();
		if (dueAt >= this.timerDueAt) return;

		clearTimeout(this.timer);
		this.arm(dueAt, performance.now());
	}

	/** Cancels the timer; events keep accumulating but nothing is due until {@link resume} */
	suspend(): void {
		this.paused = true;
		this.clearTimer();
	}

	/**
	 * Restarts the max-wait window from now and schedules the flush for `delayMs` from now (the effective delay when
	 * omitted). Does nothing if no events are pending.
	 */
	resume(delayMs?: number): void {
		this.paused = false;
		if (!this.active) return;

		const now = performance.now();
		this.firstAt = now;
		this.resumeDueAt = now + (delayMs ?? this.getDelayMs());
		this.clearTimer();
		this.arm(this.resumeDueAt, now);
	}

	/** Drops the pending window and the timer */
	cancel(): void {
		this.active = false;
		this.resumeDueAt = undefined;
		this.clearTimer();
	}

	private getDueAt(): number {
		return this.resumeDueAt ?? Math.min(this.lastAt + this.getDelayMs(), this.firstAt + this.getMaxWaitMs());
	}

	private arm(dueAt: number, now: number): void {
		this.timerDueAt = dueAt;
		this.timer = setTimeout(() => this.onTimer(), Math.min(Math.max(0, dueAt - now), maxTimerDelay));
	}

	private onTimer(): void {
		this.timer = undefined;
		if (!this.active || this.paused) return;

		const now = performance.now();
		const dueAt = this.getDueAt();
		if (dueAt > now) {
			this.arm(dueAt, now);
			return;
		}

		// Reset before firing so an event raised by a subscriber starts a fresh window
		this.cancel();
		this.onDue();
	}

	private clearTimer(): void {
		if (this.timer != null) {
			clearTimeout(this.timer);
			this.timer = undefined;
		}
	}
}

/**
 * Cap on retained working-tree paths per flush. The set otherwise grows without bound — while the window
 * is unfocused the session is suspended, so a branch switch or build accumulates every touched path until
 * refocus. Set low deliberately: ordinary edits are a handful of paths, anything past this was a
 * refresh-everything event anyway, and dropping past it only costs the matching consumers a
 * conservative refresh.
 */
const maxWorkingTreePaths = 1000;

/**
 * Cap on retained ref names per flush, for the same reason (a fetch of many refs while suspended). Past it, a ref kind
 * is recorded unnamed — any ref of that kind may have moved — which only makes `mayHaveChangedRef` more conservative.
 * A pending `config` confined to more branches than this is recorded unconfined, for the same reason.
 */
const maxPendingRefNames = 1000;

/**
 * What core's announced writes in the pending window said about one kind: when it was first announced, and the full
 * ref names it was confined to (for `config`, the branches whose sections it changed); `names` is absent when an
 * announcement left the kind open — any ref of it, or any part of the config, may have changed.
 */
interface PendingAnnouncement {
	readonly at: number;
	names: Set<string> | undefined;
}

/**
 * Per-repository session that owns the debounce/coalesce/suspend
 * pipeline for both repo (.git) and working-tree changes.
 *
 * Multiple subscribers share the same pipeline — the shortest
 * requested debounce delay wins, and so does the shortest max-wait.
 */
export class RepositoryWatchSession implements UnifiedDisposable {
	readonly repoPath: string;

	private readonly repoEmitter = new Emitter<WatcherRepoChangeEvent>();
	private readonly repoSubscribers = new Map<number, DebounceTiming>(); // subscriberId → timing
	private repoNextId = 0;
	/** Each repo subscriber's `relevantRefs`, for {@link getRelevantRefs} */
	private readonly relevantRefsSources = new Map<number, () => Iterable<string>>(); // subscriberId → relevantRefs
	private readonly pendingRepoChanges = new Set<RepositoryChange>();
	/** Full ref names, ref directories and pseudo-refs whose files changed, flushed with {@link pendingRepoChanges} */
	private readonly pendingRepoRefs = new Set<string>();
	/** Ref kinds that changed without a name, flushed with {@link pendingRepoChanges} */
	private readonly pendingRepoUnnamedRefKinds = new Set<RefChangeKind>();
	/** Kinds among {@link pendingRepoChanges} injected or pushed unfenced, which an announcement never replaces */
	private readonly pendingRepoUnfencedChanges = new Set<RepositoryChange>();
	/**
	 * Kinds among {@link pendingRepoChanges} that only core's announced writes, and their own echoes, reported (see
	 * {@link noteSelfWrite})
	 */
	private readonly pendingRepoAnnounced = new Map<RepositoryChange, PendingAnnouncement>();
	/**
	 * Refs core's writes named since the last flush, kept when an outside report makes their kind unannounced: each is
	 * a ref a write changed, never the echo of a ref directory
	 */
	private readonly pendingRepoAnnouncedRefs = new Set<string>();
	/**
	 * For a pending `config` change, the branches (full ref names) whose sections are all that every report of it
	 * changed; `undefined` once any report may have changed anything else
	 */
	private pendingRepoConfigBranches: Set<string> | undefined;
	private readonly repoClock: DebounceClock;
	private effectiveRepoMs: number;
	private effectiveRepoMaxWaitMs: number;
	private readonly defaultRepoMs: number;
	private readonly defaultRepoMaxWaitMs: number;

	private readonly workingTreeEmitter = new Emitter<WorkingTreeChangeEvent>();
	private readonly workingTreeSubscribers = new Map<number, DebounceTiming>();
	private workingTreeNextId = 0;
	private pendingWorkingTreePaths = new Set<string>();
	private pendingWorkingTreeIncomplete = false;
	private readonly workingTreeClock: DebounceClock;
	private effectiveWorkingTreeMs: number;
	private effectiveWorkingTreeMaxWaitMs: number;
	private readonly defaultWorkingTreeMs: number;
	private readonly defaultWorkingTreeMaxWaitMs: number;

	private _etagWorkingTree = 0;
	private _suspended: boolean;
	private _disposed = false;

	private readonly lifecycle?: WatchSessionLifecycle;
	private readonly onDidFireRepoChangeCallback?: (event: WatcherRepoChangeEvent) => void;
	private readonly onDidFireWorkingTreeChangeCallback?: (repoPath: string) => void;

	constructor(options: WatchSessionOptions) {
		this.repoPath = options.repoPath;
		this.defaultRepoMs = options.defaultRepoDelayMs ?? defaultRepoDelay;
		this.defaultWorkingTreeMs = options.defaultWorkingTreeDelayMs ?? defaultWorkingTreeDelay;
		this.defaultRepoMaxWaitMs = options.defaultRepoMaxWaitMs ?? defaultRepoMaxWait;
		this.defaultWorkingTreeMaxWaitMs = options.defaultWorkingTreeMaxWaitMs ?? defaultWorkingTreeMaxWait;
		this.effectiveRepoMs = this.defaultRepoMs;
		this.effectiveRepoMaxWaitMs = this.defaultRepoMaxWaitMs;
		this.effectiveWorkingTreeMs = this.defaultWorkingTreeMs;
		this.effectiveWorkingTreeMaxWaitMs = this.defaultWorkingTreeMaxWaitMs;
		this.repoClock = new DebounceClock(
			() => this.effectiveRepoMs,
			() => this.effectiveRepoMaxWaitMs,
			() => this.flushRepo(),
		);
		this.workingTreeClock = new DebounceClock(
			() => this.effectiveWorkingTreeMs,
			() => this.effectiveWorkingTreeMaxWaitMs,
			() => this.flushWorkingTree(),
		);
		this.lifecycle = options.lifecycle;
		this.onDidFireRepoChangeCallback = options.onDidFireRepoChange;
		this.onDidFireWorkingTreeChangeCallback = options.onDidFireWorkingTreeChange;
		this._suspended = options.suspended ?? false;
		if (this._suspended) {
			this.repoClock.suspend();
			this.workingTreeClock.suspend();
		}
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;

		this._disposed = true;

		this.repoClock.cancel();
		this.workingTreeClock.cancel();

		this.clearPendingRepoChanges();
		this.pendingWorkingTreePaths.clear();
		this.pendingWorkingTreeIncomplete = false;
		this.repoSubscribers.clear();
		this.relevantRefsSources.clear();
		this.workingTreeSubscribers.clear();

		this.repoEmitter.dispose();
		this.workingTreeEmitter.dispose();
	}

	get suspended(): boolean {
		return this._suspended;
	}

	get hasPendingChanges(): boolean {
		return this.pendingRepoChanges.size > 0 || this.hasPendingWorkingTreeChanges;
	}

	/**
	 * An incomplete batch with no surviving paths still has to fire: the caller dropped paths we never saw, so
	 * gating the pipeline on the retained set alone would swallow the change entirely.
	 */
	private get hasPendingWorkingTreeChanges(): boolean {
		return this.pendingWorkingTreePaths.size > 0 || this.pendingWorkingTreeIncomplete;
	}

	get repoSubscriberCount(): number {
		return this.repoSubscribers.size;
	}

	get workingTreeSubscriberCount(): number {
		return this.workingTreeSubscribers.size;
	}

	/**
	 * Monotonic counter incremented immediately when working tree changes
	 * are pushed (before debounce). Used by `GitCommit.hasFullDetails()`
	 * to detect staleness of uncommitted commit data.
	 */
	get etagWorkingTree(): number {
		return this._etagWorkingTree;
	}

	/**
	 * Subscribe to .git directory changes with configurable debounce.
	 * First subscribe fires `onFirstRepoSubscriber`, last dispose
	 * fires `onLastRepoSubscriber`.
	 *
	 * When multiple subscribers exist, the shortest debounce wins —
	 * all subscribers fire on the same (fastest) cadence. `maxWaitMs` bounds how long continuous
	 * activity can defer a flush (the shortest wins too); `Infinity` means no cap.
	 *
	 * `relevantRefs` narrows THIS subscription's events to the refs it cares about, given as full ref names
	 * (`refs/heads/main`, `refs/remotes/origin/main`, `refs/tags/v1`, `refs/stash`). It is read at delivery, so it can
	 * return the subscriber's current list. A `heads`/`remotes`/`tags`/`stash` change is delivered only when a listed
	 * ref of that kind may have moved, when the change isn't attributable to a name (e.g. a `packed-refs` rewrite),
	 * or, for `heads`, when a pseudo-ref (`HEAD`, `ORIG_HEAD`) moved — so `stash` and `tags` changes are dropped unless
	 * a ref of that kind is listed. A `config` change confined to some branches' `branch.<name>` sections
	 * (`configBranches`) is delivered only when `HEAD` or one of those branches is listed. Other change kinds always
	 * pass, and an event left with no changes isn't delivered.
	 * The filter never affects other subscribers, the debounce, or the global `onDidFireRepoChange` forwarding.
	 */
	subscribe(opts?: {
		delayMs?: number;
		maxWaitMs?: number;
		relevantRefs?: () => Iterable<string>;
	}): RepositorySubscription {
		if (this._disposed) {
			return Object.assign(
				createDisposable(() => {}),
				{
					onDidChange: this.repoEmitter.event,
				},
			);
		}

		const id = this.repoNextId++;
		const wasEmpty = this.repoSubscribers.size === 0;

		this.repoSubscribers.set(id, {
			delayMs: opts?.delayMs ?? this.defaultRepoMs,
			maxWaitMs: opts?.maxWaitMs ?? this.defaultRepoMaxWaitMs,
		});
		this.recalcRepoTiming();

		const relevantRefs = opts?.relevantRefs;
		if (relevantRefs != null) {
			this.relevantRefsSources.set(id, relevantRefs);
		}

		if (wasEmpty) {
			this.lifecycle?.onFirstRepoSubscriber?.();
		}

		// If the effective delay or max-wait got shorter while a flush is pending, move it sooner
		this.repoClock.rearmIfEarlier();

		let subDisposed = false;
		return Object.assign(
			createDisposable(() => {
				if (subDisposed) return;

				subDisposed = true;

				this.repoSubscribers.delete(id);
				this.relevantRefsSources.delete(id);
				this.recalcRepoTiming();

				if (this.repoSubscribers.size === 0) {
					this.repoClock.cancel();
					this.clearPendingRepoChanges();
					this.lifecycle?.onLastRepoSubscriber?.();
				}
			}),
			{
				onDidChange:
					relevantRefs != null
						? createRelevantRefsEvent(this.repoEmitter.event, relevantRefs)
						: this.repoEmitter.event,
			},
		);
	}

	/** Every repo subscriber's current `relevantRefs` (see {@link subscribe}), unioned */
	getRelevantRefs(): Set<string> {
		const refs = new Set<string>();
		for (const relevantRefs of this.relevantRefsSources.values()) {
			for (const ref of relevantRefs()) {
				refs.add(ref);
			}
		}
		return refs;
	}

	/** Subscribe to working tree changes; `delayMs` and `maxWaitMs` behave as in {@link subscribe}. */
	subscribeToWorkingTree(opts?: { delayMs?: number; maxWaitMs?: number }): WorkingTreeSubscription {
		if (this._disposed) {
			return Object.assign(
				createDisposable(() => {}),
				{
					onDidChangeWorkingTree: this.workingTreeEmitter.event,
				},
			);
		}

		const id = this.workingTreeNextId++;
		const wasEmpty = this.workingTreeSubscribers.size === 0;

		this.workingTreeSubscribers.set(id, {
			delayMs: opts?.delayMs ?? this.defaultWorkingTreeMs,
			maxWaitMs: opts?.maxWaitMs ?? this.defaultWorkingTreeMaxWaitMs,
		});
		this.recalcWorkingTreeTiming();

		if (wasEmpty) {
			this.lifecycle?.onFirstWorkingTreeSubscriber?.();
		}

		// If the effective delay or max-wait got shorter while a flush is pending, move it sooner
		this.workingTreeClock.rearmIfEarlier();

		let subDisposed = false;
		return Object.assign(
			createDisposable(() => {
				if (subDisposed) return;

				subDisposed = true;

				this.workingTreeSubscribers.delete(id);
				this.recalcWorkingTreeTiming();

				if (this.workingTreeSubscribers.size === 0) {
					this.workingTreeClock.cancel();
					this.pendingWorkingTreePaths.clear();
					// Dropped with the paths it describes — a stale flag would make the next subscriber's
					// first ordinary flush claim a partial set and force needless full refreshes.
					this.pendingWorkingTreeIncomplete = false;
					this.lifecycle?.onLastWorkingTreeSubscriber?.();
				}
			}),
			{ onDidChangeWorkingTree: this.workingTreeEmitter.event },
		);
	}

	suspend(): void {
		this._suspended = true;
		// Cancel active timers — events continue to coalesce but don't fire
		this.repoClock.suspend();
		this.workingTreeClock.suspend();
	}

	resume(delayMs?: number): void {
		if (!this._suspended) return;

		this._suspended = false;

		// Flush accumulated changes (a clock with nothing pending stays idle); the max-wait window restarts from now
		this.repoClock.resume(delayMs);
		this.workingTreeClock.resume(delayMs);
	}

	/**
	 * Inject changes (e.g., after a git operation the caller performed). Goes through debounce + suspend. Ref kinds
	 * among them are unnamed — any ref of that kind may have moved.
	 */
	fireChange(...changes: RepositoryChange[]): void {
		if (this._disposed || changes.length === 0) return;

		this.coalesceRepo(changes, undefined, 'unfenced');
	}

	/** Immediate fire, bypassing debounce + suspend (for Closed/Opened). Ref kinds among them are unnamed. */
	fireChangeImmediate(...changes: RepositoryChange[]): void {
		if (this._disposed || changes.length === 0) return;

		const event = new WatcherRepoChangeEvent(this.repoPath, changes);
		// Same contract as `flushRepo`: notify the global forwarder (which advances the cache's status clock) BEFORE
		// subscribers. Skipping it here would route changes to subscribers that no one advanced the clock for —
		// subscribers see them as session-routed and (correctly) don't re-advance, so the cache would go stale.
		this.onDidFireRepoChangeCallback?.(event);
		this.repoEmitter.fire(event);
	}

	/**
	 * Push interpreted repo changes into the pipeline. `ref` is the full ref name (or ref directory, or pseudo-ref) whose
	 * file changed; a ref kind in `changes` is attributed to it when the kinds match, and is otherwise unnamed.
	 * `false` preserves cache invalidations for a config edit without claiming any ref moved. `configBranches`, for a
	 * `config` among `changes`, are the local branches (full ref names) whose `branch.<name>` sections are all that
	 * changed in `.git/config`; without it, the config change may be anywhere.
	 */
	pushRepoChanges(changes: RepositoryChange[], ref?: string | false, configBranches?: ReadonlySet<string>): void {
		if (this._disposed) return;

		this.coalesceRepo(changes, ref, 'raw', configBranches);
	}

	/**
	 * Push watcher-observed repo changes that no write of core's can account for — an overflow's rescan, or an ignore
	 * rule changed in the working tree — so {@link noteSelfWrite} never replaces them or takes them for its echo. Ref
	 * kinds are unnamed.
	 */
	pushUnfencedRepoChanges(changes: RepositoryChange[]): void {
		if (this._disposed) return;

		this.coalesceRepo(changes, undefined, 'unfenced');
	}

	/**
	 * Core announced one of its own writes for this repository: its caches were evicted and its host notified, both
	 * after the write finished. The announcement becomes this session's one event for the write:
	 *
	 * - the announced kinds are pushed through the debounce and suspend like {@link fireChange}, and the event carries
	 *   them in `announced`. A ref kind is unnamed unless `refs` names refs of that kind (the full ref names the write
	 *   moved), in which case it carries those names and no other ref of the kind counts as changed by the write.
	 *   `config` is confined to the `branch.<name>` sections of the local branches `refs` names when
	 *   `options.configConfinedToRefs` says so, and the event carries them (`configBranches`);
	 * - a raw change of an announced kind is the write's own report of it only when it is provably within what the
	 *   write announced: a ref the write named or a ref directory holding one, or a config change confined to branches
	 *   the write's config was confined to. Pending when the announcement arrives, it is replaced. Arriving later, it
	 *   merges and the kind stays announced only within the repo debounce delay of the announcement; a window can stay
	 *   pending for minutes while the session is suspended, and a later move of the same ref is as likely an outside
	 *   one. Any other report of the kind is an outside change: it stays, and the kind isn't `announced`, since the
	 *   host has not handled the outside part. A write never names `HEAD`, but a commit locks it to write its reflog,
	 *   so under a write that announced `head`, a report of the `HEAD` file within the same delay is the write's echo,
	 *   its `heads` part included;
	 * - a kind the write announced open (unnamed, or `config` unconfined) covers any change of the kind: raw changes
	 *   of it still pending are replaced, since the host evicts everything of the kind after the write. One arriving
	 *   within the repo debounce delay of the announcement, before its event fires, is taken for the write's own late
	 *   echo; any later report of the kind before the event fires clears the mark.
	 *
	 * Once the event fires, nothing is special: an echo the watcher delivers after it causes one extra, unannounced
	 * event (a duplicate refresh, narrowed like any other), rather than risk losing an outside change of the same kind.
	 *
	 * Empty `changes`, or `'unknown'`, announces every kind a watcher can report (never `'unknown'` itself, which a
	 * cache reads as a close), open whatever `refs` says; `'closed'` and `'opened'` are ignored. Only raw `.git` changes
	 * are replaced or kept announced: {@link fireChange}, {@link fireChangeImmediate}, {@link pushUnfencedRepoChanges}
	 * and working-tree changes always pass.
	 */
	noteSelfWrite(
		changes: readonly RepositoryChange[],
		refs?: readonly string[],
		options?: { readonly configConfinedToRefs?: boolean },
	): void {
		if (this._disposed) return;

		const all = changes.length === 0 || changes.includes('unknown');
		const announced = all ? allWatchedRepositoryChanges : changes.filter(c => isAnnounceable(c));
		const named = all ? undefined : groupNamedRefs(changes, refs);
		const configBranches =
			!all && options?.configConfinedToRefs === true && changes.includes('config')
				? getBranchRefs(refs)
				: undefined;

		for (const change of this.pendingRepoChanges) {
			if (this.pendingRepoUnfencedChanges.has(change) || !isAnnounceable(change)) continue;
			if (!all && !changes.includes(change)) continue;

			if (change === 'config' && configBranches != null) {
				// An earlier announcement's config stays and merges with this one; a raw one is replaced only when it
				// is provably this write's own report
				if (this.pendingRepoAnnounced.has(change)) continue;
				if (!isSubsetOf(this.pendingRepoConfigBranches, configBranches)) continue;
			}

			const names = isRefChangeKind(change) ? named?.get(change) : undefined;
			if (names != null) {
				for (const name of names) {
					this.pendingRepoRefs.delete(name);
				}
				// Git reports the directory it creates or removes to hold the write's ref as well. Only a raw report can
				// be that echo: a name an earlier write announced is a ref it changed, and it can sit where this write's
				// directory is (delete `team`, then create `team/task`)
				// Walked from each name, as a write can name many refs (a fetch) while many outside ones are pending
				for (const name of names) {
					for (const dir of getRefDirectories(name)) {
						if (!this.pendingRepoAnnouncedRefs.has(dir)) {
							this.pendingRepoRefs.delete(dir);
						}
					}
				}
				// What's left of the kind came from outside the write, so it stays, unannounced
				if (this.hasPendingRefOfKind(change)) continue;
			}

			this.pendingRepoChanges.delete(change);
			this.pendingRepoAnnounced.delete(change);
			if (change === 'config') {
				this.pendingRepoConfigBranches = undefined;
			}
			if (!isRefChangeKind(change)) continue;

			// An unnamed announcement covers any ref of the kind, so the replaced kind takes its named refs with it
			this.pendingRepoUnnamedRefKinds.delete(change);
			for (const ref of this.pendingRepoRefs) {
				if (getRefChangeKind(ref) === change) {
					this.pendingRepoRefs.delete(ref);
				}
			}
		}

		if (announced.length !== 0) {
			this.coalesceRepo(
				named != null ? announced.filter(c => !isRefChangeKind(c) || !named.has(c)) : announced,
				undefined,
				'announced',
				configBranches,
			);
			if (named != null) {
				for (const [kind, names] of named) {
					for (const name of names) {
						this.coalesceRepo([kind], name, 'announced');
						// Only a name kept among the pending refs can be taken for a directory's echo; past the cap
						// the kind went unnamed, which covers it, so the set stays as bounded as those refs
						if (this.pendingRepoRefs.has(name)) {
							this.pendingRepoAnnouncedRefs.add(name);
						}
					}
				}
			}
		} else if (this.pendingRepoChanges.size === 0) {
			// Nothing left to flush: idle the clock rather than let it fire an empty window
			this.repoClock.cancel();
		}
	}

	/** Push working tree file changes into the pipeline */
	/** `incomplete` marks the batch as partial when the caller already dropped paths of its own. */
	pushWorkingTreeChanges(paths: Iterable<string>, incomplete?: boolean): void {
		if (this._disposed) return;

		this._etagWorkingTree++;
		if (incomplete) {
			this.pendingWorkingTreeIncomplete = true;
		}
		this.coalesceWorkingTrees(paths);
	}

	private static minDelay(subscribers: Map<number, DebounceTiming>, fallback: number): number {
		let min = fallback;
		for (const { delayMs } of subscribers.values()) {
			if (delayMs < min) {
				min = delayMs;
			}
		}
		return min;
	}

	/** Unlike the delay, the default isn't a ceiling — a subscriber can opt out of the cap with `Infinity` */
	private static minMaxWait(subscribers: Map<number, DebounceTiming>, fallback: number): number {
		if (subscribers.size === 0) return fallback;

		let min = Infinity;
		for (const { maxWaitMs } of subscribers.values()) {
			if (maxWaitMs < min) {
				min = maxWaitMs;
			}
		}
		return min;
	}

	private recalcRepoTiming(): void {
		this.effectiveRepoMs = RepositoryWatchSession.minDelay(this.repoSubscribers, this.defaultRepoMs);
		this.effectiveRepoMaxWaitMs = RepositoryWatchSession.minMaxWait(
			this.repoSubscribers,
			this.defaultRepoMaxWaitMs,
		);
	}

	private recalcWorkingTreeTiming(): void {
		this.effectiveWorkingTreeMs = RepositoryWatchSession.minDelay(
			this.workingTreeSubscribers,
			this.defaultWorkingTreeMs,
		);
		this.effectiveWorkingTreeMaxWaitMs = RepositoryWatchSession.minMaxWait(
			this.workingTreeSubscribers,
			this.defaultWorkingTreeMaxWaitMs,
		);
	}

	private flushRepo(): void {
		if (this.pendingRepoChanges.size === 0) return;

		// The event is built only here — raw events just add to the pending sets (which the event copies)
		const event = new WatcherRepoChangeEvent(
			this.repoPath,
			[...this.pendingRepoChanges],
			{
				names: this.pendingRepoRefs,
				unnamed: this.pendingRepoUnnamedRefKinds,
				configBranches: this.pendingRepoConfigBranches,
			},
			this.pendingRepoAnnounced.keys(),
		);
		this.clearPendingRepoChanges();
		// Advance any cache clock BEFORE notifying subscribers (same rationale as `flushWorkingTree`): a subscriber
		// that synchronously reads status must see the post-change generation, not a joinable pre-change run.
		this.onDidFireRepoChangeCallback?.(event);
		this.repoEmitter.fire(event);
	}

	/**
	 * `origin` is a raw `.git` event, a push no announcement replaces ({@link fireChange},
	 * {@link pushUnfencedRepoChanges}), or core's announced write. A kind stays announced only while nothing else
	 * reports it in the pending window, save the write's own report of it (see {@link noteSelfWrite}).
	 * `configBranches` confines a `config` among `changes` to those branches' sections; without it, it may be anywhere.
	 */
	private coalesceRepo(
		changes: readonly RepositoryChange[],
		ref: string | false | undefined,
		origin: 'raw' | 'unfenced' | 'announced',
		configBranches?: ReadonlySet<string>,
	): void {
		if (changes.length === 0) return;

		const now = performance.now();
		const refKind = typeof ref === 'string' ? getRefChangeKind(ref) : undefined;
		for (const change of changes) {
			const pending = this.pendingRepoChanges.has(change);
			// What this report is confined to: the ref it names, or the branches whose config sections it changed
			let names: ReadonlySet<string> | undefined;
			if (origin !== 'unfenced') {
				if (change === 'config') {
					names = configBranches;
				} else if (typeof ref === 'string' && refKind === change) {
					names = new Set([ref]);
				}
			}

			const announcement = this.pendingRepoAnnounced.get(change);
			if (origin === 'announced') {
				if (!pending) {
					this.pendingRepoAnnounced.set(change, {
						at: now,
						names: names != null ? new Set(names) : undefined,
					});
				} else if (announcement != null) {
					// Added in place: a write naming many refs arrives here once per name, and copying the set each
					// time would cost quadratic time in the number of refs it moved
					if (announcement.names != null && names != null) {
						for (const name of names) {
							announcement.names.add(name);
						}
					} else {
						announcement.names = undefined;
					}
				}
			} else {
				const own =
					origin === 'raw' && announcement != null && this.isOwnReport(change, announcement, names, now);
				if (announcement != null && !own) {
					this.pendingRepoAnnounced.delete(change);
				} else if (!pending && origin === 'raw' && this.isHeadEcho(change, names, now)) {
					// A detached HEAD's move announces head without heads, and the HEAD file is all it wrote
					this.pendingRepoAnnounced.set(change, { at: now, names: new Set(names) });
				}
				if (origin === 'unfenced') {
					this.pendingRepoUnfencedChanges.add(change);
				}
			}

			if (change === 'config') {
				let branches: Set<string> | undefined;
				if (!pending) {
					branches = names != null ? new Set(names) : undefined;
				} else if (this.pendingRepoConfigBranches != null && names != null) {
					branches = new Set([...this.pendingRepoConfigBranches, ...names]);
				}
				this.pendingRepoConfigBranches =
					branches != null && branches.size <= maxPendingRefNames ? branches : undefined;
			}

			this.pendingRepoChanges.add(change);
			if (ref === false || !isRefChangeKind(change)) continue;

			if (
				ref != null &&
				refKind === change &&
				(this.pendingRepoRefs.size < maxPendingRefNames || this.pendingRepoRefs.has(ref))
			) {
				this.pendingRepoRefs.add(ref);
			} else {
				this.pendingRepoUnnamedRefKinds.add(change);
			}
		}
		this.repoClock.note();
	}

	/**
	 * Whether a raw report of `change`, confined to `names` (`undefined`: not confined), is the announced write's own.
	 * It must arrive within the repo debounce delay of the announcement, as it always had to. An open announcement
	 * asks nothing more; one confined to names also needs every name the report carries to be one the write announced,
	 * save the `heads` part of a `HEAD` report under a write that announced `head` in time, which is a commit's echo.
	 */
	private isOwnReport(
		change: RepositoryChange,
		announcement: PendingAnnouncement,
		names: ReadonlySet<string> | undefined,
		now: number,
	): boolean {
		if (now - announcement.at > this.effectiveRepoMs) return false;
		if (announcement.names == null) return true;
		if (names == null) return false;
		// A ref and a directory of the same name can't coexist, which is what lets a directory report stand for its
		// refs; config sections `branch.team` and `branch.team/task` can
		if (isRefChangeKind(change) ? isCoveredBy(names, announcement.names) : isSubsetOf(names, announcement.names)) {
			return true;
		}

		return this.isHeadEcho(change, names, now);
	}

	/** Whether a raw `heads` report confined to `HEAD` is the echo of a write that announced `head` in time */
	private isHeadEcho(change: RepositoryChange, names: ReadonlySet<string> | undefined, now: number): boolean {
		if (change !== 'heads' || names?.size !== 1 || !names.has('HEAD')) return false;

		const head = this.pendingRepoAnnounced.get('head');
		return head != null && now - head.at <= this.effectiveRepoMs;
	}

	/** Whether a pending report of `kind` remains, unnamed or under a name */
	private hasPendingRefOfKind(kind: RepositoryChange): boolean {
		if (!isRefChangeKind(kind)) return false;
		if (this.pendingRepoUnnamedRefKinds.has(kind)) return true;

		for (const ref of this.pendingRepoRefs) {
			if (getRefChangeKind(ref) === kind) return true;
		}
		return false;
	}

	private clearPendingRepoChanges(): void {
		this.pendingRepoChanges.clear();
		this.pendingRepoRefs.clear();
		this.pendingRepoUnnamedRefKinds.clear();
		this.pendingRepoUnfencedChanges.clear();
		this.pendingRepoAnnounced.clear();
		this.pendingRepoAnnouncedRefs.clear();
		this.pendingRepoConfigBranches = undefined;
	}

	private flushWorkingTree(): void {
		if (!this.hasPendingWorkingTreeChanges) return;

		const paths = this.pendingWorkingTreePaths;
		const incomplete = this.pendingWorkingTreeIncomplete;
		this.pendingWorkingTreePaths = new Set();
		this.pendingWorkingTreeIncomplete = false;
		// Advance the cache's status clock (via WatchService's global forwarding) BEFORE notifying subscribers,
		// so a subscriber that synchronously reads status sees the post-change generation, not a joinable pre-change run.
		this.onDidFireWorkingTreeChangeCallback?.(this.repoPath);
		this.workingTreeEmitter.fire({ repoPath: this.repoPath, paths: paths, incomplete: incomplete });
	}

	private coalesceWorkingTrees(paths: Iterable<string>): void {
		for (const p of paths) {
			// Stop retaining paths past the cap, but keep draining the iterable — the flag is what makes the
			// partial set safe to consume, and dropping out early would leave later paths for the next window.
			if (this.pendingWorkingTreePaths.size >= maxWorkingTreePaths && !this.pendingWorkingTreePaths.has(p)) {
				this.pendingWorkingTreeIncomplete = true;
				continue;
			}

			this.pendingWorkingTreePaths.add(p);
		}

		if (this.hasPendingWorkingTreeChanges) {
			this.workingTreeClock.note();
		}
	}
}

/** `'closed'` and `'opened'` are lifecycle, not a write's effect, so an announcement never replaces or names them */
function isAnnounceable(change: RepositoryChange): boolean {
	return change !== 'closed' && change !== 'opened';
}

/**
 * The names in `refs` grouped by their ref kind, for the ref kinds among `changes` only; `undefined` when none is named.
 * Pseudo-refs (`HEAD`) are left out: a write names the refs it moved, and those are full ref names.
 */
function groupNamedRefs(
	changes: readonly RepositoryChange[],
	refs: readonly string[] | undefined,
): Map<RefChangeKind, Set<string>> | undefined {
	if (!refs?.length) return undefined;

	let named: Map<RefChangeKind, Set<string>> | undefined;
	for (const ref of refs) {
		if (!ref.startsWith('refs/')) continue;

		const kind = getRefChangeKind(ref);
		if (kind == null || !changes.includes(kind)) continue;

		named ??= new Map();
		let names = named.get(kind);
		if (names == null) {
			names = new Set();
			named.set(kind, names);
		}
		names.add(ref);
	}
	return named;
}

/** The local branches among `refs` (full `refs/heads/` names), or `undefined` when there are none */
function getBranchRefs(refs: readonly string[] | undefined): Set<string> | undefined {
	let branches: Set<string> | undefined;
	for (const ref of refs ?? []) {
		if (ref.startsWith('refs/heads/')) {
			(branches ??= new Set()).add(ref);
		}
	}
	return branches;
}

/**
 * Whether `ref` is a ref directory holding one of `names` (compared on `/` boundaries). A namespace root
 * (`refs/heads`) or a pseudo-ref is no such directory, so a report of it is never a write's own by this rule.
 */
function isRefDirectoryOfAny(ref: string, names: ReadonlySet<string>): boolean {
	if (!ref.startsWith('refs/') || getRefChangeKind(ref) == null) return false;

	const prefix = `${ref}/`;
	for (const name of names) {
		if (name.startsWith(prefix)) return true;
	}
	return false;
}

/**
 * The ref directories holding `ref`, innermost first, each of `ref`'s own kind; never a namespace root (`refs/heads`),
 * as {@link isRefDirectoryOfAny} counts them
 */
function* getRefDirectories(ref: string): Iterable<string> {
	for (let index = ref.lastIndexOf('/'); index > 0; index = ref.lastIndexOf('/', index - 1)) {
		const dir = ref.substring(0, index);
		if (!dir.startsWith('refs/') || getRefChangeKind(dir) == null) return;

		yield dir;
	}
}

/**
 * Whether every name in `names` is one in `of` or a ref directory holding one; never for `undefined`, which stands for
 * any name
 */
function isCoveredBy(names: ReadonlySet<string> | undefined, of: ReadonlySet<string>): boolean {
	if (names == null) return false;

	for (const name of names) {
		if (!of.has(name) && !isRefDirectoryOfAny(name, of)) return false;
	}
	return true;
}

/** Whether every name in `names` is in `of`; never for `undefined`, which stands for any name */
function isSubsetOf(names: ReadonlySet<string> | undefined, of: ReadonlySet<string>): boolean {
	if (names == null) return false;

	for (const name of names) {
		if (!of.has(name)) return false;
	}
	return true;
}

/** Wraps a session's repo event so each delivery is narrowed to the subscriber's relevant refs (see `subscribe`) */
function createRelevantRefsEvent(
	event: Event<WatcherRepoChangeEvent>,
	relevantRefs: () => Iterable<string>,
): Event<WatcherRepoChangeEvent> {
	return (listener, thisArgs, disposables) =>
		event(
			e => {
				const narrowed = narrowToRelevantRefs(e, relevantRefs);
				if (narrowed != null) {
					listener.call(thisArgs, narrowed);
				}
			},
			undefined,
			disposables,
		);
}

/**
 * Narrows an event to the refs a subscriber cares about. Returns the event itself when no change kind is removed (the
 * kept names then stay a superset, which only makes `mayHaveChangedRef` more conservative), `undefined` when every kind
 * is removed, and otherwise a new event with the kept kinds, names and unnamed kinds. A `config` change confined to
 * some local branches' sections is removed unless a relevant ref is `HEAD` or one of those branches (see
 * `mayHaveChangedConfig`).
 */
function narrowToRelevantRefs(
	e: WatcherRepoChangeEvent,
	relevantRefs: () => Iterable<string>,
): WatcherRepoChangeEvent | undefined {
	// Ref kinds that pass only if a relevant ref of that kind may have moved
	let unresolved: Set<RefChangeKind> | undefined;
	for (const change of e.changes) {
		if (!isRefChangeKind(change) || e.unnamedRefKinds.has(change)) continue;

		(unresolved ??= new Set()).add(change);
	}
	// A confined `config` passes only if a relevant ref is one of the branches it is confined to
	const configBranches = e.configBranches;
	let keepConfig = configBranches == null;
	if (unresolved == null && keepConfig) return e;

	unresolved ??= new Set();

	const pseudoRefs: string[] = [];
	for (const name of e.refs) {
		if (!name.startsWith('refs/')) {
			pseudoRefs.push(name);
		}
	}
	if (pseudoRefs.length !== 0) {
		// A pseudo-ref (`HEAD`, `ORIG_HEAD`) moving is a `heads` change for every subscriber
		unresolved.delete('heads');
		if (unresolved.size === 0 && keepConfig) return e;
	}

	// Names that equal or cover a relevant ref — collected as we go, since `relevantRefs` may be a one-shot iterable
	const keptNames = new Set<string>(pseudoRefs);
	for (const ref of relevantRefs()) {
		// `HEAD` is usually a symref to the checked-out branch, so any `heads` change may have moved it, and any branch's
		// config section may be its branch's
		if (ref === 'HEAD') {
			if (e.changes.has('heads')) {
				for (const name of e.refs) {
					if (getRefChangeKind(name) === 'heads') {
						keptNames.add(name);
					}
				}
			}
			keepConfig = true;
			unresolved.delete('heads');
			continue;
		}

		if (!keepConfig && configBranches?.has(ref)) {
			keepConfig = true;
		}

		const kind = getRefChangeKind(ref);
		if (kind == null || !e.changes.has(kind)) continue;

		const covering = findCoveringRefName(e.refs, ref);
		if (covering == null) continue;

		keptNames.add(covering);
		unresolved.delete(kind);
	}
	if (unresolved.size === 0 && keepConfig) return e;

	const keptChanges: RepositoryChange[] = [];
	for (const change of e.changes) {
		if (change === 'config' ? keepConfig : !isRefChangeKind(change) || !unresolved.has(change)) {
			keptChanges.push(change);
		}
	}
	if (keptChanges.length === 0) return undefined;

	return new WatcherRepoChangeEvent(
		e.repoPath,
		keptChanges,
		{ names: keptNames, unnamed: e.unnamedRefKinds, configBranches: configBranches },
		e.announced,
	);
}
