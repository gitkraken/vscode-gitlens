import * as assert from 'assert';
import { processGraphRows } from '../process.js';
import type { GraphCommit } from '../types.js';

function commit(sha: string, parents: string[], extra?: Partial<GraphCommit>): GraphCommit {
	return {
		sha: sha,
		shortSha: sha.slice(0, 7),
		message: `commit ${sha}`,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: Date.parse('2026-01-01T00:00:00Z'),
		parents: parents,
		kind: parents.length > 1 ? 'merge' : 'commit',
		...extra,
	};
}

suite('engine/process processGraphRows', () => {
	test('preserves canonical row kinds and aligns rows 1:1 with the input commits', () => {
		const commits = [commit('M', ['A', 'B']), commit('A', ['C']), commit('B', ['C']), commit('C', [])];
		const { rows } = processGraphRows(commits);

		assert.strictEqual(rows[0].kind, 'merge'); // two parents → merge
		assert.strictEqual(rows[1].kind, 'commit'); // one parent → commit
		// Topology-only rows align by index — consumers key payload lookups off this contract.
		assert.deepStrictEqual(
			rows.map(r => r.sha),
			commits.map(c => c.sha),
		);
		assert.strictEqual(rows[0].column, 0);
		assert.strictEqual(rows[2].column, 1); // B on the branch lane
	});

	test('consumer-supplied kind (workdir/stash) overrides the parent-count heuristic', () => {
		const { rows } = processGraphRows([commit('W', ['A'], { kind: 'workdir' }), commit('A', [])]);
		assert.strictEqual(rows[0].kind, 'workdir');
	});

	test('carries the epoch-ms date through untouched for the layout tie-break', () => {
		const ms = Date.parse('2026-01-01T00:00:00Z');
		const { rows } = processGraphRows([commit('A', [], { date: ms })]);
		assert.strictEqual(rows[0].date, ms);
	});

	test('a non-finite date maps to 0 rather than NaN', () => {
		const { rows } = processGraphRows([commit('A', [], { date: Number.NaN })]);
		assert.strictEqual(rows[0].date, 0);
	});

	test('does not mutate the input commits array or its elements', () => {
		const commits = [commit('M', ['A', 'B']), commit('A', ['C']), commit('B', ['C']), commit('C', [])];
		const snapshot = JSON.parse(JSON.stringify(commits));
		processGraphRows(commits);
		assert.deepStrictEqual(commits, snapshot);
	});
});

suite('engine/process processGraphRows — segments', () => {
	test('returns rows, fold segments, and unloaded columns together', () => {
		const result = processGraphRows([commit('A', ['B']), commit('B', ['C']), commit('C', [])]);
		assert.strictEqual(result.rows.length, 3);
		assert.strictEqual(result.segments.length, 1);
		assert.deepStrictEqual([...result.segments[0].commitShas], ['A', 'B', 'C']);
		assert.strictEqual(result.unloadedColumns.size, 0);
	});

	test('surfaces the reserved column for an unloaded merge parent', () => {
		const result = processGraphRows([commit('M', ['A', 'Z']), commit('A', [])]);
		assert.strictEqual(result.unloadedColumns.get('Z'), 1);
		// The dangling stub edge is present on the merge row.
		assert.strictEqual(result.rows[0].edges[1].starting?.parentSha, 'Z');
	});

	// A scope that resolved NO anchors yields an empty synthetic set, which marks no edges and so cannot
	// change any output. The guards must therefore test SIZE, not nullness — a bare non-null set used to
	// disable suffix reconciliation (and, on the paging path, the append-resume), turning every scoped
	// update into a full O(total) re-run for nothing.
	test('an empty syntheticChildren set does not disable suffix reconciliation', () => {
		const base = [commit('A', ['B']), commit('B', ['C']), commit('C', [])];
		const prior = processGraphRows(base);
		const next = [commit('N', ['A']), ...base];

		const reconcileArg = { priorRows: prior.rows };
		const withEmptyScope = processGraphRows(next, {
			syntheticChildren: new Set<string>(),
			reconcile: reconcileArg,
		});
		const unscoped = processGraphRows(next, { reconcile: reconcileArg });

		assert.ok(withEmptyScope.reconciled != null, 'an empty scope set must still reconcile');
		assert.deepStrictEqual(
			withEmptyScope.reconciled,
			unscoped.reconciled,
			'an empty scope set must reconcile exactly as an unscoped run does',
		);
		assert.deepStrictEqual(
			withEmptyScope.rows.map(r => r.column),
			unscoped.rows.map(r => r.column),
			'and produce the same layout',
		);
	});
});
