// Row-paging math shared by the graph's prefetch trigger. Kept pure (no DOM) so it's unit-testable.

/** Hard ceiling on how far ahead (in rows) the graph will prefetch — keeps a fast fling from asking
 * for an unbounded runway. */
export const maxPrefetchDistanceRows = 400;
/** Floor so even a tiny viewport / stationary cursor keeps a comfortable buffer loaded ahead. */
export const minPrefetchDistanceRows = 50;

/**
 * How many rows before the loaded end the graph should start paging in the next page, so the page is
 * in flight before the user scrolls into it. Grows with both the viewport (taller lists want a bigger
 * buffer) and the current scroll velocity (~1s of runway: at `v` rows/sec, reserve `v` rows so a
 * ~300ms page lands before arrival). Clamped to [min, max].
 *
 * @param viewportHeightPx Scroller client height in px.
 * @param rowHeightPx Fixed row height in px.
 * @param velocityRowsPerSec Estimated absolute scroll velocity in rows/second (0 when idle).
 */
export function computePrefetchDistance(
	viewportHeightPx: number,
	rowHeightPx: number,
	velocityRowsPerSec: number,
): number {
	const viewportRows = rowHeightPx > 0 ? Math.ceil(viewportHeightPx / rowHeightPx) : 0;
	// Round the velocity term up generously — better to prefetch a touch early than to hit the wall.
	const velocityRows = Math.ceil(Math.max(0, velocityRowsPerSec));
	const distance = Math.max(minPrefetchDistanceRows, 2 * viewportRows, velocityRows);
	return Math.min(maxPrefetchDistanceRows, distance);
}
