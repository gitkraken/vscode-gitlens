import * as assert from 'assert';
import { processGraphRows } from '../process.js';
import type { CommitKind, GraphCommit, ProcessedGraphRow } from '../types.js';

// Rows are newest-first; `date` descending keeps that order explicit where it matters.
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

function wip(parent: string): GraphCommit {
	// The WIP row's parent tracks HEAD — moving it is what makes a ff-merge/checkout a `replace`.
	return commit('work-dir', [parent], 'workdir', 1_000);
}

function columnsBySha(rows: readonly ProcessedGraphRow[]): Map<string, number> {
	return new Map(rows.map(r => [r.sha, r.column]));
}

/**
 * The TRUNK RE-ROOT contract. A ff-merge / checkout / reset moves HEAD onto an already-loaded commit that
 * was drawn on a side lane; keeping sticky columns strands the now-current branch there with a gap on the
 * base lane. The engine cannot detect this — the topology is unchanged and the lane shape is
 * indistinguishable from an ordinary side-lane gap — so the CONSUMER (which owns refs/HEAD) decides, via
 * `isTrunkReroot`, and drops `stableFrom`. These tests pin what that decision has to produce: dropping
 * fixes the layout, and the cases that must KEEP sticky stay byte-stable.
 */
suite('engine/trunk re-root — sticky columns across a HEAD move', () => {
	// The repro: `feat` is loaded ahead of `main` on a side lane (the WIP lane holds the base lane down to
	// the old HEAD). A fast-forward merge moves HEAD onto feat's tip with NO new commits.
	test('the repro: keeping sticky strands the re-rooted trunk on its old side lane', () => {
		const before = [
			wip('A'),
			commit('F', ['E'], 'commit', 5),
			commit('E', ['D'], 'commit', 4),
			commit('D', ['A'], 'commit', 3),
			commit('A', ['P'], 'commit', 2),
			commit('P', [], 'commit', 1),
		];
		const prior = processGraphRows(before);
		assert.strictEqual(columnsBySha(prior.rows).get('F'), 1, 'fixture: feat sits on a side lane');
		assert.strictEqual(columnsBySha(prior.rows).get('A'), 0, 'fixture: the trunk owns the base lane');

		// Fast-forward main → F: no commit row changes; only the WIP row re-anchors to F.
		const after = [
			wip('F'),
			commit('F', ['E'], 'commit', 5),
			commit('E', ['D'], 'commit', 4),
			commit('D', ['A'], 'commit', 3),
			commit('A', ['P'], 'commit', 2),
			commit('P', [], 'commit', 1),
		];

		const sticky = processGraphRows(after, { stableFrom: prior.stability });
		assert.strictEqual(columnsBySha(sticky.rows).get('F'), 1, 'sticky reproduces the stale side lane');
		assert.notStrictEqual(sticky.renormalized, true, 'the area backstop cannot catch this local misroute');
	});

	// …and the fix: dropping `stableFrom` (what `isTrunkReroot` triggers) reproduces the cold layout — the
	// same thing reopening the graph produces, which is the behaviour users already recognise as correct.
	test('the fix: dropping stability on a re-root puts the current branch back on the base lane', () => {
		const after = [
			wip('F'),
			commit('F', ['E'], 'commit', 5),
			commit('E', ['D'], 'commit', 4),
			commit('D', ['A'], 'commit', 3),
			commit('A', ['P'], 'commit', 2),
			commit('P', [], 'commit', 1),
		];
		const cold = processGraphRows(after);
		const cols = columnsBySha(cold.rows);
		for (const sha of ['F', 'E', 'D', 'A', 'P']) {
			assert.strictEqual(cols.get(sha), 0, `${sha} must sit on the trunk lane`);
		}
	});

	// The hidden-branch variant, which is NOT harmless: the revealed commits have no sticky columns of their
	// own, but the inheritance preamble hands the new tip its first parent's preference — so it inherits the
	// stale SIDE lane of the visible ancestor it forks from. `isTrunkReroot` therefore has to anchor on that
	// ancestor (its nearest previously-laid-out first-parent), not merely ask whether the tip itself was loaded.
	test('a revealed branch tip inherits its visible ancestor stale side lane, so it must drop sticky', () => {
		// C2 and C3 both fork from C4; C3 lands on the side lane. C0 (the hidden branch's tip) forks from C3.
		const before = [
			commit('C2', ['C4'], 'commit', 5),
			commit('C3', ['C4'], 'commit', 4),
			commit('C4', ['C5'], 'commit', 3),
			commit('C5', [], 'commit', 2),
		];
		const prior = processGraphRows(before);
		assert.strictEqual(columnsBySha(prior.rows).get('C3'), 1, 'fixture: the fork sits on a side lane');

		// Checking out the hidden branch reveals C0 (HEAD is never hidden).
		const after = [commit('C0', ['C3'], 'commit', 6), ...before];
		const sticky = processGraphRows(after, { stableFrom: prior.stability });
		const cold = processGraphRows(after);

		assert.strictEqual(columnsBySha(sticky.rows).get('C0'), 1, 'sticky strands the new HEAD on the side lane');
		assert.strictEqual(columnsBySha(cold.rows).get('C0'), 0, 'cold puts the current branch on the base lane');
		assert.notStrictEqual(sticky.renormalized, true, 'and the area backstop does not catch it');
	});

	// The other half of the contract: the updates that must NOT drop sticky have to stay byte-stable, or the
	// fix would trade a rare misroute for lane churn on everyday operations.
	test('an ordinary commit on a non-newest branch keeps its lanes', () => {
		const before = [
			commit('A', ['Z'], 'commit', 5), // newer branch, owns the base lane
			commit('B', ['Z'], 'commit', 4), // HEAD's branch, on the side lane
			commit('Z', [], 'commit', 1),
		];
		const prior = processGraphRows(before);
		assert.strictEqual(columnsBySha(prior.rows).get('B'), 1, 'fixture: HEAD branch on the side lane');

		const after = [
			commit('N', ['B'], 'commit', 6),
			commit('A', ['Z'], 'commit', 5),
			commit('B', ['Z'], 'commit', 4),
			commit('Z', [], 'commit', 1),
		];
		const sticky = processGraphRows(after, { stableFrom: prior.stability });

		assert.notStrictEqual(sticky.renormalized, true, 'an ordinary commit must not reshuffle lanes');
		const cols = columnsBySha(sticky.rows);
		assert.strictEqual(cols.get('A'), 0, 'the incumbent branch keeps the base lane');
		assert.strictEqual(cols.get('B'), 1, 'the branch keeps its stable side lane');
		assert.strictEqual(cols.get('N'), 1, 'the new commit joins its branch lane');
	});

	// A `git pull` fast-forward lands HEAD on a NEWLY-FETCHED tip. `isTrunkReroot` must not fire (the sha
	// was never laid out), and sticky must carry the new chain onto the trunk lane by inheritance.
	test('pull fast-forward onto newly-fetched commits keeps sticky on the trunk lane', () => {
		const before = [
			wip('A'),
			commit('A', ['B'], 'commit', 3),
			commit('B', ['C'], 'commit', 2),
			commit('C', [], 'commit', 1),
		];
		const prior = processGraphRows(before);
		assert.strictEqual(columnsBySha(prior.rows).get('A'), 0, 'fixture: linear trunk on the base lane');

		const after = [
			wip('N1'),
			commit('N1', ['N2'], 'commit', 5),
			commit('N2', ['A'], 'commit', 4),
			commit('A', ['B'], 'commit', 3),
			commit('B', ['C'], 'commit', 2),
			commit('C', [], 'commit', 1),
		];
		const sticky = processGraphRows(after, { stableFrom: prior.stability });

		assert.notStrictEqual(sticky.renormalized, true, 'a clean prepend must keep sticky stability');
		const cols = columnsBySha(sticky.rows);
		for (const sha of ['N1', 'N2', 'A', 'B', 'C']) {
			assert.strictEqual(cols.get(sha), 0, `${sha} must stay on the trunk lane`);
		}
	});

	// The two counterexamples that killed the engine-side heuristic, kept as regressions: neither moves
	// HEAD, so both MUST be byte-stable. A lane-shape backstop reshuffled both (a free lane next to the
	// trunk is ordinary, not evidence of a re-root).
	test('a fetch and a first WIP row, both with HEAD unchanged, are byte-stable', () => {
		const base = [
			commit('A', ['D'], 'commit', 6),
			commit('B', ['D'], 'commit', 5),
			commit('C', ['H'], 'commit', 4),
			commit('D', ['R'], 'commit', 3),
			commit('H', ['R'], 'commit', 2),
			commit('R', [], 'commit', 1),
		];
		const prior = processGraphRows(base);
		const priorCols = columnsBySha(prior.rows);

		// A fetch that adds an unrelated tip must not move any existing lane.
		const fetched = processGraphRows([commit('N', ['B'], 'commit', 7), ...base], {
			stableFrom: prior.stability,
		});
		const fetchedCols = columnsBySha(fetched.rows);
		for (const [sha, column] of priorCols) {
			assert.strictEqual(fetchedCols.get(sha), column, `fetch moved ${sha}`);
		}

		// Dirtying the working tree (first WIP row) must not move any existing lane either.
		const dirtied = processGraphRows([wip('H'), ...base], { stableFrom: prior.stability });
		const dirtiedCols = columnsBySha(dirtied.rows);
		for (const [sha, column] of priorCols) {
			assert.strictEqual(dirtiedCols.get(sha), column, `WIP row moved ${sha}`);
		}
	});
});
