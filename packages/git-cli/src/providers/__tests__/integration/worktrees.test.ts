import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { addWorktree, createBranch, createTestRepo } from './helpers.js';

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

suite('WorktreesSubProvider mutations', () => {
	let repo: TestRepo;
	let cacheResets: { repoPath: string; types: CachedGitTypes[] }[];
	let repoChanges: { repoPath: string; changes: RepositoryChange[] }[];

	suiteSetup(() => {
		cacheResets = [];
		repoChanges = [];
		repo = createTestRepo({
			hooks: {
				cache: { onReset: (repoPath, ...types) => cacheResets.push({ repoPath: repoPath, types: types }) },
				repository: {
					onChanged: (repoPath, changes) => repoChanges.push({ repoPath: repoPath, changes: changes }),
				},
			},
		});
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	setup(() => {
		cacheResets.length = 0;
		repoChanges.length = 0;
	});

	function porcelainWorktreeCount(): number {
		const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo.path, encoding: 'utf8' });
		return out.split('\n').filter(l => l.startsWith('worktree ')).length;
	}

	test('pruneWorktrees removes the admin entry of a worktree whose directory was deleted out from under git', async () => {
		const before = porcelainWorktreeCount();

		createBranch(repo.path, 'prune-target');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-worktree-prune-'));
		addWorktree(repo.path, worktreePath, 'prune-target');
		assert.strictEqual(porcelainWorktreeCount(), before + 1, 'the new worktree should be listed');

		rmSync(worktreePath, { recursive: true, force: true });
		// Git still carries the admin entry for a directory that was deleted out from under it.
		assert.strictEqual(
			porcelainWorktreeCount(),
			before + 1,
			'the admin entry should survive the directory going missing',
		);

		await repo.provider.worktrees.pruneWorktrees(repo.path);

		assert.strictEqual(porcelainWorktreeCount(), before, 'the pruned worktree admin entry should be gone');
		assert.ok(
			cacheResets.some(r => r.types.includes('worktrees')),
			'onReset should fire for worktrees',
		);
		assert.ok(
			repoChanges.some(c => c.changes.includes('worktrees')),
			'onChanged should fire for worktrees',
		);
	});

	test('pruneWorktrees unregisters the cache entry for a worktree it removes', async () => {
		createBranch(repo.path, 'prune-unregister-target');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-worktree-prune-unregister-'));
		addWorktree(repo.path, worktreePath, 'prune-unregister-target');

		// Register the worktree's path the way the host does for an opened repo.
		const gitDir = await repo.provider.config.getGitDir(worktreePath);
		repo.provider.cache.registerRepoPath(fileUri(worktreePath), gitDir);

		const normalizedPath = normalizePath(worktreePath);
		assert.strictEqual(
			repo.provider.cache.isRegistered(normalizedPath),
			true,
			'the worktree should be registered before pruning',
		);

		rmSync(worktreePath, { recursive: true, force: true });
		await repo.provider.worktrees.pruneWorktrees(repo.path);

		assert.strictEqual(
			repo.provider.cache.isRegistered(normalizedPath),
			false,
			'pruning should unregister the cache entry for the worktree it removed',
		);
	});

	test('lockWorktree records a reason and unlockWorktree clears it', async () => {
		createBranch(repo.path, 'lock-target');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-worktree-lock-'));
		addWorktree(repo.path, worktreePath, 'lock-target');

		try {
			await repo.provider.worktrees.lockWorktree(repo.path, worktreePath, { reason: 'testing lock' });
			assert.ok(
				cacheResets.some(r => r.types.includes('worktrees')),
				'onReset should fire for worktrees on lock',
			);
			assert.ok(
				repoChanges.some(c => c.changes.includes('worktrees')),
				'onChanged should fire for worktrees on lock',
			);

			// `getWorktrees` is cached — clear it (what a host's `onReset` handler would do) before re-reading.
			repo.provider.cache.clearCaches(repo.path, 'worktrees');
			let worktrees = await repo.provider.worktrees.getWorktrees(repo.path);
			const locked = worktrees.find(w => w.branch?.name === 'lock-target');
			assert.ok(locked, 'the locked worktree should be listed');
			assert.strictEqual(locked.locked, 'testing lock');

			cacheResets.length = 0;
			repoChanges.length = 0;

			await repo.provider.worktrees.unlockWorktree(repo.path, worktreePath);
			assert.ok(
				cacheResets.some(r => r.types.includes('worktrees')),
				'onReset should fire for worktrees on unlock',
			);

			repo.provider.cache.clearCaches(repo.path, 'worktrees');
			worktrees = await repo.provider.worktrees.getWorktrees(repo.path);
			const unlocked = worktrees.find(w => w.branch?.name === 'lock-target');
			assert.ok(unlocked, 'the worktree should still be listed');
			assert.strictEqual(unlocked.locked, false);
		} finally {
			execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repo.path, stdio: 'pipe' });
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});

	test('deleteWorktree accepts run options', async () => {
		createBranch(repo.path, 'delete-target');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-worktree-delete-'));
		addWorktree(repo.path, worktreePath, 'delete-target');

		await repo.provider.worktrees.deleteWorktree(repo.path, worktreePath, undefined, { timeout: 0 });

		const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo.path, encoding: 'utf8' });
		assert.ok(!out.includes(worktreePath), 'the deleted worktree should no longer be listed');
	});

	test('a cancelled createWorktree rejects as CancellationError, not WorktreeCreateError', async () => {
		createBranch(repo.path, 'create-cancelled-target');
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-worktree-create-cancelled-'));
		const isCancellation = (err: unknown) => err instanceof Error && err.name === 'CancellationError';

		try {
			const runOptions = { cancellation: AbortSignal.abort() };
			await assert.rejects(
				repo.provider.worktrees.createWorktree(
					repo.path,
					join(parent, 'direct'),
					{ commitish: 'create-cancelled-target' },
					runOptions,
				),
				isCancellation,
			);
			await assert.rejects(
				repo.provider.worktrees.createWorktreeWithResult(
					repo.path,
					join(parent, 'with-result'),
					{ commitish: 'create-cancelled-target' },
					runOptions,
				),
				isCancellation,
			);

			const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo.path, encoding: 'utf8' });
			assert.ok(
				!out.includes('branch refs/heads/create-cancelled-target'),
				'a cancelled checkout must not add the worktree',
			);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	test('a cancelled deleteWorktree rejects as CancellationError, not WorktreeDeleteError', async () => {
		createBranch(repo.path, 'delete-cancelled-target');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-worktree-delete-cancelled-'));
		addWorktree(repo.path, worktreePath, 'delete-cancelled-target');

		try {
			await assert.rejects(
				repo.provider.worktrees.deleteWorktree(repo.path, worktreePath, undefined, {
					cancellation: AbortSignal.abort(),
				}),
				(err: unknown) => err instanceof Error && err.name === 'CancellationError',
			);

			const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
				cwd: repo.path,
				encoding: 'utf8',
			});
			// Matched by branch, not path — git may record the realpath of a symlinked temp dir.
			assert.ok(
				out.includes('branch refs/heads/delete-cancelled-target'),
				'a cancelled removal must leave the worktree in place',
			);
		} finally {
			execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repo.path, stdio: 'pipe' });
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});
});
