/**
 * Visibility-aware event buffering for RPC webviews.
 *
 * For `retainContextWhenHidden: true` webviews, VS Code silently drops
 * `postMessage` while hidden. The EventVisibilityBuffer intercepts event
 * handlers and stores pending replays keyed by buffered subscription. On visibility
 * restore, all pending replays fire through the normal RPC handler path.
 *
 * Key properties:
 * - Same buffered subscription firing N times while hidden → 1 pending entry (latest overwrites)
 * - Pending count bounded by distinct buffered subscriptions
 * - Zero work on restore if nothing fired while hidden
 */

import type { Disposable } from 'vscode';
import type { RpcEventSubscription, Unsubscribe } from './services/types.js';

export type EventVisibilityKey = string | symbol;

/**
 * Tracks outstanding RPC event subscriptions so they can be cleaned up on
 * reconnection (`reset`) or controller teardown (`dispose`).
 *
 * Without this, VS Code event listeners created by `createRpcEventSubscription`
 * leak when a webview refreshes — the old Supertalk Connection closes but
 * nobody calls the `Unsubscribe` functions that hold the VS Code Disposables.
 */
export class SubscriptionTracker implements Disposable {
	private _unsubscribes = new Set<Unsubscribe>();
	private _disposed = false;
	private _epoch = 0;

	/**
	 * Monotonic generation counter, bumped by every {@link reset}/{@link dispose}. An ASYNC subscription
	 * method (one that awaits resource acquisition before `track()`) captures this before its await and
	 * compares after — a mismatch means a reconnect reset the tracker mid-acquisition, so the resource
	 * belongs to a superseded generation and must be disposed instead of tracked (tracking it would leak
	 * it until the NEXT reset and double-deliver alongside the new generation's subscription).
	 */
	get epoch(): number {
		return this._epoch;
	}

	/**
	 * Register an unsubscribe function for tracking.
	 * @returns A wrapped unsubscribe that also removes itself from the tracker.
	 */
	track(unsubscribe: Unsubscribe): () => void {
		// Already torn down — e.g. the webview was disposed while an async subscription method
		// (the only ones with an await between resource-acquisition and track) was in flight.
		// `dispose()` won't run again, so track-then-forget would leak; dispose the resource now.
		if (this._disposed) {
			(unsubscribe as () => void)();
			return () => {};
		}

		this._unsubscribes.add(unsubscribe);
		return () => {
			this._unsubscribes.delete(unsubscribe);
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsubscribe as () => void)();
		};
	}

	/**
	 * Disposes tracked subscriptions but stays usable — used on RPC reconnection so the next
	 * generation's `track()` calls register normally instead of being torn down immediately by
	 * a permanently-disposed tracker.
	 */
	reset(): void {
		this._epoch++;
		for (const unsub of this._unsubscribes) {
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsub as () => void)();
		}
		this._unsubscribes.clear();
	}

	/** Disposes tracked subscriptions and permanently disables the tracker. Called on final teardown. */
	dispose(): void {
		this._disposed = true;
		this.reset();
	}
}

/**
 * Manages visibility state and a pending replay map for buffered events.
 *
 * Usage:
 * - Controller creates an EventVisibilityBuffer for `retainContextWhenHidden: true` webviews
 * - Factory wraps each event subscription using `bufferEventHandler`
 * - Controller calls `setVisible(visible)` in `onParentVisibilityChanged`
 */
export class EventVisibilityBuffer {
	private _visible = true;
	private readonly _pending = new Map<EventVisibilityKey, () => void>();

	get visible(): boolean {
		return this._visible;
	}

	setVisible(visible: boolean): void {
		this._visible = visible;
		if (visible) {
			this.flush();
		}
	}

	addPending(key: EventVisibilityKey, fn: () => void): void {
		this._pending.set(key, fn); // overwrites previous — only latest survives
	}

	removePending(key: EventVisibilityKey): void {
		this._pending.delete(key);
	}

	private flush(): void {
		if (this._pending.size === 0) return;

		// Snapshot and clear before invoking — handlers could re-add pending entries
		const fns = [...this._pending.values()];
		this._pending.clear();
		for (const fn of fns) {
			fn();
		}
	}
}

/**
 * Wraps an event handler with visibility buffering.
 *
 * - `save-last`: When hidden, stores a closure that replays the latest event data.
 *   Each call overwrites the previous — only the most recent data survives.
 * - `signal`: When hidden, stores a closure that fires with `signalValue` (typically
 *   `undefined`). The webview handler re-fetches current state as needed.
 *
 * When `buffer` is `undefined` (retainContextWhenHidden: false), returns the handler
 * unchanged — no buffering overhead.
 */
export function bufferEventHandler<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: EventVisibilityKey,
	handler: (data: T) => void,
	mode: 'save-last' | 'signal',
	signalValue?: T,
): (data: T) => void {
	if (buffer == null) return handler;
	return (data: T) => {
		if (buffer.visible) {
			handler(data);
		} else {
			buffer.addPending(key, () => handler(mode === 'save-last' ? data : (signalValue as T)));
		}
	};
}

/**
 * Result of {@link createRpcEvent} — bundles a subscriber factory
 * and a fire function backed by the same internal handler map.
 */
export interface RpcEvent<T> {
	readonly subscribe: (buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker) => RpcEventSubscription<T>;
	readonly fire: (data: T) => void;
}

/**
 * Creates a self-contained handler-map event.
 *
 * The handler map is created and managed internally. Use `.subscribe(buffer, tracker)`
 * inside `getRpcServices` to produce an `RpcEventSubscription<T>`, and `.fire(data)` anywhere
 * to invoke all registered handlers.
 *
 * @param key - Logical event key for visibility buffering pending entries
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 */
export function createRpcEvent<T>(key: string, mode: 'save-last' | 'signal', signalValue?: T): RpcEvent<T> {
	const handlers = new Map<symbol, (data: T) => void>();
	return {
		subscribe: function (buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): RpcEventSubscription<T> {
			return function (handler: (data: T) => void): Unsubscribe {
				const pendingKey = Symbol(key);
				const buffered = bufferEventHandler(buffer, pendingKey, handler, mode, signalValue);
				const sym = Symbol();
				handlers.set(sym, buffered);
				const unsubscribe = function () {
					buffer?.removePending(pendingKey);
					handlers.delete(sym);
				};
				return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
			};
		},
		fire: function (data: T): void {
			for (const handler of [...handlers.values()]) {
				handler(data);
			}
		},
	};
}

/**
 * Creates an `RpcEventSubscription` backed by a VS Code `Disposable` event source.
 *
 * Standard pattern for the common case: Container event emitter → buffered handler → cleanup.
 * The `subscribe` function receives the already-buffered handler and returns a `Disposable`.
 *
 * The `subscribe` callback runs LAZILY — only when a client registers a handler, and once per
 * registration. It must never be the sole updater of a bridged `Signal.State`: a webview that
 * reads the signal without subscribing gets a permanently frozen value (#5513). Keep signals
 * fresh with an eagerly-registered listener instead — see `SubscriptionService`'s constructor.
 *
 * For custom patterns (aggregation, handler maps, replay-on-subscribe), use `bufferEventHandler` directly.
 *
 * @param buffer - Optional visibility buffer (undefined = no buffering)
 * @param key - Logical event key used to create a per-subscription pending entry
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param subscribe - Receives buffered handler, returns Disposable to clean up
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 * @param tracker - Optional subscription tracker for disposal on reconnection
 */
export function createRpcEventSubscription<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: string,
	mode: 'save-last' | 'signal',
	subscribe: (bufferedHandler: (data: T) => void) => Disposable,
	signalValue?: T,
	tracker?: SubscriptionTracker,
): RpcEventSubscription<T> {
	return (handler: (data: T) => void): Unsubscribe => {
		const pendingKey = Symbol(key);
		const buffered = bufferEventHandler(buffer, pendingKey, handler, mode, signalValue);
		const disposable = subscribe(buffered);
		const unsubscribe = () => {
			buffer?.removePending(pendingKey);
			disposable.dispose();
		};
		return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
	};
}
