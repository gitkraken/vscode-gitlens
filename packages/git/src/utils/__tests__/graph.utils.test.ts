import * as assert from 'assert';
import type { GitGraphRow } from '../../models/graph.js';
import { appendRowsAtCursor, restampGraphRowIds } from '../graph.utils.js';

function row(sha: string, options?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: sha,
		parents: [`p-${sha}`],
		author: 'Tester',
		email: 'test@example.com',
		date: 1000,
		message: `commit ${sha}`,
		kind: 'commit',
		...options,
	};
}

function rows(count: number, prefix = 'sha'): GitGraphRow[] {
	return Array.from({ length: count }, (_, i) => row(`${prefix}${i}`));
}

suite('graph.utils', () => {
	suite('appendRowsAtCursor', () => {
		test('cursor at the end appends the page (plain append)', () => {
			const appended = appendRowsAtCursor(rows(5), 'sha4', rows(3, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'sha3', 'sha4', 'page0', 'page1', 'page2'],
			);
		});

		test('cursor mid-array trims the rows below it before appending', () => {
			const appended = appendRowsAtCursor(rows(5), 'sha2', rows(2, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'page0', 'page1'],
			);
		});

		test('missing cursor appends after everything (reducer fallthrough)', () => {
			const appended = appendRowsAtCursor(rows(2), 'nope', rows(1, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				['sha0', 'sha1', 'page0'],
			);
		});

		test('cursor at last row appends without trimming', () => {
			const prior = rows(5);
			const appended = appendRowsAtCursor(prior, 'sha4', rows(3, 'page'));
			assert.deepStrictEqual(
				appended.map(r => r.sha),
				[...prior.map(r => r.sha), 'page0', 'page1', 'page2'],
			);
		});

		test('an empty page keeps the trimmed prior window', () => {
			const prior = rows(4);
			assert.deepStrictEqual(
				appendRowsAtCursor(prior, 'sha1', []).map(r => r.sha),
				['sha0', 'sha1'],
			);
			assert.deepStrictEqual(
				appendRowsAtCursor(prior, 'sha3', []).map(r => r.sha),
				['sha0', 'sha1', 'sha2', 'sha3'],
			);
		});
	});

	/**
	 * The single owner of the row-id swap (the host processor's copy was dead — it ran second, after these
	 * ids were already corrected). The git-cli integration suite pins the same swap end-to-end against real
	 * repos; these pin the field coverage and the prefix-collision guard directly.
	 */
	suite('restampGraphRowIds', () => {
		const from = '/repo';
		const to = '/repo.worktrees/wt';

		test('swaps every id-bearing field: head, its upstream and worktree, remotes, tags', () => {
			const r = row('sha0', {
				heads: [
					{
						name: 'main',
						id: `${from}|heads/main`,
						isCurrentHead: true,
						upstream: { name: 'origin/main', id: `${from}|remotes/origin/main`, missing: false },
						worktree: { id: `${from}|worktrees/wt`, path: to, isDefault: false },
					},
				],
				remotes: [{ name: 'main', owner: 'origin', url: '', id: `${from}|remotes/origin/main` }],
				tags: [{ name: 'v1', id: `${from}|tags/v1`, annotated: false }],
			});

			assert.strictEqual(restampGraphRowIds(r, from, to), true);
			assert.strictEqual(r.heads![0].id, `${to}|heads/main`);
			assert.strictEqual(r.heads![0].upstream!.id, `${to}|remotes/origin/main`);
			assert.strictEqual(r.heads![0].worktree!.id, `${to}|worktrees/wt`);
			assert.strictEqual(r.remotes![0].id, `${to}|remotes/origin/main`);
			assert.strictEqual(r.tags![0].id, `${to}|tags/v1`);
		});

		test('leaves non-id fields alone — a worktree PATH is not a stamped id', () => {
			const r = row('sha0', {
				heads: [
					{
						name: 'main',
						id: `${from}|heads/main`,
						isCurrentHead: true,
						worktree: { id: `${from}|worktrees/wt`, path: from, isDefault: true },
					},
				],
			});

			restampGraphRowIds(r, from, to);

			assert.strictEqual(r.heads![0].worktree!.path, from);
			assert.strictEqual(r.heads![0].name, 'main');
		});

		// The trailing `|` is part of the match for exactly this reason.
		test('does not swap a prefix-colliding repoPath (/repo vs /repo2)', () => {
			const r = row('sha0', { heads: [{ name: 'x', id: '/repo2|heads/x', isCurrentHead: false }] });

			restampGraphRowIds(r, from, to);

			assert.strictEqual(r.heads![0].id, '/repo2|heads/x');
		});

		test('reports false for an undecorated row, so callers can skip the rest of the rebind work', () => {
			const r = row('sha0');
			const before = structuredClone(r);

			assert.strictEqual(restampGraphRowIds(r, from, to), false);
			assert.deepStrictEqual(r, before);
		});

		test('reports true for a row that carries only serialized contexts', () => {
			const r = row('sha0', { contexts: { row: '{}' } });

			assert.strictEqual(restampGraphRowIds(r, from, to), true);
		});
	});
});
