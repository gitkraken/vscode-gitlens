import * as assert from 'assert';
import { processGraphRows } from '../process.js';
import { reconcileRowsSuffix } from '../reconcile.js';
import type { CommitKind, GraphCommit } from '../types.js';

function commit(sha: string, parents: string[], kind?: CommitKind): GraphCommit {
	return {
		sha: sha,
		shortSha: sha.slice(0, 7),
		message: sha,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: 0,
		parents: parents,
		kind: kind ?? (parents.length > 1 ? 'merge' : 'commit'),
	};
}

const base = [commit('A', ['B']), commit('B', ['C', 'D']), commit('C', ['E']), commit('D', ['E']), commit('E', [])];

function indexOf(rows: readonly { sha: string }[]): (sha: string) => number | undefined {
	const map = new Map(rows.map((r, i) => [r.sha, i]));
	return sha => map.get(sha);
}

suite('engine/reconcile suffix identity after a prefix change', () => {
	test('a prepended commit on the trunk reuses the untouched suffix by identity', () => {
		const prior = processGraphRows(base).rows;
		const next = processGraphRows([commit('N', ['A']), ...base]).rows;
		const snapshot = JSON.parse(JSON.stringify(next));

		const result = reconcileRowsSuffix(prior, next);

		// Content must be untouched by the swap …
		assert.deepStrictEqual(JSON.parse(JSON.stringify(next)), snapshot);
		// … and the reused tail must be the PRIOR objects by identity.
		assert.ok(result != null && result.reused > 0, 'expected a reusable suffix');
		for (let k = 0; k < result.reused; k++) {
			assert.strictEqual(next[result.nextStart + k], prior[result.priorStart + k]);
		}
		// The row just above the reused run must NOT be a prior object (it was reprocessed).
		if (result.nextStart > 0 && result.priorStart > 0) {
			assert.notStrictEqual(next[result.nextStart - 1], prior[result.priorStart - 1]);
		}
	});

	test('a prepend with the bottom row cut (fixed-count reload) aligns via the anchor locator', () => {
		const prior = processGraphRows(base).rows;
		// Simulates the host reloading the SAME row count after a new commit landed: N enters at the
		// top and E falls off the bottom.
		const cut = [commit('N', ['A']), ...base.slice(0, -1)];
		const next = processGraphRows(cut).rows;

		// Strict bottom alignment finds nothing (bottoms differ) …
		assert.strictEqual(reconcileRowsSuffix(prior, next), undefined);

		// … but the anchor locator lines the shared region up.
		const result = reconcileRowsSuffix(prior, processGraphRows(cut).rows, indexOf(prior));
		assert.ok(result != null && result.reused > 0, 'expected anchored reuse');
	});

	test('identical runs reuse everything', () => {
		const prior = processGraphRows(base).rows;
		const next = processGraphRows(base).rows;
		const result = reconcileRowsSuffix(prior, next);
		assert.strictEqual(result?.reused, base.length);
		assert.strictEqual(result?.priorStart, 0);
		assert.strictEqual(result?.nextStart, 0);
	});

	test('a changed bottom row prevents any reuse', () => {
		const prior = processGraphRows(base).rows;
		const changed = [...base.slice(0, 4), commit('E2', [])];
		const next = processGraphRows([commit('N', ['A']), ...changed]).rows;
		assert.strictEqual(reconcileRowsSuffix(prior, next, indexOf(prior)), undefined);
	});
});
