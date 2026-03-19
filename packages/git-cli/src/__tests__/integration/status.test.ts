import * as assert from 'assert';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('StatusSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getStatus shows clean working tree', async () => {
		const status = await repo.provider.status.getStatus(repo.path);
		assert.ok(status, 'Status should not be undefined');
		assert.strictEqual(status.branch, 'main');
		assert.strictEqual(status.files.length, 0, 'Clean repo should have no changed files');
	});

	test('getStatus shows modified files', async () => {
		// Modify a tracked file
		writeFileSync(join(repo.path, 'README.md'), '# Updated\n');

		const status = await repo.provider.status.getStatus(repo.path);
		assert.ok(status, 'Status should not be undefined');
		assert.ok(status.files.length > 0, 'Should have modified files');

		const readme = status.files.find(f => f.path === 'README.md');
		assert.ok(readme, 'Should find README.md in changed files');
		assert.strictEqual(readme.status, 'M');

		// Restore
		execSync('git checkout -- README.md', { cwd: repo.path, stdio: 'pipe' });
	});

	test('getStatus shows untracked files', async () => {
		writeFileSync(join(repo.path, 'untracked.txt'), 'untracked\n');

		const status = await repo.provider.status.getStatus(repo.path);
		assert.ok(status, 'Status should not be undefined');

		const untracked = status.files.find(f => f.path === 'untracked.txt');
		assert.ok(untracked, 'Should find untracked.txt');
		assert.strictEqual(untracked.status, '?');

		// Clean up
		execSync('rm untracked.txt', { cwd: repo.path, stdio: 'pipe' });
	});

	test('getStatus shows staged files', async () => {
		writeFileSync(join(repo.path, 'staged.txt'), 'staged content\n');
		execSync('git add staged.txt', { cwd: repo.path, stdio: 'pipe' });

		const status = await repo.provider.status.getStatus(repo.path);
		assert.ok(status, 'Status should not be undefined');

		const staged = status.files.find(f => f.path === 'staged.txt');
		assert.ok(staged, 'Should find staged.txt');

		// Clean up
		execSync('git reset HEAD staged.txt && rm staged.txt', { cwd: repo.path, stdio: 'pipe' });
	});

	test('getStatus reports correct branch', async () => {
		execSync('git checkout -b test-status-branch', { cwd: repo.path, stdio: 'pipe' });

		const status = await repo.provider.status.getStatus(repo.path);
		assert.ok(status, 'Status should not be undefined');
		assert.strictEqual(status.branch, 'test-status-branch');

		// Switch back
		execSync('git checkout main', { cwd: repo.path, stdio: 'pipe' });
	});
});
