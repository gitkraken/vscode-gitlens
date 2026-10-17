import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree } from './helpers.js';

/**
 * Worktrees share a `.git`'s refs, tags, stash, remotes and config, so a typed write's `onChanged` reaches
 * every registered checkout sharing the repository — the shared part of it, for the ones it didn't run in.
 */
suite('Typed write announcements across worktrees', () => {
	let repo: TestRepo;
	let announced: { repoPath: string; changes: RepositoryChange[] }[];
	let onAnnounced: ((repoPath: string) => void) | undefined;
	let worktree: ReturnType<typeof createWorktree>;
	let mainPath: string;
	let linkedPath: string;

	setup(async () => {
		announced = [];
		onAnnounced = undefined;
		repo = createTestRepo({
			hooks: {
				repository: {
					onChanged: (repoPath, changes) => {
						announced.push({ repoPath: repoPath, changes: changes });
						onAnnounced?.(repoPath);
					},
				},
			},
		});
		createBranch(repo.path, 'feature');
		worktree = createWorktree(repo.path, 'feature');

		mainPath = normalizePath(repo.path);
		linkedPath = normalizePath(worktree.path);
		for (const path of [repo.path, worktree.path]) {
			repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
		}
	});

	teardown(() => {
		worktree.cleanup();
		repo.cleanup();
	});

	function announcementsTo(path: string): RepositoryChange[][] {
		return announced.filter(a => a.repoPath === path).map(a => a.changes);
	}

	test('a branch created in a linked worktree is announced to it and to the main checkout', async () => {
		await repo.provider.branches.createBranch(worktree.path, 'created', 'HEAD');

		assert.deepStrictEqual(announcementsTo(linkedPath), [['heads']]);
		assert.deepStrictEqual(announcementsTo(mainPath), [['heads']]);
	});

	test('a commit in a linked worktree announces only the shared part to the main checkout', async () => {
		writeFileSync(join(worktree.path, 'file.txt'), 'content\n');
		execFileSync('git', ['add', 'file.txt'], { cwd: worktree.path, stdio: 'pipe' });

		await repo.provider.ops.commit(worktree.path, 'Add file');

		assert.deepStrictEqual(announcementsTo(linkedPath), [['head', 'heads', 'index']]);
		assert.deepStrictEqual(announcementsTo(mainPath), [['heads']]);
	});

	test('a sibling advances its status clock for a shared change', async () => {
		const before = repo.provider.cache.getStatusGeneration(mainPath);

		await repo.provider.branches.createBranch(worktree.path, 'created', 'HEAD');

		assert.ok(repo.provider.cache.getStatusGeneration(mainPath) > before);
	});

	/** Adds a second linked worktree, so the write's checkout has two siblings, and counts shared `refs` evictions */
	async function withTwoSiblings(
		run: (shared: {
			evictions: string[];
			reads: () => number;
			read: (path: string) => Promise<unknown>;
		}) => Promise<void>,
	): Promise<void> {
		createBranch(repo.path, 'other');
		const other = createWorktree(repo.path, 'other');
		try {
			repo.provider.cache.registerRepoPath(fileUri(other.path), await repo.provider.config.getGitDir(other.path));

			const cache = repo.provider.cache as unknown as {
				evictShared(key: string, repoPath: string, inFlight?: string): void;
			};
			const evictShared = cache.evictShared;
			const evictions: string[] = [];
			cache.evictShared = function (this: unknown, key, repoPath, inFlight) {
				if (key === 'refs') {
					evictions.push(repoPath);
				}
				evictShared.call(this, key, repoPath, inFlight);
			};

			let reads = 0;
			const read = (path: string) =>
				repo.provider.cache.getRefs(path, async () => {
					reads++;
					await new Promise(resolve => setTimeout(resolve, 10));
					return [];
				});
			// A cached entry to evict
			await read(mainPath);
			reads = 0;

			await run({ evictions: evictions, reads: () => reads, read: read });
		} finally {
			other.cleanup();
		}
	}

	test("a typed write's announcement evicts shared caches once, and a read started on hearing it survives its siblings", async () => {
		await withTwoSiblings(async shared => {
			let pending: Promise<unknown> | undefined;
			onAnnounced = path => {
				if (path === linkedPath) {
					pending ??= shared.read(path);
				}
			};

			repo.provider.context.hooks!.repository!.onChanged!(worktree.path, ['heads']);

			assert.strictEqual(announced.length, 3, 'the write and both siblings are announced');
			assert.strictEqual(shared.evictions.length, 1, "only the write's own checkout evicts shared refs");
			assert.ok(pending != null);

			await shared.read(mainPath);
			await pending;
			assert.strictEqual(shared.reads(), 1, 'the read started from the first announcement is joined');
		});
	});

	test('a raw write notified for a linked worktree evicts shared caches once', async () => {
		await withTwoSiblings(async shared => {
			const before = repo.provider.cache.getStatusGeneration(mainPath);

			repo.provider.notifyChanged(worktree.path, ['heads']);

			assert.strictEqual(announced.length, 3);
			assert.strictEqual(shared.evictions.length, 1, "only the write's own checkout evicts shared refs");
			assert.ok(repo.provider.cache.getStatusGeneration(mainPath) > before, 'a sibling still advances its clock');
		});
	});

	test('a change worktrees do not share is not announced to siblings', () => {
		repo.provider.notifyChanged(worktree.path, ['index']);

		assert.deepStrictEqual(announcementsTo(linkedPath), [['index']]);
		assert.deepStrictEqual(announcementsTo(mainPath), []);
	});

	test('an unknown change reaches siblings as every shared kind', () => {
		repo.provider.notifyChanged(worktree.path, ['unknown']);

		assert.deepStrictEqual(announcementsTo(linkedPath), [['unknown']]);
		assert.deepStrictEqual(announcementsTo(mainPath), [
			['heads', 'tags', 'stash', 'remotes', 'worktrees', 'config'],
		]);
	});

	test('an empty change reaches siblings as every shared kind', () => {
		repo.provider.notifyChanged(worktree.path, []);

		assert.deepStrictEqual(announcementsTo(mainPath), [
			['heads', 'tags', 'stash', 'remotes', 'worktrees', 'config'],
		]);
	});

	test("a raw -C run with notify: 'infer' reaches each checkout once", async () => {
		await repo.provider.git.run({ cwd: repo.path, notify: 'infer' }, '-C', worktree.path, 'tag', 'raw-tag');

		assert.deepStrictEqual(announcementsTo(linkedPath), [['tags']]);
		assert.deepStrictEqual(announcementsTo(mainPath), [['tags']]);
	});

	test("a raw -C commit with notify: 'infer' tells the caller's cwd only the shared part", async () => {
		await repo.provider.git.run(
			{ cwd: repo.path, notify: 'infer' },
			'-C',
			worktree.path,
			'commit',
			'--allow-empty',
			'-m',
			'raw',
		);

		assert.deepStrictEqual(announcementsTo(linkedPath), [['head', 'heads', 'index', 'pausedOp']]);
		assert.deepStrictEqual(announcementsTo(mainPath), [['heads']]);
	});

	test('a checkout that is not registered is not announced to', async () => {
		repo.provider.cache.unregisterRepoPath(linkedPath);

		await repo.provider.branches.createBranch(repo.path, 'created', 'HEAD');

		assert.deepStrictEqual(announcementsTo(mainPath), [['heads']]);
		assert.deepStrictEqual(announcementsTo(linkedPath), []);
	});
});
