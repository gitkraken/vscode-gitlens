import * as assert from 'assert';
import { isHistoryRewrite } from '../delta.js';
import type { RowTopology } from '../delta.js';
import { processCommitsAndSegments } from '../process.js';
import type { GraphStability } from '../process.js';
import type { GraphCommit, ProcessedGraphRow } from '../types.js';

function commit(hash: string, parents: string[], date: number): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: hash,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: date,
		parents: parents,
		refs: [],
	};
}

function topo(commits: readonly GraphCommit[]): RowTopology[] {
	return commits.map(c => ({ sha: c.hash, parents: c.parents, type: 'commit-node', date: c.date }));
}

function columnsBySha(rows: readonly ProcessedGraphRow[]): Map<string, number> {
	return new Map(rows.map(r => [r.sha, r.column]));
}

// Mirrors the webview's `stableFrom` gate (gl-lit-graph `recomputeRows`): stability is offered on a
// replace ONLY when it is not a history rewrite.
function stableFromFor(
	prior: readonly GraphCommit[],
	next: readonly GraphCommit[],
	stability: GraphStability,
): GraphStability | undefined {
	return isHistoryRewrite(topo(prior), topo(next)) ? undefined : stability;
}

suite('engine/rewrite — sticky columns across a history rewrite', () => {
	// Two single-commit branches forking from a shared base. In date order P is the top tip, so it takes
	// column 0 and Q parks on column 1.
	const priorCommits = [commit('P', ['base'], 3), commit('Q', ['base'], 2), commit('base', [], 1)];

	// A rebase replays P (new sha `Pb`) so it now sorts BELOW Q — Q becomes the top tip. Cold layout gives
	// the top tip column 0, i.e. Q should move to column 0 and Pb to column 1.
	const rebasedCommits = [commit('Q', ['base'], 3), commit('Pb', ['base'], 2), commit('base', [], 1)];

	test('the repro: sticky preferences drag a surviving lane the area backstop cannot catch', () => {
		const prior = processCommitsAndSegments(priorCommits);
		assert.strictEqual(prior.rows.find(r => r.sha === 'Q')!.column, 1, 'Q parks on column 1 in the prior layout');

		const sticky = processCommitsAndSegments(rebasedCommits, { stableFrom: prior.stability });
		const cold = processCommitsAndSegments(rebasedCommits);

		// Cold packs the new top tip (Q) back onto column 0.
		assert.strictEqual(
			cold.rows.find(r => r.sha === 'Q')!.column,
			0,
			'cold layout puts the new top tip Q on column 0',
		);
		// Sticky reproduces Q's stale column 1 — the visible drag.
		assert.strictEqual(sticky.rows.find(r => r.sha === 'Q')!.column, 1, 'sticky drags Q to its stale column 1');
		assert.notDeepStrictEqual(
			[...columnsBySha(sticky.rows)],
			[...columnsBySha(cold.rows)],
			'sticky layout diverges from cold after the rewrite',
		);
		// And the area backstop is blind to it — the misroute is equal-area (columns are just swapped).
		assert.strictEqual(sticky.renormalized ?? false, false, 'the equal-area misroute does not trip renormalize');
	});

	test('the fix: dropping stability on a detected rewrite reproduces the cold (correct) layout', () => {
		const prior = processCommitsAndSegments(priorCommits);
		const cold = processCommitsAndSegments(rebasedCommits);

		const stableFrom = stableFromFor(priorCommits, rebasedCommits, prior.stability);
		assert.strictEqual(stableFrom, undefined, 'the rewrite is detected, so no stability is offered');

		const fixed = processCommitsAndSegments(rebasedCommits, { stableFrom: stableFrom });
		assert.deepStrictEqual(
			[...columnsBySha(fixed.rows)],
			[...columnsBySha(cold.rows)],
			'the gated layout equals cold (== reopening the graph)',
		);
	});

	test('a plain commit (prepend) still keeps sticky stability through the gate', () => {
		const prior = processCommitsAndSegments(priorCommits);
		// A new commit on top of P — a prepend, not a rewrite.
		const withCommit = [commit('N', ['P'], 4), ...priorCommits];

		const stableFrom = stableFromFor(priorCommits, withCommit, prior.stability);
		assert.notStrictEqual(stableFrom, undefined, 'a prepend is not a rewrite, so stability is preserved');

		const gated = processCommitsAndSegments(withCommit, { stableFrom: stableFrom });
		// The surviving commits reproduce their prior columns (no reshuffle).
		for (const sha of ['P', 'Q', 'base']) {
			assert.strictEqual(
				gated.rows.find(r => r.sha === sha)!.column,
				prior.rows.find(r => r.sha === sha)!.column,
				`prepend keeps ${sha}'s column stable`,
			);
		}
	});
});
