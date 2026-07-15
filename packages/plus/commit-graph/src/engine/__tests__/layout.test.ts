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

suite('engine/layout sticky columns', () => {
	// Re-run `rows` seeded with the prior run's columns, exactly as the renderer does on a rows update:
	// below-window stubs first, then real rows — so a row's own column always wins the tie (see
	// `gl-lit-graph`'s `recomputeRows`).
	function relayout(prior: readonly GraphRow[], next: readonly GraphRow[]) {
		const first = computeColumnsAndSegments(prior);
		const preferred = new Map<Sha, number>();
		for (const [sha, column] of first.unloadedColumns) {
			preferred.set(sha, column);
		}
		for (const r of first.rows) {
			preferred.set(r.sha, r.column);
		}

		const second = computeColumnsAndSegments(next, { preferredColumns: preferred });
		return {
			before: new Map(first.rows.map(r => [r.sha, r.column])),
			after: new Map(second.rows.map(r => [r.sha, r.column])),
		};
	}

	// A side lane (S→F) whose tip F has a child, over a merge fan that only opens the DEEP lanes (B1/C1/D1
	// at columns 1..3) BELOW F. So at F's row only columns 0-1 are live and 2 is free, while the window's
	// deepest lane is 3 — the exact shape that used to fling a fresh claim out past every lane.
	const sideLaneOverDeepFan = (): GraphRow[] => [
		row('T', ['M1']),
		row('S', ['F']),
		row('F', ['M1']),
		row('M1', ['M2', 'B1'], 'merge'),
		row('M2', ['M3', 'C1'], 'merge'),
		row('M3', ['BASE', 'D1'], 'merge'),
		row('B1', ['BASE']),
		row('C1', ['BASE']),
		row('D1', ['BASE']),
		row('BASE', []),
	];

	test('a WIP row above an already-reserved anchor packs in next to it, not out past every lane', () => {
		// THE BUG: W's anchor F is reserved (S is F's child), so W's inherited preference (F's column) is
		// taken and it fell through to the old "park above the whole preferred range" — landing on column 4
		// with 2 and 3 sitting empty, and dragging the graph column wider with it.
		const prior = sideLaneOverDeepFan();
		const next = [...prior.slice(0, 2), row('W', ['F'], 'workdir'), ...prior.slice(2)];
		const { before, after } = relayout(prior, next);

		assert.strictEqual(before.get('F'), 1, 'fixture: the anchor sits on column 1');
		assert.strictEqual(Math.max(...before.values()), 3, 'fixture: the window is 4 lanes deep');

		// The lowest column that is actually free at W's row — NOT maxColumn + 1.
		assert.strictEqual(after.get('W'), 2);

		// ...and it cost nothing: every real commit keeps its lane, so the splice/lane colors hold.
		for (const [sha, column] of before) {
			assert.strictEqual(after.get(sha), column, `${sha} moved lanes`);
		}
		assert.strictEqual(Math.max(...after.values()), 3, 'the graph column must not have grown');
	});

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

	// INHERITANCE SANITY. Nothing asserted this, and that blind spot let a candidate fix that bent the trunk
	// onto a fresh lane on EVERY new commit pass the entire suite. A layout that simply never inherits scores
	// perfectly on eviction, width and fixpoint — these are the tests that tell those two apart. The
	// "uncontended" qualifier is load-bearing: declining to inherit is CORRECT when something already owns
	// the lane across the span the new row would occupy.
	test('a new commit on an uncontended trunk lands on the trunk lane', () => {
		const prior = [row('T0', ['T1']), row('T1', ['T2']), row('T2', [])];
		const { before, after } = relayout(prior, [row('N', ['T0']), ...prior]);

		assert.strictEqual(before.get('T0'), 0, 'fixture: the trunk owns column 0');
		assert.strictEqual(after.get('N'), 0, 'the new commit must continue the trunk lane, not bend off it');
		for (const sha of ['T0', 'T1', 'T2']) {
			assert.strictEqual(after.get(sha), before.get(sha), `${sha} left the trunk lane`);
		}
	});

	test('every commit of an uncontended fetched branch lands on the branch lane', () => {
		// Multi-commit branch: the whole chain inherits, so a single-parent release row is not enough to
		// reason about it. All three must end up on one lane, and the trunk must not move.
		const prior = [row('T0', ['T1']), row('T1', ['T2']), row('T2', [])];
		const next = [row('F1', ['F2']), row('F2', ['F3']), row('F3', ['T1']), ...prior];
		const { before, after } = relayout(prior, next);

		assert.strictEqual(after.get('F1'), after.get('F2'), 'the branch must occupy ONE lane');
		assert.strictEqual(after.get('F2'), after.get('F3'), 'the branch must occupy ONE lane');
		for (const sha of ['T0', 'T1', 'T2']) {
			assert.strictEqual(after.get(sha), before.get(sha), `${sha} left the trunk lane`);
		}
	});

	test('a new tip does not inherit a lane that is occupied where it would sit', () => {
		// C9 is a childless stash tip, so FEAT may legitimately continue its lane — EXCEPT that C7 also owns
		// that column and sits inside the span FEAT's lane would cover. Inheriting is only a guess that the
		// parent's lane is still free where the new row lands; here it isn't, and taking it anyway evicted C7.
		const prior = [row('T0', ['C8']), row('C7', ['C8', 'U0'], 'merge'), row('C8', ['U0']), row('C9', [], 'stash')];
		const { before, after } = relayout(prior, [row('FEAT', ['C9']), ...prior]);

		assert.strictEqual(before.get('C7'), 1, 'fixture: C7 owns column 1');
		assert.strictEqual(before.get('C9'), 1, 'fixture: C9 owns column 1 too — its lane is disjoint from C7s');

		assert.strictEqual(after.get('C7'), 1, 'C7 kept its lane');
		assert.notStrictEqual(after.get('FEAT'), 1, 'FEAT must take a fresh lane, not camp on C7s');
	});

	test('a force-pushed tip does not evict the lane it lands beside', () => {
		// A row whose children ALL decline to reserve it (the no-drag rule) gets no reservation and
		// fresh-claims after all — so it consults its preference. `makeScratchFactory` must register it as a
		// need, or a fallback claim camps on its column and evicts everything below it.
		const prior = [row('T', ['M']), row('S', ['M']), row('M', ['A']), row('A', ['B']), row('B', [])];
		const next = [row('FP', ['A']), ...prior.filter(r => r.sha !== 'T')];
		const { before, after } = relayout(prior, next);

		for (const sha of ['S', 'M', 'A', 'B']) {
			assert.strictEqual(after.get(sha), before.get(sha), `${sha} was evicted from its lane`);
		}
	});

	test('a cold run still lets a claim pull its parent chain onto a lower lane', () => {
		// The drag guard must NOT fire without preferences. Here C3 claims the free column 0 and the
		// reservation-replace pulls C4 down onto it — GKC's own lane compaction, and it is what keeps the
		// graph one lane narrower. There is no prior layout to cascade into on a cold run, so guarding it
		// would cost width for nothing (C3 landed on column 2, C4 on 1, before this was scoped to fallbacks).
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
		// The drag guard (sit above the first parent's reserved column) must fire ONLY where the drag is
		// actually reachable. C6 is a plain tip whose first parent C7 is an ADDITIONAL parent of the merge
		// C1 — merge-flagged, so `assignColumnForRow` refuses to move it and no drag is possible. Bounding
		// C6 anyway would strand it out right (it landed on column 4 here) for nothing.
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

	test('a new tip takes a fresh lane instead of evicting the lanes already on its parent', () => {
		// BASE's lane is already continued by T1 (which OWNS column 0), so the brand-new tip N must not
		// inherit — and thereby claim — that column. N sorts newest, so it claims FIRST: inheriting would let
		// it win column 0 and evict T1, which then has to step over T2 and renumber the tail behind it.
		const prior = [row('T1', ['BASE']), row('T2', ['BASE']), row('BASE', [])];
		const { before, after } = relayout(prior, [row('N', ['BASE']), ...prior]);

		assert.strictEqual(before.get('T1'), 0, 'fixture: T1 owns column 0');
		assert.strictEqual(before.get('T2'), 1, 'fixture: T2 owns column 1');

		assert.strictEqual(after.get('T1'), 0, 'T1 kept its lane');
		assert.strictEqual(after.get('T2'), 1, 'T2 kept its lane');
		assert.strictEqual(after.get('N'), 2, 'the NEW tip is the one that takes a fresh lane');
	});

	test('a fetched branch tip does not evict the trunk onto a far-right lane', () => {
		// THE FETCH BUG: `feat` forks off the trunk, so it inherits the trunk's column — and being newest it
		// claims first, winning that column. The trunk's own new commit is then displaced, and (worse) its
		// first-parent reservation used to drag the trunk's chain out with it, splitting the mainline across
		// lanes. The trunk owns its lane; a tip hanging off it must take a new one.
		const prior = [
			row('main', ['T1']),
			row('T1', ['T2', 'S1'], 'merge'),
			row('T2', ['BASE']),
			row('S1', ['BASE']),
			row('BASE', []),
		];
		const next = [row('feat', ['T2']), row('newmain', ['main']), ...prior];
		const { before, after } = relayout(prior, next);

		const trunk = ['main', 'T1', 'T2', 'BASE'];
		for (const sha of trunk) {
			assert.strictEqual(after.get(sha), before.get(sha), `${sha} left the trunk lane`);
		}
		assert.strictEqual(after.get('newmain'), before.get('main'), 'the new trunk commit continues the trunk lane');
		assert.notStrictEqual(after.get('feat'), before.get('T2'), 'the fetched tip must not sit on the trunk lane');
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
