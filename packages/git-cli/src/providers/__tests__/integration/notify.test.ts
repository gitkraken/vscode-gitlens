import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePath } from '@gitlens/utils/path.js';
import type { HeadState } from '../../../exec/headState.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree } from './helpers.js';

/**
 * A raw `provider.git.run(...)` call bypasses every typed mutator's cache-eviction — it is the escape
 * hatch for commands GitLens doesn't have a typed method for. `notify: 'infer'` is how such a caller opts
 * back into the same cache-eviction a typed mutator gets for free, WITHOUT the host wiring an
 * `onReset` handler of its own — the provider's own cache eviction runs unconditionally.
 */
suite('Raw git.run notify', () => {
	let repo: TestRepo;

	setup(() => {
		// No `hooks` passed to `createTestRepo` — the host has NO `onReset` handler.
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test("notify: 'infer' invalidates the cached branch list; without it, the same raw write is invisible", async () => {
		// Populate the branches cache with the pre-mutation state.
		let branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(!branches.values.some(b => b.name === 'x'), 'sanity: x does not exist yet');
		assert.ok(!branches.values.some(b => b.name === 'y'), 'sanity: y does not exist yet');

		await repo.provider.git.run({ cwd: repo.path, notify: 'infer' }, 'branch', 'x');

		branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(
			branches.values.some(b => b.name === 'x'),
			"notify: 'infer' should have invalidated the cached branch list",
		);

		// The identical raw write, but with no `notify` at all — nothing tells the provider anything
		// changed, so its cached branch list (read again just above) stays stale.
		await repo.provider.git.run({ cwd: repo.path }, 'branch', 'y');

		branches = await repo.provider.branches.getBranches(repo.path);
		assert.ok(
			!branches.values.some(b => b.name === 'y'),
			'without notify, the raw branch create should NOT be visible yet — the cache is still stale',
		);
	});
});

suite('Raw git.run notify — naming the branch HEAD is on', () => {
	let repo: TestRepo;
	let wt: { path: string; cleanup: () => void };
	let spawns: string[][];

	setup(() => {
		repo = createTestRepo();
		createBranch(repo.path, 'feature');
		// Added outside core, so the provider never registered it, as with Kepler's scratch worktrees
		wt = createWorktree(repo.path, 'feature');

		spawns = [];
		const git = repo.provider.git as unknown as { _runSpawn: (...a: unknown[]) => Promise<unknown> };
		const inner = git._runSpawn;
		git._runSpawn = (...a: unknown[]) => {
			spawns.push(a[1] as string[]);
			return inner(...a);
		};
	});

	teardown(() => {
		wt.cleanup();
		repo.cleanup();
	});

	function readHead(path: string): Promise<HeadState> {
		return (repo.provider.git as unknown as { _headReader: (path: string) => Promise<HeadState> })._headReader(
			path,
		);
	}

	test("the provider's head reader reads an unregistered linked worktree's HEAD without running git", async () => {
		assert.ok(!repo.provider.cache.isRegistered(wt.path), 'sanity: the worktree is unregistered');

		assert.deepStrictEqual(await readHead(wt.path), { branch: 'refs/heads/feature' });
		assert.deepStrictEqual(await readHead(repo.path), { branch: 'refs/heads/main' });

		execFileSync('git', ['checkout', '-q', '--detach'], { cwd: wt.path, stdio: 'pipe' });
		assert.strictEqual(await readHead(wt.path), 'detached');

		assert.deepStrictEqual(spawns, []);
	});

	test('a -C commit into an unregistered worktree names its branch, and spawns only the commit', async () => {
		const announced: { repoPath: string; changes: readonly string[]; refs?: readonly string[] }[] = [];
		const listener = repo.provider.onDidAnnounceChanges(e =>
			announced.push({ repoPath: e.repoPath, changes: e.changes, refs: e.refs }),
		);
		try {
			await repo.provider.git.run(
				{ cwd: repo.path, notify: 'infer' },
				'-C',
				wt.path,
				'commit',
				'--allow-empty',
				'-m',
				'Scratch work',
			);
		} finally {
			listener.dispose();
		}

		assert.deepStrictEqual(
			spawns.map(args => args.find(a => a === 'commit')),
			['commit'],
		);
		assert.deepStrictEqual(announced, [
			{
				repoPath: normalizePath(wt.path),
				changes: ['head', 'heads', 'index', 'pausedOp'],
				refs: ['refs/heads/feature'],
			},
			{ repoPath: normalizePath(repo.path), changes: ['heads'], refs: ['refs/heads/feature'] },
		]);
	});

	test('a commit on a HEAD kept as a symlink to its branch still announces a branch move', async function () {
		// Creating a symlink on Windows needs a privilege test machines may not have
		if (process.platform === 'win32') {
			this.skip();
		}

		// `core.preferSymlinkRefs` writes HEAD this way; reading the file follows the link to the branch's object id, as
		// a detached HEAD reads, so taking it for detached would announce no branch move at all
		const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo.path, encoding: 'utf-8' });
		const head = join(gitDir.trim(), 'HEAD');
		rmSync(head);
		symlinkSync('refs/heads/main', head);
		assert.match(readFileSync(head, 'utf-8'), /^[0-9a-f]{40,64}\s*$/, 'sanity: the link reads as an object id');

		const announced: { repoPath: string; changes: readonly string[]; refs?: readonly string[] }[] = [];
		const listener = repo.provider.onDidAnnounceChanges(e =>
			announced.push({ repoPath: e.repoPath, changes: e.changes, refs: e.refs }),
		);
		try {
			await repo.provider.git.run(
				{ cwd: repo.path, notify: 'infer' },
				'commit',
				'--allow-empty',
				'-m',
				'On a symlinked HEAD',
			);
		} finally {
			listener.dispose();
		}

		assert.deepStrictEqual(announced, [
			{ repoPath: normalizePath(repo.path), changes: ['head', 'heads', 'index', 'pausedOp'], refs: undefined },
		]);
	});
});
