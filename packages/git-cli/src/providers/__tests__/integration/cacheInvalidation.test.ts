import * as assert from 'assert';
import * as sinon from 'sinon';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import { createTestRepo } from './helpers.js';

suite('CliGitProvider — a write clears the provider’s own state', () => {
	test('a typed write is visible to the next read without a host onReset handler', async () => {
		const repo = createTestRepo();
		try {
			const before = await repo.provider.branches.getBranches(repo.path);
			assert.ok(!before.values.some(b => b.name === 'fresh'));

			await repo.provider.branches.createBranch(repo.path, 'fresh', 'HEAD');

			const after = await repo.provider.branches.getBranches(repo.path);
			assert.ok(
				after.values.some(b => b.name === 'fresh'),
				'the write must clear the cached branch list itself, not rely on a host handler to',
			);
		} finally {
			repo.cleanup();
		}
	});

	test('the host handler still runs with the same arguments, after pending commands are dropped', async () => {
		const resets: [string, CachedGitTypes[]][] = [];
		const repo = createTestRepo({
			hooks: { cache: { onReset: (repoPath, ...types) => resets.push([repoPath, types]) } },
		});
		const clearPending = sinon.spy(repo.provider.git, 'clearPendingCommands');
		try {
			await repo.provider.branches.createBranch(repo.path, 'fresh', 'HEAD');

			assert.deepStrictEqual(resets[0], [repo.path, ['branches']]);
			assert.ok(clearPending.called, 'a write must drop pending commands so no later caller joins one');
		} finally {
			clearPending.restore();
			repo.cleanup();
		}
	});
});
