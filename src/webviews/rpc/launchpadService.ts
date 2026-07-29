/**
 * Standalone Launchpad RPC service.
 *
 * This is independent of any specific webview — any webview embedding
 * a launchpad component can compose this service into its service interface.
 */

import type { Container } from '../../container.js';
import type { LaunchpadSummaryError, LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator.js';
import { getLaunchpadSummary } from '../../plus/launchpad/utils/-webview/launchpad.utils.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { bufferEventHandler } from './eventVisibilityBuffer.js';
import type { RpcEventSubscription, Unsubscribe } from './services/types.js';

export class LaunchpadService {
	/**
	 * Fired when launchpad items change (PR status updates, etc.).
	 */
	readonly onLaunchpadChanged: RpcEventSubscription<undefined>;

	readonly #container: Container;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		this.onLaunchpadChanged = (callback): Unsubscribe => {
			const pendingKey = Symbol('launchpadChanged');
			const buffered = bufferEventHandler(buffer, pendingKey, callback, 'signal', undefined);
			// Subscribe to both: `onDidChange` covers item mutations (pin/snooze), while `onDidRefresh` is what a
			// completed background poll fires -- the only thing that repairs a cached failure.
			const disposables = [
				container.launchpad.onDidChange(() => buffered(undefined)),
				container.launchpad.onDidRefresh(() => buffered(undefined)),
			];
			const unsubscribe = () => {
				buffer?.removePending(pendingKey);
				for (const d of disposables) {
					d.dispose();
				}
			};
			return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
		};
	}

	/**
	 * Get a summary of launchpad items (PRs grouped by status).
	 *
	 * Pass `force` for user-initiated refreshes -- otherwise a cached failure is re-served until it expires.
	 */
	getSummary(options?: {
		force?: boolean;
	}): Promise<LaunchpadSummaryResult | { error: LaunchpadSummaryError } | undefined> {
		return getLaunchpadSummary(this.#container, options);
	}
}
