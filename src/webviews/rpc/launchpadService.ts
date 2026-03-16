/**
 * Standalone Launchpad RPC service.
 *
 * This is independent of any specific webview — any webview embedding
 * a launchpad component can compose this service into its service interface.
 */

import type { Container } from '../../container.js';
import type { LaunchpadSummaryResult } from '../../plus/launchpad/launchpadIndicator.js';
import { getLaunchpadSummary } from '../../plus/launchpad/utils/-webview/launchpad.utils.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createBufferedCallback } from './eventVisibilityBuffer.js';
import type { EventSubscriber, Unsubscribe } from './services/types.js';

export class LaunchpadService {
	/**
	 * Fired when launchpad items change (PR status updates, etc.).
	 */
	readonly onLaunchpadChanged: EventSubscriber<undefined>;

	readonly #container: Container;

	constructor(container: Container, buffer: EventVisibilityBuffer | undefined, tracker?: SubscriptionTracker) {
		this.#container = container;

		this.onLaunchpadChanged = (callback): Unsubscribe => {
			const pendingKey = Symbol('launchpadChanged');
			const buffered = createBufferedCallback(buffer, pendingKey, callback, 'signal', undefined);
			const disposable = container.launchpad.onDidChange(() => buffered(undefined));
			const unsubscribe = () => {
				buffer?.removePending(pendingKey);
				disposable.dispose();
			};
			return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
		};
	}

	/**
	 * Get a summary of launchpad items (PRs grouped by status).
	 */
	getSummary(): Promise<LaunchpadSummaryResult | { error: Error } | undefined> {
		return getLaunchpadSummary(this.#container);
	}
}
