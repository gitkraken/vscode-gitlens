import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePath } from '@gitlens/utils/path.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('ConfigSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getConfig reads user.name', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.name');
		assert.strictEqual(value, 'Test User');
	});

	test('getConfig reads user.email', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'user.email');
		assert.strictEqual(value, 'test@gitlens.test');
	});

	test('getConfig returns undefined for unset keys', async () => {
		const value = await repo.provider.config.getConfig(repo.path, 'gitlens.nonexistent.key' as any);
		assert.strictEqual(value, undefined);
	});

	test('getRepositoryInfo resolves repo root + gitDir for the repo path', async () => {
		const info = await repo.provider.config.getRepositoryInfo(repo.path);
		assert.ok(info != null && !Array.isArray(info), 'should resolve to rich object shape');
		assert.strictEqual(info.repoPath, normalizePath(repo.path));
		assert.strictEqual(info.gitDir, normalizePath(join(repo.path, '.git')));
		assert.strictEqual(info.commonGitDir, undefined);
		assert.strictEqual(info.superprojectPath, undefined);
	});

	test('getRepositoryInfo returns [] for a non-git directory', async () => {
		const outside = mkdtempSync(join(tmpdir(), 'gitlens-test-nonrepo-'));
		try {
			const info = await repo.provider.config.getRepositoryInfo(outside);
			assert.deepStrictEqual(info, []);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
