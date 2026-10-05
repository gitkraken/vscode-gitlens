import * as assert from 'assert';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { GitError } from '../../../exec/git.js';
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

function isNotARepositoryError(ex: unknown): boolean {
	return ex instanceof GitError && /not a git repository/i.test(ex.stderr ?? '');
}

function createUnbornRepo(): string {
	const path = mkdtempSync(join(tmpdir(), 'gitlens-unborn-'));
	execFileSync('git', ['init', '-b', 'main'], { cwd: path, stdio: 'pipe' });
	return path;
}

suite('StatusSubProvider — reads reject when git fails', () => {
	let repo: TestRepo;
	let notARepoPath: string;
	let bareRepoPath: string;

	suiteSetup(() => {
		repo = createTestRepo();
		notARepoPath = mkdtempSync(join(tmpdir(), 'gitlens-not-a-repo-'));
		bareRepoPath = mkdtempSync(join(tmpdir(), 'gitlens-bare-repo-'));
		execFileSync('git', ['init', '--bare'], { cwd: bareRepoPath });
	});

	suiteTeardown(() => {
		rmSync(notARepoPath, { recursive: true, force: true });
		rmSync(bareRepoPath, { recursive: true, force: true });
		repo.cleanup();
	});

	test('getStatus rejects outside a repository', async () => {
		await assert.rejects(repo.provider.status.getStatus(notARepoPath), isNotARepositoryError);
	});

	test('getStatus rejects in a bare repository', async () => {
		await assert.rejects(repo.provider.status.getStatus(bareRepoPath), (ex: unknown) => ex instanceof GitError);
	});

	test('getStatusForFile and getStatusForPath still resolve undefined outside a repository', async () => {
		assert.strictEqual(await repo.provider.status.getStatusForFile?.(notARepoPath, 'a.txt'), undefined);
		assert.strictEqual(await repo.provider.status.getStatusForPath?.(notARepoPath, 'a.txt'), undefined);
		assert.strictEqual(
			await repo.provider.status.getStatusForPath?.(notARepoPath, 'a.txt', { renames: false }),
			undefined,
		);
	});

	test('getUntrackedFiles rejects outside a repository', async () => {
		await assert.rejects(repo.provider.status.getUntrackedFiles(notARepoPath), isNotARepositoryError);
	});

	test('getConflictingFiles rejects outside a repository', async () => {
		await assert.rejects(repo.provider.status.getConflictingFiles(notARepoPath), isNotARepositoryError);
	});

	test('hasConflictingFiles rejects outside a repository', async () => {
		await assert.rejects(repo.provider.status.hasConflictingFiles(notARepoPath), isNotARepositoryError);
	});

	// Outside a repository `git diff` falls back to its `--no-index` usage, so its stderr names no repository
	test('getWorkingChangesState rejects outside a repository', async () => {
		await assert.rejects(
			repo.provider.status.getWorkingChangesState(notARepoPath),
			(ex: unknown) => ex instanceof GitError,
		);
	});

	test('hasWorkingChanges rejects outside a repository', async () => {
		await assert.rejects(
			repo.provider.status.hasWorkingChanges(notARepoPath),
			(ex: unknown) => ex instanceof GitError,
		);
	});

	test('a cancelled read rejects as a cancellation', async () => {
		await assert.rejects(repo.provider.status.getUntrackedFiles(repo.path, AbortSignal.abort()), (ex: unknown) =>
			isCancellationError(ex),
		);
		await assert.rejects(
			repo.provider.status.hasWorkingChanges(repo.path, undefined, AbortSignal.abort()),
			(ex: unknown) => isCancellationError(ex),
		);
	});
});

suite('StatusSubProvider — working changes before the first commit', () => {
	let repo: TestRepo;
	const unbornPaths: string[] = [];

	function unborn(): string {
		const path = createUnbornRepo();
		unbornPaths.push(path);
		return path;
	}

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		for (const path of unbornPaths) {
			rmSync(path, { recursive: true, force: true });
		}
		repo.cleanup();
	});

	test('a staged file is a working change', async () => {
		const path = unborn();
		writeFileSync(join(path, 'a.txt'), 'a\n');
		execFileSync('git', ['add', 'a.txt'], { cwd: path, stdio: 'pipe' });

		assert.strictEqual(await repo.provider.status.hasWorkingChanges(path), true);

		const state = await repo.provider.status.getWorkingChangesState(path);
		assert.deepStrictEqual(state, { staged: true, unstaged: false, untracked: false });
	});

	test('an empty repository has no working changes', async () => {
		assert.strictEqual(await repo.provider.status.hasWorkingChanges(unborn()), false);
	});

	test('an untracked file alone is a working change', async () => {
		const path = unborn();
		writeFileSync(join(path, 'a.txt'), 'a\n');

		assert.strictEqual(await repo.provider.status.hasWorkingChanges(path), true);
	});
});

suite('StatusSubProvider — hasWorkingChanges', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test('a modified tracked file is a working change', async () => {
		writeFileSync(join(repo.path, 'README.md'), '# Updated\n');

		assert.strictEqual(await repo.provider.status.hasWorkingChanges(repo.path), true);
	});

	test('a staged file is a staged change', async () => {
		writeFileSync(join(repo.path, 'staged.txt'), 'staged\n');
		execFileSync('git', ['add', 'staged.txt'], { cwd: repo.path, stdio: 'pipe' });

		assert.strictEqual(
			await repo.provider.status.hasWorkingChanges(repo.path, { unstaged: false, untracked: false }),
			true,
		);
	});

	test('an untracked file alone is a working change', async () => {
		writeFileSync(join(repo.path, 'untracked.txt'), 'untracked\n');

		assert.strictEqual(await repo.provider.status.hasWorkingChanges(repo.path), true);
	});

	test('a clean working tree has no working changes', async () => {
		assert.strictEqual(await repo.provider.status.hasWorkingChanges(repo.path), false);
	});
});
