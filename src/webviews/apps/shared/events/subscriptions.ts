/**
 * Shared subscription utilities for webview event wiring.
 *
 * - `subscribeAll`: Bulk event subscription with cleanup and error handling
 * - `Unsubscribe`: Type alias for unsubscribe functions
 */
import { Logger } from '../../../../system/logger.js';

/** Unsubscribe function returned by event subscriptions. */
export type Unsubscribe = () => void;

/**
 * Subscribe to multiple RPC events in parallel with automatic cleanup.
 *
 * Absorbs the Supertalk type assertion (`as unknown as Promise<Unsubscribe>`)
 * so callers don't need it. Uses `Promise.allSettled` so one failed subscription
 * doesn't prevent the others from being set up.
 *
 * @param subscriptions - Array of subscription setup closures.
 *   Each closure calls an event subscription method and returns its result.
 * @returns A single unsubscribe function that cleans up all subscriptions.
 *
 * @example
 * ```typescript
 * const unsubscribe = await subscribeAll([
 *   () => events.onConfigChanged(() => actions.fetchPreferences()),
 *   () => events.onSubscriptionChanged(sub => { state.hasAccount = sub.account != null; }),
 *   () => events.onRepositoryChanged(e => handleRepoChanged(e)),
 * ]);
 * // Later:
 * unsubscribe();
 * ```
 */
export async function subscribeAll(
	subscriptions: Array<() => Promise<Unsubscribe> | Unsubscribe>,
): Promise<Unsubscribe> {
	const results = await Promise.allSettled(subscriptions.map(fn => fn() as Promise<Unsubscribe>));
	const unsubscribers: Unsubscribe[] = [];
	for (const result of results) {
		if (result.status === 'fulfilled' && typeof result.value === 'function') {
			unsubscribers.push(result.value);
		} else if (result.status === 'rejected') {
			Logger.error(result.reason, 'Failed to subscribe');
		}
	}
	return () => {
		for (const unsub of unsubscribers) {
			try {
				unsub();
			} catch (ex) {
				Logger.error(ex, 'Failed to unsubscribe');
			}
		}
	};
}
