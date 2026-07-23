import * as assert from 'assert';
import { buildChildrenBySha, findBranchingPointSha } from '../navigation.js';
import type { Sha } from '../types.js';

type NavRow = { sha: Sha; parents: readonly Sha[]; column: number };

function row(sha: Sha, parents: Sha[], column: number): NavRow {
	return { sha: sha, parents: parents, column: column };
}

// Trunk on column 0, a feature lane on column 1 that merges back at M. Rows in git-log order
// (children above parents):
//
//   row0  M   (merge, col 0, parents [A, F2])
//   row1  F2  (col 1, parents [F1])          ← feature lane tip
//   row2  F1  (col 1, parents [B])           ← feature lane bottom
//   row3  A   (col 0, parents [B])           ← trunk
//   row4  B   (col 0, parents [C])           ← FORK POINT (children F1 col 1 + A col 0)
//   row5  C   (col 0, parents [D])           ← trunk
//   row6  D   (col 0, parents [])            ← root
function makeRows(): NavRow[] {
	return [
		row('M', ['A', 'F2'], 0),
		row('F2', ['F1'], 1),
		row('F1', ['B'], 1),
		row('A', ['B'], 0),
		row('B', ['C'], 0),
		row('C', ['D'], 0),
		row('D', [], 0),
	];
}

function indexBySha(rows: readonly NavRow[]): Map<Sha, number> {
	return new Map(rows.map((r, i) => [r.sha, i]));
}

suite('engine/navigation', () => {
	test('buildChildrenBySha maps each parent to its children (fork point sees both lanes)', () => {
		const children = buildChildrenBySha(makeRows());

		// B is forked by both the feature lane (F1) and the trunk (A).
		assert.deepStrictEqual(children.get('B'), ['F1', 'A']);
		// A and F2 are the merge M's two parents, so both list M as a child.
		assert.deepStrictEqual(children.get('A'), ['M']);
		assert.deepStrictEqual(children.get('F2'), ['M']);
		assert.deepStrictEqual(children.get('F1'), ['F2']);
		assert.deepStrictEqual(children.get('C'), ['B']);
		assert.deepStrictEqual(children.get('D'), ['C']);
		// M is the topmost row — nothing lists it as a parent.
		assert.strictEqual(children.get('M'), undefined);
	});

	test('down from a lane hops same-column then falls off-lane to the fork point (not the merge)', () => {
		const rows = makeRows();
		// F2 → F1 (same lane) → B (parent off-lane; B is a branching point). Must NOT reach the merge M.
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'F2', 1);
		assert.strictEqual(sha, 'B');
	});

	test('down from trunk stops at the nearest fork point below', () => {
		const rows = makeRows();
		// A → B (nearest fork). Must NOT return M nor keep going to C.
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'A', 1);
		assert.strictEqual(sha, 'B');
	});

	test('down from a branching point keeps walking (stop is only checked on newly reached commits)', () => {
		const rows = makeRows();
		// From B: step → C (not branching), step → D (not branching), D has no parent → returns D.
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'B', 1);
		assert.strictEqual(sha, 'D');
	});

	test('up from the root walks same-column children to the fork point', () => {
		const rows = makeRows();
		// D → C (same lane) → B (branching point).
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'D', -1);
		assert.strictEqual(sha, 'B');
	});

	test('up from a lane bottom stops at its tip', () => {
		const rows = makeRows();
		// F1 → F2 (same lane). F2 is itself a branching point (its child M sits on col 0), so the walk
		// stops there. (The old-engine reference would also stop: F2's only further step would be a
		// same-column/first-parent child, and M is neither — M.parents[0] is A, not F2.)
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'F1', -1);
		assert.strictEqual(sha, 'F2');
	});

	test('up from the topmost commit (no children) returns undefined', () => {
		const rows = makeRows();
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'M', -1);
		assert.strictEqual(sha, undefined);
	});

	test('down from the root (no parents) returns undefined', () => {
		const rows = makeRows();
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'D', 1);
		assert.strictEqual(sha, undefined);
	});

	test('unknown fromSha returns undefined', () => {
		const rows = makeRows();
		const sha = findBranchingPointSha(rows, indexBySha(rows), buildChildrenBySha(rows), 'ZZZ', 1);
		assert.strictEqual(sha, undefined);
	});
});
