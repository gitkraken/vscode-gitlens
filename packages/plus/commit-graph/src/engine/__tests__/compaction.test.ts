import * as assert from 'assert';
import { processGraphRows } from '../process.js';
import { CommitGraphEngineSession } from '../session.js';
import type { GraphCommit, ProcessedGraphRow } from '../types.js';

function commit(sha: string, parents: string[], date: number): GraphCommit {
	return {
		sha: sha,
		shortSha: sha.slice(0, 7),
		message: `commit ${sha}`,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: date,
		parents: parents,
		kind: parents.length > 1 ? 'merge' : 'commit',
	};
}

/**
 * Rows whose node sits to the RIGHT of a lane that carries nothing at that row — the visible defect
 * ("a commit's node parks far right with dead columns beside it"). A lane counts as live at a row if
 * the node occupies it or an edge passes through it.
 */
function gappedRows(rows: readonly ProcessedGraphRow[]): number {
	let gapped = 0;
	for (const row of rows) {
		// `RowEdges` is keyed BY column, so its keys are the lanes carrying an edge through this row.
		const live = new Set<number>([row.column, ...Object.keys(row.edges).map(Number)]);
		for (let lane = 0; lane < row.column; lane++) {
			if (!live.has(lane)) {
				gapped++;
				break;
			}
		}
	}
	return gapped;
}

/**
 * A trunk with several long-lived side branches whose spans OVERLAP, so multiple lanes are live at
 * once — lane pressure is what makes column reuse observable at all. `tipCommits` per branch are
 * prepended ahead of the trunk so each holds its lane across the whole span below it.
 */
function buildGraph(branchTipCounts: readonly number[]): GraphCommit[] {
	const trunkLength = 60;
	const trunk: GraphCommit[] = [];
	for (let i = 0; i < trunkLength; i++) {
		trunk.push(commit(`T${i}`, i === trunkLength - 1 ? [] : [`T${i + 1}`], 1_000_000 - i * 10));
	}

	const branches: GraphCommit[] = [];
	branchTipCounts.forEach((tipCount, b) => {
		// Fork points staggered but overlapping: every branch forks below the previous one's tip.
		const forkAt = 10 + b * 6;
		for (let i = 0; i < tipCount; i++) {
			const parent = i === tipCount - 1 ? `T${forkAt}` : `B${b}_${i + 1}`;
			branches.push(commit(`B${b}_${i}`, [parent], 1_000_500 - b * 3 - i * 10));
		}
	});

	// Date-ordered, newest first — the order the graph walk produces.
	return [...branches, ...trunk].sort((a, b) => b.date - a.date);
}

suite('engine/compaction', () => {
	// Everything below asserts `gappedRows(...) === 0`, so a metric that could never report a gap would
	// make the whole suite pass vacuously. Pin that it actually detects one: a node in lane 2 whose row
	// carries nothing in lanes 0-1 is the exact defect being guarded against.
	test('the gap metric detects a node parked beside a dead lane', () => {
		const parked = [{ sha: 'a', parents: [], kind: 'commit', column: 2, edges: {}, edgeColumnMax: 2 }];
		assert.strictEqual(gappedRows(parked as unknown as ProcessedGraphRow[]), 1);
		const packed = [{ sha: 'a', parents: [], kind: 'commit', column: 0, edges: {}, edgeColumnMax: 0 }];
		assert.strictEqual(gappedRows(packed as unknown as ProcessedGraphRow[]), 0);
	});

	test('a cold layout leaves no node parked beside a dead lane', () => {
		const rows = processGraphRows(buildGraph([8, 8, 8, 8, 8])).rows;

		assert.ok(
			rows.some(r => r.column > 1),
			'precondition: the fixture must produce real lane pressure, else the assertion is vacuous',
		);
		assert.strictEqual(gappedRows(rows), 0);
	});

	// The ratchet this guards against needs state to CARRY between updates — a small mis-preference that
	// is never cleaned up, so each round starts a little worse. Re-laying out cold every round (which a new
	// tip does: a prepend classifies as `replace`) can't ratchet by construction, so testing that proves
	// nothing. The one path that genuinely carries layout state is an APPEND, which resumes from the prior
	// pass — so page the same graph in progressively through the session and watch for drift.
	test('paging deeper through the session never parks a node beside a dead lane', () => {
		const all = buildGraph([8, 8, 8, 8, 8]);
		const session = new CommitGraphEngineSession<GraphCommit, GraphCommit>();

		let appends = 0;
		let sawPressure = false;
		for (let n = 20; n <= all.length; n += 10) {
			const state = session.update({ sourceRows: all.slice(0, n), toCommit: c => c });
			if (state.transition.kind === 'append') {
				appends++;
			}
			sawPressure ||= state.rows.some(r => r.column > 1);

			assert.strictEqual(
				gappedRows(state.rows),
				0,
				`a node parked beside a dead lane after paging to ${n} rows (${state.transition.kind})`,
			);
		}

		// Both preconditions matter, and the first is the one the old version of this test lacked: without
		// real appends every round was a cold layout, so carried state — the only thing that can ratchet —
		// was never exercised.
		assert.ok(appends > 0, 'precondition: the paging must actually append, else no state carries');
		assert.ok(sawPressure, 'precondition: the fixture must produce real lane pressure');
	});

	// The incremental result must also agree with laying the same rows out from scratch. A ratchet that
	// kept gaps at zero but still drifted columns would slip past the check above; this catches that.
	test('a paged-in layout agrees with a cold layout of the same rows', () => {
		const all = buildGraph([8, 8, 8, 8, 8]);
		const session = new CommitGraphEngineSession<GraphCommit, GraphCommit>();
		for (let n = 20; n < all.length; n += 10) {
			session.update({ sourceRows: all.slice(0, n), toCommit: c => c });
		}
		const paged = session.update({ sourceRows: all, toCommit: c => c }).rows;
		const cold = processGraphRows(all).rows;

		assert.deepStrictEqual(
			paged.map(r => [r.sha, r.column]),
			cold.map(r => [r.sha, r.column]),
			'paging in reached a different layout than a cold pass over the same rows',
		);
	});
});
