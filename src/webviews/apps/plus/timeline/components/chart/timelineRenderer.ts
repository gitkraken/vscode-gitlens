import type { TimelineSliceBy } from '../../../../../plus/timeline/protocol.js';
import type { TimelineViewModel } from './timelineData.js';

// Bigger rows by default than the original V8 spec — the legacy chart's "lush" feel came from
// rows with enough vertical room for outlier bubbles to puff out and bump into their neighbours.
// At 72 min, ≤8-author repos fill the editor placement without scroll while still giving each
// row room to breathe; 9+ authors trigger vertical scroll, which is the right tradeoff.
export const minRowHeight = 72;
export const maxRowHeight = 96;
// Compact floor for very small canvases — at this size rows can't be lush, but they still need
// room for at least one avatar. Sized so a single row + buffers fits in the canvas the chart gets
// at VS Code's 120px webview minimum (~44px after breadcrumb/slider chrome).
export const compactRowHeightPx = 24;
const compactRowHeightCanvasHeightPx = 80;
const fullRowHeightCanvasHeightPx = 600;
// Vertical strip reserved between the swimlane region and the X-axis line for tick labels — the
// labels sit here, the bars grow downward from the axis line, and outlier bubbles in the bottom
// row can't crash into the labels because the strip is *outside* the swimlane region.
export const axisLabelStripHeightPx = 20;
// Compact strip height used when the volume bars are hidden by viewport size — sits at the same
// vertical footprint as the horizontal scrollbar so the bottom chrome stays cohesive.
export const compactAxisLabelStripHeightPx = 12;
// Thin top breathing strip. The host's swimlane clip is open to canvas y=0 so top-row outlier
// bubbles can render up into this strip without being cropped, and `topBufferPx` (~0.22 ×
// maxRowHeight) inside the swimlane region already reserves enough room for worst-case bubble
// overflow. Anything more here is just empty visual gap above the first row.
export const headerPaddingPx = 2;
// Padding (in CSS px) between the canvas edges and where bubbles can sit, so hover-scaled bubbles
// don't get cropped against the canvas border. Scales loosely with row height in the host layout.
export const bubbleEdgePaddingPx = 4;
// Left-edge gutter reserved between the canvas edge and the rail / Y2 column. Keeps avatars and
// the "Lines changed" rotated label off the viewport border. Mirror in the rail's CSS via the
// `--rail-left-offset` host variable.
export const railLeftOffsetPx = 8;
// Width of the left rail column (avatars). The host's DOM rail overlays the canvas's left
// gutter — they share the same horizontal strip — so the canvas's `gutterLeft` is sized to fit
// both the rail (occupying the swimlane vertical band) and the Y2 axis (occupying the volume
// vertical band) within the same gutter column. Sized just past the avatar diameter (~28px) +
// hover scale — any wider and the rail's right padding pushes the chart away from the avatars.
// Used as the floor for `pickRailColumnWidth` and as the default when callers don't supply a
// `gutterLeft` override.
export const railColumnWidthPx = 36;
// Upper bound for the rail column when sliceBy='branch' on a wide chart — sized for ~10-12 chars
// of branch name plus the 24px icon and a comfortable inter-pill gap. Going wider eats into the
// chart without revealing meaningfully more name (most branch names that don't fit by here also
// don't fit by 200px).
export const railColumnWidthMaxPx = 160;
// Chart cssWidth at which `pickRailColumnWidth` starts ramping up from the floor in branch mode.
// Below this we keep the icon-only rail because there isn't enough chart left over to justify
// stealing pixels for partial branch names.
const railWidthRampStartPx = 480;
// Chart cssWidth at which the ramp tops out at `railColumnWidthMaxPx` for branch mode.
const railWidthRampEndPx = 800;
// Volume strip height adapts to the canvas height so a tall editor pane gets the full bar chart,
// while a short panel collapses it to a thin strip and gives the swimlanes the breathing room.
export const minVolumeHeightPx = 14;
export const maxVolumeHeightPx = 64;
// Below this canvas height the strip stays at min; above maxVolumeRampHeightPx it stays at max.
const minVolumeRampHeightPx = 300;
const maxVolumeRampHeightPx = 800;
// At canvas heights below this, the volume strip is hidden entirely — every spare pixel goes to
// the swimlane region. The "Lines changed" reading is lost, but the bubble swimlane (the primary
// signal) stays readable rather than being squeezed by chrome.
const hideVolumeBelowCanvasHeightPx = 200;
// Bumped to VS Code's standard scrollbar size so the chart's scrollbars read as system-native
// affordances rather than as tiny custom strips.
export const verticalScrollbarWidthPx = 14;
export const horizontalScrollbarHeightPx = 12;
export const y2GutterWidthPx = 56; // Right gutter for the "Lines changed" Y2 axis ticks/label
export const brushFillOpacity = 0.45;
export const brushEdgeWidthPx = 2;
const bubbleFillAlpha = 0.55;

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;
const weekMs = 7 * dayMs;
const monthMs = 30 * dayMs;
const yearMs = 365 * dayMs;

export interface TimelineLayout {
	width: number;
	height: number;
	dpr: number;

	/** Pixel-x range available for chart content. The host reserves the Y label gutter on the left
	 * and the Y2 ("Lines changed") gutter on the right. */
	chartLeft: number;
	chartRight: number;
	get chartWidth(): number;

	/** Inset (px) applied inside `[chartLeft, chartRight]` for *data* positioning — bubble centers
	 * and X-axis ticks/labels project onto the inner range so even max-radius hover-scaled bubbles
	 * don't reach the chart edges. */
	dataInsetX: number;

	/** Top buffer (px) inside the swimlane region before the first row's center. Sized so the top
	 * row's outlier bubbles don't extend above the swimlane region (and thus get cropped against
	 * the swimlane clip). Combined with `bottomBufferPx` this gives the chart its "row 0 doesn't
	 * crash into the canvas top" gap. */
	swimlaneTopBufferPx: number;

	/** Thin sticky strip at the top of the canvas — reserved for vertical-scroll affordance, NOT
	 * for axis labels. The X-axis labels render in `axisStrip`, below the swimlane (legacy parity). */
	headerY: number;
	headerHeight: number;

	/** Scrollable swimlane region — bubbles draw inside this Y range, scrolled by `scrollY`. */
	swimlaneTop: number;
	swimlaneBottom: number;
	rowHeight: number;
	/** Total virtual height of all swimlanes (== sliceCount × rowHeight). When greater than the
	 * visible region's height, the host scrolls the static layer by `scrollY` pixels. */
	virtualSwimlaneHeight: number;

	/** X-axis strip — sits between the swimlane and the volume strip and hosts the tick labels.
	 * Top is the X-axis baseline (where bubbles end); bottom is where the volume bars start, so
	 * the X axis literally separates the two regions like a shared axis line. */
	axisStripTop: number;
	axisStripBottom: number;

	/** Volume bars grow UPWARD from `volumeBottom` toward the X-axis baseline at `volumeTop`
	 * (= `axisStripBottom`). Heavy commits' bars reach toward the X-axis and visually connect
	 * to the bubbles above; small commits stay short near `volumeBottom`. */
	volumeTop: number;
	volumeBottom: number;

	/** Right gutter reserved for the Y2 ("Lines changed") axis ticks + rotated label. */
	y2Left: number;

	/** Horizontal scrollbar strip at the very bottom (only visible when zoomed). */
	horizontalScrollbarTop: number;
}

export interface TimelineTheme {
	background: string;
	zebraOdd: string;
	axisDomain: string;
	axisLabel: string;
	axisLabelMuted: string;
	gridLine: string;
	bubbleStroke: string;
	selectedRing: string;
	hoverRing: string;
	additions: string;
	deletions: string;
	scrollThumb: string;
	scrollThumbHover: string;
	tooltipBg: string;
	tooltipFg: string;
	tooltipBorder: string;
	/** Categorical palette for slices. The view model's `slice.colorIndex` indexes into this array,
	 * wrapping with modulo for datasets that exceed the palette length. */
	slicePalette: readonly string[];
}

export interface TimelineDrawState {
	viewModel: TimelineViewModel;
	layout: TimelineLayout;
	theme: TimelineTheme;
	scrollY: number;
	zoomRange?: { oldest: number; newest: number };
	selectedSha?: string;
	hoverIndex?: number;
	/**
	 * Animation transition for hover highlight crossfade. `outgoingIndex` is the bubble we're leaving
	 * (drawn at `1 - intensity`), `hoverIndex` is the one we're moving to (drawn at `intensity`).
	 * Lets the host drive a smooth scale-up + halo fade-in via rAF without forcing the renderer to
	 * own animation state — and gives directly-adjacent hover transitions a clean crossfade rather
	 * than an instant jump.
	 */
	hoverIntensity?: number;
	outgoingHoverIndex?: number;
	outgoingHoverIntensity?: number;
	/**
	 * Slice index pinned by the side label / legend chip hover. When set, every swimlane row
	 * EXCEPT this one is dimmed in the overlay so the user can isolate a single contributor's
	 * footprint without losing the rest of the chart's chrome.
	 */
	hoverSliceIndex?: number;
	/**
	 * Volume bar pinned by hovering the bottom volume strip — the index in the view model arrays
	 * whose timestamp the user is pointing at. When set, the overlay layer dims every swimlane
	 * bubble that doesn't share the bar's X (so the user sees only the contributors who landed
	 * commits at that moment) and `drawVolume` highlights the matching bar.
	 */
	hoverVolumeIndex?: number;
	/**
	 * Slice indices the user has toggled off via avatar/legend click. Their bubbles disappear from
	 * the swimlane and their additions/deletions subtract from the volume bars; the row stays in
	 * place (just empty) so the user's mental map of contributors doesn't shift. Volume math uses
	 * the `additionsBySlice`/`deletionsBySlice` arrays on the view model.
	 */
	hiddenSlices?: ReadonlySet<number>;
	brushRange?: { startX: number; endX: number };
	scrollbarOpacity?: number;
	loading?: boolean;
	/** Directional "more history" indicators drawn into the axis strip when the dataset extends
	 *  past the viewport on that side. Purely visual — no hit-testing or interaction. */
	historyBefore?: boolean;
	historyAfter?: boolean;
}

/**
 * Volume strip height for a given canvas height. Linear ramp from `minVolumeHeightPx` at
 * `minVolumeRampHeightPx` (and below) to `maxVolumeHeightPx` at `maxVolumeRampHeightPx` (and above).
 */
export function pickVolumeHeight(cssHeight: number): number {
	const span = maxVolumeRampHeightPx - minVolumeRampHeightPx;
	const t = span > 0 ? (cssHeight - minVolumeRampHeightPx) / span : 1;
	const clamped = Math.max(0, Math.min(1, t));
	return Math.round(minVolumeHeightPx + clamped * (maxVolumeHeightPx - minVolumeHeightPx));
}

/**
 * Row-height floor for a given canvas height. Linear ramp from `compactRowHeightPx` at
 * `compactRowHeightCanvasHeightPx` (and below) to `minRowHeight` at `fullRowHeightCanvasHeightPx`
 * (and above) — short panels are allowed to compress rows below the lush default so 4-5 slices
 * still fit without forcing scroll.
 */
export function pickMinRowHeight(cssHeight: number): number {
	const span = fullRowHeightCanvasHeightPx - compactRowHeightCanvasHeightPx;
	const t = span > 0 ? (cssHeight - compactRowHeightCanvasHeightPx) / span : 1;
	const clamped = Math.max(0, Math.min(1, t));
	return Math.round(compactRowHeightPx + clamped * (minRowHeight - compactRowHeightPx));
}

/**
 * Rail column width for the current chart width and slice mode. Author mode is always
 * `railColumnWidthPx` — avatars are 24px and any extra column is dead space. Branch mode ramps
 * linearly from `railColumnWidthPx` at `railWidthRampStartPx` (and below) to `railColumnWidthMaxPx`
 * at `railWidthRampEndPx` (and above) so partial branch names become visible without hover when
 * there's enough chart width to justify the trade-off.
 */
export function pickRailColumnWidth(cssWidth: number, sliceBy: TimelineSliceBy): number {
	if (sliceBy !== 'branch') return railColumnWidthPx;

	const span = railWidthRampEndPx - railWidthRampStartPx;
	const t = span > 0 ? (cssWidth - railWidthRampStartPx) / span : 1;
	const clamped = Math.max(0, Math.min(1, t));
	return Math.round(railColumnWidthPx + clamped * (railColumnWidthMaxPx - railColumnWidthPx));
}

export function computeLayout(
	cssWidth: number,
	cssHeight: number,
	dpr: number,
	sliceCount: number,
	options?: {
		gutterLeft?: number;
		gutterRight?: number;
		headerHeight?: number;
		volumeHeight?: number;
		showVolume?: boolean;
		showY2?: boolean;
		showHorizontalScrollbar?: boolean;
	},
): TimelineLayout {
	// Hide the volume strip on very short canvases so the bubble swimlane (the primary signal)
	// doesn't get squeezed by chrome that nobody can read at that size anyway. The X-axis label
	// strip is preserved separately so the time scale stays anchored even when bars are gone.
	const showVolume = options?.showVolume !== false && cssHeight >= hideVolumeBelowCanvasHeightPx;
	const showAxisLabels = options?.showVolume !== false;
	const _showY2 = options?.showY2 !== false && showVolume;
	// Single left gutter shared by the rail (avatars, drawn in DOM, overlaying the swimlane band
	// of the gutter) and the Y2 axis (drawn on canvas, occupying the volume band of the gutter).
	// Includes the rail's left offset so chartLeft sits PAST the rail's right edge in canvas
	// coords (otherwise the rail's CSS shift would leave chartLeft inside the rail visually).
	const gutterLeft = options?.gutterLeft ?? railLeftOffsetPx + railColumnWidthPx + bubbleEdgePaddingPx;
	// Reserve the vertical scrollbar's column on the right. Just the scrollbar width (no extra
	// bubble pad) so bubbles can sit close to the chart's right edge.
	const gutterRight = options?.gutterRight ?? verticalScrollbarWidthPx;
	const headerHeight = options?.headerHeight ?? headerPaddingPx;
	const volumeHeight = showVolume ? (options?.volumeHeight ?? pickVolumeHeight(cssHeight)) : 0;
	const horizontalScrollbarHeight = options?.showHorizontalScrollbar ? horizontalScrollbarHeightPx : 0;

	const chartLeft = Math.min(cssWidth, Math.max(0, gutterLeft));
	const chartRight = Math.max(chartLeft, cssWidth - gutterRight);
	// `y2Left` is now the left-side X coordinate where Y2 ticks live (just inside the rail-side
	// gutter). Kept as a single field so callers don't have to know about the gutter swap.
	const y2Left = Math.max(0, chartLeft - y2GutterWidthPx);

	const headerY = 0;
	const swimlaneTop = headerY + headerHeight;
	// Volume bars rise downward from the X-axis line. Above the line sits a dedicated label strip
	// (reserved here so bottom-row outlier bubbles can't overlap labels), and above that the
	// swimlane region. Layout stack from the bottom up:
	//     volume (bars) → axis line (volumeTop) → axis label strip → swimlane → header padding.
	const volumeBottom = cssHeight;
	const volumeTop = Math.max(swimlaneTop, volumeBottom - volumeHeight);
	// Use the compact strip when the X-axis is preserved but the volume bars are hidden — saves
	// ~8px on tiny canvases and the host suppresses the tick nubs to match.
	const axisLabelStripHeight = !showAxisLabels
		? 0
		: showVolume
			? axisLabelStripHeightPx
			: compactAxisLabelStripHeightPx;
	const axisStripTop = Math.max(swimlaneTop, volumeTop - axisLabelStripHeight);
	const axisStripBottom = volumeTop;
	// Reserve top + bottom buffers inside the swimlane region so the top-row / bottom-row
	// outlier bubbles don't poke past the canvas edges. Sized for the 0.7 cap (= max bubble
	// extends 0.2 × rowHeight past row boundary). Tied to the canvas-derived row-height floor so
	// the buffers compress alongside the rows on small canvases — the visible top gap is
	// dominated by this buffer, not the headerPaddingPx.
	const rowHeightFloor = pickMinRowHeight(cssHeight);
	const topBufferPx = sliceCount > 0 ? Math.round(rowHeightFloor * 0.22) : 0;
	const bottomBufferPx = sliceCount > 0 ? Math.round(rowHeightFloor * 0.22) : 0;
	const swimlaneBottom = axisStripTop;
	const swimlaneRegionHeight = Math.max(0, swimlaneBottom - swimlaneTop);
	// Horizontal scrollbar anchors to the *top* of the X-axis label strip — leaves the bottom of
	// the strip clear for the date labels, which sit just above the X-axis line. Previously the
	// scrollbar anchored to the bottom (`volumeTop - height`), which caused it to overlap the
	// labels and made both harder to read.
	const horizontalScrollbarTop = horizontalScrollbarHeight > 0 ? axisStripTop : cssHeight;

	// Pick the row height that lets every slice fit the visible region — bounded by the
	// canvas-height-adaptive floor (compact panels go below the lush default rather than auto-
	// scrolling on the first 2-3 slices) and the lush max (oversized rows waste vertical space).
	const usableLaneHeight = Math.max(0, swimlaneRegionHeight - topBufferPx - bottomBufferPx);
	const idealRowHeight =
		sliceCount > 0
			? Math.max(rowHeightFloor, Math.min(maxRowHeight, usableLaneHeight / sliceCount))
			: rowHeightFloor;
	const rowHeight = Math.max(rowHeightFloor, Math.min(maxRowHeight, idealRowHeight));
	const virtualSwimlaneHeight = topBufferPx + sliceCount * rowHeight + bottomBufferPx;
	// Inset for the *data range* — bubble centers (and X-axis labels/ticks) project onto
	// `[chartLeft + dataInsetX, chartRight - dataInsetX]`. Derived from `clampRadiusToRow` (the
	// max possible bubble radius for this row height) plus the standard edge padding, so a
	// max-radius bubble at the chart edge never overflows into the rail or right gutter
	// regardless of how the row-height ↔ radius cap ratio is tuned in `clampRadiusToRow`.
	const dataInsetX = Math.round(clampRadiusToRow(rowHeight) + bubbleEdgePaddingPx);

	return {
		width: cssWidth,
		height: cssHeight,
		dpr: dpr,
		chartLeft: chartLeft,
		chartRight: chartRight,
		get chartWidth(): number {
			return Math.max(0, this.chartRight - this.chartLeft);
		},
		dataInsetX: dataInsetX,
		swimlaneTopBufferPx: topBufferPx,
		headerY: headerY,
		headerHeight: headerHeight,
		swimlaneTop: swimlaneTop,
		swimlaneBottom: swimlaneBottom,
		rowHeight: rowHeight,
		virtualSwimlaneHeight: virtualSwimlaneHeight,
		axisStripTop: axisStripTop,
		axisStripBottom: axisStripBottom,
		volumeTop: volumeTop,
		volumeBottom: volumeBottom,
		y2Left: y2Left,
		horizontalScrollbarTop: horizontalScrollbarTop,
	};
}

/**
 * Project a timestamp onto a canvas-local x. Mapped to `[chartLeft + dataInsetX, chartRight -
 * dataInsetX]` rather than the raw chart range so bubble centers (and labels) leave room for
 * outlier bubble radii + hover scale on both edges. Returns NaN when the domain has zero width.
 */
export function tsToX(ts: number, oldest: number, newest: number, lo: TimelineLayout): number {
	const span = newest - oldest;
	if (span <= 0) return Number.NaN;

	const t = (ts - oldest) / span;
	const left = lo.chartLeft + lo.dataInsetX;
	const usable = Math.max(0, lo.chartWidth - 2 * lo.dataInsetX);
	return left + t * usable;
}

/** Inverse of `tsToX` — returns the timestamp at canvas-local x. */
export function xToTs(x: number, oldest: number, newest: number, lo: TimelineLayout): number {
	const span = newest - oldest;
	if (span <= 0) return Number.NaN;

	const usable = Math.max(1, lo.chartWidth - 2 * lo.dataInsetX);
	const t = (x - lo.chartLeft - lo.dataInsetX) / usable;
	return oldest + t * span;
}

/** Y center of `sliceIndex`'s row in virtual swimlane coordinates (before `scrollY` is applied). */
export function sliceVirtualCenterY(sliceIndex: number, lo: TimelineLayout): number {
	return lo.swimlaneTopBufferPx + sliceIndex * lo.rowHeight + lo.rowHeight / 2;
}

/**
 * Hit-test a pointer position against the rendered bubbles. Returns the index of the nearest bubble
 * whose center is within (radius + slop) of the cursor, or undefined.
 *
 * Linear scan over the visible time-range slice — `chooseVisibleRange`'s start/end indices keep this
 * O(visibleN), which is fine at any realistic dataset size. Resist the urge to add a quadtree until
 * profiling proves it's needed.
 */
export function hitTestBubble(
	x: number,
	y: number,
	scrollY: number,
	viewModel: TimelineViewModel,
	zoomOldest: number,
	zoomNewest: number,
	lo: TimelineLayout,
	slop = 4,
): number | undefined {
	if (x < lo.chartLeft || x > lo.chartRight) return undefined;
	if (y < lo.swimlaneTop || y > lo.swimlaneBottom) return undefined;

	const yVirtual = y - lo.swimlaneTop + scrollY;

	let best: number | undefined;
	let bestDistSq = Infinity;

	const radiusCap = clampRadiusToRow(lo.rowHeight);
	// Smaller floor so 1-line commits render visibly tiny — magnifies the variance between the
	// smallest and largest bubbles, which is what gives the chart its "burst" feel.
	const radiusMin = Math.min(1.5, radiusCap);
	const radiusRange = radiusCap - radiusMin;
	// Match the placeholder ring radius in `drawSwimlanes` so the no-changes "Working Tree" marker
	// is hit-testable at its visible size instead of at its near-zero bubbleR.
	const placeholderR = Math.min(8, radiusCap * 0.5);

	const [start, end] = visibleIndexRange(viewModel.timestamps, zoomOldest, zoomNewest);
	for (let i = start; i < end; i++) {
		const ts = viewModel.timestamps[i];
		const cx = tsToX(ts, zoomOldest, zoomNewest, lo);
		if (Number.isNaN(cx) || cx < lo.chartLeft || cx > lo.chartRight) continue;

		const cy = sliceVirtualCenterY(viewModel.sliceIndex[i], lo);
		const dx = x - cx;
		const dy = yVirtual - cy;
		const distSq = dx * dx + dy * dy;
		const isPlaceholder = viewModel.commits[i].sha === '';
		const r = isPlaceholder ? placeholderR + slop : radiusMin + radiusRange * viewModel.bubbleR[i] + slop;

		if (distSq <= r * r && distSq < bestDistSq) {
			best = i;
			bestDistSq = distSq;
		}
	}

	return best;
}

function clampRadiusToRow(rowHeight: number): number {
	// Outlier bubbles only modestly overflow the row boundary — at 0.7×rowHeight, the largest
	// commits extend ~0.2 rowHeight into the adjacent lane (a visible kiss, not a merge). Dense
	// rows still compose via alpha-stack so density reads as density, but adjacent lanes stay
	// distinguishable. Higher caps look "lush" on small datasets but turn into solid colour bands
	// on dense repo-scope views — 0.7 is the sweet spot that holds up across both.
	return Math.max(2, rowHeight * 0.7);
}

/**
 * Returns `[start, end)` indices in `timestamps` for the inclusive timestamp range. Assumes
 * `timestamps` is non-decreasing — built that way by `timelineData.buildViewModel`.
 */
/**
 * Volume-strip hit-test — returns the index of the LARGEST visible commit whose volume bar is
 * within `slop` pixels of the pointer X. "Largest" means biggest additions+deletions; ties go to
 * the closest in X. Used for the linked spotlight (hover dims sibling bubbles, focuses the largest
 * commit's bubble) and for click-to-zoom.
 */
export function hitTestVolumeBar(
	x: number,
	y: number,
	viewModel: TimelineViewModel,
	zoomOldest: number,
	zoomNewest: number,
	lo: TimelineLayout,
	hiddenSlices?: ReadonlySet<number>,
	slop = 3,
): number | undefined {
	if (x < lo.chartLeft || x > lo.chartRight) return undefined;
	if (y < lo.volumeTop || y > lo.volumeBottom) return undefined;

	let best: number | undefined;
	let bestVolume = -1;
	let bestDx = Infinity;

	const [start, end] = visibleIndexRange(viewModel.timestamps, zoomOldest, zoomNewest);
	for (let i = start; i < end; i++) {
		const sliceIdx = viewModel.sliceIndex[i];
		if (hiddenSlices?.has(sliceIdx)) continue;

		const vol = viewModel.additions[i] + viewModel.deletions[i];
		if (vol === 0) continue;

		const cx = tsToX(viewModel.timestamps[i], zoomOldest, zoomNewest, lo);
		if (Number.isNaN(cx) || cx < lo.chartLeft || cx > lo.chartRight) continue;

		const dx = Math.abs(x - cx);
		if (dx > slop) continue;

		// Prefer larger commits when multiple share the column (binning collapses same-time commits
		// across slices into adjacent indices); fall back to closer-X to break ties.
		if (vol > bestVolume || (vol === bestVolume && dx < bestDx)) {
			best = i;
			bestVolume = vol;
			bestDx = dx;
		}
	}
	return best;
}

/**
 * Volume-strip nearest-bar lookup — returns the index of the closest visible commit's volume bar
 * to the pointer X, regardless of distance. Used for the scrub spotlight: while the pointer is
 * anywhere inside the volume strip, the focus stays locked onto a bar so the dim/spotlight doesn't
 * flash off when the cursor passes through gaps between bars. Closest by X wins; ties go to the
 * larger commit so the spotlight prefers the more salient bubble.
 */
export function findNearestVolumeBar(
	x: number,
	y: number,
	viewModel: TimelineViewModel,
	zoomOldest: number,
	zoomNewest: number,
	lo: TimelineLayout,
	hiddenSlices?: ReadonlySet<number>,
): number | undefined {
	if (x < lo.chartLeft || x > lo.chartRight) return undefined;
	if (y < lo.volumeTop || y > lo.volumeBottom) return undefined;

	let best: number | undefined;
	let bestDx = Infinity;
	let bestVolume = -1;

	const [start, end] = visibleIndexRange(viewModel.timestamps, zoomOldest, zoomNewest);
	for (let i = start; i < end; i++) {
		const sliceIdx = viewModel.sliceIndex[i];
		if (hiddenSlices?.has(sliceIdx)) continue;

		const vol = viewModel.additions[i] + viewModel.deletions[i];
		if (vol === 0) continue;

		const cx = tsToX(viewModel.timestamps[i], zoomOldest, zoomNewest, lo);
		if (Number.isNaN(cx) || cx < lo.chartLeft || cx > lo.chartRight) continue;

		const dx = Math.abs(x - cx);
		if (dx < bestDx || (dx === bestDx && vol > bestVolume)) {
			best = i;
			bestDx = dx;
			bestVolume = vol;
		}
	}
	return best;
}

export function visibleIndexRange(timestamps: Float64Array, oldest: number, newest: number): readonly [number, number] {
	if (timestamps.length === 0) return [0, 0];

	const start = lowerBound(timestamps, oldest);
	const end = upperBound(timestamps, newest);
	return [start, end];
}

function lowerBound(arr: Float64Array, target: number): number {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (arr[mid] < target) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

function upperBound(arr: Float64Array, target: number): number {
	let lo = 0;
	let hi = arr.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (arr[mid] <= target) {
			lo = mid + 1;
		} else {
			hi = mid;
		}
	}
	return lo;
}

/**
 * Vertical-scrollbar hit-test for the swimlane region. Returns the kind of target at the given
 * canvas-local point, or undefined if the point is outside the scrollbar. The track always sits at
 * the right edge of the swimlane region; the thumb represents the visible window of `scrollY`
 * inside the virtual height.
 */
export function hitTestVerticalScrollbar(
	x: number,
	y: number,
	scrollY: number,
	lo: TimelineLayout,
): { kind: 'thumb'; thumbY1: number; thumbY2: number } | { kind: 'track'; side: 'up' | 'down' } | undefined {
	if (lo.virtualSwimlaneHeight <= lo.swimlaneBottom - lo.swimlaneTop) return undefined;
	if (x < lo.width - verticalScrollbarWidthPx || x > lo.width) return undefined;
	if (y < lo.swimlaneTop || y > lo.swimlaneBottom) return undefined;

	const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
	const ratio = visibleH / lo.virtualSwimlaneHeight;
	const thumbH = Math.max(20, visibleH * ratio);
	const thumbY1 = lo.swimlaneTop + (scrollY / lo.virtualSwimlaneHeight) * visibleH;
	const thumbY2 = thumbY1 + thumbH;

	if (y >= thumbY1 && y <= thumbY2) return { kind: 'thumb', thumbY1: thumbY1, thumbY2: thumbY2 };
	return { kind: 'track', side: y < thumbY1 ? 'up' : 'down' };
}

/** Convert a vertical-scrollbar drag delta (canvas pixels) to a delta in `scrollY` (virtual pixels). */
export function verticalScrollbarDeltaToScrollY(deltaY: number, lo: TimelineLayout): number {
	const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
	if (visibleH <= 0) return 0;
	return deltaY * (lo.virtualSwimlaneHeight / visibleH);
}

/**
 * Picks a "nice" tick step (in milliseconds) for an axis spanning `domainMs` over `chartWidthPx`,
 * targeting roughly one label every `targetSpacingPx` pixels. Snaps to common calendar units (day,
 * week, month, year) so labels don't fall on awkward intermediate timestamps.
 */
export type AxisTickStep = { stepMs: number; unit: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' };

export function pickAxisTickStep(domainMs: number, chartWidthPx: number, targetSpacingPx = 80): AxisTickStep {
	if (chartWidthPx <= 0 || domainMs <= 0) return { stepMs: dayMs, unit: 'day' };

	const targetTickCount = Math.max(2, Math.floor(chartWidthPx / targetSpacingPx));
	const ideal = domainMs / targetTickCount;

	const quarterMs = 3 * monthMs;
	if (ideal <= 6 * hourMs) return { stepMs: hourMs, unit: 'hour' };
	if (ideal <= 1.5 * dayMs) return { stepMs: dayMs, unit: 'day' };
	if (ideal <= 10 * dayMs) return { stepMs: weekMs, unit: 'week' };
	if (ideal <= 45 * dayMs) return { stepMs: monthMs, unit: 'month' };
	// Prefer quarters before jumping to years — gives a useful "Q1 2026 / Q2 2026 / …" cadence on
	// 1–3 year ranges instead of skipping straight to whole years and losing intra-year structure.
	if (ideal <= 200 * dayMs) return { stepMs: quarterMs, unit: 'quarter' };
	return { stepMs: yearMs, unit: 'year' };
}

export type AxisTickUnit = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface AxisTickFormatter {
	(date: Date, unit: AxisTickUnit, opts: { showYear: boolean }): string;
}

export interface AxisTick {
	timestamp: number;
	x: number;
	label: string;
	unit: AxisTickUnit;
}

/**
 * Iterates "nice" axis tick timestamps inside `[oldest, newest]`. Snaps each tick to the start of
 * its calendar unit (e.g. midnight for `'day'`, 1st-of-month for `'month'`) so labels read naturally.
 */
export function* iterateAxisTicks(
	oldest: number,
	newest: number,
	step: { stepMs: number; unit: AxisTickUnit },
): Generator<number> {
	if (newest <= oldest) return;

	let cursor: number;
	const startDate = new Date(oldest);
	switch (step.unit) {
		case 'hour':
			cursor = new Date(
				startDate.getFullYear(),
				startDate.getMonth(),
				startDate.getDate(),
				startDate.getHours(),
			).getTime();
			break;
		case 'day':
			cursor = new Date(startDate).setHours(0, 0, 0, 0);
			break;
		case 'week': {
			const d = new Date(startDate);
			d.setHours(0, 0, 0, 0);
			const dow = (d.getDay() + 6) % 7;
			d.setDate(d.getDate() - dow);
			cursor = d.getTime();
			break;
		}
		case 'month':
			cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1).getTime();
			break;
		case 'quarter': {
			// Snap back to the start of the containing calendar quarter (Jan, Apr, Jul, Oct).
			const qStartMonth = Math.floor(startDate.getMonth() / 3) * 3;
			cursor = new Date(startDate.getFullYear(), qStartMonth, 1).getTime();
			break;
		}
		case 'year':
			cursor = new Date(startDate.getFullYear(), 0, 1).getTime();
			break;
	}

	// Always emit the leftmost edge as a tick — without it, a chart whose first calendar
	// boundary lands well into the visible range starts unlabelled, leaving the user no
	// reference for "where does this timeline begin?". Done before advancing the cursor so
	// it doesn't double-emit when the range happens to start on a boundary.
	let emittedLeftEdge = false;
	if (cursor > oldest) {
		yield oldest;

		emittedLeftEdge = true;
	}

	while (cursor <= newest) {
		// Skip if we already emitted the left edge AND this tick is essentially the same value
		// (e.g. range starts exactly on a boundary, in which case `cursor === oldest`).
		if (!(emittedLeftEdge && Math.abs(cursor - oldest) < 1)) {
			yield cursor;
		}

		emittedLeftEdge = false;
		// For calendar-aligned units, advance by calendar months rather than fixed ms to stay
		// aligned across DST shifts and 28/30/31-day months.
		if (step.unit === 'month' || step.unit === 'quarter' || step.unit === 'year') {
			const d = new Date(cursor);
			const months = step.unit === 'month' ? 1 : step.unit === 'quarter' ? 3 : 12;
			d.setMonth(d.getMonth() + months);
			cursor = d.getTime();
		} else {
			cursor += step.stepMs;
		}
	}
}

export function getAxisTicks(
	lo: TimelineLayout,
	oldest: number,
	newest: number,
	formatTick: AxisTickFormatter,
	measureLabelWidth: (label: string) => number,
): AxisTick[] {
	if (newest <= oldest) return [];

	const buildTicksForStep = (step: AxisTickStep): AxisTick[] => {
		const ticks: AxisTick[] = [];
		let lastRightEdgeX = -Infinity;
		let lastYear: number | undefined;
		let isFirstLabel = true;

		for (const t of iterateAxisTicks(oldest, newest, step)) {
			const x = tsToX(t, oldest, newest, lo);
			if (Number.isNaN(x) || x < lo.chartLeft || x > lo.chartRight) continue;

			const date = new Date(t);
			const year = date.getFullYear();
			const showYear = isFirstLabel || year !== lastYear;
			const label = formatTick(date, step.unit, { showYear: showYear });
			const labelW = measureLabelWidth(label);
			const leftEdgeX = x - labelW / 2;
			const rightEdgeX = x + labelW / 2;

			if (leftEdgeX < lastRightEdgeX + 6) continue;

			lastRightEdgeX = rightEdgeX;
			lastYear = year;
			isFirstLabel = false;

			// Round `x` for the DOM axis-overlay to consume — browsers position elements at
			// fractional `left:` differently from how canvas antialiases at the same float, so
			// the unrounded value can leave a tick label 0.5-1px off from the bubble underneath
			// it. Bubbles keep their fractional `cx` for accurate timestamp positioning; only
			// the tick label snaps to the nearest pixel.
			ticks.push({ timestamp: t, x: Math.round(x), label: label, unit: step.unit });
		}

		return ticks;
	};

	// Step demotion ladder. `pickAxisTickStep` optimizes label density for typical-size datasets,
	// but on narrow time bands (e.g. a 3-day file history rendered on a sidebar) the picked step
	// can be coarser than the visible range — `iterateAxisTicks` snaps to the next boundary
	// (e.g. start-of-week) which falls outside `[oldest, newest]`, leaving the chart with zero
	// ticks. When that happens, demote one step at a time until at least two ticks survive.
	const ladder: AxisTickStep[] = [
		pickAxisTickStep(newest - oldest, lo.chartWidth),
		{ stepMs: weekMs, unit: 'week' },
		{ stepMs: dayMs, unit: 'day' },
		{ stepMs: hourMs, unit: 'hour' },
	];
	let ticks: AxisTick[] = [];
	for (const step of ladder) {
		ticks = buildTicksForStep(step);
		if (ticks.length >= 2) break;
	}
	return ticks;
}

/**
 * Static-layer painter for the (now-minimal) top strip. Just paints the background — X-axis labels
 * are rendered as DOM by the host. Kept as a separate function so the `header / swimlane / volume`
 * clip-and-cache layering is preserved and there's a hook for future header-region content.
 */
export function drawHeader(
	ctx: CanvasRenderingContext2D,
	state: TimelineDrawState,
	_formatTick: AxisTickFormatter,
): void {
	const { layout: lo, theme } = state;
	ctx.fillStyle = theme.background;
	ctx.fillRect(0, 0, lo.width, lo.headerHeight);
}

/**
 * Picks tick stops that distribute evenly on the SQRT scale used by the volume bars — without
 * sqrt-aware spacing, linear ticks cluster in the upper third of the strip and leave the small-
 * value half label-less. Targets fractional bar heights at `i/count` and snaps each to a nice
 * 1/2/5×10ⁿ value, deduped and capped at `yMax`.
 */
export function pickY2TickStops(yMax: number, count: number): number[] {
	if (yMax <= 0 || count <= 0) return [];

	const seen = new Set<number>();
	const stops: number[] = [];
	for (let i = 1; i <= count; i++) {
		const t = i / count;
		const target = Math.min(yMax, t * t * yMax);
		const snapped = Math.min(yMax, niceRound(target));
		if (snapped > 0 && !seen.has(snapped)) {
			seen.add(snapped);
			stops.push(snapped);
		}
	}
	return stops;
}

function niceRound(value: number): number {
	if (value <= 0) return 0;

	const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
	const norm = value / magnitude;
	const niceMantissa = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
	return niceMantissa * magnitude;
}

export function formatY2(value: number): string {
	// Whitespace between the magnitude and the unit reads cleaner at the small font size we draw
	// these in — and matches how the rest of the GitLens UI surfaces "12 K" style numbers.
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} M`;
	if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} K`;
	return String(Math.round(value));
}

/**
 * Static-layer painter for the swimlane region. Drawn at full virtual height so the host can blit
 * a vertically-scrolled window of it without re-rasterizing on every scroll tick. Includes:
 * - Zebra row backgrounds (V5)
 * - Per-row Y-axis labels in the gutter
 * - Per-row category-color bubbles (one fillRect per timestamp grid line + arc per bubble)
 * - Optional bin-count badges when the view model is binned (V3)
 */
export function drawSwimlanes(ctx: CanvasRenderingContext2D, state: TimelineDrawState): void {
	const { viewModel, layout: lo, theme, zoomRange, scrollY, hiddenSlices, hoverSliceIndex } = state;
	const oldest = zoomRange?.oldest ?? viewModel.oldest;
	const newest = zoomRange?.newest ?? viewModel.newest;
	const palette = theme.slicePalette;

	const totalH = Math.max(lo.virtualSwimlaneHeight, 1);

	// Background — fill the full virtual height so the blit doesn't reveal previous content.
	ctx.fillStyle = theme.background;
	ctx.fillRect(0, 0, lo.width, totalH);

	// Lane center line — a faint horizontal rule per row at the y-center. Starts just past the
	// avatar rail's right edge (with a small gap) so a hidden/disabled avatar's strikethrough
	// doesn't get visually doubled by the lane line carrying through the avatar.
	if (theme.gridLine) {
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, scrollY, lo.width, lo.swimlaneBottom - lo.swimlaneTop);
		ctx.clip();

		ctx.fillStyle = theme.gridLine;
		ctx.globalAlpha = 0.35;
		const lineLeft = lo.chartLeft;
		const lineWidth = Math.max(0, lo.chartRight - lineLeft);
		for (let i = 0; i < viewModel.slices.length; i++) {
			const y = Math.round(sliceVirtualCenterY(i, lo));
			ctx.fillRect(lineLeft, y, lineWidth, 1);
		}
		ctx.globalAlpha = 1;
		ctx.restore();
	}

	// Y-axis labels are rendered by the host as DOM (avatars + names + color chips + hover behavior).
	// Drawing them on canvas was always going to lose to DOM at text shaping, ellipsis, and
	// interactivity, and the host-DOM labels can react to hover by dimming sibling rows. The static
	// canvas layer just paints the bubbles; the gutter is filled by the host's overlay.

	if (newest <= oldest || viewModel.commits.length === 0) return;

	// Project the normalized 0..1 magnitudes stored in `bubbleR` to actual pixel radii bound by
	// the row height (V1) — taller rows get larger bubbles, shorter rows get smaller, so size always
	// reads relative to the row it sits in.
	const radiusCap = clampRadiusToRow(lo.rowHeight);
	// Smaller floor so 1-line commits render visibly tiny — magnifies the variance between the
	// smallest and largest bubbles, which is what gives the chart its "burst" feel.
	const radiusMin = Math.min(1.5, radiusCap);
	const radiusRange = radiusCap - radiusMin;

	// Single translucent fill pass — overlapping bubbles compose into deeper colors so density reads
	// as density, isolated bubbles still get clean antialiased edges from canvas's native arc render.
	// Resist the temptation to add a per-bubble outline stroke: in dense rows, neighbouring outlines
	// turn into a noisy striped pattern that obscures the very signal the alpha-stack is conveying.
	const [start, end] = visibleIndexRange(viewModel.timestamps, oldest, newest);

	// Per-bubble alpha: when a slice is pinned (avatar/legend hover), bubbles in OTHER slices fade
	// to a quarter of their normal alpha. This naturally follows each bubble's shape — outliers
	// overflowing their row dim correctly without the per-row fillRect masks that used to look
	// like clipped horizontal lanes.
	const dimmedAlpha = bubbleFillAlpha * 0.18;
	const hasSliceHover = hoverSliceIndex != null;
	// When nothing is pinned, every bubble draws at the same alpha — set it once before the loop
	// instead of writing canvas state per bubble (≥10k bubbles × 2 writes/iter on dense charts).
	if (!hasSliceHover) {
		ctx.globalAlpha = bubbleFillAlpha;
	}
	// Fixed radius for the "Working Tree, no changes" placeholder — sized to read as a distinct
	// marker but small enough not to compete with real outlier bubbles. Tied to the row height so
	// short rows don't render an oversized empty ring.
	const placeholderR = Math.min(8, radiusCap * 0.5);

	for (let i = start; i < end; i++) {
		const sliceIdx = viewModel.sliceIndex[i];
		if (hiddenSlices?.has(sliceIdx)) continue;

		const cx = tsToX(viewModel.timestamps[i], oldest, newest, lo);
		if (Number.isNaN(cx) || cx < lo.chartLeft || cx > lo.chartRight) continue;

		const cy = sliceVirtualCenterY(sliceIdx, lo);
		const color = palette[viewModel.slices[sliceIdx].colorIndex % palette.length];

		// "Working Tree, no changes" placeholder — sha is empty (the marker the host uses when
		// `getPseudoCommitsWithStats` returns nothing). Draw as a hollow ring at a fixed visible
		// size so the slider's right-edge selection has a real target instead of resolving to a
		// near-zero filled dot. The ring visually communicates "no changes here" rather than
		// disguising itself as a tiny real commit.
		if (viewModel.commits[i].sha === '') {
			if (hasSliceHover) {
				ctx.globalAlpha = hoverSliceIndex === sliceIdx ? 1 : dimmedAlpha / bubbleFillAlpha;
			} else {
				ctx.globalAlpha = 1;
			}
			ctx.strokeStyle = color;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.arc(cx, cy, placeholderR, 0, Math.PI * 2);
			ctx.stroke();
			if (!hasSliceHover) {
				ctx.globalAlpha = bubbleFillAlpha;
			}
			continue;
		}

		const r = radiusMin + radiusRange * viewModel.bubbleR[i];
		if (r <= 0) continue;

		if (hasSliceHover) {
			ctx.globalAlpha = hoverSliceIndex === sliceIdx ? bubbleFillAlpha : dimmedAlpha;
		}
		ctx.fillStyle = color;
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalAlpha = 1;
}

/**
 * Square-root mapping from a (lines-changed) value to its bar height in pixels. Used by both the
 * volume bars and the Y2 axis ticks so they stay aligned. Sqrt is gentle enough that order is
 * preserved at a glance, but compresses outliers enough that a small commit isn't reduced to a
 * sub-pixel sliver next to a refactor commit. Returns 0..usableH.
 */
export function volumeBarHeight(value: number, yMax: number, usableH: number): number {
	if (value <= 0 || yMax <= 0 || usableH <= 0) return 0;
	return Math.sqrt(Math.min(1, value / yMax)) * usableH;
}

/**
 * Static-layer painter for the sticky bottom volume strip. Bars rise upward from the X-axis line
 * (which sits just above the volume strip), so the volume reads as the lower half of a shared
 * chart rather than as a disconnected panel. Stacks additions on top of deletions per column.
 */
export function drawVolume(ctx: CanvasRenderingContext2D, state: TimelineDrawState): void {
	const { viewModel, layout: lo, theme, zoomRange, hiddenSlices, hoverSliceIndex, hoverVolumeIndex } = state;
	const h = lo.volumeBottom - lo.volumeTop;
	if (h <= 0) return;

	ctx.fillStyle = theme.background;
	ctx.fillRect(0, lo.volumeTop, lo.width, h);

	const oldest = zoomRange?.oldest ?? viewModel.oldest;
	const newest = zoomRange?.newest ?? viewModel.newest;
	const yMax = Math.max(1, viewModel.yMaxAdd + viewModel.yMaxDel);

	// Bars grow UPWARD from the bottom of the volume strip — matches the conventional histogram
	// orientation (taller = bigger). Heavy commits' bars rise toward the X-axis (where the
	// bubbles live above), giving the most-salient values visual proximity to the time/contributor
	// region; light commits stay short near the bottom and don't compete for attention.
	const baselineY = lo.volumeBottom;

	if (newest <= oldest || viewModel.commits.length === 0) return;

	const [start, end] = visibleIndexRange(viewModel.timestamps, oldest, newest);
	const usableH = Math.max(0, h - 2);

	// When the user is hovering a volume bar, anchor the spotlight on its X so that bars sharing
	// the same pixel column light up too (binning collapses same-time commits across slices into
	// adjacent indices, but each slice keeps its own bar — they all read as one stack to the user).
	let hoverX: number | undefined;
	if (hoverVolumeIndex != null) {
		hoverX = tsToX(viewModel.timestamps[hoverVolumeIndex], oldest, newest, lo);
		if (Number.isNaN(hoverX)) {
			hoverX = undefined;
		}
	}

	for (let i = start; i < end; i++) {
		const sliceIdx = viewModel.sliceIndex[i];
		if (hiddenSlices?.has(sliceIdx)) continue;

		const x = tsToX(viewModel.timestamps[i], oldest, newest, lo);
		if (Number.isNaN(x) || x < lo.chartLeft || x > lo.chartRight) continue;

		const a = viewModel.additions[i];
		const d = viewModel.deletions[i];
		if (a === 0 && d === 0) continue;

		const isVolumeFocus = hoverX != null && Math.abs(x - hoverX) <= 1.5;

		// When a slice is pinned via hover, dim every non-matching bar so the user can see the
		// pinned slice's footprint in time across the volume strip. Volume hover spotlight wins
		// over slice hover — that's the linked-interaction behavior asking for full focus on the
		// hovered moment, not the pinned contributor.
		if (hoverVolumeIndex != null) {
			ctx.globalAlpha = isVolumeFocus ? 1 : 0.15;
		} else {
			ctx.globalAlpha = hoverSliceIndex != null && hoverSliceIndex !== sliceIdx ? 0.2 : 1;
		}

		// Square-root scale on the COMBINED volume so a 1-line typo fix is still a visible pixel
		// when the same view holds a 5000-line refactor. Small commits read at ≈sqrt(v/vMax) instead
		// of v/vMax — 50 lines vs a 5000-line max goes from 1% to ~10% of strip height. Splitting
		// the resulting height by the additions/deletions ratio keeps the stack truthful (taller =
		// more total lines) without giving sub-pixel bars to small commits.
		const total = a + d;
		const totalH = volumeBarHeight(total, yMax, usableH);
		const aH = total > 0 ? totalH * (a / total) : 0;
		const dH = totalH - aH;
		const px = Math.round(x) - 1;
		const barWidth = isVolumeFocus ? 4 : 2;
		const barX = isVolumeFocus ? px - 1 : px;

		// Stack additions then deletions, both growing UPWARD from the shared bottom baseline.
		// Additions sit at the bottom (foundation), deletions stack on top — preserves the
		// "additions touch the baseline" relationship from the previous downward layout.
		if (aH > 0) {
			ctx.fillStyle = theme.additions;
			ctx.fillRect(barX, baselineY - aH, barWidth, aH);
		}
		if (dH > 0) {
			ctx.fillStyle = theme.deletions;
			ctx.fillRect(barX, baselineY - aH - dH, barWidth, dH);
		}
	}
	ctx.globalAlpha = 1;
}

/**
 * Overlay-layer painter — drawn fresh on every rAF, on top of the static layers blitted from their
 * off-screen caches. Cheap by design (no axis labels, no bubble redraws); the host can repaint this
 * per pointer move without touching the static caches.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, state: TimelineDrawState): void {
	const {
		viewModel,
		layout: lo,
		theme,
		zoomRange,
		hoverIndex,
		hoverIntensity,
		outgoingHoverIndex,
		outgoingHoverIntensity,
		hoverSliceIndex,
		hoverVolumeIndex,
		selectedSha,
		brushRange,
		scrollY,
	} = state;
	const oldest = zoomRange?.oldest ?? viewModel.oldest;
	const newest = zoomRange?.newest ?? viewModel.newest;

	// (The rail and X-axis label "frosted glass" are DOM overlays in the host template — they
	// use CSS `backdrop-filter` to blur the canvas pixels behind them. Keeping the canvas itself
	// untouched means hover halos and bubble edges that bleed into those columns remain crisp on
	// the canvas and get blurred only as they show through the DOM bars.)

	// Volume-bar spotlight — when the user is hovering the volume strip, mask everything in the
	// swimlane EXCEPT a narrow column at the hovered timestamp. Reveals which contributors landed
	// commits at that exact moment while keeping the rest of the chart visible as faint context.
	// Wins over slice hover (when both are pinned) so the linked-interaction reads as one cohesive
	// "moment-in-time" focus rather than two competing dims fighting for visual priority.
	let volumeHoverX: number | undefined;
	if (hoverVolumeIndex != null && viewModel.commits.length > 0) {
		const ts = viewModel.timestamps[hoverVolumeIndex];
		const x = tsToX(ts, oldest, newest, lo);
		if (!Number.isNaN(x) && x >= lo.chartLeft && x <= lo.chartRight) {
			volumeHoverX = x;
			const radiusCap = clampRadiusToRow(lo.rowHeight);
			const halfWidth = radiusCap + 6;
			const left = Math.max(lo.chartLeft, x - halfWidth);
			const right = Math.min(lo.chartRight, x + halfWidth);

			ctx.fillStyle = theme.background;
			ctx.globalAlpha = 0.85;
			// Mask extends down through the X-axis label strip to the X-axis line (volumeTop)
			// so the focused column reads as one continuous spotlight from the top of the
			// swimlane through the axis line — otherwise the X-axis line/labels stay at full
			// brightness and visually compete with the focused column above. The volume bars
			// below the line are left untouched (they have their own per-slice dim).
			if (left > 0) {
				ctx.fillRect(0, 0, left, lo.volumeTop);
			}
			if (right < lo.width) {
				ctx.fillRect(right, 0, lo.width - right, lo.volumeTop);
			}
			ctx.globalAlpha = 1;
		}
	}

	// (Per-row dim mask removed — the dim is now applied per-bubble inside `drawSwimlanes` via
	// `state.hoverSliceIndex`, so outlier bubbles overflowing their row don't show as "lanes
	// that get clipped" the way the old fillRect approach did.)

	// Bubble-hover sibling dim — translucent overlay while a bubble's hover tween is in flight.
	// Spans from canvas y=0 (matching the host's swimlane clip extent) down to the X-axis line
	// (volumeTop) so the X-axis line/labels dim alongside the swimlane — otherwise the bottom
	// strip stays at full strength and visually competes with the focused bubble above it. The
	// volume bars below the axis line are left at full strength.
	const dimIntensity = (hoverIntensity ?? 0) + (outgoingHoverIntensity ?? 0) * 0.6;
	if (dimIntensity > 0.01 && hoverSliceIndex == null) {
		ctx.fillStyle = theme.background;
		ctx.globalAlpha = Math.min(0.45, 0.45 * dimIntensity);
		ctx.fillRect(0, 0, lo.width, lo.volumeTop);
		ctx.globalAlpha = 1;
	}

	// Slice-hover dim band over the X-axis label strip. The swimlane area itself dims per-bubble
	// inside `drawSwimlanes` (so the focused row's bubbles stay crisp at full alpha), but the
	// X-axis line/labels don't have a per-slice alpha hook — without this band they stay at full
	// strength and visually compete with the focused row above. Spans from `swimlaneBottom`
	// (= top of axis label strip) down to `volumeTop` (= X-axis line). The volume bars below
	// the axis line have their own per-slice dim and are left untouched.
	if (hoverSliceIndex != null) {
		ctx.fillStyle = theme.background;
		ctx.globalAlpha = 0.45;
		ctx.fillRect(0, lo.swimlaneBottom, lo.width, lo.volumeTop - lo.swimlaneBottom);
		ctx.globalAlpha = 1;
	}

	// (Lollipop stems on slice hover removed — they read as visual noise on top of the slice
	// dim, and the dim itself is enough to communicate "this is the focused slice".)

	// Hover focus line spans header → swimlane → volume so the cursor's X reads as a global focus.
	// Brightens with the hover-in tween so the line fades in alongside the bubble pop rather than
	// snapping to full opacity instantly.
	if (hoverIndex != null && hoverIndex >= 0 && hoverIndex < viewModel.timestamps.length) {
		const ts = viewModel.timestamps[hoverIndex];
		const x = tsToX(ts, oldest, newest, lo);
		if (!Number.isNaN(x) && x >= lo.chartLeft && x <= lo.chartRight) {
			drawFocusLine(ctx, x, lo.headerY, lo.volumeBottom, theme.gridLine, 0.3 + 0.4 * (hoverIntensity ?? 1));
		}
	}

	// Volume-hover focus line — connects the hovered bar to the spotlit bubbles above so the
	// linkage reads as one motion rather than two unrelated highlights. Slightly brighter than the
	// bubble-hover line so it competes with the spotlight mask without disappearing into it.
	if (volumeHoverX != null) {
		drawFocusLine(ctx, volumeHoverX, lo.swimlaneTop, lo.volumeBottom, theme.gridLine, 0.55);
	}

	// Outgoing hover bubble — the previous one is still fading out as the new one fades in. Drawn
	// before the new one so the new bubble pops "on top" of the leaving one in directly-adjacent
	// hover transitions.
	if (outgoingHoverIndex != null && outgoingHoverIndex !== hoverIndex && (outgoingHoverIntensity ?? 0) > 0.01) {
		drawHoverHighlight(
			ctx,
			viewModel,
			outgoingHoverIndex,
			oldest,
			newest,
			scrollY,
			lo,
			theme,
			outgoingHoverIntensity ?? 0,
		);
	}

	// Selected-sha persistent halo — drawn under the hover so a hovered-and-selected bubble shows
	// the hover effect on top and the selection ring still reads in the periphery.
	if (selectedSha != null) {
		const idx = viewModel.shaToIndex.get(selectedSha);
		if (idx != null && idx !== hoverIndex) {
			drawSelectedHighlight(ctx, viewModel, idx, oldest, newest, scrollY, lo, theme);
		}
	}

	// Incoming hover highlight — the cool one. Scales up, brightens to full opacity, paints a
	// radial halo, and lays down a crisp double-ring so it pops above the static layer regardless
	// of which color the bubble is.
	if (hoverIndex != null) {
		drawHoverHighlight(ctx, viewModel, hoverIndex, oldest, newest, scrollY, lo, theme, hoverIntensity ?? 1);
	}

	// In-progress brush rectangle (X-axis zoom selection).
	if (brushRange != null && theme.gridLine) {
		const bx1 = Math.round(Math.max(lo.chartLeft, Math.min(brushRange.startX, brushRange.endX)));
		const bx2 = Math.round(Math.min(lo.chartRight, Math.max(brushRange.startX, brushRange.endX)));
		const w = bx2 - bx1;
		if (w > 0) {
			ctx.fillStyle = theme.gridLine;
			ctx.globalAlpha = brushFillOpacity;
			ctx.fillRect(bx1, lo.swimlaneTop, w, lo.swimlaneBottom - lo.swimlaneTop);
			ctx.globalAlpha = 1;
			if (w >= brushEdgeWidthPx * 2) {
				ctx.fillRect(bx1, lo.swimlaneTop, brushEdgeWidthPx, lo.swimlaneBottom - lo.swimlaneTop);
				ctx.fillRect(
					bx2 - brushEdgeWidthPx,
					lo.swimlaneTop,
					brushEdgeWidthPx,
					lo.swimlaneBottom - lo.swimlaneTop,
				);
			}
		}
	}

	// Vertical scrollbar overlay (V8). Only drawn when the swimlane content overflows the visible region.
	drawVerticalScrollbar(ctx, lo, scrollY, theme);

	// Directional "more history" chevrons on the X-axis edges (V8). Drawn inside the dataInsetX
	// gutter on each side so they live in the empty space between chartLeft/chartRight and the
	// outermost tick label — no overlap with axis text.
	drawAxisChevrons(ctx, state);
}

/** Visual-only indicators on the X-axis edges signaling "more history exists in this direction".
 *  Drawn into the axis-label strip's vertical center, anchored inside the dataInsetX gutter on
 *  each side so they never overlap tick labels. The chart's `_hasHistoryBefore`/`_hasHistoryAfter`
 *  getters decide visibility; this just paints when the host says to. */
function drawAxisChevrons(ctx: CanvasRenderingContext2D, state: TimelineDrawState): void {
	const { layout: lo, theme, historyBefore, historyAfter } = state;
	if (!historyBefore && !historyAfter) return;

	const stripHeight = lo.axisStripBottom - lo.axisStripTop;
	if (stripHeight <= 0) return;

	const cy = (lo.axisStripTop + lo.axisStripBottom) / 2;
	// Chevron size scales with the axis strip height so it stays readable across compact and full
	// layouts. Capped so the chevron stays inside the gutter (dataInsetX is typically 8-14px).
	const half = Math.max(3, Math.min(5, Math.floor(stripHeight / 4)));
	// Center the chevron horizontally within the dataInsetX gutter on each side, so the tick at
	// `oldest`/`newest` (drawn at chartLeft + dataInsetX / chartRight - dataInsetX) has room to
	// the right/left of the chevron without overlap.
	const insetMid = Math.max(half + 2, Math.round(lo.dataInsetX / 2));

	ctx.save();
	ctx.strokeStyle = theme.axisLabelMuted;
	ctx.lineWidth = 1.5;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	if (historyBefore) {
		const x = lo.chartLeft + insetMid;
		ctx.beginPath();
		ctx.moveTo(x + half * 0.6, cy - half);
		ctx.lineTo(x - half * 0.6, cy);
		ctx.lineTo(x + half * 0.6, cy + half);
		ctx.stroke();
	}
	if (historyAfter) {
		const x = lo.chartRight - insetMid;
		ctx.beginPath();
		ctx.moveTo(x - half * 0.6, cy - half);
		ctx.lineTo(x + half * 0.6, cy);
		ctx.lineTo(x - half * 0.6, cy + half);
		ctx.stroke();
	}
	ctx.restore();
}

export interface HorizontalScrollbarGeometry {
	trackX: number;
	trackY: number;
	trackWidth: number;
	trackHeight: number;
	thumbX: number;
	thumbWidth: number;
}

export function getHorizontalScrollbarGeometry(
	lo: TimelineLayout,
	fullOldest: number,
	fullNewest: number,
	zoomRange: { oldest: number; newest: number },
): HorizontalScrollbarGeometry | undefined {
	const fullSpan = fullNewest - fullOldest;
	if (lo.horizontalScrollbarTop >= lo.height || fullSpan <= 0) return undefined;

	// Spans (almost) the full X-axis label band — 2px inset top and bottom so the track has
	// a hairline of breathing room from the strip's edges instead of butting flush against the
	// swimlane above and the X-axis line below. The labels remain visible through the
	// translucent track and the scrollbar reads as a clear "scroll lane".
	const stripHeight = lo.axisStripBottom - lo.axisStripTop;
	const inset = stripHeight >= horizontalScrollbarHeightPx + 4 ? 2 : 0;
	const trackHeight = Math.max(horizontalScrollbarHeightPx, stripHeight - inset * 2);
	const trackTop = lo.horizontalScrollbarTop + inset;
	const trackLeft = lo.chartLeft;
	const trackRight = lo.chartRight;
	const trackWidth = trackRight - trackLeft;
	if (trackWidth <= 0) return undefined;

	// Thumb at the zoom window's projected position, with a min-width so it stays grabbable.
	const thumbStart = trackLeft + ((zoomRange.oldest - fullOldest) / fullSpan) * trackWidth;
	const thumbEnd = trackLeft + ((zoomRange.newest - fullOldest) / fullSpan) * trackWidth;
	const thumbX = Math.max(trackLeft, Math.min(trackRight - 24, thumbStart));
	const thumbW = Math.max(24, Math.min(trackRight - thumbX, thumbEnd - thumbStart));

	return {
		trackX: trackLeft,
		trackY: trackTop,
		trackWidth: trackWidth,
		trackHeight: trackHeight,
		thumbX: thumbX,
		thumbWidth: thumbW,
	};
}

/**
 * Hit-test the horizontal scrollbar (item 10). Returns `'thumb'` when the pointer is over the
 * draggable thumb, `'track'` when over the track background (click → page jump), or undefined.
 */
export function hitTestHorizontalScrollbar(
	x: number,
	y: number,
	lo: TimelineLayout,
	zoomRange: { oldest: number; newest: number },
	fullOldest: number,
	fullNewest: number,
): { kind: 'thumb'; thumbX: number; thumbW: number } | { kind: 'track'; side: 'before' | 'after' } | undefined {
	const scrollbar = getHorizontalScrollbarGeometry(lo, fullOldest, fullNewest, zoomRange);
	if (scrollbar == null) return undefined;

	const trackBottom = scrollbar.trackY + scrollbar.trackHeight;
	if (y < scrollbar.trackY || y > trackBottom) return undefined;
	if (x < scrollbar.trackX || x > scrollbar.trackX + scrollbar.trackWidth) return undefined;

	if (x >= scrollbar.thumbX && x <= scrollbar.thumbX + scrollbar.thumbWidth) {
		return { kind: 'thumb', thumbX: scrollbar.thumbX, thumbW: scrollbar.thumbWidth };
	}
	return { kind: 'track', side: x < scrollbar.thumbX ? 'before' : 'after' };
}

/** Convert a horizontal-scrollbar drag delta (canvas pixels) to a delta in zoom-range timestamps. */
export function horizontalScrollbarDeltaToTimestampShift(
	deltaX: number,
	lo: TimelineLayout,
	fullOldest: number,
	fullNewest: number,
): number {
	const trackWidth = lo.chartRight - lo.chartLeft;
	if (trackWidth <= 0) return 0;
	return (deltaX / trackWidth) * (fullNewest - fullOldest);
}

function drawFocusLine(
	ctx: CanvasRenderingContext2D,
	x: number,
	yTop: number,
	yBottom: number,
	color: string,
	alpha: number,
): void {
	const px = Math.round(x) + 0.5;
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.moveTo(px, yTop);
	ctx.lineTo(px, yBottom);
	ctx.stroke();
	ctx.globalAlpha = 1;
}

/**
 * Resolves a bubble's center + base radius in screen space, or undefined if it's outside the
 * drawable swimlane region. Shared by every overlay drawer so they all use the exact same
 * geometry the static layer used (no off-by-one drift between hover and base bubble).
 */
function locateBubble(
	viewModel: TimelineViewModel,
	index: number,
	oldest: number,
	newest: number,
	scrollY: number,
	lo: TimelineLayout,
): { cx: number; cy: number; baseR: number; color: string; sliceIdx: number } | undefined {
	const ts = viewModel.timestamps[index];
	const cx = tsToX(ts, oldest, newest, lo);
	if (Number.isNaN(cx) || cx < lo.chartLeft || cx > lo.chartRight) return undefined;

	const sliceIdx = viewModel.sliceIndex[index];
	const cyVirtual = sliceVirtualCenterY(sliceIdx, lo);
	const cy = lo.swimlaneTop + (cyVirtual - scrollY);
	if (cy < lo.swimlaneTop - lo.rowHeight || cy > lo.swimlaneBottom + lo.rowHeight) return undefined;

	const radiusCap = clampRadiusToRow(lo.rowHeight);
	// Smaller floor so 1-line commits render visibly tiny — magnifies the variance between the
	// smallest and largest bubbles, which is what gives the chart its "burst" feel.
	const radiusMin = Math.min(1.5, radiusCap);
	// "Working Tree, no changes" placeholders render in `drawSwimlanes` as a fixed-size hollow
	// ring; resolve baseR to that size here so hover halos and selection highlights line up with
	// the visible ring instead of with the underlying near-zero bubbleR.
	const baseR =
		viewModel.commits[index].sha === ''
			? Math.min(8, radiusCap * 0.5)
			: radiusMin + (radiusCap - radiusMin) * viewModel.bubbleR[index];
	return { cx: cx, cy: cy, baseR: baseR, sliceIdx: sliceIdx, color: '' };
}

/**
 * Hover highlight — the "cool" one. Three stacked elements:
 *   1. Outer radial halo (color → transparent gradient) at half-alpha for atmosphere
 *   2. Bright opaque bubble at the scaled-up radius
 *   3. Two-tone ring (theme.background then bubble color) for crisp pop against any backdrop
 *
 * Driven by `intensity` (0..1) which the host eases over ~140ms — at intensity 0 the highlight
 * is invisible, at 1 it's the full pop. Scale and halo radius interpolate with intensity so the
 * effect grows in rather than snapping on, and so a directly-adjacent hover crossfade stays smooth.
 */
function drawHoverHighlight(
	ctx: CanvasRenderingContext2D,
	viewModel: TimelineViewModel,
	index: number,
	oldest: number,
	newest: number,
	scrollY: number,
	lo: TimelineLayout,
	theme: TimelineTheme,
	intensity: number,
): void {
	if (intensity <= 0) return;

	const located = locateBubble(viewModel, index, oldest, newest, scrollY, lo);
	if (located == null) return;

	const { cx, cy, baseR, sliceIdx } = located;

	const palette = theme.slicePalette;
	const color = palette[viewModel.slices[sliceIdx].colorIndex % palette.length];

	const eased = intensity;
	// Scale up to 1.45x at full intensity. The growth is what makes hovers feel "alive" without
	// any visual jitter, since the static-layer bubble underneath stays put while the overlay grows
	// over it.
	const r = baseR * (1 + 0.45 * eased);

	ctx.save();
	ctx.beginPath();
	// Clip wide-open horizontally so a hover-scaled bubble's halo can puff INTO DOM glass overlays
	// (rail and X-axis strip), where their frosted backdrops blur it. Vertically extends from canvas
	// y=0 down to the X-axis line so the halo can also glow through the axis glass without covering
	// the volume bars.
	ctx.rect(0, 0, lo.width, lo.axisStripBottom);
	ctx.clip();

	// 1. Atmospheric halo — radial gradient out from the bubble. The halo sits behind the bubble
	// fill so the bubble's hard edge stays crisp; the halo only adds the "glow" feel.
	const haloR = r * 2.6;
	const grad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, haloR);
	grad.addColorStop(0, color);
	grad.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.globalAlpha = 0.45 * eased;
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
	ctx.fill();
	ctx.globalAlpha = 1;

	// 2. Opaque bubble at the scaled-up radius — with a soft shadow blur for a "lush, floating"
	// feel that the legacy chart had baked into every bubble. We reserve it for the hovered bubble
	// only because shadowBlur is expensive at scale; static bubbles stay flat.
	ctx.shadowColor = color;
	ctx.shadowBlur = 14 * eased;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.shadowBlur = 0;
	ctx.shadowColor = 'transparent';

	// 3. Two-tone ring: a 1.5px background-color stripe right against the bubble (so the bubble
	// reads against light AND dark themes) plus a 1px color stripe just outside it. The pair acts
	// as a halftone outline that pops without looking heavy.
	ctx.lineWidth = 1.5;
	ctx.strokeStyle = theme.background;
	ctx.beginPath();
	ctx.arc(cx, cy, r + 0.75, 0, Math.PI * 2);
	ctx.stroke();

	ctx.lineWidth = 1;
	ctx.strokeStyle = color;
	ctx.beginPath();
	ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
	ctx.stroke();

	ctx.restore();
}

/**
 * Selected-bubble highlight — quieter than hover (no halo, no scale-up), just a persistent
 * two-tone ring so the user always knows which commit is "current" even after the cursor leaves.
 * Drawn under any active hover so the hover effect takes precedence in the overlap.
 */
function drawSelectedHighlight(
	ctx: CanvasRenderingContext2D,
	viewModel: TimelineViewModel,
	index: number,
	oldest: number,
	newest: number,
	scrollY: number,
	lo: TimelineLayout,
	theme: TimelineTheme,
): void {
	const located = locateBubble(viewModel, index, oldest, newest, scrollY, lo);
	if (located == null) return;

	const { cx, cy, baseR } = located;

	ctx.save();
	ctx.beginPath();
	ctx.rect(0, lo.swimlaneTop, lo.width, lo.swimlaneBottom - lo.swimlaneTop);
	ctx.clip();

	ctx.lineWidth = 1.5;
	ctx.strokeStyle = theme.background;
	ctx.beginPath();
	ctx.arc(cx, cy, baseR + 2, 0, Math.PI * 2);
	ctx.stroke();

	ctx.lineWidth = 1.5;
	ctx.strokeStyle = theme.selectedRing;
	ctx.beginPath();
	ctx.arc(cx, cy, baseR + 3.5, 0, Math.PI * 2);
	ctx.stroke();

	ctx.restore();
}

function drawVerticalScrollbar(
	ctx: CanvasRenderingContext2D,
	lo: TimelineLayout,
	scrollY: number,
	theme: TimelineTheme,
): void {
	const visibleH = lo.swimlaneBottom - lo.swimlaneTop;
	if (lo.virtualSwimlaneHeight <= visibleH) return;

	const ratio = visibleH / lo.virtualSwimlaneHeight;
	const thumbH = Math.max(20, visibleH * ratio);
	const thumbY = lo.swimlaneTop + (scrollY / lo.virtualSwimlaneHeight) * visibleH;
	const x = lo.width - verticalScrollbarWidthPx;

	// Track background — VS Code scrollbar slider colour at low alpha so the strip is always
	// faintly visible (you can see where the scrollable column is) without competing with content.
	ctx.fillStyle = theme.scrollThumb;
	ctx.globalAlpha = 0.18;
	ctx.fillRect(x, lo.swimlaneTop, verticalScrollbarWidthPx, visibleH);

	// Thumb — VS Code's "hover" slider colour at full alpha (the always-visible variant), with
	// 2px insets so the thumb sits inside the track instead of butting up against the chart edge.
	ctx.fillStyle = theme.scrollThumbHover;
	ctx.globalAlpha = 1;
	ctx.fillRect(x + 2, thumbY, verticalScrollbarWidthPx - 4, thumbH);
}

/**
 * Outlier-aware Y scale used by the volume panel. Mirrored from minimapRenderer.computeYScale: the
 * min(max, max(p95, fence)) hybrid keeps the axis tight on smooth distributions while protecting
 * against single-spike domination on heavy-tailed ones.
 */
export function computeYScale(values: Float32Array | readonly number[]): number {
	const sorted = new Float32Array(values.length);
	let length = 0;
	for (const v of values) {
		if (v === 0) continue;

		sorted[length++] = v;
	}

	if (length === 0) return 1;

	const subset = sorted.subarray(0, length);
	subset.sort();

	const quantile = (q: number): number => {
		const pos = (length - 1) * q;
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return subset[lo] + (subset[hi] - subset[lo]) * (pos - lo);
	};

	const q1 = quantile(0.25);
	const q3 = quantile(0.75);
	const p95 = subset[Math.floor((length - 1) * 0.95)];
	const max = subset[length - 1];
	const fence = q3 + 1.5 * (q3 - q1);
	const cap = Math.min(max, Math.max(p95, fence));

	return Math.max(1, Math.ceil(cap * 1.1));
}
