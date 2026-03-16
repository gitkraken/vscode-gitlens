/**
 * Shared telemetry action helpers for webview apps.
 *
 * Provides a dedup wrapper so webviews only push telemetry context
 * when it actually changes.
 */

/**
 * Creates a stateful function that deduplicates telemetry context pushes.
 * Only calls `updateFn` when the serialized context differs from the last push.
 *
 * @param updateFn - The RPC method to call (e.g. `services.updateTelemetryContext`)
 * @returns A function that accepts context and only pushes when changed
 *
 * @example
 * ```typescript
 * const pushContext = createTelemetryContextUpdater(
 *   context => void services.updateTelemetryContext(context),
 * );
 * // Only sends if context differs from last push:
 * pushContext({ 'context.period': '1M', 'context.sliceBy': 'author' });
 * ```
 */
export function createTelemetryContextUpdater(
	updateFn: (context: Record<string, string | number | boolean | undefined>) => void,
): (context: Record<string, string | number | boolean | undefined>) => void {
	let lastStr = '';
	return (context: Record<string, string | number | boolean | undefined>) => {
		const str = JSON.stringify(context);
		if (str !== lastStr) {
			lastStr = str;
			updateFn(context);
		}
	};
}
