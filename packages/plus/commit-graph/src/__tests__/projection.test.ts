import * as assert from 'assert';
import { processGraphRows } from '../engine/process.js';
import type { GraphCommit } from '../engine/types.js';
import { CommitGraphProjectionSession } from '../projection.js';
import type { CommitGraphProjectionInput } from '../projection.js';

function commit(sha: string, parents: string[]): GraphCommit {
	return {
		sha: sha,
		shortSha: sha.slice(0, 7),
		message: `commit ${sha}`,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: Date.parse('2026-01-01T00:00:00Z'),
		parents: parents,
		kind: parents.length > 1 ? 'merge' : 'commit',
	};
}

function inputFor(
	processed: ReturnType<typeof processGraphRows>,
	filterShas: ReadonlySet<string> | undefined,
): CommitGraphProjectionInput {
	const input: CommitGraphProjectionInput = {
		identity: 'repo',
		viewKey: 'view',
		rows: processed.rows,
		segments: processed.segments,
		unloadedColumns: processed.unloadedColumns,
		indexBySha: new Map(processed.rows.map((r, i) => [r.sha, i])),
		transition: { kind: 'initial' } as const,
		wipAnchorShas: new Set<string>(),
		wipSegmentTips: new Set<string>(),
		filterShas: filterShas,
		foldingEnabled: false,
		foldingDefault: 'none' as const,
		searchActive: filterShas != null,
		scopeAnchors: {},
	};
	return input;
}

suite('projection/display index', () => {
	// `filterRows` preserves source order and identity-caches its flattened rows, so a changed filter can
	// produce a LONGER list whose first row and whose row at the prior length both match the previous
	// result by reference while a row in between was swapped. Treating that as an append would leave the
	// removed sha indexed and the added ones missing.
	test('a filter change that looks like an append still rebuilds the index', () => {
		// Order matters: X sits between A and C, so a filter can swap B out for X without moving C.
		const processed = processGraphRows([
			commit('A', ['X']),
			commit('X', ['B']),
			commit('B', ['C']),
			commit('C', ['D']),
			commit('D', []),
		]);
		const session = new CommitGraphProjectionSession();

		const before = session.update(inputFor(processed, new Set(['A', 'B', 'C'])));
		assert.deepStrictEqual(
			before.rows.map(r => r.sha),
			['A', 'B', 'C'],
		);

		const after = session.updateFilter(new Set(['A', 'X', 'C', 'D']));
		const shas = after.rows.map(r => r.sha);

		// Precondition: this must be the false-append shape, or the test proves nothing.
		assert.deepStrictEqual(shas, ['A', 'X', 'C', 'D']);
		assert.strictEqual(after.rows[0], before.rows[0], 'first row identity must match');
		assert.strictEqual(after.rows[2], before.rows[2], 'row at the prior length must match');

		assert.strictEqual(after.indexBySha.get('B'), undefined, 'a removed sha must not stay indexed');
		assert.strictEqual(after.indexBySha.size, shas.length);
		for (const sha of shas) {
			assert.strictEqual(after.rows[after.indexBySha.get(sha)!]?.sha, sha, `${sha} must index to its own row`);
		}
	});
});
