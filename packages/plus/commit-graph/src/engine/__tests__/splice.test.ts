import * as assert from 'assert';
import { processGraphRows } from '../process.js';
import type { CommitKind, GraphCommit } from '../types.js';

function commit(sha: string, parents: string[], kind?: CommitKind, date = 0): GraphCommit {
	return {
		sha: sha,
		shortSha: sha.slice(0, 7),
		message: sha,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: date,
		parents: parents,
		kind: kind ?? (parents.length > 1 ? 'merge' : 'commit'),
	};
}

type Result = ReturnType<typeof processGraphRows>;

function comparable(r: Result): unknown {
	return {
		rows: r.rows,
		segments: [...r.segments].slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		unloadedColumns: [...r.unloadedColumns].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
	};
}

// Run PRIOR over `priorCommits`, then NEXT over `nextCommits` twice — once plain (the oracle) and
// once with `reconcile` (the splice path) — and assert byte-identical output plus prior-identity
// reuse when the splice fired. Mirrors the renderer's exact orchestration.
function assertSpliceMatchesFull(
	priorCommits: readonly GraphCommit[],
	nextCommits: readonly GraphCommit[],
): { spliced: boolean } {
	const prior = processGraphRows(priorCommits);
	const priorIdx = new Map(prior.rows.map((r, i) => [r.sha, i]));

	const oracle = processGraphRows(nextCommits);
	const spliced = processGraphRows(nextCommits, {
		reconcile: { priorRows: prior.rows, priorIndexOfSha: sha => priorIdx.get(sha) },
	});

	assert.deepStrictEqual(comparable(spliced), comparable(oracle), 'spliced run diverged from the full run');

	const rec = spliced.reconciled;
	if (rec != null) {
		assert.ok(rec.reused > 0);
		for (let k = 0; k < rec.reused; k++) {
			assert.strictEqual(
				spliced.rows[rec.nextStart + k],
				prior.rows[rec.priorStart + k],
				`row ${rec.nextStart + k} should be the prior object`,
			);
		}
	}
	return { spliced: rec != null };
}

const base = [
	commit('M', ['A', 'X1']),
	commit('X1', ['X2']),
	commit('X2', ['A']),
	commit('A', ['B']),
	commit('S', ['B'], 'stash'),
	commit('B', ['C']),
	commit('C', ['D']),
	commit('D', []),
];

suite('engine/process prefix-change splice equivalence', () => {
	test('single trunk prepend splices with prior identity', () => {
		const r = assertSpliceMatchesFull(base, [commit('N', ['M']), ...base]);
		assert.ok(r.spliced, 'expected the splice to fire');
	});

	test('several prepends splice', () => {
		const r = assertSpliceMatchesFull(base, [commit('N1', ['N2']), commit('N2', ['M']), ...base]);
		assert.ok(r.spliced, 'expected the splice to fire');
	});

	test('mid-window tip (new lane threads part of the graph) still matches the oracle', () => {
		assertSpliceMatchesFull(base, [commit('N', ['B']), ...base]);
	});

	test('cut bottom (fixed-count reload) aligns via the locator and matches', () => {
		const next = [commit('N', ['M']), ...base.slice(0, -1)];
		const r = assertSpliceMatchesFull(base, next);
		assert.ok(r.spliced, 'expected the splice to fire across the cut');
	});

	test('grown bottom (rebuild loaded further) computes the tail and matches', () => {
		const shortPrior = base.slice(0, -2);
		const r = assertSpliceMatchesFull(shortPrior, [commit('N', ['M']), ...base]);
		assert.ok(r.spliced, 'expected the splice to fire across the grown bottom');
	});

	test('merge prepend with an unloaded parent matches the oracle', () => {
		assertSpliceMatchesFull(base, [commit('T', ['M', 'ZZ'], 'merge'), ...base]);
	});

	test('second tip on the same parent (sibling) steps over the used lanes and splices', () => {
		// The displaced sibling must NOT ripple through low lanes — that renumbers every lane below
		// and zeroes the reuse (seen live: stacked probe branches shifted a column at depth 12k).
		const prior = [commit('P1', ['M']), ...base];
		const r = assertSpliceMatchesFull(prior, [commit('P2', ['M']), ...prior]);
		assert.ok(r.spliced, 'expected the splice to fire below the sibling tips');
	});

	test('a worktree WIP row appearing above an interior anchor splices the tail below it', () => {
		// The renderer's real update: a worktree goes dirty, so its WIP row is injected mid-graph. Its lane
		// is release-bounded (freed at its anchor one row down), so nothing below the anchor may move.
		const next = [...base.slice(0, 3), commit('W', ['A'], 'workdir'), ...base.slice(3)];
		const r = assertSpliceMatchesFull(base, next);
		assert.ok(r.spliced, 'expected the splice to fire below the WIP row');
	});

	test('identical rows (no change) splice everything', () => {
		const r = assertSpliceMatchesFull(base, [...base]);
		assert.ok(r.spliced, 'expected a full splice');
	});

	test('successive sibling updates keep the lane space at the genuinely-live width', () => {
		// Mirrors the renderer's update loop: a sibling tip lands on M on every pass, and each run splices
		// against the prior one. The width must track only the lanes that are really live — 10 concurrent
		// sibling tips means 10 lanes, and nothing beyond. (Lane space used to run away here, seen live at
		// column 187, when a claim parked past the deepest lane instead of taking the lowest free one.)
		let commits = [...base];
		let prior = processGraphRows(commits);
		const naturalMax = Math.max(...prior.rows.map(r => r.column));
		for (let i = 1; i <= 10; i++) {
			commits = [commit(`SIB${i}`, ['M']), ...commits];
			prior = processGraphRows(commits, { reconcile: { priorRows: prior.rows } });
			const maxCol = Math.max(...prior.rows.map(r => r.column));
			// Every sibling is a live lane between its row and M, so `i` of them genuinely need `i` lanes.
			// Anything past that is the engine inventing width — the exact failure this guards.
			const live = Math.max(naturalMax, i - 1);
			assert.ok(maxCol <= live, `run ${i}: maxCol ${maxCol} exceeds the ${live} genuinely-live lanes`);
			assert.ok(prior.reconciled != null && prior.reconciled.reused > 0, `run ${i}: splice did not fire`);
		}
	});
});
