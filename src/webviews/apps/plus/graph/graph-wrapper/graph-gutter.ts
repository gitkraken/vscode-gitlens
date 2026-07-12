import { colorForColumn } from '@gitkraken/commit-graph/colors.js';
import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { GutterEdgeOp, LaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { computeGutterGeometry } from '@gitkraken/commit-graph/laneClamp.js';
import { nodeRadiusRef, xForColumn } from '@gitkraken/commit-graph/view.js';
import type { SVGTemplateResult, TemplateResult } from 'lit';
import { html, nothing, svg } from 'lit';
import { LruMap } from '@gitlens/utils/lruMap.js';
import { encodeHtmlWeak } from '@gitlens/utils/string.js';
import { buildRasterImageData, svgToDataUri, wavyFilterParams } from './graph-gutter-raster.js';

/**
 * One row's lane art for the TRANSLATED-SURFACE gutter, in two sibling pieces inside the row's clip
 * viewport:
 *
 * - `.gl-graph__gutter-surface` — ALL lane art at ABSOLUTE lane x: the pass-through raster `<image>`
 *   (the proven GKC "row art as one data-URI" technique) behind the live overlay svg (node-connected
 *   connectors + own-lane verticals). The compositor slides the whole surface via
 *   `--graph-gutter-scroll`; the edge-fade mask sits on the surface (per-row gated off for rows too
 *   narrow to have anything hidden). Nothing in it is ever rewritten after build.
 * - `.gl-graph__gutter-node` — the commit node + its lane-collapse hit-target in a small svg whose
 *   viewBox slices the node's absolute coords; PINNED at the viewport edges by pure CSS `clamp()`
 *   (see `--gutter-node-x` in graph.scss), so the dot stays locatable when its lane scrolls out.
 *
 * Lane X positions use the SHARED `xForColumn` so lanes stay continuous between rows.
 *
 * Decorative only: the svgs are `aria-hidden` and `pointer-events: none` — the accessible surface is
 * the row DOM. The single interactive affordance (lane-collapse on the node) is exposed via a
 * `data-lane-tip` hit-target the host resolves through event delegation. The one exception is
 * `NodeStyle.onAvatarError`: an `<image>` load-error event doesn't bubble, so it can't be resolved the
 * same way — it's a single reference shared by every row (not a per-row closure).
 */

const BACKGROUND = 'hsl(var(--background))';
// Base radius the avatar/stash-icon nodes are DRAWN at (so the shared circular clipPath + the avatar
// image work); the node group is then scaled to the mode's target radius. 8 → a 16px base node.
const nodeAvatarRadius = 8;
// The minimum gap (px) the design keeps: between a node and its lane line, AND between two adjacent
// same-row nodes at the widest lane spacing. Drives the bg-mask and the columnWidth bounds. For the
// SCALED nodes (avatar / stash) the bg-mask divides by the group scale so the FINAL gap is still 1px.
const laneGap = 1;
// The `archive` codicon glyph (\ea98) — the stash mark, rendered as SVG <text> in the codicon font
// (available to the light-DOM graph). Used inside the avatar-mode stash square; matches the stash
// scroll-marker icon (`archive`).
const stashGlyph = String.fromCharCode(0xea98);

// Node size is FIXED per mode (NOT coupled to lane spacing). Density changes the GAP between lanes,
// not the node size: DOTS render at 10px (radius 5); AVATAR/letter identity nodes at 20px (radius 10 —
// capped so that even WITH the hover/select grow, see `.commit-dot-identity` in graph.scss, the node
// stays inside the 24px comfortable row with a ~1px gap).
const dotNodeRadius = 5;
const avatarNodeRadius = 10;

// Fixed node radius for the mode. (No longer takes a columnWidth — the resize no longer respaces.)
export function nodeRadiusFor(mode: NodeStyle['mode']): number {
	return mode === 'avatar' ? avatarNodeRadius : dotNodeRadius;
}

// Extra gap (px) past the node diameter for COMFORTABLE lane spacing — leaves clear air between a node
// and the neighboring lane.
const laneGapComfortable = 6;

// Lane spacing (= columnWidth) for a density + node mode. Fixed — the graph no longer respaces on
// resize; the density toggle picks compact vs comfortable.
//
// A row only ever holds ONE node (two dots never share a row), so the binding constraint isn't
// node-to-node, it's node-to-adjacent-lane-LINE. Compact packs to that — node radius plus a small,
// visually-tuned gap that clears the node's 1px bg-mask and the lane line's 1px half-stroke with a
// little breath. Dots get `r + laneGap + 4` (10px); the larger avatar/letter identity node gets 1px
// more air (16px). Comfortable stays diameter-based for an airier fan.
export function laneSpacing(density: 'compact' | 'comfortable', mode: NodeStyle['mode']): number {
	const r = nodeRadiusFor(mode);
	if (density === 'comfortable') return 2 * r + laneGapComfortable;
	return r + laneGap + (mode === 'avatar' ? 5 : 4);
}

export interface GutterMetrics {
	gutterWidth: number;
	rowHeight: number;
	columnWidth: number;
	/** When set, the column is too narrow for lanes: draw every node in column 0 with no edges (a
	 *  single column of dots/avatars), so the narrowest graph degrades to a plain commit-dot rail. */
	singleColumn?: boolean;
	/** Lane build window (deep scrolled graphs): edge art wholly outside it is skipped — the node, the
	 *  hit-target, and boundary-crossing connectors still build. See `computeLaneWindow`. */
	laneWindow?: LaneWindow;
}

// Node center (px) at its LOGICAL (absolute) lane position — the CSS pin (`--gutter-node-x`) converts it
// to a screen position per frame. Single-column mode collapses every node to column 0.
function nodeXFor(row: ProcessedGraphRow, metrics: GutterMetrics): number {
	return metrics.singleColumn ? xForColumn(0, metrics.columnWidth) : xForColumn(row.column, metrics.columnWidth);
}

/**
 * Commit-node rendering style. `mode: 'compact'` draws the small geometric dot (the graph
 * column's default); `mode: 'avatar'` draws an identity node at the commit's lane — the author
 * avatar image when `avatars` is on and a URL is available, otherwise the author initials in a
 * lane-colored circle. Mirrors GitKraken's `useAuthorInitialsForAvatars` switch.
 */
export interface NodeStyle {
	mode: 'compact' | 'avatar';
	avatars: boolean;
	avatarUrl?: string;
	/** Author email for the avatar image being attempted — lets a failed-load report (`onAvatarError`)
	 *  identify which avatar broke. */
	avatarEmail?: string;
	initials: string;
	/** Workdir-only: 'dirty' draws a small solid center dot in the WIP circle; 'clean'/absent draws none. */
	wipState?: 'clean' | 'dirty';
	/** Reports a failed avatar image load — see `RowRenderContext.onAvatarError` (graph-row.ts). */
	onAvatarError?: (event: Event) => void;
}

// OVERLAY lane art (node-connected verticals + cross-lane connectors; pass-throughs bake into the raster).
// Built once at absolute lane x and never rewritten — the surface translate + mask do the rest.
function renderGutterEdges(ops: readonly GutterEdgeOp[], ownLaneX?: number): SVGTemplateResult {
	const elements: SVGTemplateResult[] = [];
	for (const op of ops) {
		if (op.layer !== 'overlay') continue;
		// Own-column verticals render in the PINNED node svg instead (see renderGutterSvg) — skip here.
		if (op.el === 'line' && op.x1 === ownLaneX && op.x2 === ownLaneX) continue;

		elements.push(
			op.el === 'path'
				? svg`<path class=${op.cls} d=${op.d} stroke=${op.color} />`
				: svg`<line class=${op.cls} x1=${op.x1} y1=${op.y1} x2=${op.x2} y2=${op.y2} stroke=${op.color} />`,
		);
	}
	return svg`<g class="gl-graph__gutter-edges">${elements}</g>`;
}

// Bake the RASTER (pass-through) ops of a row into one background-image `<image>` — the proven GKC gutter
// technique: a row's spanning lanes become a single decoded bitmap the compositor moves on scroll, not
// dozens of per-lane SVG elements Lit must re-commit as rows recycle. The URI serialization is the Lit-free
// `buildRasterImageData` (so it's unit-testable); here we only place the `<image>` at the lanes' logical x.
// The whole layer is translated `-scrollX` on h-scroll via the shared `--graph-gutter-scroll` var (see
// `.gl-graph__gutter-raster` in graph.scss). `nothing` when the row has no pass-through lanes.
function renderGutterRaster(ops: readonly GutterEdgeOp[], rowHeight: number): SVGTemplateResult | typeof nothing {
	const data = buildRasterImageData(ops, rowHeight);
	if (data == null) return nothing;

	return svg`<image
		class="gl-graph__gutter-raster"
		x=${data.x}
		y="0"
		width=${data.width}
		height=${rowHeight}
		href=${data.uri}
		preserveAspectRatio="none"
	/>`;
}

// The pass-through raster in its own `<svg>`, CONTENT-anchored (width spans the built lane range): it
// sits inside `.gl-graph__gutter-surface`, which the compositor translates as one unit — the raster,
// the overlay elements, everything slides together; the edge-fade mask lives on the surface. `nothing`
// when the row has no pass-through lanes. Reuses `renderGutterRaster` for the inner `<image>`.
function renderGutterRasterLayer(
	ops: readonly GutterEdgeOp[],
	contentWidth: number,
	rowHeight: number,
): TemplateResult | typeof nothing {
	const image = renderGutterRaster(ops, rowHeight);
	if (image === nothing) return nothing;

	return html`<svg class="gl-graph__gutter-raster-layer" aria-hidden="true" width=${contentWidth} height=${rowHeight}>
		${image}
	</svg>`;
}

// Portable sans stack for the pre-rendered initials dots — a data-URI `<image>` can't reach the webview's
// `--vscode-font-family`, so the glyphs are shaped with the platform UI font (slight metric drift from the
// live text node is acceptable).
const initialsFontStack = "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Ubuntu, 'Droid Sans', sans-serif";

// Bounded (initials|color) → data-URI cache for the initials-fallback dot. Baking the lane-colored circle +
// stroked white initials into a decoded bitmap lets scroll repaints COMPOSITE it (like a real avatar image)
// instead of re-shaping the glyph + rasterizing the 2px under-stroke every frame — the avatars-off fling
// paint cost. LRU-bounded on a name×palette working set (coldest evict incrementally past the cap).
const initialsDotCache = new LruMap<string, string>(5000);

// The `data:image/svg+xml` URI baking the SAME visual as the old `<circle>+<text class="gl-graph__node-initials">`
// fallback: a lane-colored circle (r = nodeAvatarRadius) + white initials with the 2px dark under-stroke
// (paint-order: stroke), weight 600, font 8 (= the old 0.8rem at 1rem=10px). The `-r -r 2r 2r` viewBox maps
// 1:1 into renderIdentityNode's `-r..r` image box, so the group's avatar-target scale carries the dot exactly
// as it did the text.
function initialsDotUri(initials: string, color: string): string {
	const cacheKey = `${initials}|${color}`;
	let uri = initialsDotCache.get(cacheKey);
	if (uri == null) {
		const r = nodeAvatarRadius;
		const svgStr =
			`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-r} ${-r} ${r * 2} ${r * 2}">` +
			`<circle cx="0" cy="0" r="${r}" fill="${color}"/>` +
			`<text x="0" y="0" text-anchor="middle" dominant-baseline="central" fill="#fff" ` +
			`stroke="rgba(0,0,0,0.55)" stroke-width="2" stroke-linejoin="round" paint-order="stroke" ` +
			`font-family="${initialsFontStack}" font-size="8" font-weight="600">${encodeHtmlWeak(initials)}</text>` +
			`</svg>`;
		uri = svgToDataUri(svgStr);
		initialsDotCache.set(cacheKey, uri);
	}
	return uri;
}

// Identity node (avatar image or author initials) drawn at the commit's lane. Uses a single
// shared circular clipPath (`#graph-node-clip`) translated to the node — see renderWavyFilterDefs.
function renderIdentityNode(
	row: ProcessedGraphRow,
	metrics: GutterMetrics,
	color: string,
	nodeStyle: NodeStyle,
): SVGTemplateResult {
	const { rowHeight } = metrics;
	const nodeX = nodeXFor(row, metrics);
	const nodeY = rowHeight / 2;
	const r = nodeAvatarRadius;
	// Drawn at the fixed base radius; the group scales to the avatar target radius (9-11.5) for the
	// current lane spacing, so the image + clipPath + ring scale together.
	const scale = nodeRadiusFor('avatar') / nodeAvatarRadius;
	const useImage = nodeStyle.avatars && nodeStyle.avatarUrl != null && nodeStyle.avatarUrl.length > 0;
	const inner = useImage
		? svg`<image
				x=${-r} y=${-r} width=${r * 2} height=${r * 2}
				href=${nodeStyle.avatarUrl} clip-path="url(#graph-node-clip)"
				preserveAspectRatio="xMidYMid slice"
				data-avatar-email=${nodeStyle.avatarEmail ?? nothing}
				@error=${nodeStyle.onAvatarError}
			/>`
		: // Pre-rendered initials dot (see initialsDotUri): a decoded bitmap composited on scroll instead of a
			// per-paint stroked <text>. No @error (data URIs don't fail) and no data-avatar-email (not a real avatar).
			svg`<image
				x=${-r} y=${-r} width=${r * 2} height=${r * 2}
				href=${initialsDotUri(nodeStyle.initials, color)}
			/>`;
	// Outer g positions the node; the inner `commit-dot-identity` g scales up on hover to close the
	// background-masked gap to the lane line (same treatment as the dot nodes). A lane-colored ring
	// frames the avatar/initials.
	return svg`<g class="commit-dot-glow" transform="translate(${nodeX}, ${nodeY}) scale(${scale})">
		<circle class="gl-graph__node-carve" cx="0" cy="0" r=${r + laneGap / scale} fill=${BACKGROUND} />
		<g class="commit-dot-identity">
			${inner}
			<circle class="commit-dot" cx="0" cy="0" r=${r} fill="none" stroke=${color} stroke-width="1.5" />
		</g>
	</g>`;
}

// Avatar/letter-mode stash node: the SAME lane-colored SQUARE as the dot-mode stash (so a stash
// always reads as a square, never a circle), sized like the identity nodes so it aligns, with a
// white `archive` codicon centered as the stash mark. Same bg-mask gap + hover-grow treatment.
function renderStashIconNode(nodeX: number, nodeY: number, color: string): SVGTemplateResult {
	const r = nodeAvatarRadius;
	const scale = nodeRadiusFor('avatar') / nodeAvatarRadius;
	const m = r + laneGap / scale;
	return svg`<g class="commit-dot-glow" transform="translate(${nodeX}, ${nodeY}) scale(${scale})">
		<rect class="gl-graph__node-carve" x=${-m} y=${-m} width=${m * 2} height=${m * 2} rx="2" fill=${BACKGROUND} />
		<g class="commit-dot-identity">
			<rect x=${-r} y=${-r} width=${r * 2} height=${r * 2} rx="2" fill=${color} />
			<text class="gl-graph__node-stash-glyph" x="0" y="0" text-anchor="middle" dominant-baseline="central">
				${stashGlyph}
			</text>
		</g>
	</g>`;
}

// Dot-mode stash node: a SOLID lane-colored square (faint fill + solid border) cross-hatched with
// diagonal lane lines — the GitKraken "stash" mark (distinct from the round commit + the dotted WIP
// circle). Drawn at the origin (so a fixed clipPath bounds the hatch) inside a scalable group that
// grows on hover/select, with the usual background-mask gap to the lane line. Static styling (fills,
// stroke widths, hatch) lives in `.gl-graph__node-stash-*` classes; only the lane color is dynamic.
function renderStashSquareNode(nodeX: number, nodeY: number, color: string): SVGTemplateResult {
	const sr = nodeRadiusRef;
	// Drawn at the fixed base half-size; the group scales to the fixed dot radius so the box + hatch +
	// clipPath scale together.
	const scale = nodeRadiusFor('compact') / nodeRadiusRef;
	const m = sr + laneGap / scale;
	// Hatch lines parallel to the "/" diagonal (constant x+y = k), clipped to the square.
	const hatch = [-6, -3, 0, 3, 6].map(
		k =>
			svg`<line class="gl-graph__node-stash-line" x1=${-sr} y1=${k + sr} x2=${sr} y2=${k - sr} stroke=${color} />`,
	);
	return svg`<g class="commit-dot-glow" transform="translate(${nodeX}, ${nodeY}) scale(${scale})">
		<rect class="gl-graph__node-carve" x=${-m} y=${-m} width=${m * 2} height=${m * 2} rx="1.5" fill=${BACKGROUND} />
		<g class="commit-dot commit-dot-stash">
			<rect class="gl-graph__node-stash-box" x=${-sr} y=${-sr} width=${sr * 2} height=${sr * 2} rx="1"
				fill=${color} stroke=${color} />
			<g class="gl-graph__node-stash-hatch" clip-path="url(#graph-stash-clip)">${hatch}</g>
		</g>
	</g>`;
}

function renderNode(row: ProcessedGraphRow, metrics: GutterMetrics, nodeStyle?: NodeStyle): SVGTemplateResult {
	const { rowHeight } = metrics;
	const isMerge = row.kind === 'merge';
	const isStash = row.kind === 'stash';
	const isWorkdir = row.kind === 'workdir';

	const nodeColor = colorForColumn(row.column);
	const nodeX = nodeXFor(row, metrics);
	const nodeY = rowHeight / 2;

	const mode = nodeStyle?.mode ?? 'compact';
	// Fixed node radius per mode (no longer tracks lane spacing). The bg-mask (r + laneGap) carves the
	// 1px gap to the lane line above/below.
	const r = nodeRadiusFor(mode);

	// Avatar/letter mode → identity node for authored rows; stash → square w/ glyph (no author); workdir
	// always falls through to its dotted circle below.
	// (Check `nodeStyle?.mode === 'avatar'` directly so TS narrows `nodeStyle` for renderIdentityNode.)
	if (nodeStyle?.mode === 'avatar') {
		if (isStash) {
			return renderStashIconNode(nodeX, nodeY, nodeColor);
		}
		if (!isWorkdir) {
			return renderIdentityNode(row, metrics, nodeColor, nodeStyle);
		}
	}

	// Dot shapes — dot mode, avatar mode shrunk below the floor, or always for workdir/stash/merge.
	// Kinds differ by SHAPE only at the same radius: WIP a dotted circle, stash a hatched square, merge
	// a hollow ring.
	if (isWorkdir) {
		// Dotted circle in the lane color — the GitKraken working-tree node. The dotted-outline styling
		// (background fill, stroke width/cap/dash) lives in `.gl-graph__node-outline`; the bg-mask keeps
		// the 1px gap to the lane line above/below. A DIRTY working tree adds a small solid center dot
		// (with a ~2px gap inside the ring); a clean tree is just the empty dotted ring.
		// Dirty WIP: a small solid center dot. Sized a touch smaller than the ring's inner edge so a
		// clear gap rings it (the row gradient shows in the gap). Clean WIP: no center — just the ring.
		const wipDot =
			nodeStyle?.wipState === 'dirty'
				? svg`<circle class="gl-graph__node-wip-dirty" cx=${nodeX} cy=${nodeY} r=${Math.max(1.5, r - 3.5)} fill=${nodeColor} />`
				: nothing;
		// No background-mask circle here (unlike the other nodes): the WIP ring's interior is left
		// transparent (`.gl-graph__node-outline` fill: none) so the row's gradient shines through the
		// middle. The WIP node is always a lane tip, so the only lane line is the one descending below it.
		return svg`<g class="commit-dot-glow">
			<circle class="commit-dot gl-graph__node-outline" cx=${nodeX} cy=${nodeY} r=${r} stroke=${nodeColor} />
			${wipDot}
		</g>`;
	}
	if (isStash) {
		// Solid lane-colored square cross-hatched with diagonal lines — the GitKraken stash node.
		return renderStashSquareNode(nodeX, nodeY, nodeColor);
	}
	if (isMerge) {
		// Hollow ring inside the bg-mask gap; the center pip scales with the node.
		return svg`<g class="commit-dot-glow">
			<circle class="gl-graph__node-carve" cx=${nodeX} cy=${nodeY} r=${r + laneGap} fill=${BACKGROUND} />
			<circle class="commit-dot commit-dot-hollow" cx=${nodeX} cy=${nodeY} r=${r}
				fill=${BACKGROUND} stroke=${nodeColor} stroke-width="2" />
			<circle cx=${nodeX} cy=${nodeY} r=${Math.max(1.5, r * 0.32)} fill=${nodeColor} />
		</g>`;
	}
	// Standard commit: flat filled dot inside the bg-mask gap; on hover the dot scales up to fill it.
	return svg`<g class="commit-dot-glow">
		<circle class="gl-graph__node-carve" cx=${nodeX} cy=${nodeY} r=${r + laneGap} fill=${BACKGROUND} />
		<circle class="commit-dot commit-dot-solid" cx=${nodeX} cy=${nodeY} r=${r} fill=${nodeColor} />
	</g>`;
}

/**
 * The single SVG `<defs>` (feTurbulence + feDisplacementMap) referenced by synthetic-edge
 * paths via `filter="url(#graph-wavy)"`. Must be rendered ONCE in the host before any row —
 * an `id` referenced by per-row SVGs only needs to exist once in the document.
 */
export function renderWavyFilterDefs(): TemplateResult {
	return html`<svg class="gl-graph__defs" width="0" height="0" aria-hidden="true">
		<defs>
			<filter id="graph-wavy">
				<feTurbulence
					type="turbulence"
					baseFrequency=${wavyFilterParams.baseFrequency}
					numOctaves=${wavyFilterParams.numOctaves}
					seed=${wavyFilterParams.seed}
				/>
				<feDisplacementMap in="SourceGraphic" scale=${wavyFilterParams.scale} />
			</filter>
			<clipPath id="graph-node-clip">
				<circle cx="0" cy="0" r=${nodeAvatarRadius} />
			</clipPath>
			<clipPath id="graph-stash-clip">
				<rect
					x=${-nodeRadiusRef}
					y=${-nodeRadiusRef}
					width=${nodeRadiusRef * 2}
					height=${nodeRadiusRef * 2}
					rx="1"
				/>
			</clipPath>
		</defs>
	</svg>`;
}

/**
 * Render one row's gutter `<svg>`: a single background-image `<image>` baking the pass-through lanes
 * (`renderGutterRaster`) behind the live overlay elements (node-connected connectors + node + optional
 * lane hit-target). `gutterWidth` is the fixed standalone-gutter width in `gutter` placement, or the row's
 * own `rowGutterWidth(row, columnWidth)` in `inline` placement.
 */
// Width of the pinned-node svg: comfortably covers the largest node (avatar r10, hover-grown) plus the
// lane-collapse hit-target's touch allowance either side. The viewBox slices this window around the
// node's absolute x, so node rendering stays coordinate-identical to the surface.
const gutterNodeSvgWidth = 44;

export function renderGutterSvg(
	row: ProcessedGraphRow,
	metrics: GutterMetrics,
	laneTipSha?: string,
	nodeStyle?: NodeStyle,
): TemplateResult {
	const { gutterWidth, rowHeight } = metrics;
	const nodeX = nodeXFor(row, metrics);
	const nodeY = rowHeight / 2;
	const r = nodeRadiusFor(nodeStyle?.mode ?? 'compact');
	const win = metrics.laneWindow;

	// One geometry pass → the raster (pass-through) ops feed the `<image>`, the overlay ops become live
	// elements. Both read the SAME op list so the layers stay aligned by construction.
	const ops = computeGutterGeometry(row, {
		rowHeight: rowHeight,
		columnWidth: metrics.columnWidth,
		singleColumn: metrics.singleColumn === true,
		nodeRadius: r,
		isWorkdir: row.kind === 'workdir',
		window: win,
	}).edges;

	// Invisible hit-target so the node is easy to click for lane-collapse. Kept SNUG to the dot — the
	// node radius plus a small touch allowance, floored at 1.5× the smallest (dot) radius — so clicks that
	// merely land NEAR a dot don't silently toggle its lane (a gutter-node click also selects the row).
	// Resolved via delegation on `data-lane-tip` by the host (keeps this render function pure). Lives in
	// the PINNED node svg, so a pinned dot stays clickable wherever the CSS clamp puts it.
	const hitRadius = Math.max(r + 2, dotNodeRadius * 1.5);
	const hitTarget =
		laneTipSha != null
			? svg`<g class="lane-hit-target" data-lane-tip=${laneTipSha}>
					<circle cx=${nodeX} cy=${nodeY} r=${hitRadius} fill="transparent" />
				</g>`
			: nothing;

	const node = renderNode(row, metrics, nodeStyle);

	// The row's OWN-column vertical segments (the only overlay LINES at the node's x — cross-lane
	// connectors are paths) ride in the PINNED node svg, not the sliding surface: a pinned dot keeps its
	// own lane line (the river pins with it, connecting consecutive pinned dots), instead of the surface
	// translate sliding the line off-view and leaving a floating dot. Free dots render identically — the
	// node svg sits exactly at the true lane x.
	const ownLaneLines: SVGTemplateResult[] = [];
	for (const op of ops) {
		if (op.layer === 'overlay' && op.el === 'line' && op.x1 === nodeX && op.x2 === nodeX) {
			ownLaneLines.push(
				svg`<line class=${op.cls} x1=${op.x1} y1=${op.y1} x2=${op.x2} y2=${op.y2} stroke=${op.color} />`,
			);
		}
	}

	// The surface spans the BUILT lane content (absolute coords) — the compositor slides it as one unit
	// via `--graph-gutter-scroll`; the row's clip viewport crops it. The fade WRAPPER around it is
	// viewport-sized (inset 0) and static, so the edge-fade mask anchors to the VIEWPORT edges while the
	// content slides beneath — masking the translated surface directly would either fade the content's
	// own ends or (on a size-less box) alpha everything out. The overlay svg and the raster svg share the
	// same content width so they can never shear apart.
	const contentWidth =
		win != null ? xForColumn(win.endColumn, metrics.columnWidth) + metrics.columnWidth : gutterWidth;
	// The node (+ hit target) renders with its ABSOLUTE coords into a small svg whose viewBox slices the
	// area around the node — the element itself is then PINNED into view by pure CSS (`--gutter-node-x`),
	// so the dot sticks at the viewport edges when its lane scrolls out, with zero per-frame JS.
	// The edge-fade GATE (`is-row-fadeable`, the narrow-row guard) lives on the ROW element, not here: it
	// depends on the row's per-offset viewport width, and baking it into this fragment would make the
	// gutter cache offset-dependent (see `rowFadeable` in graph-row.ts).
	return html`<div class="gl-graph__gutter-fade">
			<div class="gl-graph__gutter-surface">
				${renderGutterRasterLayer(ops, contentWidth, rowHeight)}<svg
					class="graph-gutter"
					aria-hidden="true"
					role="presentation"
					width=${contentWidth}
					height=${rowHeight}
				>
					${renderGutterEdges(ops, nodeX)}
				</svg>
			</div>
		</div>
		<svg
			class="gl-graph__gutter-node"
			aria-hidden="true"
			role="presentation"
			width=${gutterNodeSvgWidth}
			height=${rowHeight}
			viewBox="${nodeX - gutterNodeSvgWidth / 2} 0 ${gutterNodeSvgWidth} ${rowHeight}"
		>
			<g class="gl-graph__node-lane">${ownLaneLines}</g>
			${node}${hitTarget}
		</svg>`;
}
