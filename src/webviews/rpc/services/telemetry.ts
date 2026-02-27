/**
 * Telemetry service — send telemetry events and update context from webviews.
 */

import type { TelemetryEventData, TelemetryEvents } from '../../../constants.telemetry.js';
import type { RpcServiceHost } from './types.js';

export class WebviewTelemetryService {
	constructor(
		private readonly host: RpcServiceHost,
		private readonly _updateTelemetryContext: (
			context: Record<string, string | number | boolean | undefined>,
		) => void,
	) {}

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
	sendEvent(name: string, data?: TelemetryEventData): Promise<void> {
		// Cast: RPC boundary receives plain strings — can't enforce keyof TelemetryEvents across the wire
		this.host.sendTelemetryEvent(name as keyof TelemetryEvents, data);
		return Promise.resolve();
	}
}
