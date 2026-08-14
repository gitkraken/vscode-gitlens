import * as assert from 'assert';
import type { ProcessedGraphRow, RowEdges } from '@gitkraken/commit-graph/engine/types.js';
import { computeChainLaneRuns } from '../chainLane.utils.js';

function row(
	sha: string,
	column: number,
	kind: ProcessedGraphRow['kind'] = 'commit',
	parents: string[] = [],
	edges: RowEdges = {},
): ProcessedGraphRow {
	return { sha: sha, parents: parents, kind: kind, column: column, edges: edges, edgeColumnMax: column };
}

/** A row's engine-baked pass-through art at `column`, linking to `parentSha` — what a gap row between a
 *  run's last chained row and its fork must carry for the extension walk to continue through it. */
function passThroughAt(column: number, parentSha: string): RowEdges {
	return { [column]: { passThrough: { parentSha: parentSha, kind: 'commit' } } };
}

function indexOf(rows: readonly ProcessedGraphRow[]): ReadonlyMap<string, number> {
	const map = new Map<string, number>();
	rows.forEach((r, i) => map.set(r.sha, i));

	return map;
}

suite('computeChainLaneRuns', () => {
	test('single run spans the chain shas min/max display index', () => {
		const rows = [row('a', 0), row('b', 0), row('c', 0), row('d', 0)];
		const runs = computeChainLaneRuns(new Set(['a', 'c']), indexOf(rows), rows);
		assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 2 }]);
	});

	test('shas on two columns produce two runs', () => {
		const rows = [row('a', 0), row('b', 1), row('c', 0), row('d', 1)];
		const runs = computeChainLaneRuns(new Set(['a', 'b', 'c', 'd']), indexOf(rows), rows);
		assert.deepStrictEqual(
			[...runs].sort((x, y) => x.column - y.column),
			[
				{ column: 0, startIndex: 0, endIndex: 2 },
				{ column: 1, startIndex: 1, endIndex: 3 },
			],
		);
	});

	test('a sha missing from indexBySha is skipped', () => {
		const rows = [row('a', 0), row('b', 0), row('c', 0)];
		// 'z' isn't in these rows (hidden behind a collapsed lane / filtered out) — ignored, not thrown.
		const runs = computeChainLaneRuns(new Set(['a', 'c', 'z']), indexOf(rows), rows);
		assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 2 }]);
	});

	test('a workdir row is skipped even when its sha is in the chain', () => {
		const rows = [row('wip', 0, 'workdir'), row('a', 0), row('b', 0), row('c', 0)];
		const runs = computeChainLaneRuns(new Set(['wip', 'a', 'c']), indexOf(rows), rows);
		assert.deepStrictEqual(runs, [{ column: 0, startIndex: 1, endIndex: 3 }]);
	});

	test('a single-row run (start === end) is dropped', () => {
		const rows = [row('a', 0), row('b', 1), row('c', 0)];
		const runs = computeChainLaneRuns(new Set(['b']), indexOf(rows), rows);
		assert.deepStrictEqual(runs, []);
	});

	test('a mid-chain Ctrl seed walked both directions is covered by one run spanning above and below', () => {
		const rows = [row('above2', 0), row('above1', 0), row('seed', 0), row('below1', 0), row('below2', 0)];
		const runs = computeChainLaneRuns(
			new Set(['above2', 'above1', 'seed', 'below1', 'below2']),
			indexOf(rows),
			rows,
		);
		assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 4 }]);
	});

	suite('fork-point extension', () => {
		test('full reach: the gap rows all carry the fork link at the run column', () => {
			const rows = [
				row('a', 0),
				row('b', 0),
				row('c', 0, 'commit', ['fork']),
				row('mid', 2, 'commit', [], passThroughAt(0, 'fork')),
				row('fork', 1),
			];
			const runs = computeChainLaneRuns(new Set(['a', 'b', 'c']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [
				{ column: 0, startIndex: 0, endIndex: 2, extension: { kind: 'fork', forkIndex: 4, forkColumn: 1 } },
			]);
		});

		test('adjacent fork (no gap) still reaches, trivially', () => {
			const rows = [row('a', 0), row('b', 0, 'commit', ['fork']), row('fork', 1)];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [
				{ column: 0, startIndex: 0, endIndex: 1, extension: { kind: 'fork', forkIndex: 2, forkColumn: 1 } },
			]);
		});

		test('cross-column guard: a same-column "fork" is not drawn (the walk should have continued)', () => {
			const rows = [row('a', 0), row('b', 0, 'commit', ['fork']), row('fork', 0)];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 1 }]);
		});

		test('no extension when the last chained row has no parent (a root)', () => {
			const rows = [row('a', 0), row('b', 0)];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 1 }]);
		});

		test('no extension when the fork sha is outside the loaded window', () => {
			const rows = [row('a', 0), row('b', 0, 'commit', ['unloaded'])];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [{ column: 0, startIndex: 0, endIndex: 1 }]);
		});

		test('continuity break mid-gap clamps to the top of the first row missing the link', () => {
			const rows = [
				row('a', 0),
				row('b', 0, 'commit', ['fork']),
				row('mid', 2), // no pass-through art at column 0 — the engine reassigned the lane here
				row('fork', 1),
			];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [
				{ column: 0, startIndex: 0, endIndex: 1, extension: { kind: 'clamp', clampIndex: 2 } },
			]);
		});

		test('a WIP/interleaved row in the gap that DOES carry the pass-through does not clamp', () => {
			const rows = [
				row('a', 0),
				row('b', 0, 'commit', ['fork']),
				row('wip', 0, 'workdir', [], passThroughAt(0, 'fork')),
				row('fork', 1),
			];
			const runs = computeChainLaneRuns(new Set(['a', 'b']), indexOf(rows), rows);
			assert.deepStrictEqual(runs, [
				{ column: 0, startIndex: 0, endIndex: 1, extension: { kind: 'fork', forkIndex: 3, forkColumn: 1 } },
			]);
		});
	});
});
