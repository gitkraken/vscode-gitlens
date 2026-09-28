import * as assert from 'assert';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

suite('StatusSubProvider — untracked/branch options', () => {
	let repo: TestRepo;
	let bareDir: string;

	suiteSetup(() => {
		repo = createTestRepo();

		bareDir = mkdtempSync(join(tmpdir(), 'gitlens-test-bare-'));
		execFileSync('git', ['clone', '--bare', repo.path, bareDir], { stdio: 'pipe' });
		execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['fetch', 'origin'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['branch', '--set-upstream-to', 'origin/main', 'main'], { cwd: repo.path, stdio: 'pipe' });

		// A modified tracked file, plus an untracked directory holding one file.
		writeFileSync(join(repo.path, 'README.md'), '# Updated\n');
		mkdirSync(join(repo.path, 'dir'));
		writeFileSync(join(repo.path, 'dir', 'a.txt'), 'x\n');
	});

	suiteTeardown(() => {
		rmSync(bareDir, { recursive: true, force: true });
		repo.cleanup();
	});

	test("untracked: 'no' returns no untracked files", async () => {
		const status = await repo.provider.status.getStatus(repo.path, { untracked: 'no' });
		assert.ok(status, 'Status should not be undefined');

		assert.ok(
			status.files.some(f => f.path === 'README.md'),
			'the modified file must still be present',
		);
		assert.ok(!status.files.some(f => f.status === '?'), 'no untracked entries at all');
	});

	test("untracked: 'normal' returns the directory as one entry", async () => {
		const status = await repo.provider.status.getStatus(repo.path, { untracked: 'normal' });
		assert.ok(status, 'Status should not be undefined');

		const untrackedPaths = status.files.filter(f => f.status === '?').map(f => f.path);
		assert.strictEqual(untrackedPaths.length, 1, 'the whole untracked directory collapses to one entry');
		assert.ok(untrackedPaths[0].startsWith('dir'), `expected a 'dir' entry, got ${untrackedPaths[0]}`);
		assert.ok(
			!status.files.some(f => f.path === 'dir/a.txt'),
			"'normal' must not list the file inside the untracked directory individually",
		);
	});

	test("untracked: 'all' (and the default) list the file inside the untracked directory", async () => {
		const allStatus = await repo.provider.status.getStatus(repo.path, { untracked: 'all', force: true });
		const defaultStatus = await repo.provider.status.getStatus(repo.path, { force: true });

		for (const status of [allStatus, defaultStatus]) {
			assert.ok(status, 'Status should not be undefined');
			assert.ok(
				status.files.some(f => f.path === 'dir/a.txt'),
				'dir/a.txt must be listed individually',
			);
		}
	});

	test('branch: false still returns the files, with no upstream state', async () => {
		const status = await repo.provider.status.getStatus(repo.path, { branch: false, force: true });
		assert.ok(status, 'Status should not be undefined');

		assert.ok(
			status.files.some(f => f.path === 'README.md'),
			'the modified file must still be present',
		);
		assert.ok(
			status.files.some(f => f.path === 'dir/a.txt'),
			'untracked files must still be present (default untracked mode)',
		);
		assert.strictEqual(status.upstream, undefined, 'no upstream state without --branch');
	});
});
