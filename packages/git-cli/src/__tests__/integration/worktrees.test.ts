import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('WorktreesSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getWorktrees returns at least the main worktree', async () => {
		const worktrees = await repo.provider.worktrees?.getWorktrees(repo.path);
		assert.ok(worktrees, 'Worktrees should not be undefined');
		assert.ok(worktrees.length >= 1, 'Should have at least 1 worktree (main)');
	});

	test('default worktree points to repo path', async () => {
		const worktrees = await repo.provider.worktrees?.getWorktrees(repo.path);
		assert.ok(worktrees, 'Worktrees should not be undefined');

		const main = worktrees.find(w => w.isDefault);
		assert.ok(main, 'Should have a default worktree');
		assert.ok(
			main.path.includes(repo.path) || repo.path.includes(main.path),
			`Default worktree path "${main.path}" should relate to repo path "${repo.path}"`,
		);
	});
});
