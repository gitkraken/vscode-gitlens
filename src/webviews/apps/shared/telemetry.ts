import type { TelemetryEvents } from '../../../constants.telemetry';
import type { TelemetrySendEventParams } from '../../protocol';

export const telemetryEventName = 'gl-telemetry-fired';

export function emitTelemetrySentEvent<T extends keyof TelemetryEvents>(
	el: EventTarget,
	params: TelemetrySendEventParams<T>,
) {
	el.dispatchEvent(
		new CustomEvent<TelemetrySendEventParams<T>>(telemetryEventName, {
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
