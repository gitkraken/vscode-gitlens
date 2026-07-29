import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { addCommit, createStash, createTestRepo } from './helpers.js';

// `stashNumber` exists so the graph's details panel can tell a selected stash from an ordinary commit and
// route file actions accordingly (`buildCommitLite` -> `commitLite.stashNumber` -> `currentRef.stash`).
// Everything downstream of the wire is plain data flow; what actually needs real git is THIS end — that a
// stash row emerges from a walk carrying the `{n}` of `stash@{n}`. Asserting it here rather than trusting
// the field to be populated, since a silently-undefined optional is exactly how that wiring failed before.
suite('GraphSubProvider stash rows', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'hello', 'Add file1');
		addCommit(repo.path, 'file2.txt', 'world', 'Add file2');
		createStash(repo.path, 'first stash');
		createStash(repo.path, 'second stash');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('every stash row carries its stash number, and no commit row does', async () => {
		const graph = await repo.provider.graph.getGraph(repo.path, undefined);

		const stashRows = graph.rows.filter(r => r.kind === 'stash');
		assert.strictEqual(stashRows.length, 2, 'precondition: both stashes should be walked as rows');

		for (const row of stashRows) {
			assert.ok(
				row.stashNumber != null,
				`stash row ${row.sha} must carry a stashNumber (got ${String(row.stashNumber)})`,
			);
			assert.match(row.stashNumber, /^\d+$/, 'stashNumber is the bare index of `stash@{n}`, not the full ref');
		}

		// `stash@{0}` is the most recent — both indices must be present and distinct, so the field is really
		// per-row rather than a constant that happens to be non-null.
		assert.deepStrictEqual(
			stashRows.map(r => r.stashNumber).sort(),
			['0', '1'],
			'each stash row should carry its own index',
		);

		for (const row of graph.rows.filter(r => r.kind !== 'stash')) {
			assert.strictEqual(row.stashNumber, undefined, `non-stash row ${row.sha} must not claim a stash number`);
		}
	});
});
