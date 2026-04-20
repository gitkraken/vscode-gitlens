import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

suite('StashSubProvider.createStash', () => {
	test('returns SHA when working tree is dirty', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'README.md'), '# Test Repository\nmodified\n');
			const sha = await r.provider.stash?.createStash(r.path, 'snapshot');
			assert.ok(sha, 'Expected a SHA from createStash');
			assert.match(sha, /^[0-9a-f]{40}$/, 'Expected a full git SHA');

			// Working tree should still be dirty — createStash does NOT push onto the stash list
			// or reset the index/working tree. Verify by reading the file.
			const content = readFileSync(join(r.path, 'README.md'), 'utf-8');
			assert.ok(content.includes('modified'), 'createStash should not reset the working tree');

			// Stash list should remain empty
			const list = await r.provider.stash?.getStash(r.path);
			assert.strictEqual(list?.stashes.size ?? 0, 0, 'createStash should not add to the stash list');
		} finally {
			r.cleanup();
		}
	});

	test('returns undefined when working tree is clean', async () => {
		const r = createTestRepo();
		try {
			const sha = await r.provider.stash?.createStash(r.path);
			assert.strictEqual(sha, undefined, 'Expected undefined on clean repo');
		} finally {
			r.cleanup();
		}
	});
});

suite('StashSubProvider.applyStash (by SHA)', () => {
	test('applies a stash-like commit by SHA (no stash list entry required)', async () => {
		const r = createTestRepo();
		try {
			// Dirty the tree, snapshot via createStash (no list entry), reset, then apply by SHA
			writeFileSync(join(r.path, 'applied.txt'), 'applied content\n');
			execFileSync('git', ['add', 'applied.txt'], { cwd: r.path, stdio: 'pipe' });

			const sha = await r.provider.stash?.createStash(r.path, 'snapshot');
			assert.ok(sha, 'Expected a SHA');

			// Reset to a clean state — file gone
			execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: r.path, stdio: 'pipe' });
			assert.throws(
				() => readFileSync(join(r.path, 'applied.txt'), 'utf-8'),
				'File should not exist after reset',
			);

			const result = await r.provider.stash?.applyStash(r.path, sha);
			assert.ok(result, 'Expected a result');
			assert.strictEqual(result.conflicted, false);
			assert.strictEqual(readFileSync(join(r.path, 'applied.txt'), 'utf-8'), 'applied content\n');
		} finally {
			r.cleanup();
		}
	});
});
