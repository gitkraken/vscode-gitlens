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

// Compare the render-facing output (NOT the opaque resume token). Segments + unloadedColumns are order-
// insensitive (sort for a stable compare); rows ARE order-sensitive (topological), so compare as-is.
function comparable(r: Result): unknown {
	return {
		rows: r.rows,
		segments: [...r.segments].slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		unloadedColumns: [...r.unloadedColumns].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
	};
}

// Assert that paging the commits in at EVERY split point (and every 2-step chain of appends) produces a
// result byte-identical to a single full recompute over the whole set.
function assertIncrementalMatchesFull(commits: readonly GraphCommit[]): void {
	const full = processCommitsAndSegments(commits);

	// Single append at each boundary.
	for (let split = 1; split < commits.length; split++) {
		const batch1 = processCommitsAndSegments(commits.slice(0, split));
		const appended = processCommitsAndSegments(commits, { resume: batch1.resume });
		assert.deepStrictEqual(comparable(appended), comparable(full), `single append at split ${split} diverged`);
	}

	// Two chained appends (a → b → full) — exercises resuming from an already-resumed snapshot.
	for (let a = 1; a < commits.length - 1; a++) {
		for (let b = a + 1; b < commits.length; b++) {
			const s1 = processCommitsAndSegments(commits.slice(0, a));
			const s2 = processCommitsAndSegments(commits.slice(0, b), { resume: s1.resume });
			const s3 = processCommitsAndSegments(commits, { resume: s2.resume });
			assert.deepStrictEqual(comparable(s3), comparable(full), `chained append ${a}→${b}→full diverged`);
		}
	}
}

suite('engine/incremental append equivalence', () => {
	test('linear history', () => {
		assertIncrementalMatchesFull([commit('A', ['B']), commit('B', ['C']), commit('C', ['D']), commit('D', [])]);
	});

	test('merge fan (branch forks then merges back)', () => {
		assertIncrementalMatchesFull([
			commit('M', ['A', 'B'], 'merge'),
			commit('A', ['C']),
			commit('B', ['C']),
			commit('C', ['D']),
			commit('D', []),
		]);
	});

	test('unloaded merge parent that pages in later (reservation resolved on append)', () => {
		// M's second parent Z is far below; splitting before Z loads exercises the held-reservation path.
		assertIncrementalMatchesFull([
			commit('M', ['A', 'Z'], 'merge'),
			commit('A', ['B']),
			commit('B', ['Z']),
			commit('Z', ['Y']),
			commit('Y', []),
		]);
	});

	test('stash lane sharing a parent', () => {
		assertIncrementalMatchesFull([
			commit('A', ['C']),
			commit('S', ['C'], 'stash'),
			commit('C', ['D']),
			commit('D', []),
		]);
	});

	test('diamond with two merges', () => {
		assertIncrementalMatchesFull([
			commit('T', ['M1', 'X'], 'merge'),
			commit('M1', ['A', 'B'], 'merge'),
			commit('X', ['B']),
			commit('A', ['B']),
			commit('B', ['C']),
			commit('C', []),
		]);
	});

	test('multiple independent branches off a shared base', () => {
		assertIncrementalMatchesFull([
			commit('H1', ['S']),
			commit('H2', ['S']),
			commit('H3', ['S']),
			commit('S', ['R']),
			commit('R', []),
		]);
	});

	test('worktree WIP row above an already-reserved anchor (release-bounded lane)', () => {
		// W's anchor F is reserved (S is F's child), so W's lane is BOUNDED — it frees one row later at F.
		// The bound must be derived identically whether F pages in with W or on a later append.
		assertIncrementalMatchesFull([
			commit('T', ['M']),
			commit('S', ['F']),
			commit('W', ['F'], 'workdir'),
			commit('F', ['M']),
			commit('M', ['A', 'B'], 'merge'),
			commit('A', ['BASE']),
			commit('B', ['BASE']),
			commit('BASE', []),
		]);
	});

	test('resume returns a token equal in effect to a fresh full run', () => {
		const commits = [commit('A', ['B']), commit('B', ['C']), commit('C', [])];
		const full = processCommitsAndSegments(commits);
		// A no-op "append" (same commit count) must NOT take the append path — falls back to full.
		const again = processCommitsAndSegments(commits, { resume: full.resume });
		assert.deepStrictEqual(comparable(again), comparable(full));
	});
});
