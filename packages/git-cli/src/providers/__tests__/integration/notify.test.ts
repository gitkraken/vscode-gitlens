import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

/**
 * A raw `provider.git.run(...)` call bypasses every typed mutator's cache-eviction — it is the escape
 * hatch for commands GitLens doesn't have a typed method for. `notify: 'infer'` is how such a caller opts
 * back into the same cache-eviction a typed mutator gets for free, WITHOUT the host wiring an
 * `onReset` handler of its own — the provider's own cache eviction runs unconditionally.
 */
suite('Raw git.run notify', () => {
	let repo: TestRepo;

	setup(() => {
		// No `hooks` passed to `createTestRepo` — the host has NO `onReset` handler.
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test("notify: 'infer' invalidates the cached branch list; without it, the same raw write is invisible", async () => {
		// Populate the branches cache with the pre-mutation state.
		let branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(!branches.values.some(b => b.name === 'x'), 'sanity: x does not exist yet');
		assert.ok(!branches.values.some(b => b.name === 'y'), 'sanity: y does not exist yet');

		await repo.provider.git.run({ cwd: repo.path, notify: 'infer' }, 'branch', 'x');

		branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(
			branches.values.some(b => b.name === 'x'),
			"notify: 'infer' should have invalidated the cached branch list",
		);

		// The identical raw write, but with no `notify` at all — nothing tells the provider anything
		// changed, so its cached branch list (read again just above) stays stale.
		await repo.provider.git.run({ cwd: repo.path }, 'branch', 'y');

		branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(
			!branches.values.some(b => b.name === 'y'),
			'without notify, the raw branch create should NOT be visible yet — the cache is still stale',
		);
	});
});
