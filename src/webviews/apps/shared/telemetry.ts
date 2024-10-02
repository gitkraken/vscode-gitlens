import type { TelemetrySendEventParams } from '../../protocol';

export const telemetryEventName = 'gl-telemetry-fired';

export function emitTelemetrySentEvent<T extends TelemetrySendEventParams>(el: EventTarget, params: T) {
	el.dispatchEvent(
		new CustomEvent<T>(telemetryEventName, {
			bubbles: true,
			detail: params,
		}),
	);
}

declare global {
	interface WindowEventMap {
		[telemetryEventName]: CustomEvent<TelemetrySendEventParams>;
	}
}
