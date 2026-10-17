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
 */
const maxPendingRefNames = 1000;

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
	 * Kinds among {@link pendingRepoChanges} that only core's announced writes reported, with when each was announced
	 * (see {@link noteSelfWrite})
	 */
	private readonly pendingRepoAnnouncedAt = new Map<RepositoryChange, number>();
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
	 * a ref of that kind is listed. Other change kinds always pass, and an event left with no changes isn't delivered.
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
	 */
	pushRepoChanges(changes: RepositoryChange[], ref?: string): void {
		if (this._disposed) return;

		this.coalesceRepo(changes, ref, 'raw');
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
	 * - raw changes of an announced kind still pending are replaced by it — they happened before the announcement,
	 *   which already covers them, whether they came from the write or from an outside change;
	 * - the announced kinds are pushed through the debounce and suspend like {@link fireChange}, ref kinds unnamed,
	 *   and the event carries them in `announced`;
	 * - raw changes of an announced kind that arrive later are never dropped. One arriving within the repo debounce
	 *   delay of the announcement, before its event fires, is taken for the write's own late echo and keeps the kind
	 *   announced; any other report of the kind before the event fires clears the mark. Once it fires, nothing is
	 *   special.
	 *
	 * The trade-off: an echo the watcher delivers after the announced event fired causes one extra, unannounced event
	 * (a duplicate refresh), rather than risk losing an outside change of the same kind.
	 *
	 * Empty `changes`, or `'unknown'`, announces every kind a watcher can report (never `'unknown'` itself, which a
	 * cache reads as a close); `'closed'` and `'opened'` are ignored. Only raw `.git` changes are replaced or kept
	 * announced: {@link fireChange}, {@link fireChangeImmediate}, {@link pushUnfencedRepoChanges} and working-tree
	 * changes always pass.
	 */
	noteSelfWrite(changes: readonly RepositoryChange[]): void {
		if (this._disposed) return;

		const all = changes.length === 0 || changes.includes('unknown');
		const announced = all ? allWatchedRepositoryChanges : changes.filter(c => isAnnounceable(c));

		for (const change of this.pendingRepoChanges) {
			if (this.pendingRepoUnfencedChanges.has(change) || !isAnnounceable(change)) continue;
			if (!all && !changes.includes(change)) continue;

			this.pendingRepoChanges.delete(change);
			this.pendingRepoAnnouncedAt.delete(change);
			if (!isRefChangeKind(change)) continue;

			// Announcements carry no ref names, so the replaced kind takes its named refs with it
			this.pendingRepoUnnamedRefKinds.delete(change);
			for (const ref of this.pendingRepoRefs) {
				if (getRefChangeKind(ref) === change) {
					this.pendingRepoRefs.delete(ref);
				}
			}
		}

		if (announced.length !== 0) {
			this.coalesceRepo(announced, undefined, 'announced');
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
			{ names: this.pendingRepoRefs, unnamed: this.pendingRepoUnnamedRefKinds },
			this.pendingRepoAnnouncedAt.keys(),
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
	 * reports it in the pending window, save the write's own late echo (see {@link noteSelfWrite}).
	 */
	private coalesceRepo(
		changes: readonly RepositoryChange[],
		ref: string | undefined,
		origin: 'raw' | 'unfenced' | 'announced',
	): void {
		if (changes.length === 0) return;

		const now = performance.now();
		const refKind = ref != null ? getRefChangeKind(ref) : undefined;
		for (const change of changes) {
			if (origin === 'announced') {
				if (!this.pendingRepoChanges.has(change)) {
					this.pendingRepoAnnouncedAt.set(change, now);
				}
			} else {
				const announcedAt = origin === 'raw' ? this.pendingRepoAnnouncedAt.get(change) : undefined;
				if (announcedAt == null || now - announcedAt > this.effectiveRepoMs) {
					this.pendingRepoAnnouncedAt.delete(change);
				}
				if (origin === 'unfenced') {
					this.pendingRepoUnfencedChanges.add(change);
				}
			}
			this.pendingRepoChanges.add(change);
			if (!isRefChangeKind(change)) continue;

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

	private clearPendingRepoChanges(): void {
		this.pendingRepoChanges.clear();
		this.pendingRepoRefs.clear();
		this.pendingRepoUnnamedRefKinds.clear();
		this.pendingRepoUnfencedChanges.clear();
		this.pendingRepoAnnouncedAt.clear();
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
 * is removed, and otherwise a new event with the kept kinds, names and unnamed kinds.
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
	if (unresolved == null) return e;

	const pseudoRefs: string[] = [];
	for (const name of e.refs) {
		if (!name.startsWith('refs/')) {
			pseudoRefs.push(name);
		}
	}
	if (pseudoRefs.length !== 0) {
		// A pseudo-ref (`HEAD`, `ORIG_HEAD`) moving is a `heads` change for every subscriber
		unresolved.delete('heads');
		if (unresolved.size === 0) return e;
	}

	// Names that equal or cover a relevant ref — collected as we go, since `relevantRefs` may be a one-shot iterable
	const keptNames = new Set<string>(pseudoRefs);
	for (const ref of relevantRefs()) {
		const kind = getRefChangeKind(ref);
		if (kind == null || !e.changes.has(kind)) continue;

		// `HEAD` is usually a symref to the checked-out branch, so any `heads` change may have moved it
		if (ref === 'HEAD') {
			for (const name of e.refs) {
				if (getRefChangeKind(name) === 'heads') {
					keptNames.add(name);
				}
			}
			unresolved.delete(kind);
			continue;
		}

		const covering = findCoveringRefName(e.refs, ref);
		if (covering == null) continue;

		keptNames.add(covering);
		unresolved.delete(kind);
	}
	if (unresolved.size === 0) return e;

	const keptChanges: RepositoryChange[] = [];
	for (const change of e.changes) {
		if (!isRefChangeKind(change) || !unresolved.has(change)) {
			keptChanges.push(change);
		}
	}
	if (keptChanges.length === 0) return undefined;

	return new WatcherRepoChangeEvent(
		e.repoPath,
		keptChanges,
		{ names: keptNames, unnamed: e.unnamedRefKinds },
		e.announced,
	);
}
