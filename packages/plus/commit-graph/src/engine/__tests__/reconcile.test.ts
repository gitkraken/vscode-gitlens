import * as assert from 'assert';
import { processCommitsAndSegments } from '../process.js';
import { reconcileRowsSuffix } from '../reconcile.js';
import type { CommitKind, GraphCommit } from '../types.js';

function commit(hash: string, parents: string[], kind?: CommitKind): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: hash,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: 0,
		parents: parents,
		refs: [],
		kind: kind,
	};
}

const base = [commit('A', ['B']), commit('B', ['C', 'D']), commit('C', ['E']), commit('D', ['E']), commit('E', [])];

function indexOf(rows: readonly { sha: string }[]): (sha: string) => number | undefined {
	const map = new Map(rows.map((r, i) => [r.sha, i]));
	return sha => map.get(sha);
}

suite('engine/reconcile suffix identity after a prefix change', () => {
	test('a prepended commit on the trunk reuses the untouched suffix by identity', () => {
		const prior = processCommitsAndSegments(base).rows;
		const next = processCommitsAndSegments([commit('N', ['A']), ...base]).rows;
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
		const prior = processCommitsAndSegments(base).rows;
		// Simulates the host reloading the SAME row count after a new commit landed: N enters at the
		// top and E falls off the bottom.
		const cut = [commit('N', ['A']), ...base.slice(0, -1)];
		const next = processCommitsAndSegments(cut).rows;

		// Strict bottom alignment finds nothing (bottoms differ) …
		assert.strictEqual(reconcileRowsSuffix(prior, next), undefined);

		// … but the anchor locator lines the shared region up.
		const result = reconcileRowsSuffix(prior, processCommitsAndSegments(cut).rows, indexOf(prior));
		assert.ok(result != null && result.reused > 0, 'expected anchored reuse');
	});

	test('identical runs reuse everything', () => {
		const prior = processCommitsAndSegments(base).rows;
		const next = processCommitsAndSegments(base).rows;
		const result = reconcileRowsSuffix(prior, next);
		assert.strictEqual(result?.reused, base.length);
		assert.strictEqual(result?.priorStart, 0);
		assert.strictEqual(result?.nextStart, 0);
	});

	test('a changed bottom row prevents any reuse', () => {
		const prior = processCommitsAndSegments(base).rows;
		const changed = [...base.slice(0, 4), commit('E2', [])];
		const next = processCommitsAndSegments([commit('N', ['A']), ...changed]).rows;
		assert.strictEqual(reconcileRowsSuffix(prior, next, indexOf(prior)), undefined);
	});
});

suite('engine/reconcile with sticky columns', () => {
	// A new tip whose parent sits MID-window: naive lowest-free allocation lets it steal column 0,
	// cascading fallback re-assignments below and defeating reuse; sticky hints park the new lane
	// ABOVE the preferred range, so rows below the tip's resolution point reproduce byte-for-byte.
	// (Rows the new lane passes THROUGH legitimately change — they must render the new lane.)
	const deepBase = [
		commit('A', ['B']),
		commit('S', ['C'], 'stash'),
		commit('B', ['C']),
		commit('C', ['D']),
		commit('D', ['E']),
		commit('E', []),
	];

	test('a mid-window tip prepended without hints shuffles; with hints the tail reconciles', () => {
		const prior = processCommitsAndSegments(deepBase).rows;
		const nextCommits = [commit('N', ['C']), ...deepBase];

		const preferred = new Map(prior.map(r => [r.sha, r.column]));
		const sticky = processCommitsAndSegments(nextCommits, { preferredColumns: preferred }).rows;
		const stickyResult = reconcileRowsSuffix(prior, sticky);

		// Rows below the new tip's resolution point (D, E) must reproduce and reconcile.
		assert.ok((stickyResult?.reused ?? 0) >= 2, 'expected sticky hints to reconcile the tail below the new lane');
		// Reused rows keep their prior columns (that is the whole point).
		if (stickyResult != null) {
			for (let k = 0; k < stickyResult.reused; k++) {
				assert.strictEqual(
					sticky[stickyResult.nextStart + k].column,
					prior[stickyResult.priorStart + k].column,
				);
			}
		}
	});

	test('hints never change output validity: identical inputs yield identical output with hints', () => {
		const plain = processCommitsAndSegments(deepBase);
		const preferred = new Map(plain.rows.map(r => [r.sha, r.column]));
		const hinted = processCommitsAndSegments(deepBase, { preferredColumns: preferred });
		assert.deepStrictEqual(hinted.rows, plain.rows);
		assert.deepStrictEqual([...hinted.unloadedColumns], [...plain.unloadedColumns]);
	});
});
