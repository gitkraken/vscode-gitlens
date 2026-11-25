import * as assert from 'assert';
import * as sinon from 'sinon';
import type { CachedGitTypes } from '@gitlens/git/cache.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createBranch, createTestRepo, createWorktree } from './helpers.js';

suite('Cache — an index change keeps cached git results', () => {
	const completed: string[] = [];
	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};

	let repo: TestRepo;
	let linked: { path: string; cleanup: () => void };

	setup(async () => {
		repo = createTestRepo({ gitOptions: { logger: countingLogger } });
		createBranch(repo.path, 'task');
		addCommit(repo.path, 'main.txt', 'main', 'Work on main');
		linked = createWorktree(repo.path, 'task');
		addCommit(linked.path, 'task.txt', 'task', 'Work on task');
		for (const path of [repo.path, linked.path]) {
			repo.provider.cache.registerRepoPath(fileUri(path), await repo.provider.config.getGitDir(path));
		}
	});

	teardown(() => {
		linked.cleanup();
		repo.cleanup();
	});

	/** The git processes a merge-base read in the linked worktree spawns */
	async function readMergeBase(): Promise<string[]> {
		const mark = completed.length;
		const base = await repo.provider.refs.getMergeBase(linked.path, 'main', 'task');
		assert.ok(base, 'main and task share a commit');
		return completed.slice(mark);
	}

	function mergeBases(spawned: string[]): number {
		return spawned.filter(line => line.includes('merge-base')).length;
	}

	test('an index change in any worktree leaves the cached merge base, and a ref change drops it', async () => {
		assert.strictEqual(mergeBases(await readMergeBase()), 1);
		assert.deepStrictEqual(await readMergeBase(), [], 'a repeat is served from the cache');

		repo.provider.cache.onRepositoryChanged(repo.path, ['index']);
		assert.deepStrictEqual(await readMergeBase(), [], 'an index change in another worktree');

		repo.provider.cache.onRepositoryChanged(linked.path, ['index']);
		assert.deepStrictEqual(await readMergeBase(), [], 'an index change in the worktree itself');

		repo.provider.cache.onRepositoryChanged(repo.path, ['heads']);
		assert.strictEqual(mergeBases(await readMergeBase()), 1, 'a branch tip move must re-run it');
	});
});

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
