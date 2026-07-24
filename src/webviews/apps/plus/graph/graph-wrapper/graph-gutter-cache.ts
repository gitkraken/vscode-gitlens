import { buildEdgeHash } from '@gitkraken/commit-graph/engine/edges.js';
import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { LaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { laneWindowCovers, windowClipsRow } from '@gitkraken/commit-graph/laneClamp.js';
import type { GraphPlacement } from '@gitkraken/commit-graph/view.js';
import type { TemplateResult } from 'lit';
import { LruMap } from '@gitlens/utils/lruMap.js';
import type { GutterMetrics, NodeStyle } from './graph-gutter.js';

/**
 * Per-`gl-lit-graph`-instance memo over the row gutter SVG (`renderGutterSvg`) — the runtime consumer
 * of the engine's `buildEdgeHash`. `renderGutterSvg` rebuilds a row's whole lane art (the pass-through
 * raster `<image>` URI + the node-connected overlay elements + the node) on every host re-render tick, yet
 * most ticks change nothing about a row's gutter — a selection moved, a payload swapped, the viewport
 * scrolled vertically — so the template is byte-identical to last tick's. `GutterCache` keys each built
 * `TemplateResult` and hands the SAME instance back on a hit, so Lit skips reconciling that subtree AND the
 * JS construction (incl. the raster URI serialization) is skipped. The cache key is offset-independent, so
 * it doubles as the per-row raster-URI cache tier. Even huge windows collapse to a handful of distinct edge
 * shapes, so the cache stays tiny.
 *
 * This module is deliberately Lit-free (the builder is INJECTED, not imported) so the cache mechanics —
 * key derivation, epoch invalidation, bounded eviction — are unit-testable in the Node test runner
 * without loading `lit`/`renderGutterSvg` (which reference `HTMLElement`).
 */

// Max distinct cached gutter templates — generously above the working set (visible rows × a few
// kinds/shapes). Dot mode keys collapse to the few edge shapes and never evict; avatar mode adds a
// per-author identity payload, so the cap bounds the map when scrolling through many distinct authors.
// On overflow the LRU evicts the coldest entries incrementally (hot/visible rows survive).
const gutterCacheCap = 4096;

export interface GutterEpochParams {
	rowHeight: number;
	columnWidth: number;
	graphColumnWidth: number;
	foldLaneWidth: number;
	singleColumn: boolean;
	placement: GraphPlacement;
	nodeMode: NodeStyle['mode'];
	nodeAvatars: boolean;
	/** Bumps whenever the active lane palette changes — lane colors are baked into the SVG as literal
	 *  hex (not CSS vars), so a palette swap must invalidate every cached template. */
	paletteEpoch: number;
}

/**
 * The render-global inputs (metrics, density, node style, palette) every row's SVG bakes in. When any
 * change, no cached template can survive — so a changed signature drops the whole cache. Kept separate
 * from the per-row key so those inputs don't bloat every key.
 *
 * The scroll offset is deliberately ABSENT: gutters are built at absolute lane positions and the
 * compositor translates the surface, so scrolling never evicts the cache — templates are reused across
 * every offset. The lane BUILD window (`metrics.laneWindow`) is likewise absent — it's per-row key
 * state, so a window-bucket crossing re-keys only the rows it clips instead of wiping the whole cache.
 */
export function gutterEpochSignature(p: GutterEpochParams): string {
	return `${p.rowHeight}|${p.columnWidth}|${p.graphColumnWidth}|${p.foldLaneWidth}|${
		p.singleColumn ? 1 : 0
	}|${p.placement}|${p.nodeMode}|${p.nodeAvatars ? 1 : 0}|${p.paletteEpoch}`;
}

// Per-row cache key: everything the SVG bakes in that VARIES row-to-row within one epoch. Edge topology
// (kinds, spansHidden, and the node column) is the engine's `buildEdgeHash`; the rest is the node shape
// (kind), the lane-collapse hit-target, and — only for authored rows in avatar mode — the identity
// payload (avatar url / initials) or the workdir wip glyph. The `<svg>` width is keyed ONLY for
// unwindowed builds (it's the content width there); windowed builds derive their content width from the
// WINDOW, so their keys carry no width and stay identical across offsets — the lane window itself is NOT
// keyed either: entries remember the window they were built under and match by COVERAGE (see `render`).
function gutterRowKey(
	row: ProcessedGraphRow,
	metrics: GutterMetrics,
	laneTipSha: string | undefined,
	nodeStyle: NodeStyle | undefined,
): string {
	// Length-prefix the free-form segments (`<len>:<value>`) so a value containing the `|` delimiter can't
	// straddle into the next segment and collide with a different row's key.
	let key = `${buildEdgeHash(row.edges, row.edgeColumnMax, row.column)}|${row.column}|${row.kind}`;
	if (metrics.laneWindow == null) {
		key = `${key}|${metrics.gutterWidth}`;
	}
	if (laneTipSha != null) {
		key = `${key}|t${laneTipSha.length}:${laneTipSha}`;
	}
	// Identity-node payload reaches the SVG only for authored rows in avatar mode (stash → glyph square,
	// workdir → dotted circle, both payload-free). Omitting it elsewhere keeps dot-mode keys down to the
	// few edge shapes.
	if (nodeStyle?.mode === 'avatar' && row.kind !== 'stash' && row.kind !== 'workdir') {
		const url = nodeStyle.avatars ? (nodeStyle.avatarUrl ?? '') : '';
		// `avatarEmail` is baked into the SVG (`data-avatar-email`, read back by the error-fallback
		// reporter) — key it too, or rows sharing a proxied data-URI would report the wrong email.
		const email = nodeStyle.avatarEmail ?? '';
		key = `${key}|a${url.length}:${url}|e${email.length}:${email}|i${nodeStyle.initials.length}:${nodeStyle.initials}`;
	}
	if (row.kind === 'workdir') {
		key = `${key}|w${nodeStyle?.wipState ?? ''}`;
	}
	return key;
}

/** Builds one row's gutter art — injected so this module never loads Lit (`renderGutterSvg` in prod). */
export type GutterBuilder = (
	row: ProcessedGraphRow,
	metrics: GutterMetrics,
	laneTipSha?: string,
	nodeStyle?: NodeStyle,
) => TemplateResult;

// A cached build remembers the window it was built UNDER so lookups can match by coverage instead of
// exact bounds: a build's content is a visual SUPERSET of any window it covers (extra lane art beyond
// the needed window is translated/clipped/faded out by the viewport), so it stays valid across offsets.
type GutterCacheEntry = { win: LaneWindow | undefined; tpl: TemplateResult };

/** A stored build serves a needed window when it has at least the needed content: unwindowed builds (and
 *  builds whose window never clipped this row) contain the row's ENTIRE lane art; otherwise the stored
 *  window must cover the needed one. A needed `undefined` (no window active) requires full art. */
function gutterEntryValid(
	stored: LaneWindow | undefined,
	needed: LaneWindow | undefined,
	row: ProcessedGraphRow,
): boolean {
	if (stored == null || !windowClipsRow(stored, row)) return true;

	return needed != null && laneWindowCovers(stored, needed);
}

/**
 * Memo over the injected gutter builder. Call `beginEpoch` once per render with the global signature
 * (drops the cache when the render-global inputs change); then `render` per row hands back a cached
 * `TemplateResult` on a hit or builds + stores one on a miss.
 */
export class GutterCache {
	private readonly map: LruMap<string, GutterCacheEntry>;
	private epoch: string | undefined;
	/** Test seam: count of real builder invocations (cache misses) since construction. */
	builds = 0;

	constructor(
		private readonly build: GutterBuilder,
		cap: number = gutterCacheCap,
	) {
		this.map = new LruMap(cap);
	}

	/** Start a render epoch. A changed signature drops every entry (all baked the old globals); an
	 *  unchanged one is a cheap no-op (vertical scroll, selection, focus, payload-only swaps). */
	beginEpoch(signature: string): void {
		if (signature === this.epoch) return;

		this.epoch = signature;
		this.map.clear();
	}

	render(row: ProcessedGraphRow, metrics: GutterMetrics, laneTipSha?: string, nodeStyle?: NodeStyle): TemplateResult {
		const key = gutterRowKey(row, metrics, laneTipSha, nodeStyle);
		const needed = metrics.laneWindow;
		const entry = this.map.get(key);
		if (entry !== undefined && gutterEntryValid(entry.win, needed, row)) {
			// Promote on a hit so a re-rendered (still-visible) row stays hot and survives the LRU eviction
			// that scrolling through many distinct authors would otherwise trigger.
			this.map.touch(key);
			return entry.tpl;
		}

		// Miss. When REPLACING a windowed entry, build at a bounded UNION of the old + new windows so an
		// oscillating offset (reveal there-and-back, bucket ping-pong) converges to ONE build that covers
		// both ends and hits forever after — bounded to 3× the needed span so a long-distance jump doesn't
		// balloon the build toward full width.
		let buildWin = needed;
		if (entry?.win != null && needed != null) {
			const union: LaneWindow = {
				startColumn: Math.min(entry.win.startColumn, needed.startColumn),
				endColumn: Math.max(entry.win.endColumn, needed.endColumn),
			};
			if (union.endColumn - union.startColumn <= (needed.endColumn - needed.startColumn) * 3) {
				buildWin = union;
			}
		}
		// Never unbounded: the LRU evicts the coldest entries incrementally once the cap is exceeded.
		this.builds++;
		const built = this.build(
			row,
			buildWin === needed ? metrics : { ...metrics, laneWindow: buildWin },
			laneTipSha,
			nodeStyle,
		);
		this.map.set(key, { win: buildWin, tpl: built });
		return built;
	}

	/** Drop the cache + epoch (e.g. on disconnect). */
	clear(): void {
		this.map.clear();
		this.epoch = undefined;
	}

	/** Test seam: current number of live cached entries. */
	get size(): number {
		return this.map.size;
	}
}

// Internal helper exposed for direct unit coverage.
export const __test = { gutterRowKey: gutterRowKey };
