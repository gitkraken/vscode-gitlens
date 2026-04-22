import type { GraphMinimapMarker, GraphMinimapSearchResultMarker, GraphMinimapStats } from './minimap.js';
import { getDay } from './minimapData.js';

const markerTallY = 0; // from-bottom offset for full-height-ish markers (branch/stash)
const markerShortY = 4; // from-bottom offset for shorter markers (PR/remote/tag)
const markerSize = 3;
const markerLaneGapPx = 3; // vertical separation between the activity curve and the top of the short-marker lane
const markerReserveY = markerShortY + markerSize + markerLaneGapPx;
const selectedCircleRadius = 5;
const hoverCircleRadius = 3;

// Top-rail glyphs anchor at the top edge — main HEAD as a green triangle, upstream as a smaller
// dimmer green triangle. With both HEAD and upstream now drawing anchor lines through the marker
// reserve, the line widths carry the visual hierarchy and the triangles can stay compact. Worktree
// HEADs ride the existing marker pipeline as bottom-lane dots (purple), so no top-rail entry.
const headTriangleHalfWidth = 4;
const headTriangleHeight = 5;
const headAnchorLineWidth = 2; // px — main HEAD's anchor line, sized to be scannable from across the chart
const upstreamTriangleHalfWidth = 3;
const upstreamTriangleHeight = 4;
const upstreamAnchorLineWidth = 1; // px — upstream's anchor line, slimmer than main HEAD's so the visual hierarchy reads
const upstreamAnchorLineAlpha = 0.5; // dimmer than main HEAD so the eye still ranks main HEAD first

const scrollbarHeight = 8;
const scrollbarThumbOpacity = 1;
const scrollbarThumbOpacityHover = 1;
const scrollbarTrackOpacity = 0.3;
const scrollbarTrackOpacityHover = 0.6;
const scrollbarViewportMarkerOpacity = 0.55;
const scrollbarViewportMarkerOpacityHover = 0.8;
const brushFillOpacity = 0.45;
const brushEdgeWidthPx = 2;
export const dayMs = 24 * 60 * 60 * 1000;
export const minZoomRangeMs = 7 * dayMs; // 7-day floor on the zoom window width

export interface MinimapTheme {
	background: string;
	line: string;
	focusLine: string;
	markerHead: string;
	markerUpstream: string;
	markerWorktree: string;
	markerLocalBranches: string;
	markerRemoteBranches: string;
	markerPullRequests: string;
	markerStashes: string;
	markerTags: string;
	markerHighlights: string;
	scrollThumb: string;
	scrollThumbHover: string;
}

export interface MinimapLayout {
	width: number;
	height: number;
	dpr: number;
	chartWidth: number;
	barWidth: number;
	activityHeight: number;
	/** When true, the X-axis is flipped: oldest on the left, newest on the right. Projection helpers
	 * apply the flip internally so drawing, hit-testing, and inverse projections all stay consistent
	 * via a single toggle. */
	reversed: boolean;
}

export interface MinimapViewModel {
	days: Float64Array;
	activity: Float32Array;
	yMax: number;
	dayIndexByDay: Map<number, number>;
}

export interface MinimapDrawState {
	viewModel: MinimapViewModel;
	layout: MinimapLayout;
	markersByDay: Map<number, GraphMinimapMarker[]> | undefined;
	searchResultsByDay: Map<number, GraphMinimapSearchResultMarker> | undefined;
	visibleDays: { top: number; bottom: number } | undefined;
	activeDay: number | undefined;
	hoverDay: number | undefined;
	theme: MinimapTheme;
	/** Full timeline extents in timestamps — oldest day and newest day of the unzoomed view model. Used
	 * to project the scrollbar track against the full timeline even when `viewModel` is a zoomed slice. */
	fullTimelineOldest?: number;
	fullTimelineNewest?: number;
	/** Zoom window in timestamps (oldest..newest). Undefined = not zoomed. */
	zoomRange?: { oldest: number; newest: number };
	/** In-progress brush rect in canvas-local x coordinates. Undefined = not brushing. */
	brushRange?: { startX: number; endX: number };
	/** 0..1 opacity for the scrollbar overlay — animated toward 1 when zoomed, 0 when not. */
	scrollbarOpacity?: number;
	/** True when the pointer is hovering anywhere over the scrollbar track region. */
	scrollbarHover?: boolean;
	/** When true, the activity spline is suppressed — partial stats would render as a near-flat line. */
	loading?: boolean;
}

export function layout(
	cssWidth: number,
	cssHeight: number,
	dpr: number,
	dayCount: number,
	reversed: boolean,
): MinimapLayout {
	// Canvas width is already clipped by host CSS (`calc(100% - 2.5rem)`) to reserve the popover gutter.
	const chartWidth = Math.max(0, cssWidth);
	const barWidth = dayCount > 0 ? chartWidth / dayCount : 0;
	const activityHeight = Math.max(1, cssHeight - markerReserveY);
	return {
		width: cssWidth,
		height: cssHeight,
		dpr: dpr,
		chartWidth: chartWidth,
		barWidth: barWidth,
		activityHeight: activityHeight,
		reversed: reversed,
	};
}

export function buildViewModel(
	data: Map<number, GraphMinimapStats | null>,
	dataType: 'commits' | 'lines',
	todayMidnight: number,
): MinimapViewModel {
	let oldestDay = todayMidnight;
	for (const day of data.keys()) {
		if (day < oldestDay) {
			oldestDay = day;
		}
	}

	const rawDayCount = Math.max(1, Math.round((todayMidnight - oldestDay) / dayMs) + 1);
	const days = new Float64Array(rawDayCount);
	const activity = new Float32Array(rawDayCount);
	const dayIndexByDay = new Map<number, number>();

	const cursor = new Date(todayMidnight);
	for (let i = 0; i < rawDayCount; i++) {
		const day = getDay(cursor);
		days[i] = day;
		dayIndexByDay.set(day, i);

		const stat = data.get(day);
		if (stat != null) {
			if (dataType === 'lines') {
				activity[i] = (stat.activity?.additions ?? 0) + (stat.activity?.deletions ?? 0);
			} else {
				activity[i] = stat.commits;
			}
		}

		cursor.setDate(cursor.getDate() - 1);
	}

	return { days: days, activity: activity, yMax: computeYScale(activity), dayIndexByDay: dayIndexByDay };
}

export function computeYScale(activity: Float32Array | readonly number[]): number {
	// Typed-array scratch avoids boxing per non-zero value, and typed-array `.sort()` is numeric by
	// default — skipping both the JS array allocation and the per-comparison comparator closure.
	const sorted = new Float32Array(activity.length);
	let length = 0;
	for (const v of activity) {
		if (v === 0) continue;
		sorted[length++] = v;
	}

	if (length === 0) return 1;

	const subset = sorted.subarray(0, length);
	subset.sort();

	// Linear-interpolated quantile — handles small-n without the bias that `subset[floor(length*q)]`
	// introduces (e.g. length=4 would otherwise return the max as Q3, inflating the IQR fence).
	const quantile = (q: number) => {
		const pos = (length - 1) * q;
		const lo = Math.floor(pos);
		const hi = Math.ceil(pos);
		return subset[lo] + (subset[hi] - subset[lo]) * (pos - lo);
	};

	const q1 = quantile(0.25);
	const q3 = quantile(0.75);
	// P95 uses nearest-rank (not interpolation) so an extreme spike at the top of the sorted array
	// cannot drag P95 up via interpolation — e.g. `[3,4,5,6,7,10000]` must not pull P95 toward 10000.
	const p95 = subset[Math.floor((length - 1) * 0.95)];
	const max = subset[length - 1];
	// Tukey upper fence guards the scale on tight distributions where P95 ≈ max would leave no room
	// for the occasional taller-than-typical bar; P95 handles heavy tails where the fence sits too
	// high against the body of the data.
	const fence = q3 + 1.5 * (q3 - q1);
	const cap = Math.min(max, Math.max(p95, fence));

	return Math.max(1, Math.ceil(cap * 1.1));
}

export function dayToX(day: number, viewModel: MinimapViewModel, lo: MinimapLayout): number | undefined {
	const index = viewModel.dayIndexByDay.get(day);
	if (index == null) return undefined;
	return indexToX(index, lo);
}

export function xToDay(x: number, viewModel: MinimapViewModel, lo: MinimapLayout): number | undefined {
	if (lo.barWidth === 0) return undefined;
	const xLocal = lo.reversed ? lo.chartWidth - x : x;
	const index = Math.floor(xLocal / lo.barWidth);
	if (index < 0 || index >= viewModel.days.length) return undefined;
	return viewModel.days[index];
}

// Inverse of `rangeToX` — returns the fractional timestamp for a given canvas-local x so callers
// like the brush gesture can preserve sub-bar precision (quantizing to day buckets would collapse
// narrow brushes to zero-width ranges before the zoom floor widens them).
export function xToTimestamp(x: number, viewModel: MinimapViewModel, lo: MinimapLayout): number | undefined {
	if (lo.barWidth === 0) return undefined;
	const xLocal = lo.reversed ? lo.chartWidth - x : x;
	return viewModel.days[0] - (xLocal / lo.barWidth) * dayMs;
}

function indexToX(index: number, lo: MinimapLayout): number {
	const x = index * lo.barWidth + lo.barWidth / 2;
	return lo.reversed ? lo.chartWidth - x : x;
}

function activityToY(value: number, yMax: number, activityHeight: number): number {
	const clamped = Math.min(Math.max(value, 0), yMax);
	return activityHeight - (clamped / yMax) * activityHeight;
}

function rangeToX(day: number, viewModel: MinimapViewModel, lo: MinimapLayout): number {
	const firstDay = viewModel.days[0];
	const fractionalIndex = (firstDay - day) / dayMs;
	const x = fractionalIndex * lo.barWidth + lo.barWidth / 2;
	return lo.reversed ? lo.chartWidth - x : x;
}

/**
 * Projects a timestamp onto an x coordinate across the FULL timeline, independent of any zoom
 * window. Used by the scrollbar overlay: its track represents the unzoomed history, so it projects
 * timestamps against `fullOldest`..`fullNewest` rather than the zoomed slice in `viewModel`.
 */
function fullRangeToX(day: number, fullOldest: number, fullNewest: number, lo: MinimapLayout): number {
	const span = fullNewest - fullOldest;
	if (span <= 0) return 0;
	const x = ((fullNewest - day) / span) * lo.chartWidth;
	return lo.reversed ? lo.chartWidth - x : x;
}

/**
 * Returns a new view model restricted to days within `[oldest, newest]` (inclusive). Activity is
 * sliced (typed-array views — no copy); `yMax` is recomputed over the zoom window so low-activity
 * periods reveal detail; `dayIndexByDay` is rebuilt so indices are local to the slice. Falls back
 * to the source view model when the requested range doesn't intersect it.
 */
export function sliceViewModel(source: MinimapViewModel, oldest: number, newest: number): MinimapViewModel {
	const firstDay = source.days[0]; // newest day in source (days are most-recent-first)
	const lastDay = source.days.at(-1)!; // oldest day in source

	// Clamp the requested range to what the source actually covers before projecting to indices so
	// out-of-range requests (e.g. a stale zoom after data shrinks) still produce a valid subarray.
	const clampedNewest = Math.min(newest, firstDay);
	const clampedOldest = Math.max(oldest, lastDay);
	if (clampedNewest < clampedOldest) return source;

	const startIndex = Math.max(0, Math.round((firstDay - clampedNewest) / dayMs));
	const endIndex = Math.min(source.days.length - 1, Math.round((firstDay - clampedOldest) / dayMs));
	if (endIndex < startIndex) return source;

	const slicedDays = source.days.subarray(startIndex, endIndex + 1);
	const slicedActivity = source.activity.subarray(startIndex, endIndex + 1);

	const dayIndexByDay = new Map<number, number>();
	for (let i = 0; i < slicedDays.length; i++) {
		dayIndexByDay.set(slicedDays[i], i);
	}

	return {
		days: slicedDays,
		activity: slicedActivity,
		yMax: computeYScale(slicedActivity),
		dayIndexByDay: dayIndexByDay,
	};
}

/**
 * Draws the slow-changing layer: background, activity spline, markers, search-result highlights.
 * Safe to cache into an offscreen canvas and blit each frame — this layer only needs to rebuild
 * when the data, markers, search results, layout, or theme actually change.
 *
 * The caller is expected to have set the ctx's transform (typically `setTransform(dpr, 0, 0, dpr, 0, 0)`)
 * and cleared the canvas before calling; this function draws everything in CSS-pixel coordinates.
 */
export function drawStatic(ctx: CanvasRenderingContext2D, state: MinimapDrawState): void {
	const { viewModel, layout: lo, theme, markersByDay, searchResultsByDay } = state;
	const { width, height, activityHeight } = lo;

	if (theme.background) {
		ctx.fillStyle = theme.background;
		ctx.fillRect(0, 0, width, height);
	}

	if (viewModel.days.length > 0 && !state.loading) {
		ctx.strokeStyle = theme.line;
		ctx.lineWidth = 1;
		drawActivitySpline(ctx, viewModel, lo);
	}

	if (markersByDay != null && markersByDay.size > 0) {
		const tallY = height - markerTallY - markerSize;
		const shortY = height - markerShortY - markerSize;

		for (const [day, markers] of markersByDay) {
			const x = dayToX(day, viewModel, lo);
			if (x == null) continue;

			let hasCurrentHead = false;
			let hasCurrentRemote = false;
			for (const m of markers) {
				if (m.type === 'branch' && m.current) {
					hasCurrentHead = true;
				}
				if (m.type === 'remote' && m.current) {
					hasCurrentRemote = true;
				}
			}

			// Two passes (faster than sort-then-iterate for the typical 1–5 markers per day): first
			// every non-worktree marker, then worktree dots. The split ensures worktrees draw last
			// and sit on top of any branch/stash dot sharing their lane.
			for (const m of markers) {
				if (m.type === 'branch' && m.current) continue;
				if (m.type === 'remote' && m.current) continue;
				if (m.type === 'worktree') continue;

				let color: string | undefined;
				let y = tallY;
				switch (m.type) {
					case 'branch':
						color = theme.markerLocalBranches;
						y = tallY;
						break;
					case 'remote':
						color = theme.markerRemoteBranches;
						y = shortY;
						break;
					case 'pull-request':
						color = theme.markerPullRequests;
						y = shortY;
						break;
					case 'stash':
						color = theme.markerStashes;
						y = tallY;
						break;
					case 'tag':
						color = theme.markerTags;
						y = shortY;
						break;
				}
				if (color == null) continue;
				ctx.fillStyle = color;
				ctx.fillRect(Math.round(x) - 1, y, markerSize, markerSize);
			}

			let drewWorktree = false;
			for (const m of markers) {
				if (m.type !== 'worktree') continue;
				if (!drewWorktree) {
					ctx.fillStyle = theme.markerWorktree;
					drewWorktree = true;
				}
				ctx.fillRect(Math.round(x) - 1, tallY, markerSize, markerSize);
			}

			// Top-rail glyphs replace the previous full-height HEAD/upstream bars: a downward-pointing
			// triangle anchored to the top edge, plus an anchor line drawn across the bottom marker
			// reserve so the spline above stays uncluttered. Main HEAD's anchor is bolder; upstream's
			// is slimmer and dimmer so the visual hierarchy still ranks main HEAD first.
			if (hasCurrentHead) {
				const px = Math.round(x) - Math.floor(headAnchorLineWidth / 2);
				ctx.fillStyle = theme.markerHead;
				ctx.fillRect(px, activityHeight, headAnchorLineWidth, height - activityHeight);
				drawTopRailTriangle(ctx, x, theme.markerHead, headTriangleHalfWidth, headTriangleHeight);
			}
			if (hasCurrentRemote) {
				const px = Math.round(x) - Math.floor(upstreamAnchorLineWidth / 2);
				ctx.fillStyle = theme.markerUpstream;
				ctx.globalAlpha = upstreamAnchorLineAlpha;
				ctx.fillRect(px, activityHeight, upstreamAnchorLineWidth, height - activityHeight);
				ctx.globalAlpha = 1;
				drawTopRailTriangle(ctx, x, theme.markerUpstream, upstreamTriangleHalfWidth, upstreamTriangleHeight);
			}
		}
	}

	if (searchResultsByDay != null && searchResultsByDay.size > 0) {
		ctx.fillStyle = theme.markerHighlights;
		for (const day of searchResultsByDay.keys()) {
			const x = dayToX(day, viewModel, lo);
			if (x == null) continue;
			ctx.fillRect(Math.round(x) - 1, 0, 2, height);
		}
	}
}

/**
 * Draws the fast-changing overlay: visible-range band, hover focus line, selected-day circle, hover circle.
 * Called every rAF; the caller is expected to have already painted the static layer below.
 */
export function drawOverlay(ctx: CanvasRenderingContext2D, state: MinimapDrawState): void {
	const { viewModel, layout: lo, theme, visibleDays, activeDay, hoverDay, scrollbarOpacity, brushRange } = state;
	const { height, activityHeight, chartWidth } = lo;

	// Reserve the bottom strip for the scrollbar once it's faded past invisible so focus lines, the
	// hover ring, and the visible-range band don't bleed under it. The band height is the only hit
	// that matters; focus lines / dots are well above the bottom strip.
	const scrollbarVisible = scrollbarOpacity != null && scrollbarOpacity > 0.01;
	const bandHeight = scrollbarVisible ? Math.max(1, height - scrollbarHeight) : height;

	// Scroll-thumb-styled visible-range overlay: no borders, translucent fill in the VS Code scrollbar
	// slider color so it reads as a proper scroll thumb sliding over the chart rather than a tinted
	// band with stroked edges. When zoomed, the band is projected against the zoomed `viewModel`, so
	// ranges entirely outside the zoom window fall off-canvas naturally and aren't drawn — the
	// scrollbar's graph-viewport marker carries that signal instead.
	if (visibleDays != null && theme.scrollThumb) {
		const xTop = rangeToX(visibleDays.top, viewModel, lo);
		const xBottom = rangeToX(visibleDays.bottom, viewModel, lo);
		// Snap the band to whole pixels so the fill's left/right edges don't wobble at subpixel
		// boundaries as `visibleDays` shifts during scroll.
		const rawX1 = Math.round(Math.min(xTop, xBottom));
		const rawX2 = Math.round(Math.max(xTop, xBottom));
		// Clip to chart area so a partially-overlapping range shows only its visible portion — the
		// rest is implicitly off-canvas.
		const x1 = Math.max(0, rawX1);
		const x2 = Math.min(chartWidth, rawX2);
		if (x2 > x1) {
			ctx.fillStyle = theme.scrollThumb;
			ctx.fillRect(x1, 0, Math.max(1, x2 - x1), bandHeight);
		}
	}

	// Hover renders first (dimmer focus line + hollow ring) so the selected dot paints over it when
	// they're on adjacent days. Skipped entirely when hover coincides with the selected day so the
	// solid selected dot isn't obscured.
	if (hoverDay != null && hoverDay !== activeDay) {
		const idx = viewModel.dayIndexByDay.get(hoverDay);
		if (idx != null) {
			const x = indexToX(idx, lo);
			drawFocusLine(ctx, x, height, theme.focusLine, 0.5);
			const y = activityToY(viewModel.activity[idx], viewModel.yMax, activityHeight);
			drawDataCircle(ctx, x, y, hoverCircleRadius, theme.background, theme.line, 1);
		}
	}

	if (activeDay != null) {
		const idx = viewModel.dayIndexByDay.get(activeDay);
		if (idx != null) {
			const x = indexToX(idx, lo);
			drawFocusLine(ctx, x, height, theme.focusLine, 1);
			const y = activityToY(viewModel.activity[idx], viewModel.yMax, activityHeight);
			drawDataCircle(ctx, x, y, selectedCircleRadius, theme.line, theme.background, 1.5);
		}
	}

	// In-progress brush rectangle — the live preview of the range the user is dragging. Drawn bold:
	// translucent focus-colored fill for the footprint, plus full-strength edges so the selection's
	// extents stay crisp even at small widths. Uses `theme.focusLine` rather than `theme.scrollThumb`
	// so the brush reads as active focus (more saturated) rather than a passive scroll chrome tint.
	if (brushRange != null && theme.focusLine) {
		const bx1 = Math.round(Math.max(0, Math.min(brushRange.startX, brushRange.endX)));
		const bx2 = Math.round(Math.min(chartWidth, Math.max(brushRange.startX, brushRange.endX)));
		const width = bx2 - bx1;
		if (width > 0) {
			ctx.fillStyle = theme.focusLine;
			ctx.globalAlpha = brushFillOpacity;
			ctx.fillRect(bx1, 0, width, bandHeight);
			ctx.globalAlpha = 1;
			if (width >= brushEdgeWidthPx * 2) {
				ctx.fillRect(bx1, 0, brushEdgeWidthPx, bandHeight);
				ctx.fillRect(bx2 - brushEdgeWidthPx, 0, brushEdgeWidthPx, bandHeight);
			} else {
				// Very narrow brush — one solid band reads more clearly than two overlapping edges.
				ctx.fillRect(bx1, 0, width, bandHeight);
			}
		}
	}

	if (scrollbarVisible) {
		drawScrollbar(ctx, state);
	}
}

/**
 * Draws the scrollbar overlay at the bottom of the minimap — only called when a zoom is active (or
 * fading out). The track spans the full timeline, the thumb shows the current zoom window, and a
 * thin marker shows where the graph's viewport sits in the full timeline (drawn even when the graph
 * is scrolled outside the zoom window, so the user always sees "where the graph is").
 */
function drawScrollbar(ctx: CanvasRenderingContext2D, state: MinimapDrawState): void {
	const {
		layout: lo,
		theme,
		visibleDays,
		zoomRange,
		scrollbarOpacity,
		scrollbarHover,
		fullTimelineOldest,
		fullTimelineNewest,
	} = state;
	const { height, chartWidth } = lo;
	if (scrollbarOpacity == null || scrollbarOpacity <= 0) return;
	if (fullTimelineOldest == null || fullTimelineNewest == null) return;
	if (fullTimelineNewest <= fullTimelineOldest) return;

	const trackOpacity = scrollbarHover ? scrollbarTrackOpacityHover : scrollbarTrackOpacity;
	const thumbOpacity = scrollbarHover ? scrollbarThumbOpacityHover : scrollbarThumbOpacity;
	const viewportOpacity = scrollbarHover ? scrollbarViewportMarkerOpacityHover : scrollbarViewportMarkerOpacity;
	const thumbColor = scrollbarHover && theme.scrollThumbHover ? theme.scrollThumbHover : theme.scrollThumb;

	const topY = height - scrollbarHeight;
	const prevAlpha = ctx.globalAlpha;
	ctx.globalAlpha = scrollbarOpacity;

	// Track
	if (theme.scrollThumb) {
		ctx.globalAlpha = scrollbarOpacity * trackOpacity;
		ctx.fillStyle = theme.scrollThumb;
		ctx.fillRect(0, topY, chartWidth, scrollbarHeight);
	}

	// Graph-viewport marker — a thin tinted bar showing where the graph's scroll viewport sits in
	// the full timeline. Present even when the graph is scrolled outside the current zoom window.
	if (visibleDays != null && thumbColor) {
		const xA = fullRangeToX(visibleDays.top, fullTimelineOldest, fullTimelineNewest, lo);
		const xB = fullRangeToX(visibleDays.bottom, fullTimelineOldest, fullTimelineNewest, lo);
		const mx1 = Math.round(Math.max(0, Math.min(xA, xB)));
		const mx2 = Math.round(Math.min(chartWidth, Math.max(xA, xB)));
		if (mx2 > mx1) {
			ctx.globalAlpha = scrollbarOpacity * viewportOpacity;
			ctx.fillStyle = thumbColor;
			ctx.fillRect(mx1, topY, Math.max(1, mx2 - mx1), scrollbarHeight);
		}
	}

	// Thumb — the current zoom window.
	if (zoomRange != null && thumbColor) {
		const xNewer = fullRangeToX(zoomRange.newest, fullTimelineOldest, fullTimelineNewest, lo);
		const xOlder = fullRangeToX(zoomRange.oldest, fullTimelineOldest, fullTimelineNewest, lo);
		const tx1 = Math.round(Math.max(0, Math.min(xNewer, xOlder)));
		const tx2 = Math.round(Math.min(chartWidth, Math.max(xNewer, xOlder)));
		if (tx2 > tx1) {
			ctx.globalAlpha = scrollbarOpacity * thumbOpacity;
			ctx.fillStyle = thumbColor;
			ctx.fillRect(tx1, topY, Math.max(2, tx2 - tx1), scrollbarHeight);
		}
	}

	ctx.globalAlpha = prevAlpha;
}

/**
 * Hit-testing helper for the scrollbar region. Returns the kind of target at the given canvas-local
 * point, or undefined if the point is outside the scrollbar.
 */
export function hitTestScrollbar(
	x: number,
	y: number,
	lo: MinimapLayout,
	zoomRange: { oldest: number; newest: number },
	fullTimelineOldest: number,
	fullTimelineNewest: number,
): { kind: 'thumb'; thumbX1: number; thumbX2: number } | { kind: 'track'; side: 'newer' | 'older' } | undefined {
	if (y < lo.height - scrollbarHeight || y > lo.height) return undefined;
	if (fullTimelineNewest <= fullTimelineOldest) return undefined;
	const xNewer = fullRangeToX(zoomRange.newest, fullTimelineOldest, fullTimelineNewest, lo);
	const xOlder = fullRangeToX(zoomRange.oldest, fullTimelineOldest, fullTimelineNewest, lo);
	const tx1 = Math.min(xNewer, xOlder);
	const tx2 = Math.max(xNewer, xOlder);
	if (x >= tx1 && x <= tx2) return { kind: 'thumb', thumbX1: tx1, thumbX2: tx2 };
	// Left of the thumb is "newer" when the axis runs newest→oldest (default) and "older" when reversed.
	const leftSide: 'newer' | 'older' = lo.reversed ? 'older' : 'newer';
	const rightSide: 'newer' | 'older' = lo.reversed ? 'newer' : 'older';
	return { kind: 'track', side: x < tx1 ? leftSide : rightSide };
}

/**
 * Converts a scrollbar-thumb drag delta (in canvas-local pixels) to a shift in the zoom window's
 * start/end timestamps. In the default orientation older days live at larger x, so a rightward drag
 * shifts the window toward older days (negative shift); when the axis is reversed the relationship
 * flips and a rightward drag shifts toward newer days.
 */
export function scrollbarDeltaToTimestampShift(
	deltaX: number,
	fullOldest: number,
	fullNewest: number,
	lo: MinimapLayout,
): number {
	if (lo.chartWidth <= 0) return 0;
	const sign = lo.reversed ? 1 : -1;
	return sign * (deltaX / lo.chartWidth) * (fullNewest - fullOldest);
}

function drawActivitySpline(ctx: CanvasRenderingContext2D, viewModel: MinimapViewModel, lo: MinimapLayout): void {
	const { activity, yMax } = viewModel;
	const { barWidth, chartWidth, activityHeight } = lo;
	const rawCount = viewModel.days.length;
	if (rawCount === 0 || barWidth === 0) return;

	let pointCount = rawCount;
	for (let i = 0; i < rawCount; i++) {
		const x = indexToX(i, lo);
		if (x > chartWidth + barWidth || x < -barWidth) {
			pointCount = i;
			break;
		}
	}
	if (pointCount === 0) return;

	const ys = new Float32Array(pointCount);
	for (let i = 0; i < pointCount; i++) {
		ys[i] = activityToY(activity[i], yMax, activityHeight);
	}

	if (pointCount === 1) {
		ctx.fillStyle = ctx.strokeStyle;
		ctx.fillRect(Math.round(indexToX(0, lo)), Math.round(ys[0]), 1, 1);
		return;
	}

	if (pointCount === 2) {
		ctx.beginPath();
		ctx.moveTo(indexToX(0, lo), ys[0]);
		ctx.lineTo(indexToX(1, lo), ys[1]);
		ctx.stroke();
		return;
	}

	const tangents = computeMonotoneTangents(ys, barWidth);

	ctx.beginPath();
	ctx.moveTo(indexToX(0, lo), ys[0]);
	// `step` scales the tangents into y-deltas; tangents are dy-per-barWidth, so one-third of a bar
	// gives the control-point y offset regardless of canvas direction. The x offset has to follow the
	// actual canvas direction though — when the axis is reversed, x1 < x0 so we use the signed
	// (x1 - x0) / 3 instead of a fixed +barWidth/3, otherwise the control points end up outside the
	// segment and the cubic overshoots into the spike artifacts that look nothing like a smooth curve.
	const step = barWidth / 3;
	for (let i = 0; i < pointCount - 1; i++) {
		const x0 = indexToX(i, lo);
		const x1 = indexToX(i + 1, lo);
		const xStep = (x1 - x0) / 3;
		ctx.bezierCurveTo(
			x0 + xStep,
			ys[i] + step * tangents[i],
			x1 - xStep,
			ys[i + 1] - step * tangents[i + 1],
			x1,
			ys[i + 1],
		);
	}
	ctx.stroke();
}

// Fritsch–Carlson monotone cubic interpolation: tangents at each point are the sign-preserving
// clamped average of the adjacent secant slopes. Endpoints copy the neighboring secant. Keeping
// this as a separate exported function so the math is unit-testable without a canvas.
export function computeMonotoneTangents(ys: Float32Array | readonly number[], dx: number): Float32Array {
	const n = ys.length;
	const tangents = new Float32Array(n);
	if (n < 2 || dx === 0) return tangents;
	if (n === 2) {
		const s = (ys[1] - ys[0]) / dx;
		tangents[0] = s;
		tangents[1] = s;
		return tangents;
	}

	const secants = new Float32Array(n - 1);
	for (let i = 0; i < n - 1; i++) {
		secants[i] = (ys[i + 1] - ys[i]) / dx;
	}
	tangents[0] = secants[0];
	tangents[n - 1] = secants[n - 2];
	for (let i = 1; i < n - 1; i++) {
		const s0 = secants[i - 1];
		const s1 = secants[i];
		const sign0 = Math.sign(s0);
		const sign1 = Math.sign(s1);
		if (sign0 !== sign1 || sign0 === 0) {
			tangents[i] = 0;
		} else {
			tangents[i] = (sign0 + sign1) * Math.min(Math.abs(s0), Math.abs(s1), Math.abs(s0 + s1) / 4);
		}
	}
	return tangents;
}

function drawFocusLine(ctx: CanvasRenderingContext2D, x: number, height: number, color: string, alpha: number): void {
	const px = Math.round(x) + 0.5;
	ctx.strokeStyle = color;
	ctx.lineWidth = 1;
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.moveTo(px, 0);
	ctx.lineTo(px, height);
	ctx.stroke();
	ctx.globalAlpha = 1;
}

function drawDataCircle(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	fill: string,
	stroke: string,
	lineWidth: number,
): void {
	ctx.beginPath();
	ctx.arc(x, y, radius, 0, Math.PI * 2);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.strokeStyle = stroke;
	ctx.lineWidth = lineWidth;
	ctx.stroke();
}

// Top-rail downward triangle anchored on the canvas top edge: base spans the top edge, apex points
// down into the canvas. Used for both main HEAD (larger) and upstream HEAD (smaller, dimmer color).
function drawTopRailTriangle(
	ctx: CanvasRenderingContext2D,
	x: number,
	color: string,
	halfWidth: number,
	height: number,
): void {
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.moveTo(x - halfWidth, 0);
	ctx.lineTo(x + halfWidth, 0);
	ctx.lineTo(x, height);
	ctx.closePath();
	ctx.fill();
}
