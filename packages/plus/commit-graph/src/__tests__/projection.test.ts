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

suite('projection/setAllCollapsed', () => {
	// `inputFor` above hardcodes `foldingEnabled: false`, which this suite needs `true` for — build a
	// local input instead of touching that helper (an existing test depends on its default).
	function foldingInputFor(processed: ReturnType<typeof processGraphRows>): CommitGraphProjectionInput {
		return {
			identity: 'repo',
			viewKey: 'view',
			rows: processed.rows,
			segments: processed.segments,
			unloadedColumns: processed.unloadedColumns,
			indexBySha: new Map(processed.rows.map((r, i) => [r.sha, i])),
			transition: { kind: 'initial' } as const,
			trunkSegmentTip: 'M',
			wipAnchorShas: new Set<string>(),
			wipSegmentTips: new Set<string>(),
			foldingEnabled: true,
			foldingDefault: 'none' as const,
			searchActive: false,
			scopeAnchors: {},
		};
	}

	// Trunk (M-A-B-C-D) with a feature lane (F2-F1) forking at B and merging back at M — one
	// collapsible (non-trunk) segment, tipped at F2.
	function baseCommits() {
		return [
			commit('M', ['A', 'F2']),
			commit('F2', ['F1']),
			commit('F1', ['B']),
			commit('A', ['B']),
			commit('B', ['C']),
			commit('C', ['D']),
			commit('D', []),
		];
	}

	test('fold-all then unfold-all round-trips to the default projection', () => {
		const session = new CommitGraphProjectionSession();
		const processed = processGraphRows(baseCommits());

		const before = session.update(foldingInputFor(processed));
		const beforeShas = before.rows.map(r => r.sha);

		session.setAllCollapsed(true);
		const after = session.setAllCollapsed(false);

		assert.deepStrictEqual(
			after?.state.rows.map(r => r.sha),
			beforeShas,
		);
	});

	test('fold-all leaves the trunk tip sha visible (trunk is never collapsible)', () => {
		const session = new CommitGraphProjectionSession();
		const processed = processGraphRows(baseCommits());
		session.update(foldingInputFor(processed));

		const folded = session.setAllCollapsed(true);

		assert.ok(
			folded?.state.rows.some(r => r.sha === 'M'),
			'trunk tip M must stay visible',
		);
		assert.ok(!folded?.state.rows.some(r => r.sha === 'F1'), 'the folded feature lane body must be hidden');
	});

	test('setAllCollapsed calls update() exactly once', () => {
		const session = new CommitGraphProjectionSession();
		const processed = processGraphRows(baseCommits());
		session.update(foldingInputFor(processed));

		const originalUpdate = session.update.bind(session);
		let calls = 0;
		session.update = (...args: Parameters<typeof originalUpdate>) => {
			calls++;
			return originalUpdate(...args);
		};

		session.setAllCollapsed(true);
		assert.strictEqual(calls, 1);
	});

	test('a tip appearing after fold-all is not retroactively collapsed', () => {
		const session = new CommitGraphProjectionSession();
		const processed = processGraphRows(baseCommits());
		session.update(foldingInputFor(processed));

		// Snapshot fold-all: manuallyCollapsed captures only the segment tips that exist RIGHT NOW
		// (F2). It's a one-time set copy, not a live predicate, so a segment tip that appears later
		// (via a subsequent update()) was never added to it and stays expanded.
		session.setAllCollapsed(true);

		// A second, later graph: the same trunk/feature-1 shape, plus trunk continuing through F/H and
		// a brand-new second feature lane (G2-G2b) forking at H — a segment tip that did not exist at
		// fold-all time.
		const laterCommits = [
			commit('M', ['A', 'F2']),
			commit('F2', ['F1']),
			commit('F1', ['B']),
			commit('A', ['B']),
			commit('B', ['C']),
			commit('C', ['D']),
			commit('D', ['F']),
			commit('F', ['H', 'G2']),
			commit('G2', ['G2b']),
			commit('G2b', ['H']),
			commit('H', []),
		];
		const laterProcessed = processGraphRows(laterCommits);
		const after = session.update(foldingInputFor(laterProcessed));

		assert.ok(
			after.rows.some(r => r.sha === 'G2b'),
			'the new feature lane body (G2b) must be visible, not folded by the earlier fold-all snapshot',
		);
	});
});
