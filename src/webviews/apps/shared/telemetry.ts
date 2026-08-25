import type { TimeInput } from '@opentelemetry/api';
import type { Source, WebviewTelemetryEvents } from '../../../constants.telemetry.js';

export const telemetryEventName = 'gl-telemetry-fired';

/** A webview-emitted telemetry event, bridged to the host's telemetry pipeline (via RPC) by the
 *  listener in `appBase.ts`. Formerly the payload of the legacy IPC telemetry command; now it is
 *  the detail of `emitTelemetrySentEvent` and the parameter of `RpcController.sendTelemetry`. */
export interface TelemetrySendEventParams<T extends keyof WebviewTelemetryEvents = keyof WebviewTelemetryEvents> {
	name: T;
	data: WebviewTelemetryEvents[T];
	source?: Source;
	startTime?: TimeInput;
	endTime?: TimeInput;
}

export function emitTelemetrySentEvent<T extends keyof WebviewTelemetryEvents>(
	el: EventTarget,
	params: TelemetrySendEventParams<T>,
): void {
	el.dispatchEvent(
		new CustomEvent<TelemetrySendEventParams<T>>(telemetryEventName, {
			bubbles: true,
			// The only listener is on `window` (see `appBase.ts`), so the event must cross any
			// shadow boundaries between the dispatching element and the document. Without this,
			// events dispatched from inside a shadow root (e.g. `gl-graph-overview` inside
			// `gl-graph-sidebar-panel`) are trapped at the boundary and silently dropped.
			composed: true,
			detail: params,
		}),
	);
}

declare global {
	interface WindowEventMap {
		[telemetryEventName]: CustomEvent<TelemetrySendEventParams>;
	}
}
