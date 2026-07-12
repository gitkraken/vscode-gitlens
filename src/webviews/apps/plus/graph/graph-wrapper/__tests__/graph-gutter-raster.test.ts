import * as assert from 'assert';
import type { Edge, ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { GutterEdgeOp } from '@gitkraken/commit-graph/laneClamp.js';
import { computeGutterGeometry, computeLaneWindow } from '@gitkraken/commit-graph/laneClamp.js';
import { buildRasterImageData } from '../graph-gutter-raster.js';

// `buildRasterImageData` is the Lit-free serialization of a row's pass-through lanes into one
// `data:image/svg+xml` `<image>` URI — the raster half of the hybrid gutter. These assert the URI is
// deterministic (the gutter cache relies on identical ops → identical template), transport-safe
// (URI-encoded), bounded to the built lane band, and bakes the resting `.graph-edge` styling.

const rowHeight = 24;

function rasterLine(x: number, color: string, cls = 'graph-edge'): GutterEdgeOp {
	return {
		el: 'line',
		layer: 'raster',
		cls: cls,
		color: color,
		x1: x,
		y1: 0,
		x2: x,
		y2: rowHeight,
		d: '',
		opacity: 1,
	};
}
function overlayLine(x: number, color: string): GutterEdgeOp {
	return {
		el: 'line',
		layer: 'overlay',
		cls: 'graph-edge',
		color: color,
		x1: x,
		y1: 0,
		x2: x,
		y2: rowHeight,
		d: '',
		opacity: 1,
	};
}

// Build + assert-present, so callers get a non-optional result without a non-null assertion.
function build(ops: GutterEdgeOp[]): { uri: string; x: number; width: number } {
	const data = buildRasterImageData(ops, rowHeight);
	assert.ok(data != null, 'expected raster image data');
	return data;
}

// Decode the `<svg …>` string back out of a `data:image/svg+xml,<encoded>` URI.
function decodeSvg(uri: string): string {
	const prefix = 'data:image/svg+xml,';
	assert.ok(uri.startsWith(prefix), 'URI carries the data:image/svg+xml prefix');
	return decodeURIComponent(uri.slice(prefix.length));
}

suite('graph-gutter-raster — buildRasterImageData', () => {
	test('no pass-through lanes → undefined (overlay-only / single-column rows raster nothing)', () => {
		assert.strictEqual(buildRasterImageData([], rowHeight), undefined);
		// Overlay ops are ignored — a row whose only art is node-connected has no raster layer.
		assert.strictEqual(buildRasterImageData([overlayLine(20, '#abc')], rowHeight), undefined);
	});

	test('is deterministic — identical ops produce a byte-identical URI', () => {
		const a = build([rasterLine(20, '#e57373'), rasterLine(56, '#64b5f6')]);
		const b = build([rasterLine(20, '#e57373'), rasterLine(56, '#64b5f6')]);
		assert.strictEqual(a.uri, b.uri);
	});

	test('URI-encodes so #hex, <, > and quotes are transport-safe', () => {
		const data = build([rasterLine(20, '#e57373')]);
		const encoded = data.uri.slice('data:image/svg+xml,'.length);
		for (const ch of ['<', '>', '"', '#']) {
			assert.ok(!encoded.includes(ch), `encoded URI contains no raw "${ch}"`);
		}
		// …but round-trips to a well-formed SVG carrying the color.
		assert.ok(decodeSvg(data.uri).includes('stroke="#e57373"'));
	});

	test('places the <image> at the lanes’ logical extent, bounded to the band (not the full gutter)', () => {
		// Lanes at x=20 and x=200 (a wide row). Origin = minX - halfStroke(1); width = (max-min) + stroke(2).
		const data = build([rasterLine(20, '#111'), rasterLine(200, '#222')]);
		assert.strictEqual(data.x, 19);
		assert.strictEqual(data.width, 182);
		// Local coords: the leftmost lane sits at halfStroke inside the band; the SVG viewBox matches width×H.
		const svg = decodeSvg(data.uri);
		assert.ok(svg.includes(`viewBox="0 0 182 ${rowHeight}"`));
		assert.ok(svg.includes('<line x1="1" x2="1"'), 'leftmost lane at local x = halfStroke');
		assert.ok(svg.includes('<line x1="181" x2="181"'), 'rightmost lane at band width - halfStroke');
	});

	test('bakes the resting .graph-edge styling flat (author CSS overrides the per-op opacity attribute)', () => {
		const svg = decodeSvg(build([rasterLine(20, '#111')]).uri);
		assert.ok(svg.includes('stroke-width="2"'), 'stroke-width 2');
		assert.ok(svg.includes('stroke-opacity="0.78"'), 'resting .graph-edge opacity');
		assert.ok(svg.includes('stroke-linecap="round"'));
		assert.ok(svg.includes('fill="none"'));
		assert.ok(svg.includes(`y2="${rowHeight}"`), 'lanes span the full row height');
	});

	test('mirrors the .graph-edge dash modifiers per lane kind', () => {
		const svg = decodeSvg(
			build([
				rasterLine(20, '#111', 'graph-edge'),
				rasterLine(40, '#222', 'graph-edge is-dotted'),
				rasterLine(60, '#333', 'graph-edge is-dashed'),
			]).uri,
		);
		// Solid lane carries no dash; dotted/dashed carry their patterns (matching graph.scss).
		assert.strictEqual((svg.match(/stroke-dasharray/g) ?? []).length, 2);
		assert.ok(svg.includes('stroke-dasharray="0.1 4"'), 'dotted');
		assert.ok(svg.includes('stroke-dasharray="5 4"'), 'dashed');
	});

	test('synthetic (reachability) lanes carry their own wavy filter defs', () => {
		const plain = decodeSvg(build([rasterLine(20, '#111')]).uri);
		assert.ok(!plain.includes('<filter'), 'no filter defs when no synthetic lane');

		const svg = decodeSvg(build([rasterLine(20, '#111', 'graph-edge is-dotted is-synthetic')]).uri);
		assert.ok(svg.includes('<filter id="w">'), 'inlines the wavy filter def');
		assert.ok(svg.includes('feDisplacementMap'), 'the displacement map');
		assert.ok(svg.includes('filter="url(#w)"'), 'synthetic lane references it');
		assert.ok(svg.includes('stroke-dasharray="0.1 4"'), 'synthetic is also dotted');
	});
});

// Deep-h-scroll bucket crossing, end-to-end over the REAL window derivation + geometry: the raster for a
// row must be REBUILT (different ops → different URI + x placement) when the scroll offset crosses into a
// new window bucket — a stale first-bucket raster merely translated off-canvas is exactly the "lanes vanish
// at deep h-scroll" regression shape. Fixtures mirror the linux-repo A/B: columnWidth 10, viewport 150,
// maxColumn 300, deep offset = the h-scroll max (gutter minus viewport).
suite('graph-gutter-raster — window bucket crossing', () => {
	const columnWidth = 10;
	const viewport = 150;
	const maxColumn = 300;
	const gutterWidth = 16 + 301 * columnWidth;
	const deepScrollX = gutterWidth - viewport;

	function edge(): Edge {
		return { parentSha: 'P', kind: 'commit', spansHidden: false };
	}
	// Sparse column-indexed edges, like laneClamp.test.ts's fixture builder.
	function rowWithPassThroughs(column: number, columns: number[]): ProcessedGraphRow {
		const edges: unknown[] = [];
		edges[column] = { starting: edge() };
		for (const c of columns) {
			edges[c] = { passThrough: edge() };
		}
		return {
			sha: 'X',
			parents: [],
			column: column,
			edgeColumnMax: Math.max(column, ...columns),
			kind: 'commit',
			edges: edges,
		} as unknown as ProcessedGraphRow;
	}

	function opsAt(row: ProcessedGraphRow, scrollX: number): readonly GutterEdgeOp[] {
		const win = computeLaneWindow({
			maxColumn: maxColumn,
			columnWidth: columnWidth,
			viewport: viewport,
			scrollX: scrollX,
		});
		return computeGutterGeometry(row, {
			rowHeight: rowHeight,
			columnWidth: columnWidth,
			singleColumn: false,
			nodeRadius: 5,
			isWorkdir: false,
			window: win,
		}).edges;
	}
	function rasterAt(row: ProcessedGraphRow, scrollX: number): ReturnType<typeof buildRasterImageData> {
		return buildRasterImageData(opsAt(row, scrollX), rowHeight);
	}

	test('a spanning row rebuilds a DIFFERENT raster (URI + x placement) at the deep bucket', () => {
		// Lanes at every column — the row has art in view at every offset.
		const all = Array.from({ length: 298 }, (_, i) => i + 3);
		const r = rowWithPassThroughs(2, all);
		const rest = rasterAt(r, 0);
		const deep = rasterAt(r, deepScrollX);
		assert.ok(rest != null && deep != null, 'both buckets raster');
		assert.notStrictEqual(rest.uri, deep.uri, 'deep bucket bakes different lanes');
		assert.notStrictEqual(rest.x, deep.x, 'deep raster is placed at the shifted window origin');
		// The deep bucket's LANES cover the deep viewport (content [scrollX, scrollX+viewport]) — proving they
		// didn't vanish. Post-band, the viewport-edge lanes are OVERLAY (pinned + faded with their dots) and the
		// raster buffers the off-screen/middle columns, so coverage is over BOTH layers (each op carries its
		// logical lane x at build time).
		const deepOps = opsAt(r, deepScrollX);
		assert.ok(
			deepOps.some(op => op.x1 >= deepScrollX && op.x1 <= deepScrollX + viewport),
			'deep bucket has lanes (raster or overlay) inside the deep viewport',
		);
	});

	test('round-trip: returning to the first bucket reproduces the byte-identical URI (cacheable)', () => {
		const all = Array.from({ length: 298 }, (_, i) => i + 3);
		const r = rowWithPassThroughs(2, all);
		const a = rasterAt(r, 0);
		const b = rasterAt(r, deepScrollX);
		const c = rasterAt(r, 0);
		assert.ok(a != null && b != null && c != null);
		assert.strictEqual(a.uri, c.uri);
		assert.strictEqual(a.x, c.x);
	});

	test('a narrow row (lanes only near column 0) correctly rasters NOTHING at the deep bucket', () => {
		// This is what the live deep-h-scroll probe sampled: rows whose lanes all sit far left of the deep
		// window build zero raster ops — matching the DOM build, which emits zero edge elements for them.
		const low = Array.from({ length: 50 }, (_, i) => i + 2);
		const r = rowWithPassThroughs(1, low);
		assert.ok(rasterAt(r, 0) != null, 'rest bucket rasters the low lanes');
		assert.strictEqual(rasterAt(r, deepScrollX), undefined, 'deep bucket has none of this row’s lanes');
	});
});
