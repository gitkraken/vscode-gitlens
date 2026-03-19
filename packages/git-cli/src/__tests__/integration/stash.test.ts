import * as assert from 'assert';
import type { TestRepo } from './helpers.js';
import { createStash, createTestRepo } from './helpers.js';

suite('StashSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		createStash(repo.path, 'Test stash 1');
		createStash(repo.path, 'Test stash 2');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getStash returns stashes', async () => {
		const stash = await repo.provider.stash?.getStash(repo.path);
		assert.ok(stash, 'Stash should not be undefined');
		assert.ok(stash.stashes?.size, 'Should have stash entries');
		assert.ok(stash.stashes.size >= 2, `Expected at least 2 stashes, got ${stash.stashes.size}`);
	});

	test('stash commits have messages', async () => {
		const stash = await repo.provider.stash?.getStash(repo.path);
		assert.ok(stash?.stashes, 'Should have stash entries');

		for (const [, commit] of stash.stashes) {
			assert.ok(commit.message, `Stash ${commit.sha.slice(0, 8)} should have a message`);
		}
	});
});
