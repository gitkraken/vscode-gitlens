import * as assert from 'assert';
import { computeEdges } from '@gitkraken/commit-graph/engine/edges.js';
import { computeColumnsAndSegments } from '@gitkraken/commit-graph/engine/layout.js';
import type { CommitKind, GraphRow, ProcessedGraphRow, Sha } from '@gitkraken/commit-graph/engine/types.js';
import { computeLaneWindow, laneWindowsEqual } from '@gitkraken/commit-graph/laneClamp.js';
import type { GutterBuilder, GutterEpochParams } from '../graph-gutter-cache.js';
import { __test, GutterCache, gutterEpochSignature } from '../graph-gutter-cache.js';
import type { GutterMetrics, NodeStyle } from '../graph-gutter.js';

function row(sha: Sha, parents: Sha[] = [], kind: CommitKind = 'commit'): GraphRow {
	return { sha: sha, parents: parents, kind: kind, date: 0 };
}

// Build topology-only rows with real engine edges (so `buildEdgeHash` sees genuine shapes).
function buildRows(input: GraphRow[]): ProcessedGraphRow[] {
	const { rows, unloadedColumns } = computeColumnsAndSegments(input);
	computeEdges(rows, { unloadedColumns: unloadedColumns });
	return rows;
}

function metrics(over: Partial<GutterMetrics> = {}): GutterMetrics {
	return { gutterWidth: 100, rowHeight: 24, columnWidth: 12, ...over };
}

const dot: NodeStyle = { mode: 'compact', avatars: false, initials: 'AB' };

// Fake builder: unique object per call so identity (===) proves reuse vs rebuild without loading Lit.
function fakeBuilder(): GutterBuilder {
	return () => ({}) as unknown as ReturnType<GutterBuilder>;
}

suite('graph-gutter-cache — gutterEpochSignature', () => {
	const base: GutterEpochParams = {
		rowHeight: 24,
		columnWidth: 12,
		graphColumnWidth: 200,
		foldLaneWidth: 0,
		singleColumn: false,
		placement: 'column',
		nodeMode: 'compact',
		nodeAvatars: false,
		paletteEpoch: 0,
	};

	test('identical params produce identical signatures', () => {
		assert.strictEqual(gutterEpochSignature(base), gutterEpochSignature({ ...base }));
	});

	test('every render-global input moves the signature', () => {
		const patches: Partial<GutterEpochParams>[] = [
			{ rowHeight: 20 },
			{ columnWidth: 10 },
			{ graphColumnWidth: 180 },
			{ foldLaneWidth: 14 },
			{ singleColumn: true },
			{ placement: 'grouped' },
			{ nodeMode: 'avatar' },
			{ nodeAvatars: true },
			{ paletteEpoch: 1 },
		];
		for (const patch of patches) {
			assert.notStrictEqual(
				gutterEpochSignature(base),
				gutterEpochSignature({ ...base, ...patch }),
				`epoch must react to ${JSON.stringify(patch)}`,
			);
		}
	});

	test('the epoch is clamp-INDEPENDENT: horizontal scroll never evicts the cache', () => {
		// Gutters are built at logical lane positions; the smart-scroll clamp is applied imperatively per
		// frame (not baked into the SVG), so the epoch signature must NOT carry any scroll offset — every
		// h-scroll tick reuses the same cached templates. `GutterEpochParams` has no clamp fields at all;
		// this test pins that the signature is stable across what used to be clamp inputs.
		assert.strictEqual(gutterEpochSignature(base), gutterEpochSignature({ ...base }));
	});
});

suite('graph-gutter-cache — gutterRowKey', () => {
	test('lane-collapse hit-target presence changes the key', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, dot),
			__test.gutterRowKey(a, metrics(), 'A', dot),
		);
	});

	test('dot mode ignores avatar url + initials (they never reach the SVG)', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const other: NodeStyle = { mode: 'compact', avatars: true, avatarUrl: 'x', initials: 'ZZ' };
		assert.strictEqual(
			__test.gutterRowKey(a, metrics(), undefined, dot),
			__test.gutterRowKey(a, metrics(), undefined, other),
		);
	});

	test('avatar mode: avatar url + initials enter the key', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const av1: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', initials: 'AB' };
		const av2: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u2', initials: 'AB' };
		const av3: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', initials: 'CD' };
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, av1),
			__test.gutterRowKey(a, metrics(), undefined, av2),
		);
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, av1),
			__test.gutterRowKey(a, metrics(), undefined, av3),
		);
	});

	test('avatar mode: avatarEmail enters the key (error-fallback reporting identity)', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const e1: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', avatarEmail: 'a@x.io', initials: 'AB' };
		const e2: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', avatarEmail: 'b@x.io', initials: 'AB' };
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, e1),
			__test.gutterRowKey(a, metrics(), undefined, e2),
		);
	});

	test('avatar mode + stash row: avatar fields are omitted from the key', () => {
		const [s] = buildRows([row('S', ['A'], 'stash'), row('A', [])]);
		const av1: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', initials: 'AB' };
		const av2: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u2', initials: 'CD' };
		// A stash node renders a payload-free glyph square, so its key must ignore avatar url + initials.
		assert.strictEqual(
			__test.gutterRowKey(s, metrics(), undefined, av1),
			__test.gutterRowKey(s, metrics(), undefined, av2),
		);
	});

	test('length-prefixed segments cannot straddle (boundary collision resistance)', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		// Without length-prefixing, `url='u1|iAB'`+`initials=''` and `url='u1'`+`initials='AB'` would both
		// flatten to `...|au1|iAB...` and collide. Length prefixes keep them distinct.
		const straddle: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1|iAB', initials: '' };
		const normal: NodeStyle = { mode: 'avatar', avatars: true, avatarUrl: 'u1', initials: 'AB' };
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, straddle),
			__test.gutterRowKey(a, metrics(), undefined, normal),
		);
	});

	test('avatar mode with avatars OFF: url ignored (initials-only identity node)', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const av1: NodeStyle = { mode: 'avatar', avatars: false, avatarUrl: 'u1', initials: 'AB' };
		const av2: NodeStyle = { mode: 'avatar', avatars: false, avatarUrl: 'u2', initials: 'AB' };
		assert.strictEqual(
			__test.gutterRowKey(a, metrics(), undefined, av1),
			__test.gutterRowKey(a, metrics(), undefined, av2),
		);
	});

	test('gutter width keys ONLY unwindowed builds (windowed keys are width/offset-agnostic)', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		// Unwindowed: the width IS the svg content width → keyed.
		assert.notStrictEqual(
			__test.gutterRowKey(a, metrics(), undefined, dot),
			__test.gutterRowKey(a, metrics({ gutterWidth: 200 }), undefined, dot),
		);
		// Windowed: content width derives from the WINDOW, so per-offset row widths never re-key — the
		// property that lets grouped reveals cache-hit across offsets.
		const win = { startColumn: 0, endColumn: 17 };
		assert.strictEqual(
			__test.gutterRowKey(a, metrics({ laneWindow: win }), undefined, dot),
			__test.gutterRowKey(a, metrics({ laneWindow: win, gutterWidth: 200 }), undefined, dot),
		);
	});

	test('lane window never enters the key — coverage matching happens at the ENTRY level', () => {
		// Merge fan → a row whose edges span several columns (edgeColumnMax > 0).
		const [m] = buildRows([
			row('M', ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'], 'merge'),
			row('P0'),
			row('P1'),
			row('P2'),
			row('P3'),
			row('P4'),
			row('P5'),
		]);
		assert.ok(m.edgeColumnMax >= 2, 'fixture row must span columns');

		// Every windowed key is identical regardless of bounds or whether the window clips the row.
		const endClipped = metrics({ laneWindow: { startColumn: 0, endColumn: m.edgeColumnMax - 1 } });
		const startClipped = metrics({ laneWindow: { startColumn: 1, endColumn: m.edgeColumnMax } });
		const covering = metrics({ laneWindow: { startColumn: 0, endColumn: m.edgeColumnMax } });
		const k = __test.gutterRowKey(m, endClipped, undefined, dot);
		assert.strictEqual(__test.gutterRowKey(m, startClipped, undefined, dot), k);
		assert.strictEqual(__test.gutterRowKey(m, covering, undefined, dot), k);

		// Windowed and unwindowed builds key separately (only the latter bakes the width).
		assert.notStrictEqual(__test.gutterRowKey(m, metrics(), undefined, dot), k);
	});

	test('workdir wip state (clean vs dirty center dot) changes the key', () => {
		const [w] = buildRows([row('W', ['A'], 'workdir'), row('A', [])]);
		const clean: NodeStyle = { mode: 'compact', avatars: false, initials: '', wipState: 'clean' };
		const dirty: NodeStyle = { mode: 'compact', avatars: false, initials: '', wipState: 'dirty' };
		assert.notStrictEqual(
			__test.gutterRowKey(w, metrics(), undefined, clean),
			__test.gutterRowKey(w, metrics(), undefined, dirty),
		);
	});
});

suite('graph-gutter-cache — GutterCache', () => {
	test('re-rendering unchanged rows performs ZERO builds and reuses templates', () => {
		const rows = buildRows([row('A', ['B']), row('B', ['C']), row('C', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');

		const first = rows.map(r => cache.render(r, metrics(), undefined, dot));
		const distinct = new Set(rows.map(r => __test.gutterRowKey(r, metrics(), undefined, dot))).size;
		assert.strictEqual(cache.builds, distinct, 'one build per distinct edge shape');

		// Second pass, same epoch + inputs → no new builds, identical template instances.
		cache.beginEpoch('e1');
		const before = cache.builds;
		const second = rows.map(r => cache.render(r, metrics(), undefined, dot));
		assert.strictEqual(cache.builds, before, 'second pass performs zero gutter builds');
		rows.forEach((_, i) => assert.strictEqual(second[i], first[i], 'same TemplateResult reused'));
	});

	test('structurally identical rows across graphs share a single build (buildEdgeHash reuse)', () => {
		const a = buildRows([row('A', ['B']), row('B', ['C']), row('C', [])]);
		const b = buildRows([row('X', ['Y']), row('Y', ['Z']), row('Z', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');

		const ta = cache.render(a[0], metrics(), undefined, dot);
		const tb = cache.render(b[0], metrics(), undefined, dot);
		assert.strictEqual(cache.builds, 1, 'identical linear shapes hash + cache identically');
		assert.strictEqual(ta, tb, 'the same cached template serves both');
	});

	test('changing one row rebuilds exactly that row; others stay cached', () => {
		const rows = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');

		const tA = cache.render(rows[0], metrics(), undefined, dot);
		const tB = cache.render(rows[1], metrics(), undefined, dot);
		assert.strictEqual(cache.builds, 2);

		// Simulate an engine recompute that changed ONLY row A (its node kind flipped); B is untouched.
		const changedA: ProcessedGraphRow = { ...rows[0], kind: 'merge' };
		const tA2 = cache.render(changedA, metrics(), undefined, dot);
		assert.notStrictEqual(tA2, tA, 'the changed row is rebuilt');
		assert.strictEqual(cache.builds, 3, 'exactly one rebuild');

		assert.strictEqual(cache.render(rows[1], metrics(), undefined, dot), tB, 'the unchanged row still hits');
		assert.strictEqual(cache.builds, 3, 'the unchanged row is not rebuilt');
	});

	test('an epoch change drops the whole cache', () => {
		const rows = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');
		const t1 = cache.render(rows[0], metrics(), undefined, dot);
		assert.strictEqual(cache.size, 1);

		cache.beginEpoch('e2'); // e.g. density/theme/node-mode change
		assert.strictEqual(cache.size, 0, 'a new epoch clears every entry');
		const t2 = cache.render(rows[0], metrics(), undefined, dot);
		assert.notStrictEqual(t2, t1, 'the row rebuilds under the new epoch');
		assert.strictEqual(cache.builds, 2);
	});

	test('re-begin with the same signature keeps the cache warm', () => {
		const rows = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');
		cache.render(rows[0], metrics(), undefined, dot);
		cache.beginEpoch('e1'); // no-op
		assert.strictEqual(cache.size, 1, 'an unchanged epoch does not clear');
	});

	const av = (url: string): NodeStyle => ({ mode: 'avatar', avatars: true, avatarUrl: url, initials: 'AB' });

	test('is bounded (LRU): cap overflow evicts the coldest entry; size never exceeds the cap', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder(), 2);
		cache.beginEpoch('e1');

		// Distinct avatar payloads on the same row → distinct keys, so the cap actually bites.
		const t1 = cache.render(a, metrics(), undefined, av('u1')); // key1 — build, size 1
		const t2 = cache.render(a, metrics(), undefined, av('u2')); // key2 — build, size 2
		assert.strictEqual(cache.builds, 2);
		assert.strictEqual(cache.size, 2);

		// key3 overflows → the LRU (key1) is evicted incrementally; size stays at the cap.
		const t3 = cache.render(a, metrics(), undefined, av('u3'));
		assert.strictEqual(cache.builds, 3);
		assert.ok(cache.size <= 2, 'size never exceeds the cap');

		// key2 + key3 survived (hits, no rebuild); key1 was evicted (miss → rebuild, new instance).
		assert.strictEqual(cache.render(a, metrics(), undefined, av('u2')), t2, 'key2 survived');
		assert.strictEqual(cache.render(a, metrics(), undefined, av('u3')), t3, 'key3 survived');
		assert.strictEqual(cache.builds, 3, 'survivors are not rebuilt');

		const t1b = cache.render(a, metrics(), undefined, av('u1'));
		assert.notStrictEqual(t1b, t1, 'the evicted key1 was rebuilt');
		assert.strictEqual(cache.builds, 4);
	});

	test('a hot (repeatedly rendered) entry survives eviction while cold keys churn', () => {
		const [a] = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder(), 2);
		cache.beginEpoch('e1');

		const hot = cache.render(a, metrics(), undefined, av('hot'));
		// Each round adds a cold key (evicting the previous cold one) then re-renders `hot`; the on-hit
		// promotion keeps `hot` most-recently-used, so it's never the eviction victim.
		for (const url of ['c1', 'c2', 'c3', 'c4']) {
			cache.render(a, metrics(), undefined, av(url));
			assert.strictEqual(cache.render(a, metrics(), undefined, av('hot')), hot, `hot survived churn past ${url}`);
		}
		assert.ok(cache.size <= 2, 'the cache never exceeds its cap');
	});

	test('a stored window COVERING the needed one is a pure hit (reveal-shaped window changes)', () => {
		const [m] = buildRows([
			row('M', ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'], 'merge'),
			row('P0'),
			row('P1'),
			row('P2'),
			row('P3'),
			row('P4'),
			row('P5'),
		]);
		assert.ok(m.edgeColumnMax >= 3, 'fixture row must span columns');
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');

		// Build once at a wide (sweep-spanning) window, then render at narrower per-offset windows — the
		// reveal settle + subsequent reveals inside the span must all hit.
		const sweep = metrics({ laneWindow: { startColumn: 0, endColumn: m.edgeColumnMax - 1 } });
		const tSweep = cache.render(m, sweep, undefined, dot);
		assert.strictEqual(cache.builds, 1);
		const narrow = metrics({ laneWindow: { startColumn: 1, endColumn: m.edgeColumnMax - 1 } });
		assert.strictEqual(cache.render(m, narrow, undefined, dot), tSweep, 'covered window hits');
		assert.strictEqual(cache.builds, 1, 'no rebuild for a covered window');
	});

	test('oscillating windows CONVERGE: the replacing build unions the old + new spans', () => {
		const [m] = buildRows([
			row('M', ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'], 'merge'),
			row('P0'),
			row('P1'),
			row('P2'),
			row('P3'),
			row('P4'),
			row('P5'),
		]);
		assert.ok(m.edgeColumnMax >= 2, 'fixture row must span columns');
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');

		const bucketA = metrics({ laneWindow: { startColumn: 0, endColumn: m.edgeColumnMax - 1 } });
		const bucketB = metrics({ laneWindow: { startColumn: 1, endColumn: m.edgeColumnMax } });
		const tA = cache.render(m, bucketA, undefined, dot);
		const tAB = cache.render(m, bucketB, undefined, dot);
		assert.strictEqual(cache.builds, 2, 'the non-covered window rebuilds (at the union)');
		assert.notStrictEqual(tAB, tA);
		assert.strictEqual(cache.size, 1, 'one entry per row shape — the union replaced the old build');

		// The union covers BOTH regimes: ping-ponging between them never rebuilds again.
		assert.strictEqual(cache.render(m, bucketA, undefined, dot), tAB);
		assert.strictEqual(cache.render(m, bucketB, undefined, dot), tAB);
		assert.strictEqual(cache.builds, 2, 'oscillation converges to zero rebuilds');
	});

	test('deep h-scroll bucket crossing: REAL windows at two offsets → cache MISS, return → HIT', () => {
		// End-to-end over the real window derivation (not hand-picked windows): a deep graph h-scrolled
		// from rest to its max offset crosses window buckets; the row MUST re-key (miss → rebuild with the
		// shifted window) or the committed gutter keeps the ORIGINAL bucket's art (rasters/lanes for the
		// wrong columns — the "raster lost on deep h-scroll" regression shape). Return restores from cache.
		// A ~120-lane graph: wide enough that the window actually clips (the margin floors at 30 columns,
		// so narrower graphs never window at all).
		const parents = Array.from({ length: 120 }, (_, i) => `P${i}`);
		const [m] = buildRows([row('M', parents, 'merge'), ...parents.map(p => row(p))]);
		assert.ok(m.edgeColumnMax >= 100, `fixture row must span many columns (got ${m.edgeColumnMax})`);
		// Deep-graph shape: viewport far narrower than the lane content, so windows activate + clip.
		const columnWidth = 12;
		const viewport = 3 * columnWidth;
		const maxColumn = m.edgeColumnMax;
		const winRest = computeLaneWindow({
			maxColumn: maxColumn,
			columnWidth: columnWidth,
			viewport: viewport,
			scrollX: 0,
		});
		// Scroll deep enough to cross a bucket (step = margin/2 = 15 columns) — clamp to the content max.
		const deepScrollX = (maxColumn + 1) * columnWidth;
		const winDeep = computeLaneWindow({
			maxColumn: maxColumn,
			columnWidth: columnWidth,
			viewport: viewport,
			scrollX: deepScrollX,
		});
		assert.ok(
			!laneWindowsEqual(winRest, winDeep),
			`fixture must cross a bucket (rest ${JSON.stringify(winRest)} vs deep ${JSON.stringify(winDeep)})`,
		);

		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');
		const tRest = cache.render(m, metrics({ columnWidth: columnWidth, laneWindow: winRest }), undefined, dot);
		assert.strictEqual(cache.builds, 1);
		const tDeep = cache.render(m, metrics({ columnWidth: columnWidth, laneWindow: winDeep }), undefined, dot);
		assert.strictEqual(cache.builds, 2, 'the far bucket is a MISS — the row rebuilds at the shifted window');
		assert.notStrictEqual(tRest, tDeep, 'the shifted window builds fresh content');
		// Back to rest: the far jump was too distant to union on the way out (bounded ×3), so this is one
		// more rebuild — but at the UNION, which now spans both ends...
		const tBack = cache.render(m, metrics({ columnWidth: columnWidth, laneWindow: winRest }), undefined, dot);
		assert.strictEqual(cache.builds, 3, 'the return trip rebuilds once, at the union');
		// ...so from here the oscillation is converged: BOTH regimes hit the same union build.
		assert.strictEqual(
			cache.render(m, metrics({ columnWidth: columnWidth, laneWindow: winDeep }), undefined, dot),
			tBack,
		);
		assert.strictEqual(
			cache.render(m, metrics({ columnWidth: columnWidth, laneWindow: winRest }), undefined, dot),
			tBack,
		);
		assert.strictEqual(cache.builds, 3, 'converged — further ping-pong rebuilds nothing');
	});

	test('clear empties the cache and resets the epoch', () => {
		const rows = buildRows([row('A', ['B']), row('B', [])]);
		const cache = new GutterCache(fakeBuilder());
		cache.beginEpoch('e1');
		cache.render(rows[0], metrics(), undefined, dot);
		cache.clear();
		assert.strictEqual(cache.size, 0);
	});
});
