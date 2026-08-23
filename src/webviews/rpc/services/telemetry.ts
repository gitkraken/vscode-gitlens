/**
 * Telemetry service — send telemetry events and update context from webviews.
 */

import type { TelemetryEventData, TelemetryEvents, TrackedUsageKeys } from '../../../constants.telemetry.js';
import type { UsageTracker } from '../../../onboarding/usageTracker.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../eventVisibilityBuffer.js';
import type { RpcEventSubscription, RpcServiceHost } from './types.js';

export class TelemetryService {
	/** Fired when a tracked usage key's used-state changes. Per-key data (like onboarding's
	 *  `onDidChange`), so `save-last` buffering while hidden can drop an intermediate key's event —
	 *  consumers filter to the one key they care about and re-fetch via `isUsed` on (re)subscribe,
	 *  so a dropped intermediate push never leaves them stale. */
	readonly onUsageChanged: RpcEventSubscription<{ key: TrackedUsageKeys; used: boolean }>;

	constructor(
		private readonly host: RpcServiceHost,
		private readonly _updateTelemetryContext: (
			context: Record<string, string | number | boolean | undefined>,
		) => void,
		private readonly _usage: UsageTracker,
		buffer?: EventVisibilityBuffer,
		tracker?: SubscriptionTracker,
	) {
		this.onUsageChanged = createRpcEventSubscription<{ key: TrackedUsageKeys; used: boolean }>(
			buffer,
			'usageChanged',
			'save-last',
			buffered =>
				this._usage.onDidChange(e => {
					if (e == null) return;

					buffered({ key: e.key, used: this._usage.isUsed(e.key) });
				}),
			undefined,
			tracker,
		);
	}

	/** Whether a tracked usage key has ever been recorded. */
	isUsed(key: TrackedUsageKeys): Promise<boolean> {
		return Promise.resolve(this._usage.isUsed(key));
	}

	/**
	 * Replaces the webview-pushed telemetry context on the host.
	 * Called from the webview whenever context-relevant state changes.
	 *
	 * @param context The full webview telemetry context (replaces, not merges)
	 */
	updateContext(context: Record<string, string | number | boolean | undefined>): Promise<void> {
		this._updateTelemetryContext(context);
		return Promise.resolve();
	}

	/**
	 * Sends a telemetry event from the webview through the host's telemetry pipeline.
	 *
	 * @param name Event name (must be a known TelemetryEvents key)
	 * @param data Optional event data
	 */
	sendEvent(name: keyof TelemetryEvents, data?: TelemetryEventData): Promise<void> {
		this.host.sendTelemetryEvent(name, data);
		return Promise.resolve();
	}

	/**
	 * Records usage of a tracked action/feature from the webview.
	 * Writes storage, sends telemetry, and fires the usage change event (drives walkthrough state).
	 *
	 * @param key Tracked usage key
	 */
	async trackUsage(key: TrackedUsageKeys): Promise<void> {
		await this._usage.track(key);
	}
}
