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
 * Tracks outstanding RPC event subscriptions so they can be disposed on
 * reconnection or controller teardown.
 *
 * Without this, VS Code event listeners created by `createRpcEventSubscription`
 * leak when a webview refreshes — the old Supertalk Connection closes but
 * nobody calls the `Unsubscribe` functions that hold the VS Code Disposables.
 */
export class SubscriptionTracker implements Disposable {
	private _unsubscribes = new Set<Unsubscribe>();

	/**
	 * Register an unsubscribe function for tracking.
	 * @returns A wrapped unsubscribe that also removes itself from the tracker.
	 */
	track(unsubscribe: Unsubscribe): () => void {
		this._unsubscribes.add(unsubscribe);
		return () => {
			this._unsubscribes.delete(unsubscribe);
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsubscribe as () => void)();
		};
	}

	/**
	 * Dispose all tracked subscriptions.
	 * Called on reconnection (before fresh Connection is created) and on teardown.
	 */
	dispose(): void {
		for (const unsub of this._unsubscribes) {
			// Cast is safe: `Unsubscribe` is `(() => void) | Promise<() => void>` because the webview-client side
			// receives it async over RPC, but host-side callers always produce a synchronous `() => void`.
			(unsub as () => void)();
		}
		this._unsubscribes.clear();
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
