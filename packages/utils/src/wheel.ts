// Browsers report wheel deltas in three units (pixels / lines / pages); these convert the non-pixel
// modes to pixels so callers can apply the delta without caring about the wheel source.

/** CSS pixels per wheel "line" (`DOM_DELTA_LINE`) — the browser's default line-scroll step. */
export const wheelLineHeightPx = 16;

/** Normalizes a `WheelEvent` delta to CSS pixels. `pageExtentPx` is the viewport extent along the
 *  scrolled axis, used only for the (rare) `DOM_DELTA_PAGE` mode. */
export function normalizeWheelDelta(deltaMode: number, delta: number, pageExtentPx: number): number {
	return deltaMode === WheelEvent.DOM_DELTA_LINE
		? delta * wheelLineHeightPx
		: deltaMode === WheelEvent.DOM_DELTA_PAGE
			? delta * pageExtentPx
			: delta;
}
