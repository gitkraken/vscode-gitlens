import type { TelemetryEvents } from '../../../constants.telemetry.js';
import type { TelemetrySendEventParams } from '../../protocol.js';

export const telemetryEventName = 'gl-telemetry-fired';

export function emitTelemetrySentEvent<T extends keyof TelemetryEvents>(
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
