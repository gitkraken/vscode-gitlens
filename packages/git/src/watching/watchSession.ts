import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import type { RepositoryChange } from '../models/repository.js';
import type { WorkingTreeChangeEvent } from './changeEvent.js';
import { WatcherRepoChangeEvent } from './changeEvent.js';

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
	readonly lifecycle?: WatchSessionLifecycle;
	/**
	 * Called whenever a debounced repo change event is dispatched to subscribers.
	 * Does NOT count as a subscriber — used by WatchService for
	 * global event forwarding without affecting lifecycle callbacks.
	 */
	readonly onDidFireRepoChange?: (event: WatcherRepoChangeEvent) => void;
}

const defaultRepoDelay = 250;
const defaultWorkingTreeDelay = 2500;

/**
 * Per-repository session that owns the debounce/coalesce/suspend
 * pipeline for both repo (.git) and working-tree changes.
 *
 * Multiple subscribers share the same pipeline — the shortest
 * requested debounce delay wins.
 */
export class RepositoryWatchSession implements UnifiedDisposable {
	readonly repoPath: string;

	private readonly repoEmitter = new Emitter<WatcherRepoChangeEvent>();
	private readonly repoDelays = new Map<number, number>(); // subscriberId → delayMs
	private repoNextId = 0;
	private pendingRepoEvent: WatcherRepoChangeEvent | undefined;
	private repoTimer: ReturnType<typeof setTimeout> | undefined;
	private effectiveRepoMs: number;
	private readonly defaultRepoMs: number;

	private readonly wtEmitter = new Emitter<WorkingTreeChangeEvent>();
	private readonly wtDelays = new Map<number, number>();
	private wtNextId = 0;
	private pendingWTPaths = new Set<string>();
	private wtTimer: ReturnType<typeof setTimeout> | undefined;
	private effectiveWTMs: number;
	private readonly defaultWTMs: number;

	private _etagWorkingTree = 0;
	private _suspended = false;
	private _disposed = false;

	private readonly lifecycle?: WatchSessionLifecycle;
	private readonly onDidFireRepoChangeCallback?: (event: WatcherRepoChangeEvent) => void;

	constructor(options: WatchSessionOptions) {
		this.repoPath = options.repoPath;
		this.defaultRepoMs = options.defaultRepoDelayMs ?? defaultRepoDelay;
		this.defaultWTMs = options.defaultWorkingTreeDelayMs ?? defaultWorkingTreeDelay;
		this.effectiveRepoMs = this.defaultRepoMs;
		this.effectiveWTMs = this.defaultWTMs;
		this.lifecycle = options.lifecycle;
		this.onDidFireRepoChangeCallback = options.onDidFireRepoChange;
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		this.cancelRepoTimer();
		this.cancelWTTimer();

		this.pendingRepoEvent = undefined;
		this.pendingWTPaths.clear();
		this.repoDelays.clear();
		this.wtDelays.clear();

		this.repoEmitter.dispose();
		this.wtEmitter.dispose();
	}

	get suspended(): boolean {
		return this._suspended;
	}

	get hasPendingChanges(): boolean {
		return this.pendingRepoEvent != null || this.pendingWTPaths.size > 0;
	}

	get repoSubscriberCount(): number {
		return this.repoDelays.size;
	}

	get workingTreeSubscriberCount(): number {
		return this.wtDelays.size;
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
	 * all subscribers fire on the same (fastest) cadence.
	 */
	subscribe(opts?: { delayMs?: number }): RepositorySubscription {
		if (this._disposed) {
			return Object.assign(
				createDisposable(() => {}),
				{
					onDidChange: this.repoEmitter.event,
				},
			);
		}

		const id = this.repoNextId++;
		const delay = opts?.delayMs ?? this.defaultRepoMs;
		const wasEmpty = this.repoDelays.size === 0;
		const prevDelay = this.effectiveRepoMs;

		this.repoDelays.set(id, delay);
		this.recalcRepoDelay();

		if (wasEmpty) {
			this.lifecycle?.onFirstRepoSubscriber?.();
		}

		// If the effective delay got shorter while a timer is running, reschedule sooner
		if (this.effectiveRepoMs < prevDelay && this.repoTimer != null) {
			this.scheduleRepoFlush();
		}

		let subDisposed = false;
		return Object.assign(
			createDisposable(() => {
				if (subDisposed) return;
				subDisposed = true;

				this.repoDelays.delete(id);
				this.recalcRepoDelay();

				if (this.repoDelays.size === 0) {
					this.cancelRepoTimer();
					this.pendingRepoEvent = undefined;
					this.lifecycle?.onLastRepoSubscriber?.();
				}
			}),
			{ onDidChange: this.repoEmitter.event },
		);
	}

	subscribeToWorkingTree(opts?: { delayMs?: number }): WorkingTreeSubscription {
		if (this._disposed) {
			return Object.assign(
				createDisposable(() => {}),
				{
					onDidChangeWorkingTree: this.wtEmitter.event,
				},
			);
		}

		const id = this.wtNextId++;
		const delay = opts?.delayMs ?? this.defaultWTMs;
		const wasEmpty = this.wtDelays.size === 0;
		const prevDelay = this.effectiveWTMs;

		this.wtDelays.set(id, delay);
		this.recalcWTDelay();

		if (wasEmpty) {
			this.lifecycle?.onFirstWorkingTreeSubscriber?.();
		}

		// If the effective delay got shorter while a timer is running, reschedule sooner
		if (this.effectiveWTMs < prevDelay && this.wtTimer != null) {
			this.scheduleWTFlush();
		}

		let subDisposed = false;
		return Object.assign(
			createDisposable(() => {
				if (subDisposed) return;
				subDisposed = true;

				this.wtDelays.delete(id);
				this.recalcWTDelay();

				if (this.wtDelays.size === 0) {
					this.cancelWTTimer();
					this.pendingWTPaths.clear();
					this.lifecycle?.onLastWorkingTreeSubscriber?.();
				}
			}),
			{ onDidChangeWorkingTree: this.wtEmitter.event },
		);
	}

	suspend(): void {
		this._suspended = true;
		// Cancel active timers — events continue to coalesce but don't fire
		this.cancelRepoTimer();
		this.cancelWTTimer();
	}

	resume(delayMs?: number): void {
		if (!this._suspended) return;
		this._suspended = false;

		// Flush accumulated changes
		if (this.pendingRepoEvent != null) {
			this.scheduleRepoFlush(delayMs);
		}
		if (this.pendingWTPaths.size > 0) {
			this.scheduleWTFlush(delayMs);
		}
	}

	/** Inject changes (e.g., after a git operation the caller performed). Goes through debounce + suspend. */
	fireChange(...changes: RepositoryChange[]): void {
		if (this._disposed || changes.length === 0) return;
		this.coalesceRepo(changes);
	}

	/** Immediate fire, bypassing debounce + suspend (for Closed/Opened). */
	fireChangeImmediate(...changes: RepositoryChange[]): void {
		if (this._disposed || changes.length === 0) return;
		this.repoEmitter.fire(new WatcherRepoChangeEvent(this.repoPath, changes));
	}

	/** Push interpreted repo changes into the pipeline */
	pushRepoChanges(changes: RepositoryChange[]): void {
		if (this._disposed) return;
		this.coalesceRepo(changes);
	}

	/** Push working tree file changes into the pipeline */
	pushWorkingTreeChanges(paths: Iterable<string>): void {
		if (this._disposed) return;
		this._etagWorkingTree++;
		this.coalesceWT(paths);
	}

	private static minDelay(delays: Map<number, number>, fallback: number): number {
		if (delays.size === 0) return fallback;
		let min = fallback;
		for (const d of delays.values()) {
			if (d < min) {
				min = d;
			}
		}
		return min;
	}

	private recalcRepoDelay(): void {
		this.effectiveRepoMs = RepositoryWatchSession.minDelay(this.repoDelays, this.defaultRepoMs);
	}

	private recalcWTDelay(): void {
		this.effectiveWTMs = RepositoryWatchSession.minDelay(this.wtDelays, this.defaultWTMs);
	}

	private flushRepo(): void {
		this.repoTimer = undefined;
		const event = this.pendingRepoEvent;
		if (event == null) return;
		this.pendingRepoEvent = undefined;
		this.repoEmitter.fire(event);
		this.onDidFireRepoChangeCallback?.(event);
	}

	private scheduleRepoFlush(delayOverride?: number): void {
		if (this._suspended || this.pendingRepoEvent == null) return;

		if (this.repoTimer != null) {
			clearTimeout(this.repoTimer);
		}
		this.repoTimer = setTimeout(() => this.flushRepo(), delayOverride ?? this.effectiveRepoMs);
	}

	private coalesceRepo(changes: RepositoryChange[]): void {
		if (changes.length === 0) return;

		this.pendingRepoEvent =
			this.pendingRepoEvent == null
				? new WatcherRepoChangeEvent(this.repoPath, changes)
				: this.pendingRepoEvent.with(changes);

		this.scheduleRepoFlush();
	}

	private flushWT(): void {
		this.wtTimer = undefined;
		if (this.pendingWTPaths.size === 0) return;

		const paths = this.pendingWTPaths;
		this.pendingWTPaths = new Set();
		this.wtEmitter.fire({ repoPath: this.repoPath, paths: paths });
	}

	private scheduleWTFlush(delayOverride?: number): void {
		if (this._suspended || this.pendingWTPaths.size === 0) return;

		if (this.wtTimer != null) {
			clearTimeout(this.wtTimer);
		}
		this.wtTimer = setTimeout(() => this.flushWT(), delayOverride ?? this.effectiveWTMs);
	}

	private coalesceWT(paths: Iterable<string>): void {
		for (const p of paths) {
			this.pendingWTPaths.add(p);
		}
		this.scheduleWTFlush();
	}

	private cancelRepoTimer(): void {
		if (this.repoTimer != null) {
			clearTimeout(this.repoTimer);
			this.repoTimer = undefined;
		}
	}

	private cancelWTTimer(): void {
		if (this.wtTimer != null) {
			clearTimeout(this.wtTimer);
			this.wtTimer = undefined;
		}
	}
}
