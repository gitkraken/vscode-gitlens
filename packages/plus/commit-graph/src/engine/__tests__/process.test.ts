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

	// The `stableFrom` token is the production sticky-columns path (the renderer hands a prior result back
	// instead of assembling `preferredColumns` itself). These are the ONLY tests that exercise it and the
	// preference ordering inside `preferencesFromStability`; every other sticky test uses the low-level
	// `preferredColumns` escape hatch, so a regression in that derivation would otherwise ship green.
	test('a stableFrom token reproduces the layout hand-built preferences produce', () => {
		const base = [commit('T0', ['T1']), commit('T1', ['T2']), commit('T2', ['BASE']), commit('BASE', [])];
		const next = [commit('FT', ['T1']), commit('NEW', ['T0']), ...base];

		const prior = processGraphRows(base);
		const manual = new Map<string, number>();
		for (const [sha, column] of prior.unloadedColumns) {
			manual.set(sha, column);
		}
		for (const r of prior.rows) {
			manual.set(r.sha, r.column);
		}

		const viaToken = processGraphRows(next, { stableFrom: prior.stability });
		const viaManual = processGraphRows(next, { preferredColumns: manual });
		assert.deepStrictEqual(
			viaToken.rows.map(r => [r.sha, r.column]),
			viaManual.rows.map(r => [r.sha, r.column]),
		);
	});

	test('the stableFrom token lets a real row win a phantom stub for the same sha', () => {
		// Out-of-contract order (parent P above its loaded child C) makes C reserve a phantom lane that
		// `finalizeLayout` surfaces in `unloadedColumns` for P (col 1) even though P is a loaded row (col 0).
		// `preferencesFromStability` must seed stubs FIRST so P's real column wins the tie; a swapped order
		// would feed P the stub column and ratchet the lane space every update. Feeding the token back must
		// keep P on its own column 0. (Verified swap-sensitive: the swapped order puts P at 1.)
		const skewed = [
			commit('P', ['Z'], { date: 100 }),
			commit('C', ['P'], { date: 50 }),
			commit('Z', [], { date: 10 }),
		];
		const cold = processGraphRows(skewed);
		assert.strictEqual(cold.rows.find(r => r.sha === 'P')?.column, 0, 'fixture: P is a loaded row on column 0');
		assert.strictEqual(cold.unloadedColumns.get('P'), 1, 'fixture: P also has a phantom stub on column 1');

		const relaid = processGraphRows(skewed, { stableFrom: cold.stability });
		assert.strictEqual(relaid.rows.find(r => r.sha === 'P')?.column, 0, 'the real row must win the stub');
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
			stableFrom: prior.stability,
			syntheticChildren: new Set<string>(),
			reconcile: reconcileArg,
		});
		const unscoped = processGraphRows(next, { stableFrom: prior.stability, reconcile: reconcileArg });

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
