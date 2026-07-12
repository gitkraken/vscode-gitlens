import * as assert from 'assert';
import type { Edge, ProcessedGraphRow } from '../engine/types.js';
import {
	computeGutterGeometry,
	computeLaneWindow,
	graphEdgeFadePx,
	laneWindowCovers,
	laneWindowsEqual,
	orthEdgeFromNode,
	resolveGroupedLaneCap,
	rowShiftedGutterWidth,
	windowClipsRow,
} from '../laneClamp.js';
import type { GutterGeomParams, LaneWindow } from '../laneClamp.js';
import { gutterPadding, xForColumn } from '../view.js';

// Translated-surface model: geometry is built ONCE at logical (absolute) lane positions — these tests
// assert the op list's structure (layer split, membership, window skipping) and the pure width/window
// math. There is no clamp table / imperative pass anymore; scroll is a compositor translate and the
// pinned dot is CSS, so nothing here varies with the offset.

function edge(kind: Edge['kind'] = 'commit'): Edge {
	return { parentSha: 'P', kind: kind, spansHidden: false };
}
function row(
	column: number,
	edges: (ProcessedGraphRow['edges'][number] | undefined)[],
	kind: ProcessedGraphRow['kind'] = 'commit',
): ProcessedGraphRow {
	// A sparse array indexes by column exactly like the engine's `Record<number, RowEdge>` for the read
	// pattern `computeGutterGeometry` uses; cast through the shared shape for the test.
	return {
		sha: 'X',
		parents: [],
		column: column,
		edgeColumnMax: edges.length - 1,
		kind: kind,
		edges: edges as unknown as ProcessedGraphRow['edges'],
	};
}
function passThroughs(count: number): (ProcessedGraphRow['edges'][number] | undefined)[] {
	return Array.from({ length: count }, () => ({ passThrough: edge() }));
}

const geomParams: GutterGeomParams = {
	rowHeight: 46,
	columnWidth: 18,
	singleColumn: false,
	nodeRadius: 5,
	isWorkdir: false,
};

suite('laneClamp — orthEdgeFromNode', () => {
	test('bends toward the target lane with a rounded corner', () => {
		const d = orthEdgeFromNode(17, 23, 89, 46);
		assert.ok(d.startsWith('M 17 23 H '), d);
		assert.ok(d.includes(' Q 89 23 89 '), d);
		assert.ok(d.endsWith(' V 46'), d);
	});

	test('corner radius caps to half the available span', () => {
		// Tiny vertical span (2px) caps the radius at 1: H runs to edgeX - 1.
		const d = orthEdgeFromNode(17, 23, 35, 25);
		assert.ok(d.includes('H 34 '), d);
	});
});

suite('laneClamp — computeGutterGeometry (base ops)', () => {
	test('own-column starting/ending edges are overlay verticals at full opacity', () => {
		const r = row(1, [undefined, { starting: edge(), ending: edge() }]);
		const ops = computeGutterGeometry(r, geomParams).edges;
		assert.strictEqual(ops.length, 2);
		for (const op of ops) {
			assert.strictEqual(op.layer, 'overlay');
			assert.strictEqual(op.el, 'line');
			assert.strictEqual(op.x1, xForColumn(1, 18));
			assert.strictEqual(op.x2, xForColumn(1, 18));
			assert.strictEqual(op.opacity, 1);
		}
	});

	test('cross-column connectors are single orthogonal overlay paths (no stub twin)', () => {
		const r = row(0, [{ starting: edge() }, undefined, { starting: edge() }]);
		const ops = computeGutterGeometry(r, geomParams).edges;
		// Own-column vertical for col 0 + ONE path for the col-2 connector.
		assert.strictEqual(ops.length, 2);
		const path = ops.find(o => o.el === 'path');
		assert.ok(path != null);
		assert.strictEqual(path.layer, 'overlay');
		assert.strictEqual(path.opacity, 1);
		assert.ok(path.d.startsWith(`M ${xForColumn(0, 18)} 23 `), path.d);
		assert.ok(path.d.endsWith(' V 46'), path.d);
		assert.strictEqual(ops.filter(o => o.opacity === 0).length, 0, 'no hidden stub twins');
	});

	test('pass-through lanes are raster; node-connected ops are overlay', () => {
		const edges = passThroughs(5);
		edges[2] = { starting: edge(), ending: edge() };
		const r = row(2, edges);
		const ops = computeGutterGeometry(r, geomParams).edges;
		assert.strictEqual(ops.filter(o => o.layer === 'raster').length, 4);
		assert.strictEqual(ops.filter(o => o.layer === 'overlay').length, 2);
	});

	test('workdir starting edge begins at the node bottom edge (hollow leaf)', () => {
		const r = row(0, [{ starting: edge('workdir') }], 'workdir');
		const ops = computeGutterGeometry(r, { ...geomParams, isWorkdir: true }).edges;
		assert.strictEqual(ops[0].y1, 46 / 2 + geomParams.nodeRadius);
	});

	test('single-column mode emits no edges', () => {
		const r = row(3, passThroughs(6));
		const ops = computeGutterGeometry(r, { ...geomParams, singleColumn: true }).edges;
		assert.strictEqual(ops.length, 0);
	});

	test('window skips out-of-window lane art but keeps boundary-crossing connectors', () => {
		const edges = passThroughs(40);
		edges[3] = { starting: edge() };
		const r = row(30, edges);
		const win: LaneWindow = { startColumn: 20, endColumn: 39 };
		const ops = computeGutterGeometry(r, { ...geomParams, window: win }).edges;
		for (const op of ops.filter(o => o.layer === 'raster')) {
			const col = (op.x1 - xForColumn(0, 18)) / 18;
			assert.ok(col >= 20 && col <= 39, `raster lane ${col} outside window`);
		}
		// The col-3 connector's span [3..30] reaches into the window → its path still builds.
		assert.ok(
			ops.some(o => o.el === 'path' && o.d.includes(`Q ${xForColumn(3, 18)} `)),
			'boundary-crossing connector must build',
		);
	});

	test('lanes wholly outside the window (span included) are skipped entirely', () => {
		const r = row(30, passThroughs(40));
		const win: LaneWindow = { startColumn: 20, endColumn: 39 };
		const ops = computeGutterGeometry(r, { ...geomParams, window: win }).edges;
		assert.ok(!ops.some(o => o.el === 'line' && o.x1 < xForColumn(20, 18)));
	});
});

suite('laneClamp — computeLaneWindow', () => {
	const at = (scrollX: number, pinned?: boolean) =>
		computeLaneWindow({ maxColumn: 300, columnWidth: 18, viewport: 90, scrollX: scrollX, pinned: pinned });

	test('covers the viewport plus margins, clamped to real columns', () => {
		const w = at(0);
		assert.strictEqual(w.startColumn, 0);
		assert.ok(w.endColumn > 90 / 18, 'extends past the viewport');
		assert.ok(w.endColumn <= 300);
	});

	test('stable within a bucket; shifts across buckets', () => {
		// margin = max(2×90, 30×18) = 540 → step 270: 0 and 100 share bucket 0; 600 is bucket 2.
		assert.ok(laneWindowsEqual(at(0), at(100)), 'same bucket must reuse the window');
		assert.ok(!laneWindowsEqual(at(0), at(600)), 'crossing buckets shifts the window');
	});

	test('a sweep range spans the window across a reveal slide (both directions)', () => {
		const target = 18 * 40;
		const w = computeLaneWindow({
			maxColumn: 300,
			columnWidth: 18,
			viewport: 90,
			scrollX: target,
			pinned: true,
			sweep: { lo: 0, hi: target },
		});
		assert.strictEqual(w.startColumn, 0, 'covers the departed offset');
		assert.ok(xForColumn(w.endColumn, 18) >= target + 90, 'covers the target span');
		// Reverse sweep (revealing back left) spans the same range — and the range covers offsets the
		// scrollX itself sits INSIDE of (a retargeted slide can pass beyond both endpoints of the move).
		const back = computeLaneWindow({
			maxColumn: 300,
			columnWidth: 18,
			viewport: 90,
			scrollX: 0,
			pinned: true,
			sweep: { lo: 0, hi: target },
		});
		assert.strictEqual(back.startColumn, 0);
		assert.ok(xForColumn(back.endColumn, 18) >= target + 90);
	});

	test('a sweep range spans the bucketed (column) window across a reveal slide', () => {
		// The sweep window must COVER the plain window at BOTH endpoints — the slide passes through
		// every offset in between, and each intermediate frame is only correct if its own window's
		// content exists in the built one.
		const target = 1000;
		const sweep = computeLaneWindow({
			maxColumn: 300,
			columnWidth: 18,
			viewport: 90,
			scrollX: target,
			sweep: { lo: 0, hi: target },
		});
		assert.ok(laneWindowCovers(sweep, at(0)), 'covers the departed endpoint');
		assert.ok(laneWindowCovers(sweep, at(target)), 'covers the target endpoint');
	});

	test('pinned: exact at the offset with fade-only margin', () => {
		const w = at(18 * 20, true);
		assert.ok(w.startColumn <= 20 && w.startColumn >= 20 - Math.ceil((graphEdgeFadePx + 18) / 18) - 1);
		assert.ok(xForColumn(w.endColumn, 18) >= 18 * 20 + 90, 'covers the visible span');
		// Deterministic per offset — nearby offsets differ (no bucket quantization).
		assert.ok(!laneWindowsEqual(w, at(18 * 23, true)));
	});
});

suite('laneClamp — windowClipsRow / laneWindowsEqual', () => {
	test('windowClipsRow ⇔ the windowed build differs from unwindowed', () => {
		const win: LaneWindow = { startColumn: 0, endColumn: 10 };
		const inside = row(2, passThroughs(8));
		const outside = row(2, passThroughs(20));
		assert.strictEqual(windowClipsRow(win, inside), false);
		assert.strictEqual(windowClipsRow(win, outside), true);
		const a = computeGutterGeometry(inside, { ...geomParams, window: win }).edges;
		const b = computeGutterGeometry(inside, geomParams).edges;
		assert.deepStrictEqual(a, b, 'unclipped row builds byte-identical under the window');
	});

	test('laneWindowsEqual compares bounds', () => {
		assert.ok(laneWindowsEqual({ startColumn: 0, endColumn: 5 }, { startColumn: 0, endColumn: 5 }));
		assert.ok(!laneWindowsEqual({ startColumn: 0, endColumn: 5 }, { startColumn: 1, endColumn: 5 }));
		assert.ok(laneWindowsEqual(undefined, undefined));
		assert.ok(!laneWindowsEqual(undefined, { startColumn: 0, endColumn: 5 }));
	});

	test('laneWindowCovers: containment, not equality', () => {
		const wide = { startColumn: 0, endColumn: 50 };
		const narrow = { startColumn: 10, endColumn: 30 };
		assert.ok(laneWindowCovers(wide, narrow));
		assert.ok(laneWindowCovers(wide, wide), 'covers itself');
		assert.ok(!laneWindowCovers(narrow, wide));
		assert.ok(!laneWindowCovers(narrow, { startColumn: 5, endColumn: 20 }), 'partial overlap is not coverage');
		// Unwindowed (undefined) builds every lane: covers anything, only covered by unwindowed.
		assert.ok(laneWindowCovers(undefined, narrow));
		assert.ok(laneWindowCovers(undefined, undefined));
		assert.ok(!laneWindowCovers(narrow, undefined));
	});
});

suite('laneClamp — resolveGroupedLaneCap (grouped min/max)', () => {
	test('unmeasured width falls back to the minimum', () => {
		assert.strictEqual(resolveGroupedLaneCap(0, 26, 10, 40), 10);
		assert.strictEqual(resolveGroupedLaneCap(-1, 26, 10, 40), 10);
		assert.strictEqual(resolveGroupedLaneCap(800, 0, 10, 40), 10);
	});

	test('the minimum wins when the percentage budget is smaller', () => {
		assert.strictEqual(resolveGroupedLaneCap(400, 26, 10, 40), 10);
	});

	test('the percentage grows the cap on wider views', () => {
		const w = 2000;
		const expected = Math.floor((w * 0.4 - gutterPadding * 2) / 26);
		assert.ok(expected > 10, 'fixture sanity: dynamic beats the min');
		assert.strictEqual(resolveGroupedLaneCap(w, 26, 10, 40), expected);
	});

	test('the minimum floors at 1 and the percentage clamps to [0, 100]', () => {
		assert.strictEqual(resolveGroupedLaneCap(0, 26, 0, 40), 1);
		assert.strictEqual(resolveGroupedLaneCap(1000, 26, 1, 0), 1);
		assert.strictEqual(resolveGroupedLaneCap(1000, 26, 1, 200), resolveGroupedLaneCap(1000, 26, 1, 100));
	});
});

suite('laneClamp — rowShiftedGutterWidth (shifted per-row flow)', () => {
	const cw = 26;
	const cap = 276;
	const mk = (column: number, edgeCols: number[]): ProcessedGraphRow => {
		const edges: (ProcessedGraphRow['edges'][number] | undefined)[] = [];
		for (const c of edgeCols) {
			edges[c] = { passThrough: edge() };
		}
		return row(column, edges);
	};

	test('all lanes left of the offset shrink to the pin floor (just the pinned dot)', () => {
		// Floor = the pin position (first-lane x) + the trailing clearance.
		assert.strictEqual(rowShiftedGutterWidth(mk(2, [0, 1]), cw, cw * 20, cap), xForColumn(0, cw) + gutterPadding);
	});

	test('a lane sitting AT the offset still floors (the pinned dot must fully fit)', () => {
		// Visible extent ≈ pad — narrower than the dot; without the universal floor the viewport clips
		// the pinned dot in half at the row's right edge.
		assert.strictEqual(
			rowShiftedGutterWidth(mk(20, []), cw, xForColumn(20, cw), cap),
			xForColumn(0, cw) + gutterPadding,
		);
	});

	test('the rightmost visible lane governs the width — with a sliver of trailing air, not the dot inset', () => {
		const offset = cw * 20;
		const expected = xForColumn(24, cw) - offset + 4;
		assert.strictEqual(rowShiftedGutterWidth(mk(22, [21, 24]), cw, offset, cap), expected);
	});

	test("the row's own dot as the rightmost element keeps the full pin-inset clearance", () => {
		const offset = cw * 20;
		const expected = xForColumn(24, cw) - offset + gutterPadding;
		assert.strictEqual(rowShiftedGutterWidth(mk(24, [21, 22]), cw, offset, cap), expected);
	});

	test('a lane past the right cap forces full cap width', () => {
		assert.strictEqual(rowShiftedGutterWidth(mk(21, [60]), cw, cw * 20, cap), cap);
	});

	test('never exceeds the cap and never goes below the one-lane floor', () => {
		assert.ok(rowShiftedGutterWidth(mk(0, [5, 80, 200]), cw, cw * 3, cap) <= cap);
		assert.strictEqual(rowShiftedGutterWidth(mk(0, []), cw, cw * 50, cap), xForColumn(0, cw) + gutterPadding);
	});
});
