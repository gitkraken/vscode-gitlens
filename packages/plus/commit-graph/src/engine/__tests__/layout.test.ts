import * as assert from 'assert';
import {
	assignPinnedColumns,
	collectReachable,
	computeColumns,
	computeColumnsAndSegments,
	identifyFirstParentChain,
} from '../layout.js';
import type { CommitKind, GraphRow, Sha } from '../types.js';

// Minimal row builder — the layout only reads sha/parents/kind/date.
function row(sha: Sha, parents: Sha[] = [], kind: CommitKind = 'commit', date = 0): GraphRow {
	return { sha: sha, parents: parents, kind: kind, date: date };
}

// Fixture shapes locked by these tests — the engine's column output must stay stable so the
// Phase 7 incremental-append path can be asserted equal to a full recompute.
const fixtures = {
	// A→B→C→D, all first-parent — a single lane.
	linear: (): GraphRow[] => [row('A', ['B']), row('B', ['C']), row('C', ['D']), row('D', [])],
	// M merges A and B, both forking from C — a two-lane fan that collapses back to one.
	mergeFan: (): GraphRow[] => [row('M', ['A', 'B'], 'merge'), row('A', ['C']), row('B', ['C']), row('C', [])],
	// M's second parent Z is below the loaded window — its lane must be held (dangling stub).
	unloadedParent: (): GraphRow[] => [row('M', ['A', 'Z'], 'merge'), row('A', [])],
	// A stash sharing A's parent C — the stash keeps its own lane and kind.
	stashLane: (): GraphRow[] => [row('A', ['C']), row('S', ['C'], 'stash'), row('C', [])],
};

suite('engine/layout computeColumns', () => {
	test('linear history places every commit on column 0', () => {
		const rows = computeColumns(fixtures.linear());
		assert.deepStrictEqual(
			rows.map(r => r.column),
			[0, 0, 0, 0],
		);
	});

	test('merge fan puts the second-parent branch on its own lane', () => {
		const rows = computeColumns(fixtures.mergeFan());
		// M=0 (trunk), A=0 (first parent inherits), B=1 (second-parent branch), C=0 (reclaims trunk).
		assert.deepStrictEqual(
			rows.map(r => [r.sha, r.column]),
			[
				['M', 0],
				['A', 0],
				['B', 1],
				['C', 0],
			],
		);
	});

	test('unloaded second parent reserves a held column exposed via unloadedColumns', () => {
		const { rows, unloadedColumns } = computeColumnsAndSegments(fixtures.unloadedParent());
		assert.deepStrictEqual(
			rows.map(r => r.column),
			[0, 0],
		);
		// Z never loaded, but its reserved lane is surfaced so the edge pass can dangle a stub.
		assert.strictEqual(unloadedColumns.get('Z'), 1);
	});

	test('a stash keeps its own lane and kind', () => {
		const rows = computeColumns(fixtures.stashLane());
		const s = rows.find(r => r.sha === 'S')!;
		assert.strictEqual(s.column, 1);
		assert.strictEqual(s.kind, 'stash');
	});
});

suite('engine/layout segments', () => {
	test('linear history yields one fold segment covering the whole lane', () => {
		const { segments } = computeColumnsAndSegments(fixtures.linear());
		assert.strictEqual(segments.length, 1);
		assert.strictEqual(segments[0].tipSha, 'A');
		assert.strictEqual(segments[0].forkSha, null);
		assert.deepStrictEqual([...segments[0].commitShas], ['A', 'B', 'C', 'D']);
	});

	test('single-commit lanes are not emitted as segments', () => {
		// The B-lane in the fan holds only B (< 2 commits) → dropped.
		const { segments } = computeColumnsAndSegments(fixtures.mergeFan());
		assert.ok(!segments.some(s => s.commitShas.length < 2));
	});
});

suite('engine/layout purity', () => {
	test('computeColumns does not mutate the input rows (immutable-rows contract)', () => {
		const input = fixtures.mergeFan();
		const snapshot = JSON.parse(JSON.stringify(input));
		const out = computeColumns(input);
		// Input untouched...
		assert.deepStrictEqual(input, snapshot);
		// ...and the output rows are fresh objects, not the same references.
		for (let i = 0; i < input.length; i++) {
			assert.notStrictEqual(out[i], input[i]);
		}
	});

	test('running twice on the same input is deterministic', () => {
		const a = computeColumnsAndSegments(fixtures.mergeFan());
		const b = computeColumnsAndSegments(fixtures.mergeFan());
		assert.deepStrictEqual(a.rows, b.rows);
		assert.deepStrictEqual(a.segments, b.segments);
		assert.deepStrictEqual([...a.unloadedColumns], [...b.unloadedColumns]);
	});
});

suite('engine/layout pinned columns', () => {
	test('assignPinnedColumns tags each head first-parent chain with its stack column', () => {
		// Two stacked heads: H1→X→base, H2→Y→base. Base is shared, keeps the lower lane.
		const rows = [row('H1', ['X']), row('H2', ['Y']), row('X', ['base']), row('Y', ['base']), row('base', [])];
		const cols = assignPinnedColumns(rows, ['H1', 'H2']);
		assert.strictEqual(cols.get('H1'), 0);
		assert.strictEqual(cols.get('X'), 0);
		assert.strictEqual(cols.get('base'), 0); // shared ancestor stays on the earlier head's lane
		assert.strictEqual(cols.get('H2'), 1);
		assert.strictEqual(cols.get('Y'), 1);
	});

	test('a head not present in the loaded rows reserves no column', () => {
		const rows = [row('H1', ['base']), row('base', [])];
		const cols = assignPinnedColumns(rows, ['H1', 'missing']);
		assert.strictEqual(cols.get('H1'), 0);
		assert.strictEqual(cols.has('missing'), false);
	});

	// Regression: a stash reserves a pinned first-parent (F); a newer non-stash sibling (T, via C1)
	// later displaces that reservation. The replacement guard must never win when the parent is
	// pinned — adoption lands F on column 0 regardless, and the displaced reservation's column would
	// otherwise leak in `columnsUsed` forever, pushing later lanes right.
	test('a stash-displaced reservation on a pinned parent does not leak its column', () => {
		const rows = [
			row('S', ['F'], 'stash', 50),
			row('C1', ['T'], 'commit', 90),
			row('T', ['F'], 'commit', 80),
			row('F', [], 'commit', 0),
			row('X', [], 'commit', 10),
		];
		const { rows: out } = computeColumnsAndSegments(rows, { pinnedShas: ['F'] });
		const columnOf = (sha: Sha): number => out.find(r => r.sha === sha)!.column;

		assert.strictEqual(columnOf('F'), 0, 'F lands on its pinned column');
		assert.strictEqual(columnOf('X'), 2, "X claims T's freed lane (2), not a column leaked past it (3)");
	});
});

suite('engine/layout identifyFirstParentChain', () => {
	test('walks first-parent from the head and unions converging chains', () => {
		const rows = [row('A', ['B', 'X']), row('X', ['C']), row('B', ['C']), row('C', [])];
		const chain = identifyFirstParentChain(rows, ['A']);
		// First-parent walk: A→B→C. X is a second parent, not on the chain.
		assert.deepStrictEqual([...chain].sort(), ['A', 'B', 'C']);
	});

	test('empty heads yields an empty chain', () => {
		assert.strictEqual(identifyFirstParentChain(fixtures.linear(), []).size, 0);
	});
});

suite('engine/layout collectReachable', () => {
	// Two branches over a shared base:  main→S,  feature→S.
	//   main:    A → B → S
	//   feature: X → Y → S
	const forked = (): GraphRow[] => [row('A', ['B']), row('X', ['Y']), row('B', ['S']), row('Y', ['S']), row('S', [])];

	test('collects the full ancestor set of a single tip', () => {
		const reachable = collectReachable(forked(), ['A']);
		assert.deepStrictEqual([...reachable].sort(), ['A', 'B', 'S']);
	});

	test('unions the ancestors of multiple tips', () => {
		const reachable = collectReachable(forked(), ['A', 'X']);
		assert.deepStrictEqual([...reachable].sort(), ['A', 'B', 'S', 'X', 'Y']);
	});

	test('hiding a branch drops only its unique commits (shared base stays)', () => {
		// Visible tips = feature only → main's unique commits (A, B) disappear, shared S stays.
		const visible = collectReachable(forked(), ['X']);
		assert.deepStrictEqual([...visible].sort(), ['S', 'X', 'Y']);
		assert.ok(!visible.has('A'));
		assert.ok(!visible.has('B'));
		assert.ok(visible.has('S')); // shared ancestor still reachable from the visible branch
	});

	test('a tip not present in the loaded rows contributes nothing', () => {
		const reachable = collectReachable(forked(), ['not-loaded']);
		assert.strictEqual(reachable.size, 0);
	});

	test('merge commits reach through every parent', () => {
		const rows = [row('M', ['A', 'B'], 'merge'), row('A', ['C']), row('B', ['C']), row('C', [])];
		assert.deepStrictEqual([...collectReachable(rows, ['M'])].sort(), ['A', 'B', 'C', 'M']);
	});
});
