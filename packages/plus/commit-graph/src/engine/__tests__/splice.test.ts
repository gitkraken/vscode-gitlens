import * as assert from 'assert';
import { processCommitsAndSegments } from '../process.js';
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

type Result = ReturnType<typeof processCommitsAndSegments>;

function comparable(r: Result): unknown {
	return {
		rows: r.rows,
		segments: [...r.segments].slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		unloadedColumns: [...r.unloadedColumns].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
	};
}

// Run PRIOR over `priorCommits`, then NEXT over `nextCommits` twice — once plain (the oracle) and
// once with `reconcile` + sticky hints (the splice path) — and assert byte-identical output plus
// prior-identity reuse when the splice fired. Mirrors the renderer's exact orchestration.
function assertSpliceMatchesFull(
	priorCommits: readonly GraphCommit[],
	nextCommits: readonly GraphCommit[],
): { spliced: boolean } {
	const prior = processCommitsAndSegments(priorCommits);
	const priorIdx = new Map(prior.rows.map((r, i) => [r.sha, i]));
	const preferred = new Map(prior.rows.map(r => [r.sha, r.column]));
	for (const [sha, column] of prior.unloadedColumns) {
		preferred.set(sha, column);
	}

	const oracle = processCommitsAndSegments(nextCommits, { preferredColumns: preferred });
	const spliced = processCommitsAndSegments(nextCommits, {
		preferredColumns: preferred,
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

	test('second tip on the same parent (sibling) parks high and splices', () => {
		// The displaced sibling must NOT ripple through low lanes — that renumbers every lane below
		// and zeroes the reuse (seen live: stacked probe branches shifted a column at depth 12k).
		const prior = [commit('P1', ['M']), ...base];
		const r = assertSpliceMatchesFull(prior, [commit('P2', ['M']), ...prior]);
		assert.ok(r.spliced, 'expected the splice to fire below the sibling tips');
	});

	test('identical rows (no change) splice everything', () => {
		const r = assertSpliceMatchesFull(base, [...base]);
		assert.ok(r.spliced, 'expected a full splice');
	});

	test('successive sibling updates do not ratchet the lane space (parked columns excluded from prefs)', () => {
		// Mirrors the renderer's update loop: each run rebuilds preferences from the prior output,
		// EXCLUDING parked columns (≥ the prior run's floor). Without the exclusion each update
		// feeds parked lanes back as preferences, raising the floor — seen live at column 187.
		let commits = [...base];
		let prior = processCommitsAndSegments(commits);
		let priorFloor = prior.preferredColumnFloor;
		const naturalMax = Math.max(...prior.rows.map(r => r.column));
		for (let i = 1; i <= 5; i++) {
			commits = [commit(`SIB${i}`, ['M']), ...commits];
			const preferred = new Map<string, number>();
			for (const r of prior.rows) {
				if (priorFloor > 0 && r.column >= priorFloor) continue;

				preferred.set(r.sha, r.column);
			}
			for (const [sha, column] of prior.unloadedColumns) {
				if (priorFloor > 0 && column >= priorFloor) continue;

				preferred.set(sha, column);
			}
			prior = processCommitsAndSegments(commits, {
				preferredColumns: preferred,
				reconcile: { priorRows: prior.rows },
			});
			priorFloor = prior.preferredColumnFloor;
			const maxCol = Math.max(...prior.rows.map(r => r.column));
			// Bounded: natural lanes + one parked lane per still-live sibling tip, no compounding.
			assert.ok(maxCol <= naturalMax + 1 + i, `run ${i}: maxCol ${maxCol} ratcheted past ${naturalMax + 1 + i}`);
			assert.ok(prior.reconciled != null && prior.reconciled.reused > 0, `run ${i}: splice did not fire`);
		}
	});
});
