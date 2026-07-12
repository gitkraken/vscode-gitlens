import type { GutterEdgeOp } from '@gitkraken/commit-graph/laneClamp.js';

/**
 * Serializes a row's pass-through lane verticals (`layer: 'raster'` ops) into one `data:image/svg+xml`
 * URI — the proven GKC gutter technique (a row's spanning lanes become a single decoded bitmap the
 * compositor scrolls, instead of dozens of per-lane SVG elements Lit re-commits as rows recycle).
 *
 * Deliberately Lit-free (pure string building) so it's unit-testable in the Node test runner without
 * loading `lit`/`renderGutterSvg` (which reference `HTMLElement`). `renderGutterRaster` (graph-gutter.ts)
 * wraps the returned `{ uri, x, width }` in the `<image>`; the geometry (`GutterEdgeOp`) is produced by the
 * shared `computeGutterGeometry`.
 */

// Stroke geometry baked into the raster — `.graph-edge` (graph.scss `.graph-edge`, ~line 1263) can't reach
// inside a standalone data-URI SVG document, so every value is inlined. These MUST stay in lockstep with the
// CSS (which can't import them): change one, change the other. `stroke-opacity` is the RESTING `.graph-edge`
// value: author CSS overrides the per-op presentation attribute, so a resting DOM edge paints at this flat
// opacity too — the raster matches it (the connector fade the clamp computes only ever moved node-connected
// OVERLAY ops, via geometry, never these pass-throughs).
const rasterStrokeWidth = 2;
const rasterStrokeOpacity = 0.78;
const rasterHalfStroke = rasterStrokeWidth / 2;
// Dash patterns mirroring the `.graph-edge` modifier classes in graph.scss.
const rasterDashDotted = '0.1 4';
const rasterDashDashed = '5 4';
// Wavy displacement filter parameters (synthetic/reachability lanes). Single-sourced here because BOTH the
// raster's inline `<defs>` (below) and the host's live `renderWavyFilterDefs` (graph-gutter.ts, id
// `graph-wavy`) must paint the identical distortion — a standalone raster SVG can't reach the host def.
export const wavyFilterParams = { baseFrequency: 0.06, numOctaves: 2, seed: 3, scale: 2 };
// The wavy displacement filter (synthetic/reachability lanes) — `.graph-edge.is-synthetic`'s `url(#graph-wavy)`
// points at a host def the standalone raster SVG can't reach, so it carries its own copy. Matches
// `renderWavyFilterDefs`; inlined only when a synthetic pass-through is actually present.
const rasterWavyDefs =
	'<defs><filter id="w">' +
	`<feTurbulence type="turbulence" baseFrequency="${wavyFilterParams.baseFrequency}" numOctaves="${wavyFilterParams.numOctaves}" seed="${wavyFilterParams.seed}"/>` +
	`<feDisplacementMap in="SourceGraphic" scale="${wavyFilterParams.scale}"/>` +
	'</filter></defs>';

/** `data:image/svg+xml` URI for an SVG document string — URI-encoded so `#hex`, `<`, quotes, and spaces stay
 *  transport-safe. Shared by the raster + the initials-dot builder (graph-gutter.ts) so both serialize identically. */
export function svgToDataUri(svg: string): string {
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A pass-through lane's dash/filter extras, derived from the shared `edgeClass` string (constant class
// literals, so substring checks are exact). Solid lanes (the common case) add nothing.
function rasterLineExtra(cls: string): string {
	let extra = cls.includes('is-dashed')
		? ` stroke-dasharray="${rasterDashDashed}"`
		: cls.includes('is-dotted')
			? ` stroke-dasharray="${rasterDashDotted}"`
			: '';
	if (cls.includes('is-synthetic')) {
		extra += ' filter="url(#w)"';
	}
	return extra;
}

/** The raster `<image>` placement + its `data:image/svg+xml` URI. */
export interface RasterImageData {
	/** `data:image/svg+xml,<encoded>` URI baking every pass-through lane. */
	readonly uri: string;
	/** Logical x (px) the `<image>` is placed at — the leftmost lane minus a half-stroke. */
	readonly x: number;
	/** Rasterized band width (px) — spans only the built lanes, so the decoded surface stays bounded to the
	 *  lane band, not the (deep-graph: thousands-of-px) full gutter width. */
	readonly width: number;
}

/**
 * Build the raster `<image>` data for a row's geometry ops. Returns `undefined` when the row has no
 * pass-through lanes (single-column mode, or a row whose only art is node-connected). Coordinates are LOCAL
 * to the lanes' own x-extent (origin at the leftmost lane minus a half-stroke), so the URI + `width` are
 * scroll-independent — the whole layer is translated `-scrollX` on h-scroll via `--graph-gutter-scroll` (the
 * `<image>` is placed back at the logical `x`). Deterministic: identical ops → byte-identical URI (the gutter
 * cache relies on this — a same-key hit hands back the same template, so the URI is rebuilt only on a miss).
 */
export function buildRasterImageData(ops: readonly GutterEdgeOp[], rowHeight: number): RasterImageData | undefined {
	let minX = Infinity;
	let maxX = -Infinity;
	for (const op of ops) {
		if (op.layer !== 'raster') continue;

		if (op.x1 < minX) {
			minX = op.x1;
		}
		if (op.x1 > maxX) {
			maxX = op.x1;
		}
	}
	if (minX === Infinity) return undefined;

	const originX = minX - rasterHalfStroke;
	const width = maxX - minX + rasterStrokeWidth;
	let hasSynthetic = false;
	let lines = '';
	for (const op of ops) {
		if (op.layer !== 'raster') continue;

		const lx = op.x1 - originX;
		const extra = rasterLineExtra(op.cls);
		if (op.cls.includes('is-synthetic')) {
			hasSynthetic = true;
		}
		// y1 omitted (SVG default 0); y2 = rowHeight. Round caps overshoot vertically, clipped at the row
		// bounds just as the DOM `<line>`s are by the outer `<svg>`.
		lines += `<line x1="${lx}" x2="${lx}" y2="${rowHeight}"${extra} stroke="${op.color}"/>`;
	}
	const defs = hasSynthetic ? rasterWavyDefs : '';
	const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${rowHeight}" viewBox="0 0 ${width} ${rowHeight}">${defs}<g fill="none" stroke-width="${rasterStrokeWidth}" stroke-opacity="${rasterStrokeOpacity}" stroke-linecap="round" stroke-linejoin="round">${lines}</g></svg>`;
	return { uri: svgToDataUri(svgStr), x: originX, width: width };
}
