import * as assert from 'assert';
import { processCommits, processCommitsAndSegments } from '../process.js';
import type { GraphCommit } from '../types.js';

function commit(hash: string, parents: string[], extra?: Partial<GraphCommit>): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: `commit ${hash}`,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: Date.parse('2026-01-01T00:00:00Z'),
		parents: parents,
		refs: [],
		...extra,
	};
}

suite('engine/process processCommits', () => {
	test('infers merge kind from parent count and aligns rows 1:1 with the input commits', () => {
		const commits = [commit('M', ['A', 'B']), commit('A', ['C']), commit('B', ['C']), commit('C', [])];
		const rows = processCommits(commits);

		assert.strictEqual(rows[0].kind, 'merge'); // two parents → merge
		assert.strictEqual(rows[1].kind, 'commit'); // one parent → commit
		// Topology-only rows align by index — consumers key payload lookups off this contract.
		assert.deepStrictEqual(
			rows.map(r => r.sha),
			commits.map(c => c.hash),
		);
		assert.strictEqual(rows[0].column, 0);
		assert.strictEqual(rows[2].column, 1); // B on the branch lane
	});

	test('consumer-supplied kind (workdir/stash) overrides the parent-count heuristic', () => {
		const rows = processCommits([commit('W', ['A'], { kind: 'workdir' }), commit('A', [])]);
		assert.strictEqual(rows[0].kind, 'workdir');
	});

	test('carries the epoch-ms date through untouched for the layout tie-break', () => {
		const ms = Date.parse('2026-01-01T00:00:00Z');
		const rows = processCommits([commit('A', [], { date: ms })]);
		assert.strictEqual(rows[0].date, ms);
	});

	test('a non-finite date maps to 0 rather than NaN', () => {
		const rows = processCommits([commit('A', [], { date: Number.NaN })]);
		assert.strictEqual(rows[0].date, 0);
	});

	test('does not mutate the input commits array or its elements', () => {
		const commits = [commit('M', ['A', 'B']), commit('A', ['C']), commit('B', ['C']), commit('C', [])];
		const snapshot = JSON.parse(JSON.stringify(commits));
		processCommits(commits);
		assert.deepStrictEqual(commits, snapshot);
	});
});

suite('engine/process processCommitsAndSegments', () => {
	test('returns rows, fold segments, and unloaded columns together', () => {
		const result = processCommitsAndSegments([commit('A', ['B']), commit('B', ['C']), commit('C', [])]);
		assert.strictEqual(result.rows.length, 3);
		assert.strictEqual(result.segments.length, 1);
		assert.deepStrictEqual([...result.segments[0].commitShas], ['A', 'B', 'C']);
		assert.strictEqual(result.unloadedColumns.size, 0);
	});

	test('surfaces the reserved column for an unloaded merge parent', () => {
		const result = processCommitsAndSegments([commit('M', ['A', 'Z']), commit('A', [])]);
		assert.strictEqual(result.unloadedColumns.get('Z'), 1);
		// The dangling stub edge is present on the merge row.
		assert.strictEqual(result.rows[0].edges[1].starting?.parentSha, 'Z');
	});
});
