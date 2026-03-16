/**
 * Visibility-aware event buffering for RPC webviews.
 *
 * For `retainContextWhenHidden: true` webviews, VS Code silently drops
 * `postMessage` while hidden. The EventVisibilityBuffer intercepts event
 * callbacks and stores pending replays keyed by buffered subscription. On visibility
 * restore, all pending replays fire through the normal RPC callback path.
 *
 * Key properties:
 * - Same buffered subscription firing N times while hidden → 1 pending entry (latest overwrites)
 * - Pending count bounded by distinct buffered subscriptions
 * - Zero work on restore if nothing fired while hidden
 */

import type { Disposable } from 'vscode';
import type { EventSubscriber, Unsubscribe } from './services/types.js';

export type EventVisibilityKey = string | symbol;

/**
 * Tracks outstanding RPC event subscriptions so they can be disposed on
 * reconnection or controller teardown.
 *
 * Without this, VS Code event listeners created by `createEventSubscription`
 * leak when a webview refreshes — the old Supertalk Connection closes but
 * nobody calls the `Unsubscribe` functions that hold the VS Code Disposables.
 */
export class SubscriptionTracker implements Disposable {
	private _unsubscribes = new Set<Unsubscribe>();

	/**
	 * Register an unsubscribe function for tracking.
	 * @returns A wrapped unsubscribe that also removes itself from the tracker.
	 */
	track(unsubscribe: Unsubscribe): Unsubscribe {
		this._unsubscribes.add(unsubscribe);
		return () => {
			this._unsubscribes.delete(unsubscribe);
			unsubscribe();
		};
	}

	/**
	 * Dispose all tracked subscriptions.
	 * Called on reconnection (before fresh Connection is created) and on teardown.
	 */
	dispose(): void {
		for (const unsub of this._unsubscribes) {
			unsub();
		}
		this._unsubscribes.clear();
	}
}

/**
 * Manages visibility state and a pending replay map for buffered events.
 *
 * Usage:
 * - Controller creates an EventVisibilityBuffer for `retainContextWhenHidden: true` webviews
 * - Factory wraps each event subscription using `createBufferedCallback`
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

		// Snapshot and clear before invoking — callbacks could re-add pending entries
		const fns = [...this._pending.values()];
		this._pending.clear();
		for (const fn of fns) {
			fn();
		}
	}
}

/**
 * Wraps an event callback with visibility buffering.
 *
 * - `save-last`: When hidden, stores a closure that replays the latest event data.
 *   Each call overwrites the previous — only the most recent data survives.
 * - `signal`: When hidden, stores a closure that fires with `signalValue` (typically
 *   `undefined`). The webview handler re-fetches current state as needed.
 *
 * When `buffer` is `undefined` (retainContextWhenHidden: false), returns the callback
 * unchanged — no buffering overhead.
 */
export function createBufferedCallback<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: EventVisibilityKey,
	callback: (data: T) => void,
	mode: 'save-last' | 'signal',
	signalValue?: T,
): (data: T) => void {
	if (buffer == null) return callback;
	return (data: T) => {
		if (buffer.visible) {
			callback(data);
		} else {
			buffer.addPending(key, () => callback(mode === 'save-last' ? data : (signalValue as T)));
		}
	};
}

/**
 * Creates an `EventSubscriber` backed by a VS Code `Disposable` event source.
 *
 * Standard pattern for the common case: Container event emitter → buffered callback → cleanup.
 * The `subscribe` function receives the already-buffered callback and returns a `Disposable`.
 *
 * For custom patterns (aggregation, callback maps, replay-on-subscribe), use
 * `createBufferedCallback` directly.
 *
 * @param buffer - Optional visibility buffer (undefined = no buffering)
 * @param key - Logical event key used to create a per-subscription pending entry
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param subscribe - Receives buffered callback, returns Disposable to clean up
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 * @param tracker - Optional subscription tracker for disposal on reconnection
 */
export function createEventSubscription<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: string,
	mode: 'save-last' | 'signal',
	subscribe: (bufferedCallback: (data: T) => void) => Disposable,
	signalValue?: T,
	tracker?: SubscriptionTracker,
): EventSubscriber<T> {
	return (callback: (data: T) => void): Unsubscribe => {
		const pendingKey = Symbol(key);
		const buffered = createBufferedCallback(buffer, pendingKey, callback, mode, signalValue);
		const disposable = subscribe(buffered);
		const unsubscribe = () => {
			buffer?.removePending(pendingKey);
			disposable.dispose();
		};
		return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
	};
}

/**
 * Creates an `EventSubscriber` backed by a symbol-keyed callback map.
 *
 * For events where the provider owns the firing logic (no Container emitter).
 * The provider iterates `[...callbackMap.values()]` to fire the event.
 *
 * @param buffer - Optional visibility buffer (undefined = no buffering)
 * @param key - Logical event key used to create a per-subscription pending entry
 * @param mode - `'save-last'` replays latest data; `'signal'` replays `signalValue`
 * @param callbackMap - Map that the provider iterates to fire events
 * @param signalValue - Value to replay in `'signal'` mode (typically `undefined`)
 * @param tracker - Optional subscription tracker for disposal on reconnection
 */
export function createCallbackMapSubscription<T>(
	buffer: EventVisibilityBuffer | undefined,
	key: string,
	mode: 'save-last' | 'signal',
	callbackMap: Map<symbol, (data: T) => void>,
	signalValue?: T,
	tracker?: SubscriptionTracker,
): EventSubscriber<T> {
	return (callback: (data: T) => void): Unsubscribe => {
		const pendingKey = Symbol(key);
		const buffered = createBufferedCallback(buffer, pendingKey, callback, mode, signalValue);
		const sym = Symbol();
		callbackMap.set(sym, buffered);
		const unsubscribe = () => {
			buffer?.removePending(pendingKey);
			callbackMap.delete(sym);
		};
		return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
	};
}
