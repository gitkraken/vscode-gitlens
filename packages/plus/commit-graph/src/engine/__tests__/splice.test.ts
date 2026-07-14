import * as assert from 'assert';
import { processCommitsAndSegments } from '../process.js';
import type { CommitKind, GraphCommit } from '../types.js';

function commit(hash: string, parents: string[], kind?: CommitKind, date = 0): GraphCommit {
	return {
		hash: hash,
		shortHash: hash.slice(0, 7),
		message: hash,
		author: 'Tester',
		authorEmail: 'test@example.com',
		date: date,
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

	test('a stub for a LOADED sha never ratchets the lane space', () => {
		// Out-of-contract input (a parent emitted above its own loaded child) makes the child reserve a lane
		// for an already-placed commit, which `finalizeLayout` then reports as an "unloaded" column for a sha
		// that IS loaded. Feeding that phantom back as a preference used to add a lane on EVERY update
		// (reproduced: maxColumn 2→13 over 12 cycles). The renderer's feedback order — stubs first, rows last,
		// so a real row's column always wins — is what contains it, and this pins that contract.
		const skewed = [
			commit('P', ['Z'], undefined, 100),
			commit('C', ['P'], undefined, 50),
			commit('Z', [], undefined, 10),
		];
		let prior = processCommitsAndSegments(skewed);
		const baseline = Math.max(...prior.rows.map(r => r.column));
		for (let i = 1; i <= 12; i++) {
			const preferred = new Map<string, number>();
			for (const [sha, column] of prior.unloadedColumns) {
				preferred.set(sha, column);
			}
			for (const r of prior.rows) {
				preferred.set(r.sha, r.column);
			}
			prior = processCommitsAndSegments(skewed, {
				preferredColumns: preferred,
				reconcile: { priorRows: prior.rows },
			});
			const maxCol = Math.max(...prior.rows.map(r => r.column));
			assert.strictEqual(maxCol, baseline, `run ${i}: lane space ratcheted to ${maxCol}`);
		}
	});

	test('identical rows (no change) splice everything', () => {
		const r = assertSpliceMatchesFull(base, [...base]);
		assert.ok(r.spliced, 'expected a full splice');
	});

	test('successive sibling updates do not ratchet the lane space', () => {
		// Mirrors the renderer's update loop: each run rebuilds preferences from the ENTIRE prior output.
		// Lanes used to park past the deepest preferred column, so feeding them back raised the park floor
		// on every update and the lane space ran away (seen live at column 187). Claims are release-bounded
		// now, so a displaced tip takes the lowest genuinely-free column and the width tracks only the
		// lanes that are really live — 10 concurrent sibling tips means 10 lanes, and nothing beyond.
		let commits = [...base];
		let prior = processCommitsAndSegments(commits);
		const naturalMax = Math.max(...prior.rows.map(r => r.column));
		for (let i = 1; i <= 10; i++) {
			commits = [commit(`SIB${i}`, ['M']), ...commits];
			const preferred = new Map<string, number>();
			// Renderer's exact feedback order: stubs first, real rows last, so a row always wins the tie.
			for (const [sha, column] of prior.unloadedColumns) {
				preferred.set(sha, column);
			}
			for (const r of prior.rows) {
				preferred.set(r.sha, r.column);
			}
			prior = processCommitsAndSegments(commits, {
				preferredColumns: preferred,
				reconcile: { priorRows: prior.rows },
			});
			const maxCol = Math.max(...prior.rows.map(r => r.column));
			// Every sibling is a live lane between its row and M, so `i` of them genuinely need `i` lanes.
			// Anything past that is the engine inventing width — the exact failure this guards.
			const live = Math.max(naturalMax, i - 1);
			assert.ok(maxCol <= live, `run ${i}: maxCol ${maxCol} exceeds the ${live} genuinely-live lanes`);
			assert.ok(prior.reconciled != null && prior.reconciled.reused > 0, `run ${i}: splice did not fire`);
		}
	});
});
