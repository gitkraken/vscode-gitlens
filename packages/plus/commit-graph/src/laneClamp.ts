import { colorForColumn } from './colors.js';
import type { Edge, ProcessedGraphRow } from './engine/types.js';
import { gutterPadding, xForColumn } from './view.js';

/**
 * Lane math for the TRANSLATED-SURFACE gutter: rows build their lane art once at LOGICAL (absolute)
 * lane positions; the whole surface slides via `--graph-gutter-scroll` (one compositor translate), edge
 * fades are a CSS mask on the row's clip container, and the row's node is a separate element PINNED at
 * the viewport edges by pure CSS `clamp()`. Nothing is rewritten per frame — there is no imperative
 * clamp pass to drift from the build. This module owns the geometry (`computeGutterGeometry`), the
 * build-cost window (`computeLaneWindow`), and the grouped per-row width/cap math.
 *
 * Deliberately Lit-free (no `svg`/`html`) so it is unit-testable in the Node runner.
 */

// Width (px) of the edge-fade zone the mask dissolves at each visible edge of a row's gutter. Owned here
// so the pinned-window margin and the CSS mask agree (the scss mirrors this as 2.4rem).
export const graphEdgeFadePx = 24;
// Fixed rounding radius for orthogonal lane bends — constant so every corner reads the same.
const edgeCorner = 4;

// All static edge styling (stroke-width, linecap/linejoin, fill:none, the dotted dash pattern, the
// synthetic wavy filter) lives in `.graph-edge` + modifier classes in graph.scss — only the dynamic lane
// `stroke` color + geometry are set per element. The class strings are precomputed constants (no per-edge
// concat/allocation; this runs for every visible row on the scroll hot path).
const edgeClassBase = 'graph-edge';
const edgeClassDotted = 'graph-edge is-dotted'; // workdir edges
const edgeClassDottedSynthetic = 'graph-edge is-dotted is-synthetic'; // synthetic (wavy) edges
const edgeClassDashed = 'graph-edge is-dashed'; // spans commits hidden by a collapsed lane
// `spansHidden` (loaded-but-folded) wins over the kind-based styles EXCEPT synthetic (unloaded), which
// stays wavy; workdir lanes are never collapsed so the two never collide in practice.
export function edgeClass(edge: Edge): string {
	return edge.kind === 'synthetic-edge'
		? edgeClassDottedSynthetic
		: edge.spansHidden
			? edgeClassDashed
			: edge.kind === 'workdir'
				? edgeClassDotted
				: edgeClassBase;
}

// Orthogonal connector from a NODE (at its row-center y) to an adjacent lane at the row boundary
// (y = 0 above / rowHeight below, in another column). Leaves the node HORIZONTALLY at its center so the
// connector visibly emanates from the dot's vertical center, then turns and runs vertically in the other
// column to the boundary. Rounded corner of radius edgeCorner, capped by the available span.
export function orthEdgeFromNode(nodeX: number, nodeY: number, edgeX: number, edgeY: number): string {
	const dir = edgeX > nodeX ? 1 : -1;
	const vdir = edgeY > nodeY ? 1 : -1;
	const r = Math.min(edgeCorner, Math.abs(edgeX - nodeX) / 2, Math.abs(edgeY - nodeY) / 2);
	return `M ${nodeX} ${nodeY} H ${edgeX - dir * r} Q ${edgeX} ${nodeY} ${edgeX} ${nodeY + vdir * r} V ${edgeY}`;
}

/** Contiguous engine-column range whose lane art a row's gutter SVG builds — see `computeLaneWindow`. */
export interface LaneWindow {
	/** First engine column (inclusive) built. */
	readonly startColumn: number;
	/** Last engine column (inclusive) built. */
	readonly endColumn: number;
}

export interface LaneWindowInput {
	/** Highest engine column present in the loaded rows. */
	maxColumn: number;
	columnWidth: number;
	/** Visible lane area width (graph column width minus the fixed fold strip). */
	viewport: number;
	/** Current horizontal scroll offset (px) of the gutter content within the viewport. */
	scrollX: number;
	/** The offset only jumps between discrete selection reveals (grouped-capped — scroll input never
	 *  reaches it): no bucket quantization, and the build margin shrinks to the fade zone (no other
	 *  offset can ever bring a farther lane into view, so building it would be provably invisible work). */
	pinned?: boolean;
	/** The offset RANGE a reveal slide may sweep through (an interval, not a point: a retargeted slide
	 *  can pass anywhere inside the prior sweep): the window widens to span it entirely so the compositor
	 *  translate never crosses un-built lanes. */
	sweep?: LaneSweep;
}

/** The inclusive offset range an in-flight reveal slide can visually pass through. */
export interface LaneSweep {
	readonly lo: number;
	readonly hi: number;
}

// Build margin each side of the visible lane region: 2 viewports, floored at 30 columns — far beyond the
// edge-fade zone, so a lane outside the window is provably invisible and skipping its art is
// pixel-identical to building it. The generous floor keeps h-scroll bucket crossings (each a visible-row
// gutter rebuild) rare even at narrow lane viewports.
const laneWindowMarginViewports = 2;
const laneWindowMinMarginColumns = 30;

/** Resolve the GROUPED inline lane cap (in lanes) from the `lanes.grouped.*` settings: at least `minLanes`
 *  (when the graph has that many — callers still bound the result by the actual lane fit), growing up to
 *  `maxPercent` of the row width so wider views show more lanes automatically. An unmeasured/zero width
 *  falls back to the minimum. */
export function resolveGroupedLaneCap(
	rowWidth: number,
	columnWidth: number,
	minLanes: number,
	maxPercent: number,
): number {
	const min = Math.max(1, Math.floor(minLanes));
	if (rowWidth <= 0 || columnWidth <= 0) return min;

	const budget = (rowWidth * Math.max(0, Math.min(100, maxPercent))) / 100 - gutterPadding * 2;
	return Math.max(min, Math.floor(budget / columnWidth));
}

// Trailing clearance after a rightmost element that is just a lane LINE (not the row's dot): a sliver of
// air past the ~2px stroke, instead of the dot-sized pin inset the dot cases need.
const laneTrailingPad = 4;

/** Per-row inline gutter width for a GROUPED graph at a REVEALED (non-zero) offset: the row hugs its
 *  VISIBLE lane extent — the rightmost of its own/edge lanes that falls inside the shifted cap — the
 *  offset-0 per-row flow translated to the shifted window. A lane past the right cap forces full width
 *  (its dot pins at the right edge); a row whose lanes all sit LEFT of the offset shrinks to one lane's
 *  worth (just its left-pinned dot). Always ≤ `capWidth`. `pad` should be the CSS pin inset
 *  (`--gutter-inset`) so a row's own dot is never clamped by its own width; the trailing clearance only
 *  spends the full inset when the DOT is the rightmost visible element — a plain lane line gets a
 *  sliver, keeping the graph-to-content seam tight. */
export function rowShiftedGutterWidth(
	row: ProcessedGraphRow,
	columnWidth: number,
	offset: number,
	capWidth: number,
	pad: number = gutterPadding,
): number {
	const rightCap = offset + capWidth - pad;
	let maxVisible = -Infinity;
	const consider = (c: number): void => {
		const x = xForColumn(c, columnWidth);
		if (x > rightCap) {
			maxVisible = rightCap;
		} else if (x >= offset && x > maxVisible) {
			maxVisible = x;
		}
	};
	consider(row.column);
	for (const key in row.edges) {
		consider(Number(key));
	}
	// The floor applies UNIVERSALLY, not just to all-lanes-left rows: a lane sitting exactly at (or
	// barely past) the offset would otherwise yield a viewport narrower than the pinned dot itself,
	// clipping it in half at the row's right edge. Sized to the pin: the dot pins at the FIRST-LANE
	// position (`--gutter-pin-x` = xForColumn(0)) and trails by `pad`.
	const floor = xForColumn(0, columnWidth) + pad;
	if (maxVisible === -Infinity) return floor;

	// Full pin-inset clearance only when the dot needs it: the row's own dot governs the extent, or the
	// cap was hit (a dot pins at the right edge there). Lane-line-governed rows trail by a sliver.
	const nodeX = xForColumn(row.column, columnWidth);
	const trailing =
		maxVisible === rightCap || (nodeX >= offset && nodeX >= maxVisible) ? pad : Math.min(pad, laneTrailingPad);

	return Math.min(capWidth, Math.max(floor, maxVisible - offset + trailing));
}

/**
 * The lane BUILD window: the column range a row's gutter SVG actually builds edge art for. On deep graphs
 * (hundreds of lanes, a narrow viewport) most lanes are far outside the view — skipping them cuts the
 * per-row template from O(maxColumn) to O(window). The window start is quantized to half-margin buckets so
 * ordinary h-scrolling (a pure compositor translate) reuses cached templates; only crossing a bucket
 * rebuilds the visible rows' gutters at the shifted window — rare and bounded.
 */
export function computeLaneWindow(input: LaneWindowInput): LaneWindow {
	const { maxColumn, columnWidth, viewport, scrollX, pinned, sweep } = input;
	// Pinned (grouped-capped): the offset only jumps between discrete reveals, so the margin only needs to
	// cover the fade zone (plus a column of outward-rounding slack) and the "bucket" degenerates to the
	// exact scrollX — rasters stop just past the visible fade instead of 2 viewports out.
	const margin = pinned
		? graphEdgeFadePx + columnWidth
		: Math.max(laneWindowMarginViewports * viewport, laneWindowMinMarginColumns * columnWidth);
	// Reveal sweep: the slide animates the translate through every offset the sweep range covers, so the
	// window must span all of it — otherwise mid-slide frames show un-built (missing) lanes.
	const sLo = sweep == null ? scrollX : Math.min(scrollX, sweep.lo);
	const sHi = sweep == null ? scrollX : Math.max(scrollX, sweep.hi);
	// Half-margin buckets: for ANY scrollX inside a bucket the window covers
	// [scrollX - margin, scrollX + viewport + margin], so scrolling within the bucket never rebuilds.
	const step = Math.max(1, margin / 2);
	const s0 = pinned ? sLo : Math.floor(sLo / step) * step;
	const s1 = pinned ? sHi : Math.floor(sHi / step) * step + step;
	const lo = s0 - margin;
	const hi = s1 + viewport + margin;
	// Invert the affine xForColumn to column bounds (lane x = x0 + column * columnWidth ∈ [lo, hi]).
	const x0 = xForColumn(0, columnWidth);
	const startColumn = Math.max(0, Math.ceil((lo - x0) / columnWidth));
	const endColumn = Math.min(maxColumn, Math.floor((hi - x0) / columnWidth));
	return { startColumn: startColumn, endColumn: endColumn };
}

/** Value-equality for two (possibly absent) lane windows — the h-scroll bucket-crossing check. Compares the
 *  band too: a bucket crossing can shift the band (edge-band reclassification) while the clip bounds hold (a
 *  medium graph the window always covers), and that MUST still trigger a rebuild. */
export function laneWindowsEqual(a: LaneWindow | undefined, b: LaneWindow | undefined): boolean {
	if (a == null || b == null) return a === b;

	return a.startColumn === b.startColumn && a.endColumn === b.endColumn;
}

/** True when everything `needed` requires is already inside `built` — the h-scroll rebuild gate. A wider
 *  built window is a visual SUPERSET of any narrower one (all its lane art exists), so scrolling within it
 *  never needs a rebuild; only escaping it does. `undefined` = unwindowed (every lane built): covers
 *  anything, and is only covered by another unwindowed build. */
export function laneWindowCovers(built: LaneWindow | undefined, needed: LaneWindow | undefined): boolean {
	if (built == null) return true;
	if (needed == null) return false;

	return built.startColumn <= needed.startColumn && built.endColumn >= needed.endColumn;
}

// True when `win` would CLIP some of the row's lane art — i.e. some column in `[0, edgeColumnMax]` falls
// outside `[startColumn, endColumn]`, so `computeGutterGeometry` skips at least one lane's own art and the
// windowed build diverges from the unwindowed one. When false, every column the row touches is inside the
// window, so the build is byte-identical to unwindowed (the gutter cache keys the window only when this is
// true, and the predicate↔geometry agreement is asserted in laneClamp.test.ts).
export function windowClipsRow(win: LaneWindow, row: ProcessedGraphRow): boolean {
	return win.startColumn > 0 || row.edgeColumnMax > win.endColumn;
}

export interface GutterGeomParams {
	rowHeight: number;
	columnWidth: number;
	/** When set, the column is too narrow for lanes: every node collapses to column 0 with no edges. */
	singleColumn: boolean;
	/** Fixed node radius for the active node mode (drives the workdir hollow-leaf edge start). */
	nodeRadius: number;
	isWorkdir: boolean;
	/** Lane build window — when set, edge art wholly outside it is skipped (see `computeLaneWindow`).
	 *  The build and the clamp pass MUST use the SAME window so their op lists align by index. */
	window?: LaneWindow;
}

/** One drawable gutter edge segment. Static bits (`el`/`cls`/`color`/`layer`) are clamp-independent
 *  (fixed at build); the geometry (`x1..y2` for lines, `d` for paths) + `opacity` are what the clamp
 *  moves. A cross-lane connector always emits BOTH shapes — the orthogonal `path` and the straight-stub
 *  `line` — so the imperative pass can flip routing by opacity without re-rendering (the inactive shape
 *  is 0).
 *
 *  `layer` is the raster/DOM split (see graph-gutter): `raster` = a pass-through lane vertical the
 *  clamp never re-routes (only x-translated with the whole gutter on h-scroll) — baked into the row's
 *  single background-image data-URI; `overlay` = every node-connected segment (own-column verticals +
 *  cross-lane connectors incl. the dual-routing stub) the clamp pass pins/routes per frame — kept as
 *  live SVG elements. The split is by op TYPE (topology-only), so it's clamp-independent: the raster
 *  URI + the overlay element list both stay cacheable across every scroll offset. */
export interface GutterEdgeOp {
	el: 'line' | 'path';
	layer: 'raster' | 'overlay';
	cls: string;
	color: string;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	d: string;
	opacity: number;
}

export interface GutterGeometry {
	/** Edge ops in build order — `raster`-layer ops feed the pass-through raster image; `overlay` ops
	 *  become live SVG elements (node-connected connectors + own-lane verticals). */
	readonly edges: readonly GutterEdgeOp[];
}

function lineOp(
	layer: GutterEdgeOp['layer'],
	cls: string,
	color: string,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	opacity: number,
): GutterEdgeOp {
	return {
		el: 'line',
		layer: layer,
		cls: cls,
		color: color,
		x1: x1,
		y1: y1,
		x2: x2,
		y2: y2,
		d: '',
		opacity: opacity,
	};
}

function pathOp(layer: GutterEdgeOp['layer'], cls: string, color: string, d: string, opacity: number): GutterEdgeOp {
	return { el: 'path', layer: layer, cls: cls, color: color, x1: 0, y1: 0, x2: 0, y2: 0, d: d, opacity: opacity };
}

/**
 * Compute one row's gutter edge ops at LOGICAL (absolute) lane positions — the position-independent
 * content the translated-surface model composites: the whole surface slides via `--graph-gutter-scroll`,
 * the mask fades the edges, and the row's node is a separate CSS-pinned element. Nothing here depends on
 * the scroll offset, so a row's ops build once per (topology, window) and never need rewriting.
 */
export function computeGutterGeometry(row: ProcessedGraphRow, params: GutterGeomParams): GutterGeometry {
	const { rowHeight, columnWidth, singleColumn, nodeRadius, isWorkdir, window: win } = params;
	const midY = rowHeight / 2;
	const nodeColumn = row.column;
	// The workdir/WIP node is a hollow (transparent-interior) leaf — start its descending line at the
	// node's bottom EDGE instead of its center, so the lane line doesn't shine through the empty ring.
	const startEdgeY = isWorkdir ? midY + nodeRadius : midY;
	const nodeX = singleColumn ? xForColumn(0, columnWidth) : xForColumn(nodeColumn, columnWidth);

	const edges: GutterEdgeOp[] = [];
	// Single-column mode draws no connectors — just the dots.
	if (!singleColumn) {
		// Integer-indexed iteration bounded by edgeColumnMax (the engine's own hot-path pattern).
		for (let column = 0; column <= row.edgeColumnMax; column++) {
			const bucket = row.edges[column];
			if (bucket == null) continue;

			// Lane build window: a lane's own art (passThrough / own-column vertical) renders only when its
			// column is inside the window; a cross-lane connector renders whenever its span
			// [min(column, nodeColumn), max(column, nodeColumn)] reaches into it. Anything else is beyond
			// the margin — provably invisible — and is skipped wholesale (the deep-graph ~95%).
			let laneInWindow = true;
			if (win != null && (column < win.startColumn || column > win.endColumn)) {
				laneInWindow = false;
				if (Math.min(column, nodeColumn) > win.endColumn || Math.max(column, nodeColumn) < win.startColumn) {
					continue;
				}
			}

			const x = xForColumn(column, columnWidth);
			const color = colorForColumn(column);

			if (bucket.passThrough != null && laneInWindow) {
				// Pass-through lane vertical → RASTER layer: it never connects to the node, so it bakes into
				// the row's background-image data-URI and slides with the surface.
				edges.push(lineOp('raster', edgeClass(bucket.passThrough), color, x, 0, x, rowHeight, 1));
			}
			if (bucket.starting != null) {
				pushConnector(
					edges,
					bucket.starting,
					column === nodeColumn,
					color,
					x,
					nodeX,
					startEdgeY,
					rowHeight,
					midY,
					rowHeight,
				);
			}
			if (bucket.ending != null) {
				pushConnector(edges, bucket.ending, column === nodeColumn, color, x, nodeX, 0, midY, midY, 0);
			}
		}
	}

	return { edges: edges };
}

// Emit a starting/ending edge: an own-column vertical (`<line>`) when the bucket is at the node's own
// column, else a cross-column connector as the orthogonal `path`. `ownY1..ownY2` bound the own-column
// vertical; `boundaryY` is the row edge the connector meets (rowHeight below for starting, 0 above for
// ending). Both are OVERLAY (node-connected → live elements layered over the raster).
function pushConnector(
	edges: GutterEdgeOp[],
	edge: Edge,
	ownColumn: boolean,
	color: string,
	x: number,
	nodeX: number,
	ownY1: number,
	ownY2: number,
	midY: number,
	boundaryY: number,
): void {
	const cls = edgeClass(edge);
	if (ownColumn) {
		edges.push(lineOp('overlay', cls, color, x, ownY1, x, ownY2, 1));
		return;
	}

	edges.push(pathOp('overlay', cls, color, orthEdgeFromNode(nodeX, midY, x, boundaryY), 1));
}
