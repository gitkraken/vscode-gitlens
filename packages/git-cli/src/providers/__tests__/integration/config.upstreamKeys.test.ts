import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('ConfigSubProvider — branch upstream keys', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test('round-trips branch.<name>.remote and branch.<name>.merge', async () => {
		await repo.provider.config.setConfig(repo.path, 'branch.main.remote', 'origin');
		await repo.provider.config.setConfig(repo.path, 'branch.main.merge', 'refs/heads/main');

		assert.strictEqual(await repo.provider.config.getConfig(repo.path, 'branch.main.remote'), 'origin');
		assert.strictEqual(await repo.provider.config.getConfig(repo.path, 'branch.main.merge'), 'refs/heads/main');
	});

	test('reads core.hooksPath', async () => {
		await repo.provider.config.setConfig(repo.path, 'core.hooksPath', '.hooks');

		// `core.hooksPath` is a merged read like any other config key — some environments inject a
		// higher-precedence override (e.g. via `GIT_CONFIG_*`) that shadows a local write, so assert
		// parity with plain `git config --get` rather than assuming our own write always wins.
		const expected =
			execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: repo.path, encoding: 'utf-8' }).trim() ||
			undefined;
		assert.strictEqual(await repo.provider.config.getConfig(repo.path, 'core.hooksPath'), expected);
	});

	test('a write invalidates a previously cached read', async () => {
		await repo.provider.config.setConfig(repo.path, 'branch.main.merge', 'refs/heads/main');
		const primed = await repo.provider.config.getConfig(repo.path, 'branch.main.merge');
		assert.strictEqual(primed, 'refs/heads/main');

		await repo.provider.config.setConfig(repo.path, 'branch.main.merge', 'refs/heads/other');
		const updated = await repo.provider.config.getConfig(repo.path, 'branch.main.merge');
		assert.strictEqual(updated, 'refs/heads/other', 'the cached value must be invalidated by the write');
	});

	test('setConfig on branch.<name>.remote fires onReset(repoPath, "branches")', async () => {
		const onReset: string[][] = [];
		const hookedRepo = createTestRepo({
			hooks: { cache: { onReset: (_repoPath, ...types) => onReset.push(types) } },
		});
		try {
			await hookedRepo.provider.config.setConfig(hookedRepo.path, 'branch.main.remote', 'origin');
			assert.deepStrictEqual(onReset, [['branches']]);
		} finally {
			hookedRepo.cleanup();
		}
	});

	test('setConfig on a non-upstream key (e.g. core.hooksPath) fires no reset', async () => {
		const onReset: string[][] = [];
		const hookedRepo = createTestRepo({
			hooks: { cache: { onReset: (_repoPath, ...types) => onReset.push(types) } },
		});
		try {
			await hookedRepo.provider.config.setConfig(hookedRepo.path, 'core.hooksPath', '.hooks');
			assert.deepStrictEqual(onReset, []);
		} finally {
			hookedRepo.cleanup();
		}
	});
});
