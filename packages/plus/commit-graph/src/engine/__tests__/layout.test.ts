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

suite('engine/layout lane claims', () => {
	test('a WIP row never drags its anchor onto its own lane', () => {
		// A fresh claim landing BELOW its first parent's reservation trips the reservation-replace path,
		// which would pull the anchor (and its whole first-parent chain) up onto the WIP's lane.
		const rows = computeColumns([row('C', ['A']), row('W', ['A'], 'workdir'), row('A', [])]);
		const by = new Map(rows.map(r => [r.sha, r.column]));
		assert.strictEqual(by.get('A'), 0, 'the anchor must stay on its own lane');
		assert.strictEqual(by.get('W'), 1);
	});

	test('a WIP row on an unreserved anchor still shares its lane (straight dotted line)', () => {
		// The good case that must not regress: nothing reserved B, so W claims the lane and B inherits it.
		const rows = computeColumns([
			row('T', ['A']),
			row('W', ['B'], 'workdir'),
			row('A', ['BASE']),
			row('B', ['BASE']),
			row('BASE', []),
		]);
		const by = new Map(rows.map(r => [r.sha, r.column]));
		assert.strictEqual(by.get('W'), by.get('B'), 'the WIP row and its anchor share one lane');
	});

	test('a claim on the lowest free lane pulls its parent chain down onto it', () => {
		// Lane compaction, and what keeps the graph narrow: C3 claims the free column 0 and the
		// reservation-replace pulls C4 down onto it. Bounding claims away from a replaceable parent
		// reservation instead put C3 on column 2 and C4 on 1 — a wider graph for nothing.
		const rows = computeColumns([
			row('C0', ['C1', 'C2'], 'merge'),
			row('C1', ['C2'], 'stash'),
			row('C2', ['C4']),
			row('C3', ['C4'], 'stash'),
			row('C4', []),
		]);
		assert.deepStrictEqual(
			rows.map(r => r.column),
			[0, 0, 1, 0, 0],
		);
	});

	test('a tip under an unreplaceable reservation still takes the lowest free lane', () => {
		// C6 is a plain tip whose first parent C7 is an ADDITIONAL parent of the merge C1 — merge-flagged,
		// so `assignColumnForRow` refuses to move it and no drag is possible. C6 must not be pushed right
		// on account of a reservation it could never have disturbed (it landed on column 4 when it was).
		const rows = computeColumns([
			row('C0', ['C1']),
			row('C1', ['C2', 'C8', 'C7'], 'merge'),
			row('C2', ['C3']),
			row('C3', ['C4', 'C5'], 'merge'),
			row('C4', ['C5'], 'stash'),
			row('C5', ['C8']),
			row('C6', ['C7']),
			row('C7', ['C8']),
			row('C8', [], 'stash'),
		]);
		assert.deepStrictEqual(
			rows.map(r => r.column),
			[0, 0, 0, 0, 0, 3, 0, 2, 1],
		);
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

	test('a single-commit side lane sha is absent from every segment and from pinnedTipByCommit', () => {
		// Pin M so `pinnedTipByCommit` is genuinely populated — with no pins the map is empty by
		// construction and the 'B' assertion passes vacuously. M's first-parent chain (M→A→C) maps to
		// M; B — a single-commit second-parent lane that never finalizes into a segment — stays out of
		// both, so a ghost-ref consumer must not treat it as trunk-eligible either.
		const { segments, pinnedTipByCommit } = computeColumnsAndSegments(fixtures.mergeFan(), {
			pinnedShas: ['M'],
		});
		assert.ok(!segments.some(s => s.commitShas.includes('B')), 'B must not be a member of any finalized segment');
		assert.strictEqual(pinnedTipByCommit.get('A'), 'M');
		assert.strictEqual(pinnedTipByCommit.has('B'), false);
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
		const { columns: cols } = assignPinnedColumns(rows, ['H1', 'H2']);
		assert.strictEqual(cols.get('H1'), 0);
		assert.strictEqual(cols.get('X'), 0);
		assert.strictEqual(cols.get('base'), 0); // shared ancestor stays on the earlier head's lane
		assert.strictEqual(cols.get('H2'), 1);
		assert.strictEqual(cols.get('Y'), 1);
	});

	test('a head not present in the loaded rows reserves no column', () => {
		const rows = [row('H1', ['base']), row('base', [])];
		const { columns: cols } = assignPinnedColumns(rows, ['H1', 'missing']);
		assert.strictEqual(cols.get('H1'), 0);
		assert.strictEqual(cols.has('missing'), false);
	});

	test('assignPinnedColumns tags each chain member with its owning head sha (tipBySha)', () => {
		// Same fixture as the stack-column test above: H1→X→base, H2→Y→base, base shared.
		const rows = [row('H1', ['X']), row('H2', ['Y']), row('X', ['base']), row('Y', ['base']), row('base', [])];
		const { tipBySha } = assignPinnedColumns(rows, ['H1', 'H2']);
		assert.strictEqual(tipBySha.get('H1'), 'H1');
		assert.strictEqual(tipBySha.get('X'), 'H1');
		assert.strictEqual(tipBySha.get('base'), 'H1'); // shared ancestor stays owned by the earlier head
		assert.strictEqual(tipBySha.get('H2'), 'H2');
		assert.strictEqual(tipBySha.get('Y'), 'H2');
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

// The merge bookkeeping counts parent EDGES, never the row's `kind`. Those agreed while `kind` was
// re-derived from the parent count, but they are different questions: `kind` is the producer's label
// ("this is a merge commit"), and first-parent mode ships a merge with one parent. Keying the
// bookkeeping on the label there flags a row's only parent merge-owned, which stops the trunk
// reclaiming its lane — measured at 19 trunk rows displaced on a 45-row fixture.
suite('engine/layout — merge bookkeeping counts parents, not kind', () => {
	// A first-parent-mode window: a 30-row trunk where every third row is a merge whose second parent was
	// dropped, plus three side branches forking at different depths so lanes are genuinely contended. The
	// size matters — a handful of rows has nowhere else to go and passes either way, which is how a
	// smaller version of this test silently proved nothing.
	function firstParentTrunk(mergeKind: CommitKind): GraphRow[] {
		const rows: GraphRow[] = [];
		for (let i = 0; i < 30; i++) {
			rows.push(row(`T${i}`, i === 29 ? [] : [`T${i + 1}`], i % 3 === 1 ? mergeKind : 'commit', 1_000_000 - i));
		}
		[4, 11, 19].forEach((at, n) => {
			for (let i = 0; i < 5; i++) {
				rows.push(
					row(
						`B${n}_${i}`,
						[i === 4 ? `T${at}` : `B${n}_${i + 1}`],
						i === 1 ? mergeKind : 'commit',
						1_000_100 - n * 7 - i,
					),
				);
			}
		});
		return rows.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
	}

	// `computeColumns` has no HEAD input, so "the trunk holds lane 0" is not expressible here — that came
	// from the session. What IS expressible, and is the actual contract, is that the LABEL changes nothing:
	// any lane difference between these two runs is the bookkeeping reading `kind` when it should be
	// counting parents. Under the label-keyed version this assertion fails on this fixture.
	test('a single-parent row labelled merge lays out exactly as the same row labelled commit', () => {
		const asMerge = computeColumns(firstParentTrunk('merge'));
		const asCommit = computeColumns(firstParentTrunk('commit'));
		assert.deepStrictEqual(
			asMerge.map(r => [r.sha, r.column]),
			asCommit.map(r => [r.sha, r.column]),
			'the label must not change any lane — only the parent count may',
		);
	});

	test('a genuine two-parent merge still claims merge bookkeeping', () => {
		// Precondition for the tests above: with two parents the fan really does take a second lane, so
		// the assertions are not passing merely because this fixture has nowhere else to go.
		const laid = computeColumns(fixtures.mergeFan());
		assert.ok(
			new Set(laid.map(r => r.column)).size > 1,
			'a real merge fan must occupy more than one lane, else these tests prove nothing',
		);
	});
});
